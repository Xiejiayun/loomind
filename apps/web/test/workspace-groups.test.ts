import { describe, expect, it } from "vitest";
import type { MindmapSummary } from "../src/drafts/shared.js";
import { buildWorkspaceGroups, PERSONAL, SHARED, spaceFromPath, spacePath, type WorkspaceSummary } from "../src/workspace-groups.js";

const space = (name: string, role: WorkspaceSummary["role"]): WorkspaceSummary => ({ id: crypto.randomUUID(), name, role, createdAt: "" });
const map = (title: string, access: MindmapSummary["access"], workspaceId: string | null = null): MindmapSummary => ({ id: crypto.randomUUID(), title, access, workspaceId, updatedAt: "" });

describe("workspace navigation", () => {
  it("puts each map in exactly one accessible group, including direct shares from inaccessible workspaces", () => {
    const own = space("Work", "owner"), joined = space("Team", "editor"), external = crypto.randomUUID();
    const maps = [map("Mine", "owner"), map("From a friend", "viewer"), map("External", "editor", external),
      map("Mine without membership", "owner", external), map("Teammate's contribution", "editor", own.id), map("Mine in Team", "owner", joined.id)];
    const groups = buildWorkspaceGroups([joined, own], maps, [], "Personal", "Shared");
    expect(groups.roots.map((group) => group.id)).toEqual([PERSONAL, SHARED, own.id]);
    expect(groups.shared.children.map((group) => group.id)).toEqual([joined.id]);
    expect(groups.byId.get(PERSONAL)?.maps).toEqual([maps[0], maps[3]]);
    expect(groups.shared.maps).toEqual([maps[1], maps[2]]);
    expect(groups.byId.get(own.id)?.maps).toEqual([maps[4]]);
    expect(groups.byId.get(joined.id)?.maps).toEqual([maps[5]]);
    expect(groups.byId.has(external)).toBe(false);
  });

  it("keeps saved sibling order, drops obsolete IDs and appends newly accessible workspaces", () => {
    const own = space("Work", "owner"), added = space("New", "owner"), first = space("A", "viewer"), second = space("B", "editor");
    const order = [own.id, SHARED, PERSONAL, second.id, first.id, crypto.randomUUID(), own.id];
    const groups = buildWorkspaceGroups([added, first, own, second], [], order, "个人空间", "共享给我");
    expect(groups.roots.map((group) => group.id)).toEqual([own.id, SHARED, PERSONAL, added.id]);
    expect(groups.shared.children.map((group) => group.id)).toEqual([second.id, first.id]);
    for (const id of groups.byId.keys()) expect(spaceFromPath(spacePath(id))).toBe(id);
  });
});
