class SnapshotIndex {
  constructor() {
    this.byPath = new Map();
    this.byPathAndQuery = new Map();
    this.lookupByPath = null;
    this.lookupByPathAndQuery = null;
    this.manifestCache = null;
  }

  register(url, timestamp) {
    if (!url || !timestamp) return;

    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }

    let filePath;
    try {
      filePath = decodeURIComponent(parsed.pathname);
    } catch {
      filePath = parsed.pathname;
    }
    const search = parsed.search || "";
    const queryKey = `${filePath}${search}`;

    const normalizedTimestamp = String(timestamp);

    const currentByPath = this.byPath.get(filePath);
    if (!currentByPath || String(currentByPath.timestamp) <= normalizedTimestamp) {
      this.byPath.set(filePath, {
        file_url: url,
        timestamp: normalizedTimestamp,
        file_id: filePath,
      });
    }

    const currentByQuery = this.byPathAndQuery.get(queryKey);
    if (!currentByQuery || String(currentByQuery.timestamp) <= normalizedTimestamp) {
      this.byPathAndQuery.set(queryKey, {
        file_url: url,
        timestamp: normalizedTimestamp,
        file_id: filePath,
      });
    }

    this.lookupByPath = null;
    this.lookupByPathAndQuery = null;
    this.manifestCache = null;
  }

  buildCaches() {
    if (this.manifestCache) {
      return;
    }

    const manifest = Array.from(this.byPath.entries()).map(([file_id, value]) => ({
      ...value,
      file_id,
    }));

    manifest.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));

    const byPath = new Map();
    const byQuery = new Map();

    for (const entry of manifest) {
      const { file_url, file_id, timestamp } = entry;
      if (file_id && timestamp && !byPath.has(file_id)) {
        byPath.set(file_id, timestamp);
      }
      if (file_url) {
        try {
          const u = new URL(file_url);
          let decodedPath;
          try {
            decodedPath = decodeURIComponent(u.pathname);
          } catch {
            decodedPath = u.pathname;
          }
          const pathKey = `${decodedPath}${u.search || ""}`;
          if (pathKey && timestamp && !byQuery.has(pathKey)) {
            byQuery.set(pathKey, timestamp);
          }
        } catch {}
      }
    }

    for (const [queryKey, entry] of this.byPathAndQuery.entries()) {
      const ts = entry && entry.timestamp;
      if (!queryKey || !ts) continue;
      if (!byQuery.has(queryKey)) {
        byQuery.set(queryKey, ts);
      }
      const basePath = queryKey.replace(/\?.*$/, "");
      if (basePath && !byPath.has(basePath)) {
        byPath.set(basePath, ts);
      }
    }

    this.manifestCache = manifest;
    this.lookupByPath = byPath;
    this.lookupByPathAndQuery = byQuery;
  }

  getManifest() {
    this.buildCaches();
    return this.manifestCache || [];
  }

  resolve(assetUrl, fallbackTimestamp) {
    this.buildCaches();
    let resolved = fallbackTimestamp || 0;
    if (!assetUrl) return resolved;

    try {
      const u = new URL(assetUrl);
      let decodedPath;
      try {
        decodedPath = decodeURIComponent(u.pathname);
      } catch {
        decodedPath = u.pathname;
      }
      const queryKey = `${decodedPath}${u.search || ""}`;
      if (this.lookupByPathAndQuery && this.lookupByPathAndQuery.has(queryKey)) {
        resolved = this.lookupByPathAndQuery.get(queryKey);
      } else if (this.lookupByPath && this.lookupByPath.has(decodedPath)) {
        resolved = this.lookupByPath.get(decodedPath);
      }
    } catch {}

    return resolved;
  }
}

export { SnapshotIndex };