import { MAP_ID, type MapAccess, type MindmapSummary } from "./drafts/shared.js";

export const PERSONAL = "personal";
export const SHARED = "shared";

export interface WorkspaceSummary { id: string; name: string; role: MapAccess; createdAt: string }
export interface WorkspaceGroup {
  id: string;
  name: string;
  workspace?: WorkspaceSummary;
  maps: MindmapSummary[];
  children: WorkspaceGroup[];
}

export function spacePath(id: string) {
  return id === PERSONAL || id === SHARED ? `/app/${id}` : `/app/workspaces/${id}`;
}

export function spaceFromPath(path: string) {
  if (path === spacePath(PERSONAL)) return PERSONAL;
  if (path === spacePath(SHARED)) return SHARED;
  const id = /^\/app\/workspaces\/([^/]+)$/.exec(path)?.[1];
  return id && MAP_ID.test(id) ? id : null;
}

export function orderedGroups(groups: WorkspaceGroup[], order: string[]) {
  const remaining = new Map(groups.map((group) => [group.id, group]));
  const result: WorkspaceGroup[] = [];
  for (const id of order) {
    const group = remaining.get(id);
    if (group) { result.push(group); remaining.delete(id); }
  }
  return [...result, ...remaining.values()];
}

export function mapGroupId(map: MindmapSummary, groups: ReadonlyMap<string, WorkspaceGroup>) {
  return map.workspaceId && groups.has(map.workspaceId) ? map.workspaceId : map.access === "owner" ? PERSONAL : SHARED;
}

export function buildWorkspaceGroups(workspaces: WorkspaceSummary[], maps: MindmapSummary[], order: string[], personalName: string, sharedName: string) {
  const personal: WorkspaceGroup = { id: PERSONAL, name: personalName, maps: [], children: [] };
  const shared: WorkspaceGroup = { id: SHARED, name: sharedName, maps: [], children: [] };
  const roots = [personal, shared];
  for (const workspace of workspaces) {
    (workspace.role === "owner" ? roots : shared.children).push({ id: workspace.id, name: workspace.name, workspace, maps: [], children: [] });
  }
  const byId = new Map([...roots, ...shared.children].map((group) => [group.id, group]));
  for (const map of maps) byId.get(mapGroupId(map, byId))!.maps.push(map);
  shared.children = orderedGroups(shared.children, order);
  return { roots: orderedGroups(roots, order), byId, shared };
}
