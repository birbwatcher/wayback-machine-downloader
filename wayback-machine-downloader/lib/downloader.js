import fs from "fs";
import path from "path";
import { domainToUnicode } from "url";
import pLimit from "p-limit";
import { Readable } from "stream";

import { debugLog } from "./logger.js";
import { renderProgress, normalizeBaseUrlInput, isHtmlFile, isCssResource } from "./utils.js";
import { SnapshotIndex } from "./snapshot-index.js";
import { AssetManager } from "./asset-manager.js";

async function getRawListFromApi({ baseUrl, pageIndex, all, fromTimestamp, toTimestamp }) {
  const cdx = new URL("https://web.archive.org/cdx/search/xd");
  const params = new URLSearchParams();
  params.set("output", "json");
  params.set("url", baseUrl);
  params.set("fl", "timestamp,original");
  params.set("collapse", "digest");
  params.set("gzip", "false");
  if (!all) params.append("filter", "statuscode:200");
  if (fromTimestamp && Number(fromTimestamp) !== 0) params.set("from", String(fromTimestamp));
  if (toTimestamp && Number(toTimestamp) !== 0) params.set("to", String(toTimestamp));
  if (pageIndex != null) params.set("page", String(pageIndex));
  cdx.search = params.toString();

  try {
    const res = await fetch(cdx.toString(), { method: "GET", redirect: "follow" });
    const text = await res.text();
    let json = [];
    try {
      json = JSON.parse(text);
    } catch {
      return [];
    }
    if (Array.isArray(json) && Array.isArray(json[0]) && json[0].join(",") === "timestamp,original") {
      json.shift();
    }
    return json || [];
  } catch {
    return [];
  }
}

class WaybackMachineDownloader {
  constructor(params) {
    const normalized = params.normalized_base || normalizeBaseUrlInput(params.base_url);

    this.base_url = normalized.canonicalUrl;
    this.base_variants = normalized.variants;
    this.base_host_unicode = (normalized.unicodeHost || normalized.bareHost).toLowerCase();

    this.exact_url = !!params.exact_url;
    this.directory = params.directory || null;
    this.from_timestamp = params.from_timestamp ? Number(params.from_timestamp) : 0;
    this.to_timestamp = params.to_timestamp ? Number(params.to_timestamp) : 0;
    this.threads_count = params.threads_count != null ? Number(params.threads_count) : 3;

    this.download_external_assets = params.download_external_assets || false;

    this.rewrite_mode = params.rewrite_mode || "as-is";
    this.rewrite_links = this.rewrite_mode === "relative";
    this.canonical_action = params.canonical_action || "keep";

    this._processed = 0;
    this.snapshotIndex = null;

    this.assetManager = new AssetManager({
      backupPathResolver: () => this.backup_path(),
      rewriteLinks: this.rewrite_links,
      canonicalAction: this.canonical_action,
      downloadExternalAssets: this.download_external_assets,
      baseHostUnicode: this.base_host_unicode,
      snapshotIndex: null,
    });
  }

  backup_name() {
    try {
      if (this.base_url.includes("//")) {
        const u = new URL(this.base_url);
        return domainToUnicode(u.host);
      }
    } catch {}
    return this.base_url;
  }

  backup_path() {
    if (this.directory) {
      return this.directory.endsWith(path.sep) ? this.directory : this.directory + path.sep;
    }
    return path.join("websites", this.backup_name(), path.sep);
  }

