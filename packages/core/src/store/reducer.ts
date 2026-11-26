import { enablePatches, produceWithPatches, type Patch } from "immer";
import {
  createRichText,
  createTopic,
  normalizeHexColor,
  quantizeCoord,
  type MindmapDocument,
  type MindmapSheet,
  type MindmapTopic,
  type TopicStyleOverride,
} from "../model/document.js";
import type { MindmapCommand } from "./commands.js";

enablePatches();

export interface ReduceResult {
  nextDoc: MindmapDocument;
  patches: Patch[];
  inversePatches: Patch[];
  dirtyTopicIds: Set<string>;
}

interface TopicLocation {
  topic: MindmapTopic;
  parent: MindmapTopic | null;
  container: MindmapTopic[];
  index: number;
  isFloatingRoot: boolean;
  isSummaryRoot: boolean;
}

function findTopicInTree(
  root: MindmapTopic,
  targetId: string,
  parent: MindmapTopic | null,
  container: MindmapTopic[],
  index: number,
  isFloatingRoot = false,
  isSummaryRoot = false,
): TopicLocation | null {
  if (root.id === targetId) {
    return { topic: root, parent, container, index, isFloatingRoot, isSummaryRoot };
  }
  for (let i = 0; i < root.children.length; i++) {
    const found = findTopicInTree(root.children[i], targetId, root, root.children, i);
    if (found) return found;
  }
  return null;
}

export function findTopicLocation(sheet: MindmapSheet, topicId: string): TopicLocation | null {
  const rootRes = findTopicInTree(sheet.rootTopic, topicId, null, [sheet.rootTopic], 0);
  if (rootRes) return rootRes;
  for (let i = 0; i < sheet.floatingTopics.length; i++) {
    const res = findTopicInTree(sheet.floatingTopics[i], topicId, null, sheet.floatingTopics, i, true);
    if (res) return res;
  }
  for (let i = 0; i < sheet.summaries.length; i++) {
    const res = findTopicInTree(sheet.summaries[i].topic, topicId, null, [sheet.summaries[i].topic], 0, false, true);
    if (res) return res;
  }
  return null;
}

function isDescendant(root: MindmapTopic, targetId: string): boolean {
  if (root.id === targetId) return true;
  return root.children.some((c) => isDescendant(c, targetId));
}

function collectSubtreeIds(topic: MindmapTopic, out: Set<string>): void {
  out.add(topic.id);
  if (topic.callout) out.add(topic.callout.id);
  for (const c of topic.children) collectSubtreeIds(c, out);
}

function normalizeStyle(style?: Partial<TopicStyleOverride>): Partial<TopicStyleOverride> | undefined {
  if (!style) return undefined;
  const out: Partial<TopicStyleOverride> = { ...style };
  if (out.fillColor) out.fillColor = normalizeHexColor(out.fillColor);
  if (out.strokeColor) out.strokeColor = normalizeHexColor(out.strokeColor);
  if (out.textColor) out.textColor = normalizeHexColor(out.textColor);
  return out;
}

function cascadeCleanup(doc: MindmapDocument, sheet: MindmapSheet, removedIds: Set<string>): void {
  if (removedIds.size === 0) return;
  for (const id of removedIds) {
    if (!doc.deletedIds.includes(id)) doc.deletedIds.push(id);
  }
  sheet.relationships = sheet.relationships.filter((r) => {
    const drop = removedIds.has(r.fromId) || removedIds.has(r.toId);
    if (drop && !doc.deletedIds.includes(r.id)) doc.deletedIds.push(r.id);
    return !drop;
  });
  sheet.boundaries = sheet.boundaries.filter((b) => {
    const drop =
      b.target.kind === "subtree"
        ? removedIds.has(b.target.topicId)
        : removedIds.has(b.target.parentId);
    if (drop && !doc.deletedIds.includes(b.id)) doc.deletedIds.push(b.id);
    return !drop;
  });
  sheet.summaries = sheet.summaries.filter((s) => {
    const parentLoc = findTopicLocation(sheet, s.parentId);
    if (!parentLoc || removedIds.has(s.parentId) || removedIds.has(s.topic.id)) {
      if (!doc.deletedIds.includes(s.id)) doc.deletedIds.push(s.id);
      return false;
    }
    const maxIdx = parentLoc.topic.children.length - 1;
    if (maxIdx < 0 || s.startIndex > maxIdx) {
      if (!doc.deletedIds.includes(s.id)) doc.deletedIds.push(s.id);
      return false;
    }
    s.endIndex = Math.min(s.endIndex, maxIdx);
    return s.startIndex <= s.endIndex;
  });
}

