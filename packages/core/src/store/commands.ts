import type {
  InlineAsset,
  MindmapBoundary,
  MindmapCallout,
  MindmapRelationship,
  MindmapSheet,
  MindmapStructure,
  MindmapSummary,
  MindmapThemeConfig,
  MindmapTopic,
  RichTextDoc,
  TopicShape,
  TopicStyleOverride,
} from "../model/document.js";

export type MindmapCommand =
  // 1. Node topology operations
  | { type: "topic/addChild"; sheetId: string; parentId: string; newId: string; title?: RichTextDoc }
  | {
      type: "topic/addSibling";
      sheetId: string;
      targetId: string;
      position: "before" | "after";
      newId: string;
      title?: RichTextDoc;
    }
  | { type: "topic/addParent"; sheetId: string; targetId: string; newId: string; title?: RichTextDoc }
  | {
      type: "topic/insertSubtrees";
      sheetId: string;
      parentId: string;
      index?: number;
      topics: MindmapTopic[];
      assets?: Record<string, InlineAsset>;
    }
  | { type: "topic/delete"; sheetId: string; topicIds: string[] }
  | { type: "topic/reparent"; sheetId: string; topicId: string; newParentId: string; index?: number }
  | { type: "topic/reorder"; sheetId: string; topicId: string; delta: -1 | 1 }
  | { type: "topic/indent"; sheetId: string; topicId: string }
  | { type: "topic/outdent"; sheetId: string; topicId: string }
  | {
      type: "topic/addFloating";
      sheetId: string;
      newId: string;
      pos: { x: number; y: number };
      title?: RichTextDoc;
    }
  | { type: "topic/detachToFloating"; sheetId: string; topicId: string; pos: { x: number; y: number } }
  // 2. Rich content & style operations
  | { type: "topic/setTitle"; sheetId: string; topicId: string; title: RichTextDoc }
  | { type: "topic/setSubtitle"; sheetId: string; topicId: string; subtitle?: string }
  | { type: "topic/toggleCollapse"; sheetId: string; topicId: string; collapsed?: boolean }
  | { type: "topic/setStructure"; sheetId: string; topicId: string; structure?: MindmapStructure }
  | {
      type: "topic/setStyle";
      sheetId: string;
      topicIds: string[];
      shape?: TopicShape;
      style?: Partial<TopicStyleOverride>;
      clear?: boolean;
    }
  | { type: "topic/setManualOffset"; sheetId: string; topicId: string; offset?: { dx: number; dy: number } }
  | { type: "topic/setCustomWidth"; sheetId: string; topicId: string; width?: number }
  | { type: "topic/toggleMarker"; sheetId: string; topicId: string; marker: string }
  | { type: "topic/setSticker"; sheetId: string; topicId: string; stickerId?: string }
  | { type: "topic/setLabels"; sheetId: string; topicId: string; labels: string[] }
  | { type: "topic/toggleTask"; sheetId: string; topicId: string; status?: "todo" | "done" | null }
  | { type: "topic/setCallout"; sheetId: string; topicId: string; callout?: MindmapCallout | null }
  | { type: "topic/setNote"; sheetId: string; topicId: string; text?: string }
  | { type: "topic/setHref"; sheetId: string; topicId: string; href?: MindmapTopic["href"] }
  | { type: "topic/setEquation"; sheetId: string; topicId: string; latex?: string }
  | { type: "topic/setImage"; sheetId: string; topicId: string; image?: MindmapTopic["image"]; asset?: InlineAsset }
  // 3. Decorations & relationships
  | { type: "boundary/upsert"; sheetId: string; boundary: MindmapBoundary }
  | { type: "boundary/remove"; sheetId: string; boundaryId: string }
  | { type: "summary/upsert"; sheetId: string; summary: MindmapSummary }
  | { type: "summary/remove"; sheetId: string; summaryId: string }
  | { type: "relationship/upsert"; sheetId: string; relationship: MindmapRelationship }
  | { type: "relationship/remove"; sheetId: string; relationshipId: string }
  // 4. Canvas / Theme / Multi-sheet
  | { type: "sheet/add"; sheet: MindmapSheet }
  | { type: "sheet/switch"; sheetId: string }
  | { type: "sheet/rename"; sheetId: string; title: string }
  | { type: "sheet/remove"; sheetId: string }
  | {
      type: "sheet/setLayout";
      sheetId: string;
      structure?: MindmapStructure;
      direction?: MindmapSheet["direction"];
      spacing?: MindmapSheet["spacing"];
    }
  | { type: "theme/set"; sheetId?: string; patch: Partial<MindmapThemeConfig> }
  | { type: "doc/replaceSheetRoot"; sheetId: string; rootTopic: MindmapTopic };
