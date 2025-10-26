import fs from "fs";
import path from "path";
import { mkdir } from "fs/promises";
import { load } from "cheerio";
import { Readable } from "stream";
import { domainToUnicode } from "url";

import { debugLog } from "./logger.js";
import {
  relativeLink,
  ensureLocalTargetForPath,
  isCssResource,
} from "./utils.js";

class AssetManager {
  constructor({
    backupPathResolver,
    rewriteLinks,
    canonicalAction,
    downloadExternalAssets,
    baseHostUnicode,
    snapshotIndex,
  }) {
    this.backupPathResolver = backupPathResolver;
    this.rewriteLinks = !!rewriteLinks;
    this.canonicalAction = canonicalAction || "keep";
    this.downloadExternalAssets = !!downloadExternalAssets;
    this.baseHostUnicode = (baseHostUnicode || "").toLowerCase();
    this.snapshotIndex = snapshotIndex || null;
  }

  setSnapshotIndex(index) {
    this.snapshotIndex = index;
  }

  get backupPath() {
    const resolver = this.backupPathResolver;
    return typeof resolver === "function" ? resolver() : resolver;
  }

  windowsSanitize(p) {
    if (process.platform !== "win32") return p;
    return p.replace(/[:*?&=<>\\|]/g, (s) => "%" + s.charCodeAt(0).toString(16));
  }

  async ensureDir(dirPath) {
    try {
      await mkdir(dirPath, { recursive: true });
    } catch (e) {
      if (!e || e.code !== "EEXIST") throw e;
    }
  }

  determinePaths(fileUrl, fileId) {
    if (!fileUrl || !fileId) return null;
    if (fileUrl.startsWith("data:") || fileUrl.startsWith("javascript:")) return null;
    if (fileId.length > 200) return null;

    const backup = this.backupPath;
    const parts = fileId.split("/").filter(Boolean);
    let dirPath;
    let filePath;

    if (fileId === "") {
      dirPath = backup;
      filePath = path.join(backup, "index.html");
    } else {
      const lastPart = parts[parts.length - 1] || "";
      if (fileUrl.endsWith("/") || !lastPart.includes(".")) {
        dirPath = path.join(backup, ...parts);
        filePath = path.join(dirPath, "index.html");
      } else {
        dirPath = path.join(backup, ...parts.slice(0, -1));
        filePath = path.join(backup, ...parts);
      }
    }

    dirPath = this.windowsSanitize(dirPath);
    filePath = this.windowsSanitize(filePath);

    return { dirPath, filePath };
  }

  resolveAssetTimestamp(assetUrl, fallbackTimestamp) {
    if (!this.snapshotIndex) return fallbackTimestamp || 0;
    return this.snapshotIndex.resolve(assetUrl, fallbackTimestamp);
  }

  async downloadAsset(assetUrl, pageTimestamp, filePath, dirPath) {
    try {
      if (fs.existsSync(filePath)) return filePath;

      await this.ensureDir(dirPath);
      const assetTimestamp = this.resolveAssetTimestamp(assetUrl, pageTimestamp);
      if (!assetTimestamp) {
        debugLog(`Skipping asset ${assetUrl}, no timestamp available in range.`);
        return null;
      }
      const snapshotUrl = `https://web.archive.org/web/${assetTimestamp}id_/${assetUrl}`;
      let res;
      try {
        res = await fetch(snapshotUrl, { method: "GET", redirect: "follow" });
      } catch (e) {
        debugLog(`Skipping asset ${assetUrl}, fetch failed: ${e}`);
        return null;
      }
      if (!res.ok || !res.body) {
        debugLog(`Skipping asset ${assetUrl}, bad response ${res.status}`);
        return null;
      }

      const contentType = res.headers.get("content-type") || "";

      await new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(filePath);
        Readable.fromWeb(res.body).pipe(ws);
        ws.on("finish", resolve);
        ws.on("error", reject);
      });

      if (this.rewriteLinks && isCssResource(filePath, assetUrl, contentType)) {
        await this.rewriteCssFile(filePath, assetUrl, assetTimestamp);
      }

