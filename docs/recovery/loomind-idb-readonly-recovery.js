/**
 * Loomind Standalone Zero-Dependency Read-Only IndexedDB Recovery Script (v2)
 *
 * Usage (Browser DevTools Console on the Loomind origin):
 *   Paste and run this entire script, or invoke `window.__loomindReadOnlyRecover()`.
 *
 * Guarantees:
 * - Strictly opens IndexedDB `loomind-db` / `docs` with a `"readonly"` transaction.
 * - NEVER calls put(), add(), delete(), clear(), or opens any `"readwrite"` transaction.
 * - Exports all `v2:draft:*`, `v2:synced:*`, `v2:corrupt:*`, `v2:migrated:*`, and legacy records.
 */
(function (globalScope) {
  "use strict";

  async function loomindReadOnlyRecover(options) {
    var opts = options || {};
    var dbName = opts.dbName || "loomind-db";
    var storeName = opts.storeName || "docs";
    var idb = opts.indexedDB || (globalScope && globalScope.indexedDB);
    if (!idb) {
      throw new Error("IndexedDB is not available in this environment.");
    }

    var db = await new Promise(function (resolve, reject) {
      var req = idb.open(dbName);
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error || new Error("Failed to open IndexedDB."));
      };
    });

    try {
      if (!db.objectStoreNames.contains(storeName)) {
        return {
          schema: "loomind-readonly-recovery-v1",
          exportedAt: new Date().toISOString(),
          dbName: dbName,
          storeName: storeName,
          counts: { draft: 0, synced: 0, corrupt: 0, migrated: 0, legacy: 0, other: 0 },
          records: { draft: [], synced: [], corrupt: [], migrated: [], legacy: [], other: [] },
        };
      }

      var records = { draft: [], synced: [], corrupt: [], migrated: [], legacy: [], other: [] };

      await new Promise(function (resolve, reject) {
        var tx = db.transaction(storeName, "readonly");
        var store = tx.objectStore(storeName);
        var req = store.openCursor();
        req.onsuccess = function () {
          var cursor = req.result;
          if (!cursor) {
            resolve();
            return;
          }
          var key = String(cursor.key);
          var entry = { key: key, value: cursor.value };
          if (key.indexOf("v2:draft:") === 0) records.draft.push(entry);
          else if (key.indexOf("v2:synced:") === 0) records.synced.push(entry);
          else if (key.indexOf("v2:corrupt:") === 0) records.corrupt.push(entry);
          else if (key.indexOf("v2:migrated:") === 0) records.migrated.push(entry);
          else if (key === "active-document" || key.indexOf("google:") === 0) records.legacy.push(entry);
          else records.other.push(entry);
          cursor.continue();
        };
        req.onerror = function () {
          reject(req.error || new Error("Cursor read failed."));
        };
      });

      var dump = {
        schema: "loomind-readonly-recovery-v1",
        exportedAt: new Date().toISOString(),
        dbName: dbName,
        storeName: storeName,
        counts: {
          draft: records.draft.length,
          synced: records.synced.length,
          corrupt: records.corrupt.length,
          migrated: records.migrated.length,
          legacy: records.legacy.length,
          other: records.other.length,
        },
        records: records,
      };

      if (opts.autoDownload !== false && typeof document !== "undefined" && typeof Blob !== "undefined" && typeof URL !== "undefined") {
        var json = JSON.stringify(dump, null, 2);
        var blob = new Blob([json], { type: "application/json;charset=utf-8" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "loomind-idb-recovery-" + Date.now() + ".json";
        a.click();
        URL.revokeObjectURL(url);
      }

      return dump;
    } finally {
      db.close();
    }
  }

  if (globalScope) {
    globalScope.__loomindReadOnlyRecover = loomindReadOnlyRecover;
  }
  return loomindReadOnlyRecover;
})(typeof globalThis !== "undefined" ? globalThis : window);
