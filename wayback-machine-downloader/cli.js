#!/usr/bin/env node

import path from "path";
import readline from "readline";

import { WaybackMachineDownloader } from "./lib/downloader.js";
import { normalizeBaseUrlInput } from "./lib/utils.js";

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));
}

async function interactiveMain() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  let normalizedBase;
  while (true) {
    const baseInput = await ask(rl, "Enter domain or URL to archive (e.g., example.com): ");
    if (!baseInput) continue;
    try {
      normalizedBase = normalizeBaseUrlInput(baseInput);
      break;
    } catch {
      console.log("Please enter a valid domain or URL.\n");
    }
  }

  const base_url = normalizedBase.canonicalUrl;

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

  const exact_url = /^y(es)?$/i.test(await ask(rl, "Only exact URL (no wildcard /*)? (yes/no, default no): "));
  const directory = await ask(rl, "Target directory (leave blank for default websites/<host>/): ");

  const ext = await ask(rl, "Download external assets? (yes/no, default no): ");
  const download_external_assets = /^y(es)?$/i.test(ext);

  rl.close();

  const dl = new WaybackMachineDownloader({
    base_url,
    normalized_base: normalizedBase,
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

const isDirectCliRun = (() => {
  const entryArg = process.argv && process.argv.length > 1 ? process.argv[1] : null;
  if (!entryArg) return false;
  try {
    return import.meta.url === `file://${path.resolve(entryArg)}`;
  } catch {
    return false;
  }
})();

if (isDirectCliRun) {
  interactiveMain().catch((err) => {
    console.error(`FATAL: ${err?.stack || err}`);
    process.exit(1);
  });
}

export { interactiveMain };