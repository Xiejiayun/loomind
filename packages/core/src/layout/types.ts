import type RBush from "rbush";
import type { MindmapSheet, MindmapStructure, MindmapThemeConfig, MindmapTopic, TopicShape } from "../model/document.js";
import type { PaletteSpec, SkeletonSpec } from "../theme/tokens.js";
import type { TextMeasurer } from "./measurer.js";

export interface Point {
  x: number;
  y: number;
}

export interface LayoutBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpatialItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  topicId: string;
}

export interface LayoutNode {
  id: string;
  depth: number;
  branchIndex: number;
  side: "center" | "left" | "right" | "top" | "bottom";
  box: LayoutBox;
  contentBox: LayoutBox;
  accentColor: string;
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  textColor: string;
  fontSize: number;
  fontWeight: 400 | 500 | 600 | 700;
  paddingX: number;
  paddingY: number;
  cornerRadius: number;
  shape: Exclude<TopicShape, "auto">;
  underlineMode: boolean;
  underlineDrawnByEdge?: boolean;
  neonGlow?: boolean;
  handdrawnSeed: number;
  taskSummary?: { done: number; total: number };
  hiddenCount: number;
  calloutBox?: LayoutBox;
}

export interface LayoutEdge {
  id: string;
  fromId: string;
  toId: string;
  kind: "tapered" | "bezier" | "elbow" | "brace" | "fishbone-rib" | "timeline-spine" | "table-cell";
  svgPath: string;
  fillPath?: string;
  color: string;
  strokeWidth: number;
  handdrawn: boolean;
  seed: number;
}

export interface LayoutBoundary {
  id: string;
  svgPath: string;
  badgeBox?: LayoutBox;
  title?: string;
  fillColor: string;
  strokeColor: string;
  badgeColor: string;
}

export interface LayoutSummary {
  id: string;
  bracePath: string;
  color: string;
  topicId: string;
}

export interface LayoutRelationship {
  id: string;
  svgPath: string;
  labelPos?: Point;
  title?: string;
  p0: Point;
  c1: Point;
  c2: Point;
  p3: Point;
  color: string;
  strokeWidth: number;
  dash: "dashed" | "solid" | "dotted";
}

export interface MindmapLayoutResult {
  sheetId: string;
  bounds: LayoutBox;
  nodes: Map<string, LayoutNode>;
  edges: LayoutEdge[];
  boundaries: LayoutBoundary[];
  summaries: LayoutSummary[];
  relationships: LayoutRelationship[];
  spatialIndex: RBush<SpatialItem>;
}

export interface NodeMeasurement {
  width: number;
  height: number;
  contentWidth: number;
  contentHeight: number;
  calloutHeight: number;
  calloutWidth: number;
}

export interface TopicStats {
  depth: number;
  branchIndex: number;
  taskSummary?: { done: number; total: number };
  hiddenCount: number;
}

export interface LayoutBuildContext {
  sheet: MindmapSheet;
  theme: MindmapThemeConfig;
  skeleton: SkeletonSpec;
  palette: PaletteSpec;
  measurer: TextMeasurer;
  spacingScale: number;
  stats: Map<string, TopicStats>;
  measurements: Map<string, NodeMeasurement>;
  nodes: Map<string, LayoutNode>;
  edges: LayoutEdge[];
  placeSubtree: (
    topic: MindmapTopic,
    originX: number,
    originY: number,
    side: LayoutNode["side"],
    inheritedStructure: MindmapStructure,
  ) => LayoutBox;
  makeLayoutNode: (
    topic: MindmapTopic,
    x: number,
    y: number,
    side: LayoutNode["side"],
  ) => LayoutNode;
}

export interface StructureLayoutPlugin {
  structure: MindmapStructure;
  layoutChildren: (
    parent: MindmapTopic,
    parentNode: LayoutNode,
    ctx: LayoutBuildContext,
  ) => LayoutBox;
}
