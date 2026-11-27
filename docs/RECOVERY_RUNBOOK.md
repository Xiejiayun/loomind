# Loomind IndexedDB Read-Only Recovery Runbook (v2)

This runbook documents the standalone, zero-dependency read-only recovery path for Loomind's IndexedDB (`loomind-db` / `docs` object store) in case of a frontend rollback or local corruption.

## Live editor recovery

- Reconnect with the editor open. When a saved snapshot is available for the same collaboration room, it is merged with in-memory edits even if the corresponding incremental updates have already expired. Only a snapshot that materializes the saved JSON for that revision is accepted.
- If a JSON-only client wrote a new history, or verification fails, keep the local draft. In **Account & Sync** export a JSON backup or **Save as new map** before choosing between divergent versions. A recovery copy starts in your personal library with a new ID and history; the original and its sharing permissions are unchanged. Invite collaborators to the copy if needed.
- The document limit and the collaboration history limit are separate. If the encoded history exceeds 8 MiB but the document fits the cloud limit, **Save as new map** starts a compact history from the current content. If the document itself exceeds the cloud limit, keep the backup and reduce its media size before retrying. Do not clear IndexedDB as a recovery step.

## Rollback Rules

1. **Never clear `v2:*` keys during a rollback.** Keeping `DB_VERSION = 1` ensures the previous UI (`main@7fc979c`) does not fail with `VersionError` and ignores `v2:*` keys without crashing.
2. Before rolling back, users can export unsynced drafts, backups, and quarantined corrupt records directly from the Account & Sync dialog.
3. After an emergency rollback (when the older UI does not display `v2:*` records), use the standalone read-only recovery script below.

## Standalone Recovery Script

- **File**: `docs/recovery/loomind-idb-readonly-recovery.js`
- **Execution Domain**: Browser DevTools Console on the Loomind application origin (no new frontend bundle required).
- **Transaction Guarantee**: Strictly opens `loomind-db` / `docs` with a `"readonly"` transaction. Never writes, mutates, or deletes any IndexedDB records.

### Integrity Verification

Retrieve `docs/recovery/loomind-idb-readonly-recovery.js` from an audited commit/tag and verify its SHA-256 before pasting into DevTools:

```bash
# On Linux/macOS (LF checkout) or directly from Git object:
git show <commit>:docs/recovery/loomind-idb-readonly-recovery.js | sha256sum
```

- **Windows CRLF working copy SHA-256**: `58286f506e54129cb9bab9d33a74a6881b61c93c0f9f822de3221b591795ef7e`

### Procedure

1. Open the Loomind site in your browser (same origin where your mind maps were edited).
2. Open **DevTools → Console**.
3. Paste the verified contents of `docs/recovery/loomind-idb-readonly-recovery.js` and press Enter.
4. Run:
   ```js
   await window.__loomindReadOnlyRecover()
   ```
5. The browser will download a `loomind-idb-recovery-<timestamp>.json` file containing all `v2:draft:*`, `v2:synced:*`, `v2:corrupt:*`, `v2:migrated:*`, and legacy records, and return the parsed object in the console.
6. Verify IndexedDB was untouched (read-only transaction only).