      return filePath;
    } catch (e) {
      debugLog(`Asset download failed: ${assetUrl} → ${e}`);
      return null;
    }
  }

  async rewriteCssContent(cssContent, cssSourceUrl, pageTimestamp, { baseDir, excludePath } = {}) {
    if (!this.rewriteLinks) {
      return { css: cssContent, downloads: [] };
    }

    if (!cssContent || !cssContent.trim()) {
      return { css: cssContent, downloads: [] };
    }

    const siteHost = this.baseHostUnicode;
    const downloads = [];
    const seenPaths = new Set();
    let updatedContent = cssContent;
    let cssChanged = false;

    const processReference = (rawValue) => {
      if (!rawValue) return null;
      const trimmed = rawValue.trim();
      if (!trimmed) return null;
      if (/^(data:|javascript:|#)/i.test(trimmed)) return null;

      let absoluteUrl;
      try {
        absoluteUrl = new URL(trimmed, cssSourceUrl).toString();
      } catch {
        return null;
      }

      let parsed;
      try {
        parsed = new URL(absoluteUrl);
      } catch {
        return null;
      }
      if (!/^https?:$/i.test(parsed.protocol)) return null;

      const normalizedHost = domainToUnicode(parsed.hostname.replace(/^www\./, "")).toLowerCase();
      const isInternal = normalizedHost === siteHost;
      if (!isInternal && !this.downloadExternalAssets) return null;

      let fileId;
      try {
        fileId = decodeURIComponent(parsed.pathname);
      } catch {
        fileId = parsed.pathname;
      }
      let paths;
      try {
        paths = this.determinePaths(absoluteUrl, fileId);
      } catch {
        return null;
      }
      if (!paths) return null;

      const { dirPath, filePath } = paths;
      const assetTimestamp = this.resolveAssetTimestamp(absoluteUrl, pageTimestamp);

      if (
        filePath &&
        (!excludePath || path.resolve(filePath) !== path.resolve(excludePath))
      ) {
        const key = path.resolve(filePath);
        if (!fs.existsSync(filePath) && !seenPaths.has(key)) {
          seenPaths.add(key);
          downloads.push(this.downloadAsset(absoluteUrl, assetTimestamp, filePath, dirPath));
        }
      }

      const relativeBase = baseDir || path.dirname(filePath);
      const relativePath = relativeLink(relativeBase, filePath) + (parsed.hash || "");

      return {
        original: trimmed,
        replacement: relativePath,
      };
    };

    const urlPattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
    updatedContent = updatedContent.replace(urlPattern, (match, quote, value) => {
      const info = processReference(value);
      if (!info) return match;
      if (info.replacement === info.original) return match;
      cssChanged = true;
      const q = quote || "";
      return `url(${q}${info.replacement}${q})`;
    });

    const importPattern = /@import\s+(?!url\()\s*(['"])([^'"]+)\1/gi;
    updatedContent = updatedContent.replace(importPattern, (match, quote, value) => {
      const info = processReference(value);
      if (!info) return match;
      if (info.replacement === info.original) return match;
      cssChanged = true;
      return match.replace(value, info.replacement);
    });

    return {
      css: cssChanged && updatedContent !== cssContent ? updatedContent : cssContent,
      downloads,
    };
  }

  async rewriteCssFile(cssPath, cssSourceUrl, pageTimestamp) {
    if (!this.rewriteLinks) return;

    let cssContent;
    try {
      cssContent = fs.readFileSync(cssPath, "utf8");
    } catch {
      return;
    }

    const cssDir = path.dirname(cssPath);
    const { css: updatedContent, downloads } = await this.rewriteCssContent(
      cssContent,
      cssSourceUrl,
      pageTimestamp,
      {
        baseDir: cssDir,
        excludePath: cssPath,
      }
    );

    if (downloads.length > 0) {
      await Promise.all(downloads);
    }

    if (updatedContent !== cssContent) {
      fs.writeFileSync(cssPath, updatedContent, "utf8");
    }
  }

  async processHtml(htmlPath, pageUrl, pageTimestamp) {
    try {
      let html = fs.readFileSync(htmlPath, "utf8");
      const $ = load(html, { decodeEntities: false });
      const siteHost = this.baseHostUnicode;
      const baseDir = path.dirname(htmlPath);
      const backupRoot = this.backupPath;

      const downloadTasks = [];

      const handleCssFragment = async (cssText) => {
        const { css: updatedCss, downloads } = await this.rewriteCssContent(
          cssText,
          pageUrl,
          pageTimestamp,
          { baseDir }
        );
        if (downloads.length > 0) {
          downloadTasks.push(...downloads);
        }
        return updatedCss;
      };

      $("img[src], script[src], link[href], source[src], video[src], audio[src], iframe[src]").each((_, el) => {
        const attr = el.tagName === "link" ? "href" : "src";
        const val = $(el).attr(attr);
        if (!val) return;

        try {
          const abs = new URL(val, pageUrl).toString();
          const u = new URL(abs);
          const normalizedHost = domainToUnicode(u.hostname.replace(/^www\./, "")).toLowerCase();
          const isInternal = normalizedHost === siteHost;

          if (isInternal || this.downloadExternalAssets) {
            let fileId;
            try {
              fileId = decodeURIComponent(u.pathname);
            } catch {
              fileId = u.pathname;
            }
            let paths;
            try {
              paths = this.determinePaths(abs, fileId);
            } catch (e) {
              console.log(`Invalid path for asset ${abs}: ${e}`);
              return;
            }
            if (!paths) return;
            const { dirPath, filePath } = paths;

            if (this.rewriteLinks) {
              const normPath = fileId + (u.hash || "");
              const localTarget = ensureLocalTargetForPath(normPath);
              const localAbsPath = path.join(backupRoot, localTarget);
              $(el).attr(attr, relativeLink(baseDir, localAbsPath));
            }

            if (!fs.existsSync(filePath)) {
              downloadTasks.push(
                this.downloadAsset(abs, pageTimestamp, filePath, dirPath)
              );
            }
          }
        } catch {}
      });

      const styleNodes = $("style").toArray();
      for (const node of styleNodes) {
        const cssText = $(node).html();
        if (!cssText) continue;
        const updated = await handleCssFragment(cssText);
        if (updated !== cssText) {
          $(node).text(updated);
        }
      }

      const inlineStyled = $("[style]").toArray();
      for (const node of inlineStyled) {
        const styleAttr = $(node).attr("style");
        if (!styleAttr) continue;
        const updated = await handleCssFragment(styleAttr);
        if (updated !== styleAttr) {
          $(node).attr("style", updated);
        }
      }

      if (this.rewriteLinks) {
        $("a[href], form[action]").each((_, el) => {
          const attr = el.tagName === "a" ? "href" : "action";
          const val = $(el).attr(attr);
          if (!val) return;

          try {
            const abs = new URL(val, pageUrl).toString();
            const u = new URL(abs);
            const normalizedHost = domainToUnicode(u.hostname.replace(/^www\./, "")).toLowerCase();
            const isInternal = normalizedHost === siteHost;

            if (isInternal) {
              let normPath;
              try {
                normPath = decodeURIComponent(u.pathname);
              } catch {
                normPath = u.pathname;
              }
              normPath += u.hash || "";
              const localTarget = ensureLocalTargetForPath(normPath);
              const localAbsPath = path.join(backupRoot, localTarget);
              $(el).attr(attr, relativeLink(baseDir, localAbsPath));
            }
          } catch {}
        });
      }

      await Promise.all(downloadTasks);

      if (this.canonicalAction === "remove") {
        $("link[rel=\"canonical\"]").remove();
      }

      fs.writeFileSync(htmlPath, $.html(), "utf8");
    } catch (e) {
      console.log(`HTML processing error: ${e}`);
    }
  }
}

export { AssetManager };