export function applyMindmapCommand(doc: MindmapDocument, cmd: MindmapCommand): ReduceResult {
  const dirtyTopicIds = new Set<string>();

  const [nextDoc, patches, inversePatches] = produceWithPatches(doc, (draft) => {
    if (cmd.type === "sheet/add") {
      draft.sheets.push(cmd.sheet);
      draft.activeSheetId = cmd.sheet.id;
      return;
    }
    if (cmd.type === "sheet/switch") {
      if (draft.sheets.some((s) => s.id === cmd.sheetId)) {
        draft.activeSheetId = cmd.sheetId;
      }
      return;
    }
    if (cmd.type === "sheet/rename") {
      const s = draft.sheets.find((x) => x.id === cmd.sheetId);
      if (s) s.title = cmd.title;
      return;
    }
    if (cmd.type === "sheet/remove") {
      if (draft.sheets.length <= 1) return;
      const idx = draft.sheets.findIndex((x) => x.id === cmd.sheetId);
      if (idx === -1) return;
      draft.deletedIds.push(cmd.sheetId);
      draft.sheets.splice(idx, 1);
      if (draft.activeSheetId === cmd.sheetId) {
        draft.activeSheetId = draft.sheets[Math.max(0, idx - 1)].id;
      }
      return;
    }
    if (cmd.type === "theme/set") {
      if (cmd.sheetId) {
        const s = draft.sheets.find((x) => x.id === cmd.sheetId);
        if (s) s.theme = { ...s.theme, ...cmd.patch };
      } else {
        draft.theme = { ...draft.theme, ...cmd.patch };
      }
      return;
    }

    const sheet = draft.sheets.find((s) => s.id === cmd.sheetId);
    if (!sheet) return;

    switch (cmd.type) {
      case "sheet/setLayout": {
        if (cmd.structure) sheet.structure = cmd.structure;
        if (cmd.direction) sheet.direction = cmd.direction;
        if (cmd.spacing) sheet.spacing = cmd.spacing;
        dirtyTopicIds.add(sheet.rootTopic.id);
        break;
      }
      case "doc/replaceSheetRoot": {
        sheet.rootTopic = cmd.rootTopic;
        dirtyTopicIds.add(cmd.rootTopic.id);
        break;
      }
      case "topic/addChild": {
        const loc = findTopicLocation(sheet, cmd.parentId);
        if (!loc) break;
        loc.topic.collapsed = false;
        loc.topic.children.push(createTopic(cmd.newId, cmd.title ?? createRichText("子主题")));
        dirtyTopicIds.add(cmd.parentId);
        dirtyTopicIds.add(cmd.newId);
        break;
      }
      case "topic/addSibling": {
        const loc = findTopicLocation(sheet, cmd.targetId);
        if (!loc || !loc.parent) break;
        const insertIdx = cmd.position === "before" ? loc.index : loc.index + 1;
        loc.container.splice(insertIdx, 0, createTopic(cmd.newId, cmd.title ?? createRichText("分支主题")));
        for (const s of sheet.summaries) {
          if (s.parentId === loc.parent.id) {
            if (insertIdx <= s.startIndex) {
              s.startIndex += 1;
              s.endIndex += 1;
            } else if (insertIdx <= s.endIndex) {
              s.endIndex += 1;
            }
          }
        }
        dirtyTopicIds.add(loc.parent.id);
        dirtyTopicIds.add(cmd.newId);
        break;
      }
      case "topic/addParent": {
        const loc = findTopicLocation(sheet, cmd.targetId);
        if (!loc || !loc.parent) break;
        const wrapped = createTopic(cmd.newId, cmd.title ?? createRichText("父主题"), {
          children: [loc.topic],
        });
        loc.container.splice(loc.index, 1, wrapped);
        dirtyTopicIds.add(loc.parent.id);
        dirtyTopicIds.add(cmd.newId);
        break;
      }
      case "topic/delete": {
        const removed = new Set<string>();
        for (const id of cmd.topicIds) {
          if (id === sheet.rootTopic.id) continue;
          const loc = findTopicLocation(sheet, id);
          if (!loc) continue;
          if (loc.isSummaryRoot) {
            const sumIdx = sheet.summaries.findIndex((s) => s.topic.id === id);
            if (sumIdx !== -1) {
              removed.add(sheet.summaries[sumIdx].id);
              collectSubtreeIds(sheet.summaries[sumIdx].topic, removed);
              sheet.summaries.splice(sumIdx, 1);
            }
            continue;
          }
          collectSubtreeIds(loc.topic, removed);
          loc.container.splice(loc.index, 1);
          if (loc.parent) {
            dirtyTopicIds.add(loc.parent.id);
            for (const s of sheet.summaries) {
              if (s.parentId === loc.parent.id) {
                if (loc.index < s.startIndex) {
                  s.startIndex -= 1;
                  s.endIndex -= 1;
                } else if (loc.index <= s.endIndex) {
                  s.endIndex -= 1;
                }
              }
            }
          }
        }
        cascadeCleanup(draft, sheet, removed);
        break;
      }
      case "topic/reparent": {
        if (cmd.topicId === sheet.rootTopic.id || cmd.topicId === cmd.newParentId) break;
        const src = findTopicLocation(sheet, cmd.topicId);
        const dst = findTopicLocation(sheet, cmd.newParentId);
        if (!src || !dst || src.isSummaryRoot) break;
        if (isDescendant(src.topic, cmd.newParentId)) break;
        const [moved] = src.container.splice(src.index, 1);
        delete moved.floatingPos;
        delete moved.manualOffset;
        dst.topic.collapsed = false;
        const idx =
          cmd.index !== undefined
            ? Math.max(0, Math.min(cmd.index, dst.topic.children.length))
            : dst.topic.children.length;
        dst.topic.children.splice(idx, 0, moved);
        if (src.parent) dirtyTopicIds.add(src.parent.id);
        dirtyTopicIds.add(cmd.newParentId);
        dirtyTopicIds.add(cmd.topicId);
        break;
      }
      case "topic/reorder": {
        const loc = findTopicLocation(sheet, cmd.topicId);
        if (!loc || !loc.parent) break;
        const nextIdx = loc.index + cmd.delta;
        if (nextIdx < 0 || nextIdx >= loc.container.length) break;
        const [item] = loc.container.splice(loc.index, 1);
        loc.container.splice(nextIdx, 0, item);
        dirtyTopicIds.add(loc.parent.id);
        break;
      }
      case "topic/indent": {
        const loc = findTopicLocation(sheet, cmd.topicId);
        if (!loc || !loc.parent || loc.index === 0) break;
        const prevSibling = loc.container[loc.index - 1];
        const [item] = loc.container.splice(loc.index, 1);
        prevSibling.collapsed = false;
        prevSibling.children.push(item);
        dirtyTopicIds.add(loc.parent.id);
        dirtyTopicIds.add(prevSibling.id);
        break;
      }
      case "topic/outdent": {
        const loc = findTopicLocation(sheet, cmd.topicId);
        if (!loc || !loc.parent) break;
        const parentLoc = findTopicLocation(sheet, loc.parent.id);
        if (!parentLoc || !parentLoc.parent) break;
        const [item] = loc.container.splice(loc.index, 1);
        parentLoc.container.splice(parentLoc.index + 1, 0, item);
        dirtyTopicIds.add(parentLoc.parent.id);
        dirtyTopicIds.add(loc.parent.id);
        break;
      }
      case "topic/addFloating": {
        sheet.floatingTopics.push(
          createTopic(cmd.newId, cmd.title ?? createRichText("自由主题"), {
            floatingPos: { x: quantizeCoord(cmd.pos.x), y: quantizeCoord(cmd.pos.y) },
          }),
        );
        dirtyTopicIds.add(cmd.newId);
        break;
      }
      case "topic/detachToFloating": {
        if (cmd.topicId === sheet.rootTopic.id) break;
        const loc = findTopicLocation(sheet, cmd.topicId);
        if (!loc || loc.isSummaryRoot) break;
        if (loc.isFloatingRoot) {
          loc.topic.floatingPos = { x: quantizeCoord(cmd.pos.x), y: quantizeCoord(cmd.pos.y) };
        } else {
          const [detached] = loc.container.splice(loc.index, 1);
          delete detached.manualOffset;
          detached.floatingPos = { x: quantizeCoord(cmd.pos.x), y: quantizeCoord(cmd.pos.y) };
          sheet.floatingTopics.push(detached);
          if (loc.parent) dirtyTopicIds.add(loc.parent.id);
        }
        dirtyTopicIds.add(cmd.topicId);
        break;
      }
      case "topic/setTitle": {
        const loc = findTopicLocation(sheet, cmd.topicId);
        if (loc) {
          loc.topic.title = cmd.title;
          dirtyTopicIds.add(cmd.topicId);
        }
        break;
      }
      case "topic/setSubtitle": {
        const loc = findTopicLocation(sheet, cmd.topicId);
        if (loc) {
          if (cmd.subtitle) loc.topic.subtitle = cmd.subtitle;
          else delete loc.topic.subtitle;
          dirtyTopicIds.add(cmd.topicId);
        }
        break;
      }
      case "topic/toggleCollapse": {
        const loc = findTopicLocation(sheet, cmd.topicId);
        if (loc && loc.topic.children.length > 0) {
          loc.topic.collapsed = cmd.collapsed ?? !loc.topic.collapsed;
          dirtyTopicIds.add(cmd.topicId);
        }
        break;
      }
      case "topic/setStructure": {
        const loc = findTopicLocation(sheet, cmd.topicId);
        if (loc) {
          if (cmd.structure) loc.topic.structure = cmd.structure;
          else delete loc.topic.structure;
          dirtyTopicIds.add(cmd.topicId);
        }
        break;
      }
      case "topic/setStyle": {
        for (const id of cmd.topicIds) {
          const loc = findTopicLocation(sheet, id);
          if (!loc) continue;
          if (cmd.clear) {
            delete loc.topic.shape;
            delete loc.topic.style;
          } else {
            if (cmd.shape !== undefined) loc.topic.shape = cmd.shape;
            if (cmd.style) loc.topic.style = { ...loc.topic.style, ...normalizeStyle(cmd.style) };
          }
          dirtyTopicIds.add(id);
        }
        break;
      }
      case "topic/setManualOffset": {
        const loc = findTopicLocation(sheet, cmd.topicId);
        if (loc) {
          if (cmd.offset) {
            loc.topic.manualOffset = {
              dx: quantizeCoord(cmd.offset.dx),
              dy: quantizeCoord(cmd.offset.dy),
            };
          } else {
            delete loc.topic.manualOffset;
          }
          dirtyTopicIds.add(cmd.topicId);
        }
        break;
      }
      case "topic/setCustomWidth": {
        const loc = findTopicLocation(sheet, cmd.topicId);
        if (loc) {
          if (cmd.width !== undefined) {
            loc.topic.customWidth = Math.max(80, Math.min(640, Math.round(cmd.width)));
          } else {
            delete loc.topic.customWidth;
          }
          dirtyTopicIds.add(cmd.topicId);
        }
        break;
      }
      case "topic/toggleMarker": {
        const loc = findTopicLocation(sheet, cmd.topicId);
        if (!loc) break;
        const list = loc.topic.markers ?? [];
        const [group] = cmd.marker.split(":");
        const exists = list.includes(cmd.marker);
        const filtered = list.filter((m) => !m.startsWith(`${group}:`));
        if (!exists) filtered.push(cmd.marker);
        loc.topic.markers = filtered.length > 0 ? filtered : undefined;
        dirtyTopicIds.add(cmd.topicId);
        break;
      }
      case "topic/setSticker": {
        const loc = findTopicLocation(sheet, cmd.topicId);
        if (loc) {
          if (cmd.stickerId) loc.topic.stickerId = cmd.stickerId;
          else delete loc.topic.stickerId;
          dirtyTopicIds.add(cmd.topicId);
        }
        break;
      }
      case "topic/setLabels": {
        const loc = findTopicLocation(sheet, cmd.topicId);
        if (loc) {
          const cleaned = cmd.labels.map((l) => l.trim().slice(0, 24)).filter(Boolean).slice(0, 6);
          loc.topic.labels = cleaned.length > 0 ? cleaned : undefined;
          dirtyTopicIds.add(cmd.topicId);
        }
        break;
      }
      case "topic/toggleTask": {
        const loc = findTopicLocation(sheet, cmd.topicId);
        if (!loc) break;
        if (cmd.status === null) {
          delete loc.topic.task;
        } else if (cmd.status) {
          loc.topic.task = { status: cmd.status };
        } else {
          loc.topic.task = !loc.topic.task
            ? { status: "todo" }
            : loc.topic.task.status === "todo"
              ? { status: "done" }
              : { status: "todo" };
        }
        dirtyTopicIds.add(cmd.topicId);
        break;
      }
      case "topic/setCallout": {
        const loc = findTopicLocation(sheet, cmd.topicId);
        if (loc) {
          if (!cmd.callout) delete loc.topic.callout;
          else loc.topic.callout = cmd.callout;
          dirtyTopicIds.add(cmd.topicId);
        }
        break;
      }
      case "topic/setNote": {
        const loc = findTopicLocation(sheet, cmd.topicId);
        if (loc) {
          if (cmd.text && cmd.text.trim().length > 0) {
            loc.topic.note = { format: "markdown", text: cmd.text };
          } else {
            delete loc.topic.note;
          }
          dirtyTopicIds.add(cmd.topicId);
        }
        break;
      }
      case "topic/setHref": {
        const loc = findTopicLocation(sheet, cmd.topicId);
        if (loc) {
          if (cmd.href) loc.topic.href = cmd.href;
          else delete loc.topic.href;
          dirtyTopicIds.add(cmd.topicId);
        }
        break;
      }
      case "topic/setEquation": {
        const loc = findTopicLocation(sheet, cmd.topicId);
        if (loc) {
          if (cmd.latex && cmd.latex.trim().length > 0) {
            loc.topic.equation = { latex: cmd.latex.trim() };
          } else {
            delete loc.topic.equation;
          }
          dirtyTopicIds.add(cmd.topicId);
        }
        break;
      }
      case "topic/setImage": {
        const loc = findTopicLocation(sheet, cmd.topicId);
        if (loc) {
          if (cmd.asset) draft.assets[cmd.asset.resourceId] = cmd.asset;
          if (cmd.image) loc.topic.image = cmd.image;
          else delete loc.topic.image;
          dirtyTopicIds.add(cmd.topicId);
        }
        break;
      }
      case "boundary/upsert": {
        const idx = sheet.boundaries.findIndex((b) => b.id === cmd.boundary.id);
        const normalized = {
          ...cmd.boundary,
          style: cmd.boundary.style
            ? {
                fillColor: cmd.boundary.style.fillColor ? normalizeHexColor(cmd.boundary.style.fillColor) : undefined,
                strokeColor: cmd.boundary.style.strokeColor
                  ? normalizeHexColor(cmd.boundary.style.strokeColor)
                  : undefined,
                badgeColor: cmd.boundary.style.badgeColor
                  ? normalizeHexColor(cmd.boundary.style.badgeColor)
                  : undefined,
              }
            : undefined,
        };
        if (idx >= 0) sheet.boundaries[idx] = normalized;
        else sheet.boundaries.push(normalized);
        break;
      }
      case "boundary/remove": {
        const idx = sheet.boundaries.findIndex((b) => b.id === cmd.boundaryId);
        if (idx >= 0) {
          sheet.boundaries.splice(idx, 1);
          draft.deletedIds.push(cmd.boundaryId);
        }
        break;
      }
      case "summary/upsert": {
        const idx = sheet.summaries.findIndex((s) => s.id === cmd.summary.id);
        if (idx >= 0) sheet.summaries[idx] = cmd.summary;
        else sheet.summaries.push(cmd.summary);
        dirtyTopicIds.add(cmd.summary.parentId);
        break;
      }
      case "summary/remove": {
        const idx = sheet.summaries.findIndex((s) => s.id === cmd.summaryId);
        if (idx >= 0) {
          const removed = new Set<string>([cmd.summaryId]);
          collectSubtreeIds(sheet.summaries[idx].topic, removed);
          sheet.summaries.splice(idx, 1);
          cascadeCleanup(draft, sheet, removed);
        }
        break;
      }
      case "relationship/upsert": {
        const idx = sheet.relationships.findIndex((r) => r.id === cmd.relationship.id);
        const rel = {
          ...cmd.relationship,
          control1Offset: cmd.relationship.control1Offset
            ? {
                dx: quantizeCoord(cmd.relationship.control1Offset.dx),
                dy: quantizeCoord(cmd.relationship.control1Offset.dy),
              }
            : undefined,
          control2Offset: cmd.relationship.control2Offset
            ? {
                dx: quantizeCoord(cmd.relationship.control2Offset.dx),
                dy: quantizeCoord(cmd.relationship.control2Offset.dy),
              }
            : undefined,
          style: cmd.relationship.style
            ? {
                ...cmd.relationship.style,
                strokeColor: cmd.relationship.style.strokeColor
                  ? normalizeHexColor(cmd.relationship.style.strokeColor)
                  : undefined,
              }
            : undefined,
        };
        if (idx >= 0) sheet.relationships[idx] = rel;
        else sheet.relationships.push(rel);
        break;
      }
      case "relationship/remove": {
        const idx = sheet.relationships.findIndex((r) => r.id === cmd.relationshipId);
        if (idx >= 0) {
          sheet.relationships.splice(idx, 1);
          draft.deletedIds.push(cmd.relationshipId);
        }
        break;
      }
    }
  });

  return { nextDoc, patches, inversePatches, dirtyTopicIds };
}
