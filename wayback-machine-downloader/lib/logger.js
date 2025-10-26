let debugMode = false;

function setDebugMode(value) {
  debugMode = !!value;
}

function getDebugMode() {
  return debugMode;
}

function debugLog(...args) {
  if (debugMode) {
    console.log(...args);
  }
}

function infoLog(...args) {
  console.log(...args);
}

export { setDebugMode, getDebugMode, debugLog, infoLog };