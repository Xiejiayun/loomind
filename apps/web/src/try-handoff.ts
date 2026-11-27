import { MindmapDocumentSchema, type MindmapDocument } from "@mindmap/core";

const TRY_IMPORT_KEY = "loomind:try-import:v1";
const MAX_IMPORT_BYTES = 512 * 1024;

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
