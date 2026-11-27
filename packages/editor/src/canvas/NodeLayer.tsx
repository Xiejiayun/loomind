import React, { useMemo } from "react";
import type {
  CameraState,
  InlineAsset,
  MindmapLayoutResult,
  MindmapTopic,
  PeerPresence,
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
  remotePeers?: PeerPresence[];
  searchMatchedIds?: ReadonlySet<string>;
  activeSearchMatchId?: string | null;
  editingTopicId: string | null;
  initialEditChar?: string;
  onSelectTopic: (topicId: string, e: React.MouseEvent) => void;
  onStartEdit: (topicId: string) => void;
  onCommitEdit: (topicId: string, doc: RichTextDoc) => void;
  onCancelEdit: () => void;
  onToggleCollapse: (topicId: string) => void;
  onToggleTask: (topicId: string) => void;
  onUpdateCallout: (topicId: string, text: string | null) => void;
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
    remotePeers,
    searchMatchedIds,
    activeSearchMatchId,
    editingTopicId,
    initialEditChar,
    onSelectTopic,
    onStartEdit,
    onCommitEdit,
    onCancelEdit,
    onToggleCollapse,
    onToggleTask,
    onUpdateCallout,
    onStartDrag,
    onStartResizeWidth,
    onContextMenu,
  }) => {
    // RBush viewport culling (+600px world buffer so panning stays smooth without frequent re-culling)
    const visibleTopicIds = useMemo(() => {
      const buffer = 600 / Math.max(0.15, camera.scale);
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

    const peerByTopicId = useMemo(() => {
      if (!remotePeers || remotePeers.length === 0) return null;
      const map = new Map<string, PeerPresence>();
      for (const peer of remotePeers) {
        for (const tid of peer.selectedTopicIds) {
          if (!map.has(tid)) map.set(tid, peer);
        }
      }
      return map;
    }, [remotePeers]);

    return (
      <div className="pointer-events-none absolute inset-0">
        {visibleTopicIds.map((id) => {
          const layoutNode = layout.nodes.get(id);
          const topic = topicMap.get(id);
          if (!layoutNode || !topic) return null;

          const isEditing = editingTopicId === id;
          const isSelected = selectedIds.has(id);

          return (
            <div
              key={id}
              className="mindmap-node-motion pointer-events-auto absolute"
              style={{
                transform: `translate(${layoutNode.box.x}px, ${layoutNode.box.y}px)`,
                zIndex: isEditing ? 40 : isSelected ? 20 : 10,
              }}
            >
              <TopicCard
                topic={topic}
                layoutNode={layoutNode}
                selected={isSelected}
                remotePeer={peerByTopicId?.get(id)}
                searchHighlight={
                  activeSearchMatchId === id ? "active" : searchMatchedIds?.has(id) ? "match" : undefined
                }
                editing={isEditing}
                initialEditChar={isEditing ? initialEditChar : undefined}
                lodLow={lodLow}
                asset={topic.image ? assets[topic.image.resourceId] : undefined}
                onSelect={onSelectTopic}
                onStartEdit={onStartEdit}
                onCommitEdit={onCommitEdit}
                onCancelEdit={onCancelEdit}
                onToggleCollapse={onToggleCollapse}
                onToggleTask={onToggleTask}
                onUpdateCallout={onUpdateCallout}
                onStartDrag={onStartDrag}
                onStartResizeWidth={onStartResizeWidth}
                onContextMenu={onContextMenu}
              />
            </div>
          );
        })}
      </div>
    );
  },
);
NodeLayer.displayName = "NodeLayer";
