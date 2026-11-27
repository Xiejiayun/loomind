import type { AiChatMessage, AiChatPersistence } from "@mindmap/editor";
import { OWNER_HEADER } from "./shared.js";

const STORAGE_PREFIX = "loomind:ai-chat:v1";
const PENDING_SUFFIX = ":pending";
const MAX_CACHED_MESSAGES = 100;

function cacheKey(owner: string, mapId: string): string {
  return `${STORAGE_PREFIX}:${owner}:${mapId}`;
}

function pendingKey(owner: string, mapId: string): string {
  return `${STORAGE_PREFIX}:${owner}:${mapId}${PENDING_SUFFIX}`;
}

function normalizeForPersist(messages: AiChatMessage[]): AiChatMessage[] {
  return messages
    .filter((m) => !m.pending)
    .slice(-MAX_CACHED_MESSAGES)
    .map(({ pending: _p, upgradePrompt: _u, ...rest }) => rest);
}

export function readLocalAiChatCache(owner: string, mapId: string): AiChatMessage[] {
  try {
    const raw = localStorage.getItem(cacheKey(owner, mapId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as AiChatMessage[]) : [];
  } catch {
    return [];
  }
}

export function seedLocalAiChatCache(owner: string, mapId: string, messages: AiChatMessage[]): void {
  const clean = normalizeForPersist(messages);
  if (clean.length === 0) return;
  try {
    localStorage.setItem(cacheKey(owner, mapId), JSON.stringify(clean));
    localStorage.setItem(pendingKey(owner, mapId), "1");
  } catch {
    // Ignore storage quota errors
  }
}

export function clearLocalAiChatCache(owner: string, mapId: string): void {
  try {
    localStorage.removeItem(cacheKey(owner, mapId));
    localStorage.removeItem(pendingKey(owner, mapId));
  } catch {
    // Ignore storage errors
  }
}

async function postMessagesToCloud(owner: string, mapId: string, messages: AiChatMessage[]): Promise<boolean> {
  const clean = normalizeForPersist(messages);
  if (clean.length === 0) return true;
  try {
    // Send in batches of 40 (matching worker MAX_BATCH_MESSAGES)
    for (let i = 0; i < clean.length; i += 40) {
      const batch = clean.slice(i, i + 40);
      const res = await fetch(`/api/mindmaps/${mapId}/ai-chat`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          [OWNER_HEADER]: owner,
        },
        body: JSON.stringify({ messages: batch }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function createMapAiChatPersistence(
  owner: string,
  mapId: string,
  readOnly = false,
): AiChatPersistence {
  const key = cacheKey(owner, mapId);
  const pKey = pendingKey(owner, mapId);

  const writeCache = (messages: AiChatMessage[], pending: boolean) => {
    const clean = normalizeForPersist(messages);
    try {
      localStorage.setItem(key, JSON.stringify(clean));
      if (pending) localStorage.setItem(pKey, "1");
      else localStorage.removeItem(pKey);
    } catch {
      // Ignore storage quota errors
    }
  };

  return {
    loadCached() {
      return readLocalAiChatCache(owner, mapId);
    },

    async loadRemote() {
      try {
        const res = await fetch(`/api/mindmaps/${mapId}/ai-chat`, {
          credentials: "same-origin",
          cache: "no-store",
          headers: { [OWNER_HEADER]: owner },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { messages?: AiChatMessage[] };
        const remote = Array.isArray(data.messages) ? data.messages : [];
        const local = readLocalAiChatCache(owner, mapId);
        const hasPending = (() => {
          try {
            return localStorage.getItem(pKey) === "1";
          } catch {
            return false;
          }
        })();

        // Merge any unsynced local messages (e.g. imported from Try mode or offline turn)
        if (!readOnly && (hasPending || (remote.length === 0 && local.length > 0))) {
          const remoteIds = new Set(remote.map((m) => m.id));
          const missingLocal = local.filter((m) => !remoteIds.has(m.id));
          const merged = [...remote, ...missingLocal].slice(-MAX_CACHED_MESSAGES);
          if (missingLocal.length > 0) {
            const ok = await postMessagesToCloud(owner, mapId, missingLocal);
            writeCache(merged, !ok);
          } else {
            writeCache(merged, false);
          }
          return merged;
        }

        writeCache(remote, false);
        return remote;
      } catch {
        return null;
      }
    },

    async saveMessages(messages: AiChatMessage[]) {
      if (readOnly) return;
      const clean = normalizeForPersist(messages);
      writeCache(clean, true);
      const ok = await postMessagesToCloud(owner, mapId, clean);
      if (ok) writeCache(clean, false);
    },

    async clearMessages() {
      if (readOnly) return;
      clearLocalAiChatCache(owner, mapId);
      try {
        await fetch(`/api/mindmaps/${mapId}/ai-chat`, {
          method: "DELETE",
          credentials: "same-origin",
          headers: { [OWNER_HEADER]: owner },
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        // Best-effort clear
      }
    },

    async flushPending() {
      if (readOnly) return;
      let isPending = false;
      try {
        isPending = localStorage.getItem(pKey) === "1";
      } catch {
        return;
      }
      if (!isPending) return;
      const local = readLocalAiChatCache(owner, mapId);
      if (local.length === 0) {
        try { localStorage.removeItem(pKey); } catch { /* ignore */ }
        return;
      }
      const ok = await postMessagesToCloud(owner, mapId, local);
      if (ok) writeCache(local, false);
    },
  };
}
