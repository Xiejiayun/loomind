import RBush from "rbush";
import type {
  MindmapDocument,
  MindmapSheet,
  MindmapStructure,
  MindmapThemeConfig,
  MindmapTopic,
  TopicShape,
  TopicThemeRole,
  TopicStyleOverride,
} from "../model/document.js";
import { findTopicLocation } from "../store/reducer.js";
import { getThemePalette } from "../theme/palettes.js";
import { getSkeleton } from "../theme/skeletons.js";
import { compositeHexOverBg, isDarkFill, mixHexWithAlpha, type DepthStyleToken } from "../theme/tokens.js";
import { CALLOUT_GAP, measureTopicBox } from "./box-anatomy.js";
import { HeadlessTextMeasurer, type TextMeasurer } from "./measurer.js";
import { routeRelationships } from "./routing.js";
import { braceStructurePlugin } from "./structures/brace.js";
import { fishboneStructurePlugin } from "./structures/fishbone.js";
import { unionBox } from "./structures/flextree-util.js";
import { indentedStructurePlugin } from "./structures/indented.js";
import { logicStructurePlugin } from "./structures/logic.js";
import { matrixStructurePlugin } from "./structures/matrix.js";
import { mindmapStructurePlugin } from "./structures/mindmap.js";
import { orgStructurePlugin } from "./structures/org.js";
import { timelineStructurePlugin } from "./structures/timeline.js";
import { treeTableStructurePlugin } from "./structures/tree-table.js";
import { buildBoundaryPath, buildCurlyBracePath, buildRoughSvgPath, fnv1aSeed } from "./svg-paths.js";
import type {
  LayoutBoundary,
  LayoutBox,
  LayoutBuildContext,
  LayoutEdge,
  LayoutNode,
  LayoutSummary,
  MindmapLayoutResult,
  NodeMeasurement,
  SpatialItem,
  StructureLayoutPlugin,
  TopicStats,
} from "./types.js";

const STRUCTURE_REGISTRY = new Map<MindmapStructure, StructureLayoutPlugin>([
  ["mindmap", mindmapStructurePlugin],
  ["logic", logicStructurePlugin],
  ["org", orgStructurePlugin],
  ["brace", braceStructurePlugin],
  ["indented", indentedStructurePlugin],
  ["timeline", timelineStructurePlugin],
  ["fishbone", fishboneStructurePlugin],
  ["treeTable", treeTableStructurePlugin],
  ["matrix", matrixStructurePlugin],
]);

export function registerStructurePlugin(plugin: StructureLayoutPlugin): void {
  STRUCTURE_REGISTRY.set(plugin.structure, plugin);
}

export function getStructurePlugin(structure: MindmapStructure): StructureLayoutPlugin {
  return STRUCTURE_REGISTRY.get(structure) ?? logicStructurePlugin;
}

function spacingMultiplier(spacing: MindmapSheet["spacing"]): number {
  if (spacing === "compact") return 0.78;
  if (spacing === "spacious") return 1.32;
  return 1.0;
}

function topicMeasureHash(topic: MindmapTopic, token: DepthStyleToken, hasTaskSummary: boolean): string {
  return JSON.stringify([
    topic.title,
    topic.subtitle,
    topic.shape,
    topic.customWidth,
    topic.markers,
    topic.stickerId,
    topic.labels,
    topic.task?.status,
    hasTaskSummary,
    topic.callout?.title,
    topic.note?.text ? 1 : 0,
    topic.href?.target ? 1 : 0,
    topic.equation?.latex,
    topic.image,
    topic.style?.fontSize ?? token.fontSize,
    topic.style?.fontWeight ?? token.fontWeight,
    topic.style?.fontFamily,
    topic.style?.strokeWidth ?? token.strokeWidth,
    token.paddingX,
    token.paddingY,
  ]);
}

export class LayoutEngine {
  private measureCache = new Map<string, { hash: string; measurement: NodeMeasurement }>();
  private measurer: TextMeasurer;

  constructor(measurer?: TextMeasurer) {
    this.measurer = measurer ?? new HeadlessTextMeasurer();
  }

  setMeasurer(measurer: TextMeasurer): void {
    this.measurer = measurer;
    this.measureCache.clear();
  }

