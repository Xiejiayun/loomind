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

export const ALLOWED_IMAGE_MIME_TYPES = new Set<string>([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);

export function isAllowedImageMimeType(
  mime: string,
): mime is "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml" {
  return ALLOWED_IMAGE_MIME_TYPES.has(mime);
}

export interface CommandRejection {
  code: "SUMMARY_RANGE_BROKEN" | "SUMMARY_CANNOT_DETACH" | "UNSUPPORTED_IMAGE_MIME";
  message: string;
}

export interface ReduceResult {
  nextDoc: MindmapDocument;
  patches: Patch[];
  inversePatches: Patch[];
  dirtyTopicIds: Set<string>;
  rejected?: CommandRejection;
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

function cascadeCleanup(doc: MindmapDocument, sheet: MindmapSheet, initialRemovedIds: Set<string>): void {
  const removed = new Set<string>(initialRemovedIds);
  let changed = true;

  while (changed) {
    changed = false;
    const prevSize = removed.size;

    sheet.summaries = sheet.summaries.filter((s) => {
      const parentLoc = findTopicLocation(sheet, s.parentId);
      const invalidParent = !parentLoc || removed.has(s.parentId) || removed.has(s.topic.id);
      const invalidRange =
        !parentLoc ||
        s.startIndex < 0 ||
        s.endIndex < s.startIndex ||
        s.endIndex >= parentLoc.topic.children.length;
      if (invalidParent || invalidRange) {
        removed.add(s.id);
        collectSubtreeIds(s.topic, removed);
        return false;
      }
      return true;
    });

    sheet.relationships = sheet.relationships.filter((r) => {
      const drop = removed.has(r.fromId) || removed.has(r.toId);
      if (drop) removed.add(r.id);
      return !drop;
    });

    sheet.boundaries = sheet.boundaries.filter((b) => {
      let drop = false;
      if (b.target.kind === "subtree") {
        drop = removed.has(b.target.topicId) || !findTopicLocation(sheet, b.target.topicId);
      } else {
        const parentLoc = findTopicLocation(sheet, b.target.parentId);
        drop =
          !parentLoc ||
          removed.has(b.target.parentId) ||
          b.target.startIndex < 0 ||
          b.target.endIndex < b.target.startIndex ||
          b.target.endIndex >= parentLoc.topic.children.length;
      }
      if (drop) removed.add(b.id);
      return !drop;
    });

    if (removed.size > prevSize) {
      changed = true;
    }
  }

  for (const id of removed) {
    if (!doc.deletedIds.includes(id)) doc.deletedIds.push(id);
  }
}

/**
 * Validates and applies a same-parent reorder while preserving summary contiguity.
 * Rejects atomically if any summary on `parent` would become non-contiguous.
 */
function reorderWithinParentWithSummaries(
  sheet: MindmapSheet,
  parent: MindmapTopic,
  fromIdx: number,
  toIdx: number,
): CommandRejection | null {
  if (fromIdx === toIdx) return null;
  const childIds = parent.children.map((c) => c.id);
  const reorderedIds = [...childIds];
  const [movedId] = reorderedIds.splice(fromIdx, 1);
  reorderedIds.splice(toIdx, 0, movedId);

  const updates: Array<{ index: number; startIndex: number; endIndex: number }> = [];
  for (let i = 0; i < sheet.summaries.length; i++) {
    const s = sheet.summaries[i];
    if (s.parentId !== parent.id) continue;
    const covered = childIds.slice(s.startIndex, s.endIndex + 1);
    const newPositions = covered.map((id) => reorderedIds.indexOf(id)).sort((a, b) => a - b);
    const minPos = newPositions[0];
    const maxPos = newPositions[newPositions.length - 1];
    if (maxPos - minPos + 1 !== covered.length) {
      return {
        code: "SUMMARY_RANGE_BROKEN",
        message: "无法移动：该操作会打断概要覆盖的连续范围。",
      };
    }
    updates.push({ index: i, startIndex: minPos, endIndex: maxPos });
  }

  const [item] = parent.children.splice(fromIdx, 1);
  parent.children.splice(toIdx, 0, item);
  for (const u of updates) {
    sheet.summaries[u.index].startIndex = u.startIndex;
    sheet.summaries[u.index].endIndex = u.endIndex;
  }
  return null;
}

/**
 * Validates and applies a cross-parent move (reparent / indent / outdent) while maintaining summaries:
 * - Rejects atomically if inserting an existing subtree splits a destination summary's interior range.
 * - Shrinks multi-member source summaries when one member moves out.
 * - Migrates single-member source summaries to the new regular parent at `dstIdx`.
 */
function moveAcrossParentsWithSummaries(
  sheet: MindmapSheet,
  src: TopicLocation,
  dstParent: MindmapTopic,
  dstIdx: number,
): CommandRejection | null {
  // Check destination summaries: inserting strictly inside (startIndex, endIndex] splits the range
  for (const s of sheet.summaries) {
    if (s.parentId === dstParent.id && dstIdx > s.startIndex && dstIdx <= s.endIndex) {
      return {
        code: "SUMMARY_RANGE_BROKEN",
        message: "无法移入：不能将已有节点插入概要覆盖的连续范围中间。",
      };
    }
  }

  // Perform the tree move
  const [moved] = src.container.splice(src.index, 1);
  delete moved.floatingPos;
  delete moved.manualOffset;
  dstParent.collapsed = false;
  dstParent.children.splice(dstIdx, 0, moved);

  // Update destination summaries first (before migrating any source summary to dstParent)
  for (const s of sheet.summaries) {
    if (s.parentId === dstParent.id && dstIdx <= s.startIndex) {
      s.startIndex += 1;
      s.endIndex += 1;
    }
  }

  // Update source summaries (shrink, shift, or migrate single-member summary)
  if (src.parent) {
    const srcParentId = src.parent.id;
    for (const s of sheet.summaries) {
      if (s.parentId !== srcParentId) continue;
      if (src.index < s.startIndex) {
        s.startIndex -= 1;
        s.endIndex -= 1;
      } else if (src.index >= s.startIndex && src.index <= s.endIndex) {
        if (s.startIndex === s.endIndex) {
          // Single-member summary migrates with its sole covered topic to dstParent
          s.parentId = dstParent.id;
          s.startIndex = dstIdx;
          s.endIndex = dstIdx;
        } else {
          // Multi-member summary shrinks to remaining contiguous members
          s.endIndex -= 1;
        }
      }
    }
  }

  return null;
}

function gcUnreferencedAssets(doc: MindmapDocument): void {
  const assetKeys = Object.keys(doc.assets);
  if (assetKeys.length === 0) return;

  const referenced = new Set<string>();
  const walkTopic = (topic: MindmapTopic) => {
    if (topic.image?.resourceId) referenced.add(topic.image.resourceId);
    for (const c of topic.children) walkTopic(c);
  };

  for (const s of doc.sheets) {
    walkTopic(s.rootTopic);
    for (const f of s.floatingTopics) walkTopic(f);
    for (const sum of s.summaries) walkTopic(sum.topic);
  }

  for (const key of assetKeys) {
    if (!referenced.has(key)) {
      delete doc.assets[key];
    }
  }
}

export function applyMindmapCommand(doc: MindmapDocument, cmd: MindmapCommand): ReduceResult {
  const dirtyTopicIds = new Set<string>();
  let rejected: CommandRejection | undefined;

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
      gcUnreferencedAssets(draft);
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
        const oldRootIds = new Set<string>();
        collectSubtreeIds(sheet.rootTopic, oldRootIds);
        const newRootIds = new Set<string>();
        collectSubtreeIds(cmd.rootTopic, newRootIds);
        const vanishedIds = new Set<string>();
        for (const id of oldRootIds) {
          if (!newRootIds.has(id)) vanishedIds.add(id);
        }
        sheet.rootTopic = cmd.rootTopic;
        cascadeCleanup(draft, sheet, vanishedIds);
        gcUnreferencedAssets(draft);
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
      case "topic/insertSubtrees": {
        if (cmd.topics.length === 0) break;
        const loc = findTopicLocation(sheet, cmd.parentId);
        if (!loc) break;
        if (cmd.assets) {
          for (const asset of Object.values(cmd.assets)) {
            if (!isAllowedImageMimeType(asset.mimeType)) {
              rejected = {
                code: "UNSUPPORTED_IMAGE_MIME",
                message: "仅支持 PNG、JPEG、WebP 或 SVG 图片格式。",
              };
              break;
            }
          }
          if (rejected) break;
        }
        const insertIdx =
          cmd.index !== undefined
            ? Math.max(0, Math.min(cmd.index, loc.topic.children.length))
            : loc.topic.children.length;
        loc.topic.collapsed = false;
        loc.topic.children.splice(insertIdx, 0, ...cmd.topics);
        const count = cmd.topics.length;
        for (const s of sheet.summaries) {
          if (s.parentId === loc.topic.id) {
            if (insertIdx <= s.startIndex) {
              s.startIndex += count;
              s.endIndex += count;
            } else if (insertIdx <= s.endIndex) {
              s.endIndex += count;
            }
          }
        }
        for (const b of sheet.boundaries) {
          if (b.target.kind === "range" && b.target.parentId === loc.topic.id) {
            if (insertIdx <= b.target.startIndex) {
              b.target.startIndex += count;
              b.target.endIndex += count;
            } else if (insertIdx <= b.target.endIndex) {
              b.target.endIndex += count;
            }
          }
        }
        if (cmd.assets) {
          for (const [resId, asset] of Object.entries(cmd.assets)) {
            draft.assets[resId] = asset;
          }
        }
        dirtyTopicIds.add(cmd.parentId);
        for (const inserted of cmd.topics) {
          dirtyTopicIds.add(inserted.id);
        }
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
        gcUnreferencedAssets(draft);
        break;
      }
      case "topic/reparent": {
        if (cmd.topicId === sheet.rootTopic.id || cmd.topicId === cmd.newParentId) break;
        const src = findTopicLocation(sheet, cmd.topicId);
        const dst = findTopicLocation(sheet, cmd.newParentId);
        if (!src || !dst || src.isSummaryRoot) break;
        if (isDescendant(src.topic, cmd.newParentId)) break;

        if (src.parent && src.parent.id === dst.topic.id) {
          const maxTarget = dst.topic.children.length - 1;
          const rawIdx = cmd.index !== undefined ? cmd.index : maxTarget;
          const targetIdx = Math.max(0, Math.min(rawIdx, maxTarget));
          const err = reorderWithinParentWithSummaries(sheet, dst.topic, src.index, targetIdx);
          if (err) {
            rejected = err;
            break;
          }
          dirtyTopicIds.add(dst.topic.id);
          dirtyTopicIds.add(cmd.topicId);
          break;
        }

        const idx =
          cmd.index !== undefined
            ? Math.max(0, Math.min(cmd.index, dst.topic.children.length))
            : dst.topic.children.length;
        const err = moveAcrossParentsWithSummaries(sheet, src, dst.topic, idx);
        if (err) {
          rejected = err;
          break;
        }
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
        const err = reorderWithinParentWithSummaries(sheet, loc.parent, loc.index, nextIdx);
        if (err) {
          rejected = err;
          break;
        }
        dirtyTopicIds.add(loc.parent.id);
        break;
      }
      case "topic/indent": {
        const loc = findTopicLocation(sheet, cmd.topicId);
        if (!loc || !loc.parent || loc.index === 0) break;
        const prevSibling = loc.container[loc.index - 1];
        const err = moveAcrossParentsWithSummaries(sheet, loc, prevSibling, prevSibling.children.length);
        if (err) {
          rejected = err;
          break;
        }
        dirtyTopicIds.add(loc.parent.id);
        dirtyTopicIds.add(prevSibling.id);
        break;
      }
      case "topic/outdent": {
        const loc = findTopicLocation(sheet, cmd.topicId);
        if (!loc || !loc.parent) break;
        const parentLoc = findTopicLocation(sheet, loc.parent.id);
        if (!parentLoc || !parentLoc.parent) break;
        const err = moveAcrossParentsWithSummaries(sheet, loc, parentLoc.parent, parentLoc.index + 1);
        if (err) {
          rejected = err;
          break;
        }
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
          if (loc.parent) {
            const blocksDetach = sheet.summaries.some(
              (s) => s.parentId === loc.parent!.id && s.startIndex === loc.index && s.endIndex === loc.index,
            );
            if (blocksDetach) {
              rejected = {
                code: "SUMMARY_CANNOT_DETACH",
                message: "无法脱离为自由主题：该节点是独立概要的唯一成员。",
              };
              break;
            }
          }
          const [detached] = loc.container.splice(loc.index, 1);
          delete detached.manualOffset;
          detached.floatingPos = { x: quantizeCoord(cmd.pos.x), y: quantizeCoord(cmd.pos.y) };
          sheet.floatingTopics.push(detached);
          if (loc.parent) {
            for (const s of sheet.summaries) {
              if (s.parentId !== loc.parent.id) continue;
              if (loc.index < s.startIndex) {
                s.startIndex -= 1;
                s.endIndex -= 1;
              } else if (loc.index <= s.endIndex) {
                s.endIndex -= 1;
              }
            }
            dirtyTopicIds.add(loc.parent.id);
          }
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
          if (cmd.asset && !isAllowedImageMimeType(cmd.asset.mimeType)) {
            rejected = {
              code: "UNSUPPORTED_IMAGE_MIME",
              message: "仅支持 PNG、JPEG、WebP 或 SVG 图片格式。",
            };
            break;
          }
          if (cmd.asset) draft.assets[cmd.asset.resourceId] = cmd.asset;
          if (cmd.image) loc.topic.image = cmd.image;
          else delete loc.topic.image;
          gcUnreferencedAssets(draft);
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
          gcUnreferencedAssets(draft);
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

  if (rejected) {
    return { nextDoc: doc, patches: [], inversePatches: [], dirtyTopicIds: new Set(), rejected };
  }

  return { nextDoc, patches, inversePatches, dirtyTopicIds };
}
