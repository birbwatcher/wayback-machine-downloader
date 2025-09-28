/*
 * Wayback Machine Downloader 0.2 by WhitelightSEO — Interactive (Node.js, ESM)
 * Run: node downloader.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL, domainToUnicode } from "url";
import { mkdir } from "fs/promises";
import pLimit from "p-limit";
import { load } from "cheerio";
import { Readable } from "stream";
import readline from "readline";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----------------------------- PROGRESS BAR -----------------------------
function renderProgress(current, total) {
  const width = 40;
  const ratio = total > 0 ? current / total : 0;
  const filled = Math.round(ratio * width);
  const bar = "█".repeat(filled) + "-".repeat(width - filled);
  process.stdout.write(
    `\r[${bar}] ${Math.round(ratio * 100)}% (${current}/${total})`
  );
  if (current === total) process.stdout.write("\n");
}

// ----------------------------- HELPERS -----------------------------
function toPosix(p) {
  return p.split(path.sep).join("/");
}
function relativeLink(fromDir, toFile) {
  const rel = path.relative(fromDir, toFile);
  return toPosix(rel || path.basename(toFile));
}
function ensureLocalTargetForPath(pathname) {
  return pathname.endsWith("/") || !path.posix.basename(pathname).includes(".")
    ? path.posix.join(pathname, "index.html")
    : pathname;
}

// ----------------------------- HTML CHECK -----------------------------
function isHtmlFile(filePath, contentType, firstBytes) {
  if (contentType && /text\/html/i.test(String(contentType))) return true;
  const ext = path.extname(filePath).toLowerCase();
  if ([".html", ".htm", ".php", ".asp", ".aspx"].includes(ext)) return true;
  const head = (firstBytes || "").toString("utf8", 0, 512);
  return /<!doctype html/i.test(head) || /<html[\s>]/i.test(head);
}

// ----------------------------- Archive API -----------------------------
async function getRawListFromApi({
  baseUrl,
  pageIndex,
  all,
  fromTimestamp,
  toTimestamp,
}) {
  const cdx = new URL("https://web.archive.org/cdx/search/xd");
  const params = new URLSearchParams();
  params.set("output", "json");
  params.set("url", baseUrl);
  params.set("fl", "timestamp,original");
  params.set("collapse", "digest");
  params.set("gzip", "false");
  if (!all) params.append("filter", "statuscode:200");
  if (fromTimestamp && Number(fromTimestamp) !== 0)
    params.set("from", String(fromTimestamp));
  if (toTimestamp && Number(toTimestamp) !== 0)
    params.set("to", String(toTimestamp));
  if (pageIndex != null) params.set("page", String(pageIndex));
  cdx.search = params.toString();

  try {
    const res = await fetch(cdx.toString(), { method: "GET", redirect: "follow" });
    const text = await res.text();
    const json = JSON.parse(text);
    if (
      Array.isArray(json) &&
      Array.isArray(json[0]) &&
      json[0].join(",") === "timestamp,original"
    ) {
      json.shift();
    }
    return json || [];
  } catch (e) {
    console.log(`ERROR getRawListFromApi: ${e}`);
    return [];
  }
}

// ----------------------------- DOWNLOADER CLASS -----------------------------
class WaybackMachineDownloader {
  constructor(params) {
    this.base_url = params.base_url;
    this.exact_url = !!params.exact_url;
    this.directory = params.directory || null;
    this.from_timestamp = params.from_timestamp
      ? Number(params.from_timestamp)
      : 0;
    this.to_timestamp = params.to_timestamp ? Number(params.to_timestamp) : 0;
    this.threads_count =
      params.threads_count != null ? Number(params.threads_count) : 3;

    this.download_external_assets = params.download_external_assets || false;

    this.rewrite_mode = params.rewrite_mode || "as-is";
    this.rewrite_links = this.rewrite_mode === "relative";
    this.canonical_action = params.canonical_action || "keep";

    this._processed = 0;
  }

  backup_name() {
    try {
      if (this.base_url.includes("//")) {
        const u = new URL(this.base_url);
        return domainToUnicode(u.host); // use human-readable domain
      }
    } catch {}
    return this.base_url;
  }

  backup_path() {
    if (this.directory) {
      return this.directory.endsWith(path.sep)
        ? this.directory
        : this.directory + path.sep;
    }
    return path.join("websites", this.backup_name(), path.sep);
  }

  async get_all_snapshots_to_consider() {
    console.log("Getting snapshot pages");
    const httpOpts = {
      all: true,
      fromTimestamp: this.from_timestamp,
      toTimestamp: this.to_timestamp,
    };
    let list = [];

    list = list.concat(
      await getRawListFromApi({ baseUrl: this.base_url, pageIndex: null, ...httpOpts })
    );
    process.stdout.write(".");

    if (!this.exact_url) {
      const wildcard = this.base_url.endsWith("/*")
        ? this.base_url
        : this.base_url.replace(/\/*$/, "") + "/*";
      for (let i = 0; i < 100; i++) {
        const batch = await getRawListFromApi({
          baseUrl: wildcard,
          pageIndex: i,
          ...httpOpts,
        });
        if (!batch || batch.length === 0) break;
        list = list.concat(batch);
        process.stdout.write(".");
      }
    }
    console.log(` found ${list.length} snapshots to consider.\n`);
    return list;
  }

  async get_file_list_by_timestamp() {
    const curated = new Map();
    const all = await this.get_all_snapshots_to_consider();
    for (const pair of all) {
      const ts = pair[0];
      const url = pair[1];
      try {
        const u = new URL(url);
        const file_id = decodeURIComponent(u.pathname); // decode Cyrillic paths
        const prev = curated.get(file_id);
        if (!prev || prev.timestamp <= ts) {
          curated.set(file_id, { file_url: url, timestamp: ts, file_id });
        }
      } catch {}
    }
    const arr = Array.from(curated, ([file_id, v]) => ({ ...v, file_id }));
    arr.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
    return arr;
  }

  _windowsSanitize(p) {
    if (process.platform !== "win32") return p;
    return p.replace(/[:*?&=<>\\|]/g, (s) =>
      "%" + s.charCodeAt(0).toString(16)
    );
  }

  async _structure_dir_path(dir_path) {
    try {
      await mkdir(dir_path, { recursive: true });
    } catch (e) {
      if (!e || e.code !== "EEXIST") throw e;
    }
  }

  _determine_paths(file_url, file_id) {
    if (file_url.startsWith("data:") || file_url.startsWith("javascript:"))
      return null;
    if (file_id.length > 200) return null;

    const backup = this.backup_path();
    const parts = file_id.split("/").filter(Boolean);
    let dir_path, file_path;

    if (file_id === "") {
      dir_path = backup;
      file_path = path.join(backup, "index.html");
    } else if (
      file_url.endsWith("/") ||
      !parts[parts.length - 1].includes(".")
    ) {
      dir_path = path.join(backup, ...parts);
      file_path = path.join(dir_path, "index.html");
    } else {
      dir_path = path.join(backup, ...parts.slice(0, -1));
      file_path = path.join(backup, ...parts);
    }

    dir_path = this._windowsSanitize(dir_path);
    file_path = this._windowsSanitize(file_path);

    return { dir_path, file_path };
  }

  async _download_asset(assetUrl, pageTimestamp, file_path, dir_path) {
    try {
      if (fs.existsSync(file_path)) return file_path;

      await this._structure_dir_path(dir_path);
      const snapshotUrl = `https://web.archive.org/web/${pageTimestamp}id_/${assetUrl}`;
      let res;
      try {
        res = await fetch(snapshotUrl, { method: "GET", redirect: "follow" });
      } catch (e) {
        console.log(`Skipping asset ${assetUrl}, fetch failed: ${e}`);
        return null;
      }
      if (!res.ok || !res.body) {
        console.log(`Skipping asset ${assetUrl}, bad response ${res.status}`);
        return null;
      }

      await new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(file_path);
        Readable.fromWeb(res.body).pipe(ws);
        ws.on("finish", resolve);
        ws.on("error", reject);
      });

      return file_path;
    } catch (e) {
      console.log(`Asset download failed: ${assetUrl} → ${e}`);
      return null;
    }
  }

  async _process_html_assets(htmlPath, pageUrl, pageTimestamp) {
    try {
      const backupRoot = this.backup_path();
      let html = fs.readFileSync(htmlPath, "utf8");
      const $ = load(html);
      const site = new URL(this.base_url);
      const siteHost = domainToUnicode(site.hostname.replace(/^www\./, ""));
      const baseDir = path.dirname(htmlPath);

      const downloadTasks = [];

      // ----------- ASSETS -----------
      $(
        "img[src], script[src], link[href], source[src], video[src], audio[src], iframe[src]"
      ).each((_, el) => {
        const attr = el.tagName === "link" ? "href" : "src";
        const val = $(el).attr(attr);
        if (!val) return;

        try {
          const abs = new URL(val, pageUrl).toString();
          const u = new URL(abs);
          const isInternal =
            domainToUnicode(u.hostname.replace(/^www\./, "")) === siteHost;

          if (isInternal || this.download_external_assets) {
            const file_id = decodeURIComponent(u.pathname);
            const paths = this._determine_paths(abs, file_id);
            if (!paths) return;
            const { dir_path, file_path } = paths;

            if (this.rewrite_links) {
              const normPath = decodeURIComponent(u.pathname) + (u.hash || "");
              const localTarget = ensureLocalTargetForPath(normPath);
              const localAbsPath = path.join(backupRoot, localTarget);
              $(el).attr(attr, relativeLink(baseDir, localAbsPath));
            }

            if (!fs.existsSync(file_path)) {
              downloadTasks.push(
                this._download_asset(abs, pageTimestamp, file_path, dir_path)
              );
            }
          }
        } catch {}
      });

      // ----------- INTERNAL LINKS (pages/forms) -----------
      if (this.rewrite_links) {
        $("a[href], form[action]").each((_, el) => {
          const attr = el.tagName === "a" ? "href" : "action";
          const val = $(el).attr(attr);
          if (!val) return;

          try {
            const abs = new URL(val, pageUrl).toString();
            const u = new URL(abs);
            const isInternal =
              domainToUnicode(u.hostname.replace(/^www\./, "")) === siteHost;

            if (isInternal) {
              const normPath = decodeURIComponent(u.pathname) + (u.hash || "");
              const localTarget = ensureLocalTargetForPath(normPath);
              const localAbsPath = path.join(backupRoot, localTarget);
              $(el).attr(attr, relativeLink(baseDir, localAbsPath));
            }
          } catch {}
        });
      }

      await Promise.all(downloadTasks);

      if (this.canonical_action === "remove") {
        $("link[rel=\"canonical\"]").remove();
      }

      fs.writeFileSync(htmlPath, $.html(), "utf8");
    } catch (e) {
      console.log(`HTML processing error: ${e}`);
    }
  }

  async _download_single(file_remote_info, total) {
    const file_url = String(file_remote_info.file_url);
    const file_id = file_remote_info.file_id;
    const file_timestamp = file_remote_info.timestamp;
    const paths = this._determine_paths(file_url, file_id);
    if (!paths) {
      console.log(`Skipping invalid URL: ${file_url}`);
      this._processed++;
      renderProgress(this._processed, total);
      return;
    }
    const { dir_path, file_path } = paths;

    if (fs.existsSync(file_path)) {
      this._processed++;
      renderProgress(this._processed, total);
      return;
    }

    try {
      await this._structure_dir_path(dir_path);
      const snapshotUrl = `https://web.archive.org/web/${file_timestamp}id_/${file_url}`;
      let res;
      try {
        res = await fetch(snapshotUrl, { method: "GET", redirect: "follow" });
      } catch (e) {
        console.log(`Skipping ${file_url}, fetch failed: ${e}`);
        return;
      }

      if (!res.ok || !res.body) {
        console.log(`Skipping ${file_url}, bad response ${res.status}`);
        return;
      }

      await new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(file_path);
        Readable.fromWeb(res.body).pipe(ws);
        ws.on("finish", resolve);
        ws.on("error", reject);
      });

      const contentType = res.headers.get("content-type");
      const ext = path.extname(file_path).toLowerCase();
      const looksHtml =
        isHtmlFile(file_path, contentType, null) ||
        ext === "" ||
        ext === ".html" ||
        ext === ".htm";
      if (looksHtml) {
        await this._process_html_assets(file_path, file_url, file_timestamp);
      }
    } catch (e) {
      console.log(`Download failed for ${file_url}: ${e}`);
    } finally {
      this._processed++;
      renderProgress(this._processed, total);
    }
  }

  async download_files() {
    const startTime = Date.now();
    console.log(
      `Downloading ${this.base_url} to ${this.backup_path()} from Wayback Machine archives.`
    );
    const list = await this.get_file_list_by_timestamp();
    if (list.length === 0) {
      console.log("No files to download.");
      return;
    }

    const concurrency =
      this.threads_count && this.threads_count > 0 ? this.threads_count : 1;
    const limit = pLimit(concurrency);
    this._processed = 0;
    await Promise.all(
      list.map((info) => limit(() => this._download_single(info, list.length)))
    );
    const endTime = Date.now();
    console.log(
      `\nDownload completed in ${((endTime - startTime) / 1000).toFixed(
        2
      )}s, saved in ${this.backup_path()} (${list.length} files)`
    );
  }
}

// ============================= INTERACTIVE RUN =============================
function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));
}

async function interactiveMain() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let base_url;
  while (true) {
    base_url = await ask(rl, "Enter base URL to archive (e.g., https://example.com): ");
    if (!base_url) continue;
    try {
      new URL(base_url);
      break;
    } catch {
      console.log("Please enter a valid URL.\n");
    }
  }

  const from_timestamp = await ask(rl, "From timestamp (YYYYMMDDhhmmss) or leave blank: ");
  const to_timestamp = await ask(rl, "To timestamp (YYYYMMDDhhmmss) or leave blank: ");

  let rewrite_mode = "as-is";
  const m = await ask(rl, "Rewrite links? (yes=relative / no=as-is, default no): ");
  if (/^y(es)?$/i.test(m)) rewrite_mode = "relative";

  let canonical_action = "keep";
  if (rewrite_mode === "relative") {
    const c = await ask(rl, 'Canonical: "keep" (default) or "remove": ');
    if ((c || "").toLowerCase() === "remove") canonical_action = "remove";
  }

  let threads_count = await ask(rl, "How many download threads? (default 3): ");
  threads_count = parseInt(threads_count || "3", 10);
  if (!Number.isFinite(threads_count) || threads_count <= 0) threads_count = 3;

  const exact_url = /^y(es)?$/i.test(
    await ask(rl, "Only exact URL (no wildcard /*)? (yes/no, default no): ")
  );
  const directory = await ask(
    rl,
    "Target directory (leave blank for default websites/<host>/): "
  );

  const ext = await ask(rl, "Download external assets? (yes/no, default no): ");
  const download_external_assets = /^y(es)?$/i.test(ext);

  rl.close();

  const dl = new WaybackMachineDownloader({
    base_url,
    exact_url,
    directory: directory || null,
    from_timestamp: from_timestamp || 0,
    to_timestamp: to_timestamp || 0,
    threads_count,
    rewrite_mode,
    canonical_action,
    download_external_assets,
  });

  await dl.download_files();
}

const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  interactiveMain().catch((err) => {
    console.error(`FATAL: ${err?.stack || err}`);
    process.exit(1);
  });
}

export { WaybackMachineDownloader };