  compute(
    doc: MindmapDocument,
    sheetId?: string,
    opts?: { drillRootId?: string | null; appearance?: "dark" | "light" },
  ): MindmapLayoutResult {
    const sheet =
      doc.sheets.find((s) => s.id === (sheetId ?? doc.activeSheetId)) ?? doc.sheets[0];
    const theme: MindmapThemeConfig = { ...doc.theme, ...sheet.theme };
    const skeleton = getSkeleton(theme.skeletonId);
    const palette = getThemePalette(theme, opts?.appearance);
    const spacingScale = spacingMultiplier(sheet.spacing);

    const activeRoot =
      opts?.drillRootId
        ? findTopicLocation(sheet, opts.drillRootId)?.topic ?? sheet.rootTopic
        : sheet.rootTopic;

    // Stage 1: Stats DFS
    const stats = new Map<string, TopicStats>();
    const collectStats = (
      topic: MindmapTopic,
      depth: number,
      branchIndex: number,
    ): { done: number; total: number; totalDescendants: number } => {
      let done = topic.task?.status === "done" ? 1 : 0;
      let total = topic.task ? 1 : 0;
      let desc = 0;

      for (let i = 0; i < topic.children.length; i++) {
        const childBranch = depth === 0 ? i : branchIndex;
        const c = collectStats(topic.children[i], depth + 1, childBranch);
        done += c.done;
        total += c.total;
        desc += 1 + c.totalDescendants;
      }

      const taskSummary =
        total > 0 && topic.children.length > 0 ? { done, total } : undefined;
      stats.set(topic.id, {
        depth,
        branchIndex,
        taskSummary,
        hiddenCount: topic.collapsed ? desc : 0,
      });

      return { done, total, totalDescendants: desc };
    };

    collectStats(activeRoot, 0, 0);
    for (let i = 0; i < sheet.floatingTopics.length; i++) {
      collectStats(sheet.floatingTopics[i], 1, i);
    }
    for (let i = 0; i < sheet.summaries.length; i++) {
      collectStats(sheet.summaries[i].topic, 1, i);
    }

    // Stage 2: Incremental measurements
    const measurements = new Map<string, NodeMeasurement>();
    const tokenForDepth = (depth: number): DepthStyleToken =>
      depth === 0 ? skeleton.depth0 : depth === 1 ? skeleton.depth1 : skeleton.depth2Plus;

    const styledTopics = new Map<string, MindmapTopic>();
    const measureTree = (source: MindmapTopic, role: TopicThemeRole, parentStyle?: TopicStyleOverride) => {
      let topic = source;
      const preset = theme.topicStyles?.[role];
      if (preset || parentStyle?.lineWidth !== undefined || parentStyle?.lineKind || parentStyle?.lineColor) {
        const { shape, ...defaults } = preset ?? {};
        const style = { lineWidth: parentStyle?.lineWidth, lineKind: parentStyle?.lineKind === "tapered" ? "bezier" as const : parentStyle?.lineKind,
          lineColor: role === "mainTopic" && theme.rainbowBranches ? undefined : parentStyle?.lineColor,
          ...defaults, ...source.style };
        if (source.style?.fillColor && !source.style.fillPattern && style.fillPattern === "none") style.fillPattern = "solid";
        topic = { ...source, shape: source.shape ?? shape, style };
        styledTopics.set(topic.id, topic);
      }
      const st = stats.get(topic.id)!;
      const token = tokenForDepth(st.depth);
      const hash = topicMeasureHash(topic, token, Boolean(st.taskSummary));
      const cached = this.measureCache.get(topic.id);
      if (cached && cached.hash === hash) {
        measurements.set(topic.id, cached.measurement);
      } else {
        const m = measureTopicBox(topic, token, this.measurer, Boolean(st.taskSummary));
        this.measureCache.set(topic.id, { hash, measurement: m });
        measurements.set(topic.id, m);
      }
      if (!topic.collapsed) {
        for (const child of topic.children) measureTree(child, st.depth === 0 ? "mainTopic" : "subTopic", topic.style);
      }
    };

    measureTree(activeRoot, "centralTopic");
    if (!opts?.drillRootId) {
      for (const f of sheet.floatingTopics) measureTree(f, "floatingTopic");
      for (const s of sheet.summaries) measureTree(s.topic, "summaryTopic");
    }

    // Evict stale cache entries from deleted topics or switched sheets to bound memory
    if (this.measureCache.size > measurements.size * 2 + 256) {
      for (const cachedId of this.measureCache.keys()) {
        if (!measurements.has(cachedId)) {
          this.measureCache.delete(cachedId);
        }
      }
    }

    // Stage 3: Recursive structure placement
    const nodes = new Map<string, LayoutNode>();
    const edges: LayoutEdge[] = [];

    const makeLayoutNode = (
      source: MindmapTopic,
      x: number,
      y: number,
      side: LayoutNode["side"],
    ): LayoutNode => {
      const topic = styledTopics.get(source.id) ?? source;
      const st = stats.get(topic.id)!;
      const m = measurements.get(topic.id)!;
      const token = tokenForDepth(st.depth);
      const branchColor = topic.style?.lineColor ?? (theme.rainbowBranches
        ? palette.branches[st.branchIndex % palette.branches.length]
        : palette.branches[0]);
      const accentColor = st.depth === 0 ? palette.rootStroke : branchColor;

      const shape: Exclude<TopicShape, "auto"> =
        topic.shape && topic.shape !== "auto" ? topic.shape : token.shape;
      const explicitNonUnderline = Boolean(
        topic.shape && topic.shape !== "auto" && topic.shape !== "underline",
      );
      const underlineMode = shape === "underline" || (topic.shape === undefined && token.underlineMode);

      const defaultFill =
        st.depth === 0
          ? palette.rootFill
          : underlineMode
            ? "#00000000"
            : token.softFillAlpha > 0
              ? mixHexWithAlpha(branchColor, token.softFillAlpha)
              : explicitNonUnderline
                ? mixHexWithAlpha(branchColor, palette.isDark ? 0.22 : 0.12)
                : palette.cardBg;

      const defaultStrokeWidth =
        explicitNonUnderline && token.strokeWidth === 0
          ? shape === "capsule" || shape === "diamond" || shape === "hexagon" || shape === "cloud"
            ? 1.6
            : 1.2
          : explicitNonUnderline && token.underlineMode
            ? 1.5
            : token.strokeWidth;

      const defaultStroke =
        st.depth === 0
          ? palette.rootStroke
          : underlineMode
            ? branchColor
            : defaultStrokeWidth > 0
              ? branchColor
              : palette.cardBorder;

      const shapeCornerRadius =
        topic.shape && topic.shape !== "auto"
          ? shape === "rounded"
            ? 6
            : shape === "capsule"
              ? 18
              : shape === "pill"
                ? 9999
                : 0
          : token.cornerRadius;

      const pattern = topic.style?.fillPattern;
      const effectiveFill = pattern === "none" ? "#00000000" : topic.style?.fillColor ?? (pattern ? branchColor : defaultFill);
      const effectiveBg = underlineMode
        ? palette.canvasBg
        : compositeHexOverBg(effectiveFill, palette.canvasBg);
      const isDarkBg = isDarkFill(effectiveBg);
      const defaultText = isDarkBg
        ? "#FFFFFFFF"
        : palette.isDark
          ? "#0F172AFF"
          : palette.textPrimary;

      const calloutOffset = m.calloutHeight > 0 ? m.calloutHeight + CALLOUT_GAP : 0;
      const contentBox: LayoutBox = {
        x,
        y: y + calloutOffset,
        width: m.contentWidth,
        height: m.contentHeight,
      };
      const calloutBox: LayoutBox | undefined =
        m.calloutHeight > 0
          ? {
              x: x + Math.max(0, (m.contentWidth - m.calloutWidth) / 2),
              y,
              width: m.calloutWidth,
              height: m.calloutHeight,
            }
          : undefined;

      return {
        id: topic.id,
        depth: st.depth,
        branchIndex: st.branchIndex,
        side,
        box: { x, y, width: m.width, height: m.height },
        contentBox,
        accentColor,
        fillColor: effectiveFill,
        strokeColor: topic.style?.strokeColor ?? defaultStroke,
        strokeWidth: topic.style?.strokeWidth ?? (palette.neonGlow && st.depth === 0 ? 2 : defaultStrokeWidth),
        textColor: topic.style?.textColor ?? defaultText,
        fontSize: topic.style?.fontSize ?? token.fontSize,
        fontWeight: topic.style?.fontWeight ?? token.fontWeight,
        fontFamily: topic.style?.fontFamily,
        fillPattern: pattern,
        lineKind: topic.style?.lineKind,
        lineWidth: topic.style?.lineWidth,
        flatStyle: Boolean(theme.topicStyles || pattern),
        paddingX: token.paddingX,
        paddingY: token.paddingY,
        cornerRadius: topic.style?.cornerRadius ?? shapeCornerRadius,
        shape,
        underlineMode,
        isDarkBg,
        neonGlow: palette.neonGlow,
        handdrawnSeed: fnv1aSeed(topic.id),
        taskSummary: st.taskSummary,
        hiddenCount: st.hiddenCount,
        calloutBox,
      };
    };

    const translateSubtree = (topic: MindmapTopic, dx: number, dy: number) => {
      const n = nodes.get(topic.id);
      if (n) {
        n.box = { ...n.box, x: n.box.x + dx, y: n.box.y + dy };
        n.contentBox = { ...n.contentBox, x: n.contentBox.x + dx, y: n.contentBox.y + dy };
        if (n.calloutBox) {
          n.calloutBox = { ...n.calloutBox, x: n.calloutBox.x + dx, y: n.calloutBox.y + dy };
        }
      }
      if (!topic.collapsed) {
        for (const c of topic.children) translateSubtree(c, dx, dy);
      }
    };

    const ctx: LayoutBuildContext = {
      sheet,
      theme,
      skeleton,
      palette,
      measurer: this.measurer,
      spacingScale,
      stats,
      measurements,
      nodes,
      edges,
      makeLayoutNode,
      placeSubtree: (topic, originX, originY, side, inheritedStructure) => {
        const node = makeLayoutNode(topic, originX, originY, side);
        nodes.set(topic.id, node);
        let box = node.box;
        if (!topic.collapsed && topic.children.length > 0) {
          const effStruct = topic.structure ?? inheritedStructure;
          const plugin = getStructurePlugin(effStruct);
          box = plugin.layoutChildren(topic, node, ctx);
        }
        if (topic.manualOffset && (topic.manualOffset.dx !== 0 || topic.manualOffset.dy !== 0)) {
          translateSubtree(topic, topic.manualOffset.dx, topic.manualOffset.dy);
          box = {
            ...box,
            x: box.x + topic.manualOffset.dx,
            y: box.y + topic.manualOffset.dy,
          };
        }
        return box;
      },
    };

    const rootM = measurements.get(activeRoot.id)!;
    let totalBounds = ctx.placeSubtree(
      activeRoot,
      -rootM.width / 2,
      -rootM.height / 2,
      "center",
      activeRoot.structure ?? sheet.structure,
    );

    // Stage 4: Floating Topics, Summaries, Boundaries
    const summaries: LayoutSummary[] = [];
    const boundaries: LayoutBoundary[] = [];

    if (!opts?.drillRootId) {
      for (const f of sheet.floatingTopics) {
        const pos = f.floatingPos ?? { x: 260, y: -160 };
        const fBox = ctx.placeSubtree(f, pos.x, pos.y, "right", f.structure ?? "logic");
        totalBounds = unionBox(totalBounds, fBox);
      }

      for (const s of sheet.summaries) {
        const parentLoc = findTopicLocation(sheet, s.parentId);
        if (!parentLoc) continue;
        const slice = parentLoc.topic.children.slice(s.startIndex, s.endIndex + 1);
        const subBox = collectVisibleSubtreeBox(slice, nodes);
        if (!subBox) continue;

        const firstNode = nodes.get(slice[0].id);
        const isLeft = firstNode?.side === "left";
        const braceX = isLeft ? subBox.x - 16 : subBox.x + subBox.width + 16;
        const rawBracePath = buildCurlyBracePath(
          braceX,
          subBox.y,
          subBox.y + subBox.height,
          isLeft ? -1 : 1,
          14,
        );
        const bracePath = theme.handdrawn
          ? buildRoughSvgPath(rawBracePath, fnv1aSeed(`sum:${s.id}`))
          : rawBracePath;
        const sumM = measurements.get(s.topic.id)!;
        const sumX = isLeft ? braceX - 14 - sumM.width : braceX + 14;
        const sumY = subBox.y + (subBox.height - sumM.height) / 2;
        const placedSumBox = ctx.placeSubtree(
          s.topic,
          sumX,
          sumY,
          isLeft ? "left" : "right",
          s.topic.structure ?? "logic",
        );
        totalBounds = unionBox(totalBounds, placedSumBox);
        summaries.push({
          id: s.id,
          bracePath,
          color: firstNode?.accentColor ?? palette.branches[0],
          topicId: s.topic.id,
        });
      }

      for (const b of sheet.boundaries) {
        let targets: MindmapTopic[] = [];
        if (b.target.kind === "subtree") {
          const loc = findTopicLocation(sheet, b.target.topicId);
          if (loc) targets = [loc.topic];
        } else {
          const loc = findTopicLocation(sheet, b.target.parentId);
          if (loc) targets = loc.topic.children.slice(b.target.startIndex, b.target.endIndex + 1);
        }
        const subBox = collectVisibleSubtreeBox(targets, nodes);
        if (!subBox) continue;

        const padded: LayoutBox = {
          x: subBox.x - 16,
          y: subBox.y - 18,
          width: subBox.width + 32,
          height: subBox.height + 32,
        };
        const firstNode = targets[0] ? nodes.get(targets[0].id) : undefined;
        const baseColor = b.style?.strokeColor ?? firstNode?.accentColor ?? palette.branches[0];
        const fillColor = b.style?.fillColor ?? mixHexWithAlpha(baseColor, 0.08);
        const badgeColor = b.style?.badgeColor ?? baseColor;
        const badgeBox: LayoutBox | undefined = b.title
          ? {
              x: padded.x + 14,
              y: padded.y - 11,
              width: Math.max(44, b.title.length * 10 + 18),
              height: 22,
            }
          : undefined;

        boundaries.push({
          id: b.id,
          svgPath: buildBoundaryPath(padded, b.shape),
          badgeBox,
          title: b.title,
          fillColor,
          strokeColor: baseColor,
          badgeColor,
        });
        totalBounds = unionBox(totalBounds, padded);
      }
    }

    // Stage 5: RBush spatial index + Relationship routing
    const spatialIndex = new RBush<SpatialItem>();
    const items: SpatialItem[] = [];
    for (const node of nodes.values()) {
      items.push({
        minX: node.box.x,
        minY: node.box.y,
        maxX: node.box.x + node.box.width,
        maxY: node.box.y + node.box.height,
        topicId: node.id,
      });
    }
    spatialIndex.load(items);

    const relationships = opts?.drillRootId
      ? []
      : routeRelationships(sheet.relationships, nodes, spatialIndex, palette.textMuted).map((rel) =>
          theme.handdrawn
            ? { ...rel, svgPath: buildRoughSvgPath(rel.svgPath, fnv1aSeed(`rel:${rel.id}`)) }
            : rel,
        );

    return {
      sheetId: sheet.id,
      bounds: totalBounds,
      nodes,
      edges,
      boundaries,
      summaries,
      relationships,
      spatialIndex,
    };
  }
}

function collectVisibleSubtreeBox(
  topics: MindmapTopic[],
  nodes: Map<string, LayoutNode>,
): LayoutBox | null {
  let box: LayoutBox | null = null;
  const walk = (t: MindmapTopic) => {
    const n = nodes.get(t.id);
    if (n) box = box ? unionBox(box, n.box) : n.box;
    if (!t.collapsed) {
      for (const c of t.children) walk(c);
    }
  };
  for (const t of topics) walk(t);
  return box;
}

export function computeSheetLayout(
  doc: MindmapDocument,
  sheetId?: string,
  measurer?: TextMeasurer,
): MindmapLayoutResult {
  return new LayoutEngine(measurer).compute(doc, sheetId);
}
