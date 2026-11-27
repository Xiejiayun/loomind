import { afterEach, describe, expect, it, vi } from "vitest";
import { getTemplate } from "@mindmap/core";
import { LoroSyncAdapter } from "@mindmap/core/loro";
import { LiveDraft } from "../src/drafts/live-draft.js";
import { MAX_CHECKPOINT_B64 } from "../src/drafts/shared.js";

function localSession() {
  const id = crypto.randomUUID();
  const open = vi.fn<(adapter: LoroSyncAdapter) => void>();
  const live = new LiveDraft(LoroSyncAdapter, "owner", id, "Owner", { open, peers: vi.fn(), refresh: vi.fn(), change: vi.fn() });
  const local = getTemplate("blank-organic").create();
  live.show(local);
  return { id, local, live, adapter: open.mock.calls[0][0], open };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("live draft recovery", () => {
  it("keeps local edits when real snapshot content differs from the cloud JSON or cannot be decoded", async () => {
    const { live, id, local, adapter, open } = localSession();
    const different = new LoroSyncAdapter(getTemplate("quarterly-okr").create());
    for (const snapshot of [Buffer.from(different.exportSnapshot()).toString("base64"), "not a snapshot!"]) {
      vi.stubGlobal("fetch", vi.fn(async () => Response.json({ revision: 1, document: local, checkpoint: { room: crypto.randomUUID(), cursor: 0, snapshot } })));
      await expect(live.read("owner", id)).rejects.toMatchObject({ status: 502 });
      expect(open).toHaveBeenCalledTimes(1);
      expect(adapter.getDocument()).toEqual(local);
    }
    live.close();
  });

  it("does not upload a truncated history or discard edits when a snapshot exceeds the cap", async () => {
    const { live, id, local, adapter } = localSession();
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    vi.spyOn(adapter, "exportSnapshot").mockReturnValueOnce(new Uint8Array(MAX_CHECKPOINT_B64 / 4 * 3 + 1));
    await expect(live.write("owner", id, 0, local)).rejects.toMatchObject({ status: 413 });
    expect(request).not.toHaveBeenCalled();
    expect(adapter.getDocument()).toEqual(local);
    live.close();
  });
});
