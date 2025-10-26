import path from "path";
import { domainToUnicode } from "url";

function renderProgress(current, total) {
  const width = 40;
  const ratio = total > 0 ? current / total : 0;
  const filled = Math.round(ratio * width);
  const bar = "█".repeat(filled) + "-".repeat(width - filled);
  process.stdout.write(`\r[${bar}] ${Math.round(ratio * 100)}% (${current}/${total})`);
  if (current === total) process.stdout.write("\n");
}

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

function normalizeBaseUrlInput(input) {
  if (!input || typeof input !== "string") {
    throw new Error("Base URL must be a non-empty string");
  }

  let raw = input.trim();
  if (!raw) {
    throw new Error("Base URL must not be empty");
  }

  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) {
    raw = `https://${raw}`;
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (e) {
    throw new Error(`Invalid URL: ${e.message}`);
  }

  if (!/^https?:$/i.test(parsed.protocol)) {
    throw new Error("Only http and https protocols are supported");
  }

  const asciiHost = parsed.hostname.toLowerCase();
  if (!asciiHost) {
    throw new Error("URL must contain a hostname");
  }

  const bareHost = asciiHost.replace(/^www\./, "");
  const unicodeHost = domainToUnicode(bareHost);
  const port = parsed.port ? `:${parsed.port}` : "";
  const basePath = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname.replace(/\/+$/, "") : "";

  const canonicalUrl = `https://${bareHost}${port}${basePath}`;

  const hostSet = new Set([`${bareHost}${port}`]);
  if (asciiHost !== bareHost) {
    hostSet.add(`${asciiHost}${port}`);
  } else if (bareHost && bareHost.includes(".")) {
    hostSet.add(`www.${bareHost}${port}`);
  }

  const protocols = ["https:", "http:"];
  const variants = new Set();
  for (const protocol of protocols) {
    for (const host of hostSet) {
      variants.add(`${protocol}//${host}${basePath}`);
    }
  }

  return {
    canonicalUrl,
    variants: Array.from(variants),
    bareHost,
    unicodeHost,
  };
}

function isHtmlFile(filePath, contentType, firstBytes) {
  if (contentType && /text\/html/i.test(String(contentType))) return true;
  const ext = path.extname(filePath).toLowerCase();
  if ([".html", ".htm", ".php", ".asp", ".aspx"].includes(ext)) return true;
  const head = (firstBytes || "").toString("utf8", 0, 512);
  return /<!doctype html/i.test(head) || /<html[\s>]/i.test(head);
}

function isCssResource(filePath, resourceUrl, contentType) {
  const ext = path.extname(filePath || "").toLowerCase();
  if (ext === ".css") return true;
  if (contentType && /text\/css/i.test(String(contentType))) return true;
  if (resourceUrl) {
    try {
      const u = new URL(resourceUrl);
      if (/\.css(?:$|\?)/i.test(u.pathname)) return true;
    } catch {}
  }
  return false;
}

export {
  renderProgress,
  toPosix,
  relativeLink,
  ensureLocalTargetForPath,
  normalizeBaseUrlInput,
  isHtmlFile,
  isCssResource,
};