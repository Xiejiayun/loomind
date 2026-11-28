import { afterEach, expect, it, vi } from "vitest";
import { createDocument, createSheet, createTopic, validateDocumentInvariants } from "@mindmap/core/model";
import { LoroSyncAdapter } from "@mindmap/core/loro";
import { recoverLegacyBranches, restoreJsonDraft } from "../src/drafts/legacy-branches.js";

afterEach(() => vi.unstubAllGlobals());

it("repairs only identical sibling copies and wholly retired subtrees, without mutating the old draft", () => {
  const keep = createTopic("keep", "Same name", { children: [createTopic("leaf", "Leaf")] });
  const doc = createDocument([createSheet("sheet", "Map", createTopic("root", "Map", { children: [
    createTopic("retired", "Same name"), keep, structuredClone(keep), createTopic("other", "Same name"),
  ] }))]);
  doc.deletedIds.push("retired");
  const fixed = recoverLegacyBranches(doc);
  expect(fixed.sheets[0].rootTopic.children.map(({ id }) => id)).toEqual(["keep", "other"]);
  expect(validateDocumentInvariants(fixed)).toEqual([]);
  expect(doc.sheets[0].rootTopic.children).toHaveLength(4);
  doc.sheets[0].rootTopic.children[2].subtitle = "Independent change";
  expect(recoverLegacyBranches(doc)).toBe(doc);
});

it("does not overwrite a peer's independent changes on ambiguous JSON-only recovery", async () => {
  const doc = createDocument([createSheet("sheet", "Map", createTopic("root", "Map"))]);
  const base = new LoroSyncAdapter(doc);
  const live = LoroSyncAdapter.fromSnapshot(base.exportSnapshot());
  const checkpoint = { room: crypto.randomUUID(), cursor: 0, snapshot: Buffer.from(base.exportSnapshot()).toString("base64") };
  const add = (newId: string) => live.applyCommand({ type: "topic/addChild", sheetId: "sheet", parentId: "root", newId });
  add("restored");
  const draft = live.getDocument();
  add("peer-only");
  const entry = { seq: 1, updateB64: Buffer.from(live.exportUpdates(base.getVersion())).toString("base64") };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json({ revision: 1, updates: url.endsWith("since=0") ? [entry] : [] })));
  await expect(restoreJsonDraft(LoroSyncAdapter, checkpoint, 1, draft, "owner", "map", false)).rejects.toMatchObject({ status: 409 });
  const recovered = await restoreJsonDraft(LoroSyncAdapter, checkpoint, 1, live.getDocument(), "owner", "map", false);
  expect(recovered.cursor).toBe(1);
  expect(recovered.adapter.getVersion().compare(live.getVersion())).toBe(0);
});