  async get_all_snapshots_to_consider() {
    console.log("Getting snapshot pages");
    const httpOpts = { all: true, fromTimestamp: this.from_timestamp, toTimestamp: this.to_timestamp };
    let list = [];
    const bases = this.base_variants && this.base_variants.length > 0 ? this.base_variants : [this.base_url];

    for (const base of bases) {
      list = list.concat(await getRawListFromApi({ baseUrl: base, pageIndex: null, ...httpOpts }));
      process.stdout.write(".");

      if (!this.exact_url) {
        const wildcard = base.endsWith("/*") ? base : base.replace(/\/*$/, "") + "/*";
        for (let i = 0; i < 100; i++) {
          const batch = await getRawListFromApi({ baseUrl: wildcard, pageIndex: i, ...httpOpts });
          if (!batch || batch.length === 0) break;
          list = list.concat(batch);
          process.stdout.write(".");
        }
      }
    }
    console.log(` found ${list.length} snapshots to consider.\n`);
    return list;
  }

  async get_file_list_by_timestamp() {
    const index = new SnapshotIndex();
    const all = await this.get_all_snapshots_to_consider();
    for (const pair of all) {
      const ts = pair && pair[0];
      const url = pair && pair[1];
      if (!ts || !url) continue;
      index.register(url, ts);
    }

    const manifest = index.getManifest();
    this.snapshotIndex = index;
    this.assetManager.setSnapshotIndex(index);
    return manifest;
  }

  async _download_single(file_remote_info, total) {
    const file_url = String(file_remote_info.file_url);
    const file_id = file_remote_info.file_id;
    const file_timestamp = file_remote_info.timestamp;

    let paths;
    try {
      paths = this.assetManager.determinePaths(file_url, file_id);
    } catch (e) {
      console.log(`Invalid path for ${file_url}: ${e}`);
      this._processed++;
      renderProgress(this._processed, total);
      return;
    }

    if (!paths) {
      console.log(`Skipping invalid URL: ${file_url}`);
      this._processed++;
      renderProgress(this._processed, total);
      return;
    }

    const { dirPath, filePath } = paths;

    if (fs.existsSync(filePath)) {
      this._processed++;
      renderProgress(this._processed, total);
      return;
    }

    try {
      await this.assetManager.ensureDir(dirPath);
      const snapshotUrl = `https://web.archive.org/web/${file_timestamp}id_/${file_url}`;
      let res;
      try {
        res = await fetch(snapshotUrl, { method: "GET", redirect: "follow" });
      } catch (e) {
        debugLog(`Skipping ${file_url}, fetch failed: ${e}`);
        return;
      }

      if (!res.ok || !res.body) {
        debugLog(`Skipping ${file_url}, bad response ${res.status}`);
        return;
      }

      await new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(filePath);
        const rs = Readable.fromWeb(res.body);

        let settled = false;
        const cleanupPartialFile = async () => {
          try {
            await fs.promises.rm(filePath, { force: true });
          } catch {}
        };

        const handleStreamError = (err) => {
          if (settled) return;
          settled = true;
          rs.destroy();
          ws.destroy();
          cleanupPartialFile().finally(() => reject(err));
        };

        rs.on("error", handleStreamError);
        ws.on("error", handleStreamError);
        ws.on("finish", () => {
          if (settled) return;
          settled = true;
          resolve();
        });

        rs.pipe(ws);
      });

      const contentType = res.headers.get("content-type") || "";
      const ext = path.extname(filePath).toLowerCase();
      const looksHtml = isHtmlFile(filePath, contentType, null) || ext === "" || ext === ".html" || ext === ".htm";
      if (this.rewrite_links && isCssResource(filePath, file_url, contentType)) {
        await this.assetManager.rewriteCssFile(filePath, file_url, file_timestamp);
      }
      if (this.rewrite_links && looksHtml) {
        await this.assetManager.processHtml(filePath, file_url, file_timestamp);
      }
    } catch (e) {
      debugLog(`Download failed for ${file_url}: ${e}`);
    } finally {
      this._processed++;
      renderProgress(this._processed, total);
    }
  }

  async download_files() {
    const startTime = Date.now();
    console.log(`Downloading ${this.base_url} to ${this.backup_path()} from Wayback Machine archives.`);
    const list = await this.get_file_list_by_timestamp();
    if (list.length === 0) {
      console.log("No files to download.");
      return;
    }

    const concurrency = this.threads_count && this.threads_count > 0 ? this.threads_count : 1;
    const limit = pLimit(concurrency);
    this._processed = 0;
    await Promise.all(list.map((info) => limit(() => this._download_single(info, list.length))));
    const endTime = Date.now();
    console.log(`\nDownload completed in ${((endTime - startTime) / 1000).toFixed(2)}s, saved in ${this.backup_path()} (${list.length} files)`);
  }
}

export { WaybackMachineDownloader };