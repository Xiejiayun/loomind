import { canonicalJson, collectAllTopics, validateDocumentInvariants, type MindmapDocument, type MindmapTopic } from "@mindmap/core";
import type { LoroSyncAdapter } from "@mindmap/core/loro";
import { getWebMessages } from "../i18n.js";
import { CloudError } from "./cloud.js";
import { base64ToBytes, fetchRoomUpdates, type CollabGetResponse } from "./collab.js";
import type { LiveCheckpoint } from "./shared.js";

export function recoverLegacyBranches(doc: MindmapDocument): MindmapDocument {
  if (!validateDocumentInvariants(doc).some(({ code }) => code === "DUPLICATE_ID" || code === "DELETED_ID_REUSED")) return doc;
  const deleted = new Set(doc.deletedIds);
  const retired = (topic: MindmapTopic): boolean => deleted.has(topic.id) && (!topic.callout || deleted.has(topic.callout.id)) && topic.children.every(retired);
  const recover = (topic: MindmapTopic): MindmapTopic => {
    const siblings = new Map<string, MindmapTopic>();
    const children = topic.children.filter((child) => {
      if (retired(child)) return false;
      const prior = siblings.get(child.id);
      siblings.set(child.id, child);
      return !prior || canonicalJson(prior) !== canonicalJson(child);
    }).map(recover);
    return { ...topic, children };
  };
  const next = { ...doc, sheets: doc.sheets.map((sheet) => sheet.summaries.length || sheet.boundaries.some((boundary) => boundary.target.kind === "range")
    ? sheet : { ...sheet, rootTopic: recover(sheet.rootTopic) }) };
  return validateDocumentInvariants(next).length ? doc : next;
}

export async function restoreJsonDraft(ctor: typeof LoroSyncAdapter, checkpoint: LiveCheckpoint, revision: number,
  local: MindmapDocument, owner: string, id: string, overwrite: boolean) {
  const conflict = () => new CloudError(409, getWebMessages().sync.conflictDetail);
  if (validateDocumentInvariants(local).length) throw conflict();
  const bytes = base64ToBytes(checkpoint.snapshot);
  const base = ctor.fromSnapshot(bytes);
  const ids = (doc: MindmapDocument) => new Set(doc.sheets.flatMap((sheet) => [...collectAllTopics(sheet).keys()]));
  const added = ids(local);
  for (const existing of ids(base.getDocument())) added.delete(existing);
  if (added.size) {
    let cursor = checkpoint.cursor;
    const live = ctor.fromSnapshot(bytes);
    for (let count = 0; ; ) {
      const response = await fetchRoomUpdates(owner, id, checkpoint.room, cursor);
      if (!response.ok) throw new CloudError(response.status, getWebMessages().errors.cloudConnect);
      const page: CollabGetResponse = await response.json();
      if (page.revision !== revision || !Array.isArray(page.updates)) throw conflict();
      if (!page.updates.length) break;
      for (const update of page.updates) {
        if (++count > 200 || !Number.isSafeInteger(update.seq) || update.seq <= cursor || !live.importUpdates(base64ToBytes(update.updateB64))) throw conflict();
        cursor = update.seq;
      }
      if (canonicalJson(local) === canonicalJson(live.getDocument())) return { adapter: live, cursor };
    }
    if ([...ids(live.getDocument())].some((topicId) => added.has(topicId))) {
      if (!overwrite) throw conflict();
      live.reconcileDraft(local);
      return { adapter: live, cursor };
    }
  }
  base.reconcileDraft(local);
  return { adapter: base, cursor: checkpoint.cursor };
}
