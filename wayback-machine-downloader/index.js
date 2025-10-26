/*
 * Wayback Machine Downloader 0.3.0 by WhitelightSEO
 * Run: node index.js
 */

import { pathToFileURL } from "url";

import { setDebugMode, getDebugMode, debugLog } from "./lib/logger.js";
import { WaybackMachineDownloader } from "./lib/downloader.js";

const DEBUG_MODE = false;
setDebugMode(DEBUG_MODE);

const isDirectRun = (() => {
  const entryArg = process.argv && process.argv.length > 1 ? process.argv[1] : null;
  if (!entryArg) return false;

  if (import.meta.url === `file://${entryArg}`) {
    return true;
  }

  try {
    return import.meta.url === pathToFileURL(entryArg).href;
  } catch (e) {
    debugLog(`Failed to resolve entry script URL: ${e}`);
    return false;
  }
})();

if (isDirectRun) {
  import("./cli.js")
    .then(({ interactiveMain }) => interactiveMain())
    .catch((err) => {
      console.error(`FATAL: ${err?.stack || err}`);
      process.exit(1);
    });
}

export { WaybackMachineDownloader, DEBUG_MODE, setDebugMode, getDebugMode };