import React, { useMemo } from "react";
import { motion } from "motion/react";
import type {
  CameraState,
  InlineAsset,
  MindmapLayoutResult,
  MindmapTopic,
  RichTextDoc,
} from "@mindmap/core";
import { TopicCard } from "./TopicCard.js";

interface NodeLayerProps {
  layout: MindmapLayoutResult;
  topicMap: Map<string, MindmapTopic>;
  assets: Record<string, InlineAsset>;
  camera: CameraState;
  viewportSize: { width: number; height: number };
  selectedIds: Set<string>;
  editingTopicId: string | null;
  initialEditChar?: string;
  isInteracting: boolean;
  onSelectTopic: (topicId: string, e: React.MouseEvent) => void;
  onStartEdit: (topicId: string) => void;
  onCommitEdit: (topicId: string, doc: RichTextDoc) => void;
  onCancelEdit: () => void;
  onToggleCollapse: (topicId: string) => void;
  onToggleTask: (topicId: string) => void;
  onStartDrag: (topicId: string, e: React.PointerEvent) => void;
  onStartResizeWidth: (topicId: string, e: React.PointerEvent) => void;
  onContextMenu: (topicId: string, e: React.MouseEvent) => void;
}

export const NodeLayer: React.FC<NodeLayerProps> = React.memo(
  ({
    layout,
    topicMap,
    assets,
    camera,
    viewportSize,
    selectedIds,
    editingTopicId,
    initialEditChar,
    isInteracting,
    onSelectTopic,
    onStartEdit,
    onCommitEdit,
    onCancelEdit,
    onToggleCollapse,
    onToggleTask,
    onStartDrag,
    onStartResizeWidth,
    onContextMenu,
  }) => {
    // RBush viewport culling (+400px world buffer)
    const visibleTopicIds = useMemo(() => {
      const buffer = 400 / Math.max(0.15, camera.scale);
      const minX = -camera.x / camera.scale - buffer;
      const minY = -camera.y / camera.scale - buffer;
      const maxX = (viewportSize.width - camera.x) / camera.scale + buffer;
      const maxY = (viewportSize.height - camera.y) / camera.scale + buffer;

      const hits = layout.spatialIndex.search({ minX, minY, maxX, maxY });
      const ids = hits.map((h) => h.topicId);
      if (editingTopicId && layout.nodes.has(editingTopicId) && !ids.includes(editingTopicId)) {
        ids.push(editingTopicId);
      }
      return ids;
    }, [layout, camera, viewportSize, editingTopicId]);

    const lodLow = camera.scale < 0.35;

    return (
      <div className="pointer-events-none absolute inset-0">
        {visibleTopicIds.map((id) => {
          const layoutNode = layout.nodes.get(id);
          const topic = topicMap.get(id);
          if (!layoutNode || !topic) return null;

          const isEditing = editingTopicId === id;
          const isSelected = selectedIds.has(id);

          return (
            <motion.div
              key={id}
              className="pointer-events-auto absolute"
              initial={false}
              animate={{ x: layoutNode.box.x, y: layoutNode.box.y }}
              transition={
                isInteracting
                  ? { duration: 0 }
                  : { duration: 0.22, ease: [0.22, 1, 0.36, 1] }
              }
              style={{ zIndex: isEditing ? 40 : isSelected ? 20 : 10 }}
            >
              <TopicCard
                topic={topic}
                layoutNode={layoutNode}
                selected={isSelected}
                editing={isEditing}
                initialEditChar={isEditing ? initialEditChar : undefined}
                lodLow={lodLow}
                asset={topic.image ? assets[topic.image.resourceId] : undefined}
                onSelect={(e) => onSelectTopic(id, e)}
                onStartEdit={() => onStartEdit(id)}
                onCommitEdit={(doc) => onCommitEdit(id, doc)}
                onCancelEdit={onCancelEdit}
                onToggleCollapse={() => onToggleCollapse(id)}
                onToggleTask={() => onToggleTask(id)}
                onStartDrag={(e) => onStartDrag(id, e)}
                onStartResizeWidth={(e) => onStartResizeWidth(id, e)}
                onContextMenu={(e) => onContextMenu(id, e)}
              />
            </motion.div>
          );
        })}
      </div>
    );
  },
);
NodeLayer.displayName = "NodeLayer";
