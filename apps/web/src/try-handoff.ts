import { MindmapDocumentSchema, type MindmapDocument } from "@mindmap/core";
import type { AiChatMessage } from "@mindmap/editor";

const TRY_IMPORT_KEY = "loomind:try-import:v1";
const TRY_CHAT_IMPORT_KEY = "loomind:try-chat-import:v1";
const MAX_IMPORT_BYTES = 512 * 1024;
const MAX_CHAT_IMPORT_BYTES = 160 * 1024;

export function stageTryDocumentForImport(doc: MindmapDocument): boolean {
  try {
    const raw = JSON.stringify(doc);
    if (raw.length > MAX_IMPORT_BYTES) return false;
    sessionStorage.setItem(TRY_IMPORT_KEY, raw);
    return true;
  } catch {
    return false;
  }
}

export function consumeStagedTryDocument(): MindmapDocument | null {
  try {
    const raw = sessionStorage.getItem(TRY_IMPORT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(TRY_IMPORT_KEY);
    const parsed = MindmapDocumentSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function stageTryChatForImport(messages: AiChatMessage[]): boolean {
  const clean = messages
    .filter((m) => !m.pending)
    .slice(-40)
    .map(({ pending: _p, upgradePrompt: _u, ...rest }) => rest);
  if (clean.length === 0) return false;
  try {
    const raw = JSON.stringify(clean);
    if (raw.length > MAX_CHAT_IMPORT_BYTES) return false;
    sessionStorage.setItem(TRY_CHAT_IMPORT_KEY, raw);
    return true;
  } catch {
    return false;
  }
}

export function consumeStagedTryChat(): AiChatMessage[] | null {
  try {
    const raw = sessionStorage.getItem(TRY_CHAT_IMPORT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(TRY_CHAT_IMPORT_KEY);
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) && parsed.length > 0 ? (parsed as AiChatMessage[]) : null;
  } catch {
    return null;
  }
}
