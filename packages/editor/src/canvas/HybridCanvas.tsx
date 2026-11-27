import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useGesture } from "@use-gesture/react";
import { ArrowLeft, BoxSelect, Palette, Sparkles, SquareDashedBottom } from "lucide-react";
import {
  collectAllTopics,
  createRichText,
  createTopic,
  findTopicLocation,
  generateId,
  getPalette,
  hex8ToCss,
  isAllowedImageMimeType,
  richTextToPlainText,
  type LayoutBox,
  type MindmapLayoutResult,
  type RichTextDoc,
} from "@mindmap/core";
import { useMindmapStore } from "../context.js";
import { useEditorI18n } from "../i18n.js";
import { computePanToRevealNode, findNextTopicByArrow, type ArrowDirection } from "./navigation.js";
import { NodeLayer } from "./NodeLayer.js";
import { SvgLayer } from "./SvgLayer.js";

interface DragState {
  topicId: string;
  startClientX: number;
  startClientY: number;
  curClientX: number;
  curClientY: number;
  altKey: boolean;
  active: boolean;
  dropTargetId: string | null;
  dropMode: "child" | "before" | "after" | "floating";
}

interface MarqueeState {
  startX: number;
  startY: number;
  curX: number;
  curY: number;
}

interface HybridCanvasProps {
  appearance?: "dark" | "light";
  viewportRef?: React.RefObject<HTMLDivElement | null>;
  layout: MindmapLayoutResult;
  onOpenContextMenu?: (topicId: string, pos: { x: number; y: number }) => void;
  onOpenAi?: () => void;
}

export const HybridCanvas: React.FC<HybridCanvasProps> = ({ layout, viewportRef, appearance, onOpenContextMenu, onOpenAi }) => {
  const localRef = useRef<HTMLDivElement>(null);
  const containerRef = viewportRef ?? localRef;
  const worldRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [cameraReady, setCameraReady] = useState(false);
  const [initialEditChar, setInitialEditChar] = useState<string | undefined>(undefined);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const centeredSheetRef = useRef<string | null>(null);
  const userMovedCameraRef = useRef(false);

  const doc = useMindmapStore((s) => s.doc);
  const camera = useMindmapStore((s) => s.camera);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const setCamera = useMindmapStore((s) => s.setCamera);

  const setInteractingDom = useCallback((active: boolean) => {
    containerRef.current?.classList.toggle("is-interacting", active);
  }, []);

  const applyTransformDom = useCallback((c: { x: number; y: number; scale: number }) => {
    if (worldRef.current) {
      worldRef.current.style.transform = `translate(${c.x}px, ${c.y}px) scale(${c.scale})`;
    }
  }, []);
  const selectedTopicIds = useMindmapStore((s) => s.selectedTopicIds);
  const selectedRelationshipId = useMindmapStore((s) => s.selectedRelationshipId);
  const selectedBoundaryId = useMindmapStore((s) => s.selectedBoundaryId);
  const editingTopicId = useMindmapStore((s) => s.editingTopicId);
  const drillRootId = useMindmapStore((s) => s.drillRootId);
  const pitchMode = useMindmapStore((s) => s.pitchMode);
  const dispatch = useMindmapStore((s) => s.dispatch);
  const reportRejection = useMindmapStore((s) => s.reportRejection);
  const undo = useMindmapStore((s) => s.undo);
  const redo = useMindmapStore((s) => s.redo);
  const selectTopics = useMindmapStore((s) => s.selectTopics);
  const selectRelationship = useMindmapStore((s) => s.selectRelationship);
  const selectBoundary = useMindmapStore((s) => s.selectBoundary);
  const setEditingTopicId = useMindmapStore((s) => s.setEditingTopicId);
  const setDrillRootId = useMindmapStore((s) => s.setDrillRootId);
  const { t } = useEditorI18n();

  const sheet = useMemo(
    () => doc.sheets.find((s) => s.id === doc.activeSheetId) ?? doc.sheets[0],
    [doc],
  );
  const topicMap = useMemo(() => collectAllTopics(sheet), [sheet]);
  const selectedSet = useMemo(() => new Set(selectedTopicIds), [selectedTopicIds]);
  const deletedSet = useMemo(() => new Set(doc.deletedIds), [doc.deletedIds]);
  const theme = { ...doc.theme, ...sheet.theme };
  const palette = getPalette(theme.paletteId, appearance);
  const workspaceCanvas = palette.id === "workspace" && !!appearance;

  const computeFitCamera = useCallback(
    (vw: number, vh: number) => {
      const pad = 72;
      const scaleX = (vw - pad) / Math.max(160, layout.bounds.width);
      const scaleY = (vh - pad) / Math.max(120, layout.bounds.height);
      const scale = Math.max(0.35, Math.min(workspaceCanvas ? 1 : 1.6, scaleX, scaleY));
      const cx = layout.bounds.x + layout.bounds.width / 2;
      const cy = layout.bounds.y + layout.bounds.height / 2;
      return {
        x: vw / 2 - cx * scale,
        y: vh / 2 - cy * scale,
        scale,
      };
    },
    [layout.bounds, workspaceCanvas],
  );

  // Measure viewport container & keep auto-fitted on resize if user hasn't manually panned/zoomed
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      setViewportSize({ width: rect.width, height: rect.height });
      if (!userMovedCameraRef.current) {
        const next = computeFitCamera(rect.width, rect.height);
        cameraRef.current = next;
        applyTransformDom(next);
        setCamera(next);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [computeFitCamera, applyTransformDom, setCamera]);

  // Synchronous pre-paint auto-fit on initial mount or sheet/structure/spacing change (zero jump!)
  const layoutKey = `${sheet.id}:${sheet.structure}:${sheet.spacing}`;
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    if (centeredSheetRef.current === layoutKey && cameraReady) return;
    centeredSheetRef.current = layoutKey;
    userMovedCameraRef.current = false;
    setViewportSize((prev) =>
      prev.width === rect.width && prev.height === rect.height
        ? prev
        : { width: rect.width, height: rect.height },
    );
    const next = computeFitCamera(rect.width, rect.height);
    cameraRef.current = next;
    applyTransformDom(next);
    setCamera(next);
    if (!cameraReady) setCameraReady(true);
  }, [layoutKey, cameraReady, computeFitCamera, setCamera, applyTransformDom]);

  const screenToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      const sx = clientX - (rect?.left ?? 0);
      const sy = clientY - (rect?.top ?? 0);
      return {
        x: (sx - camera.x) / camera.scale,
        y: (sy - camera.y) / camera.scale,
      };
    },
    [camera],
  );

  // Zero-rerender 120fps Pan & Wheel Zoom via direct GPU DOM transform
  useGesture(
    {
      onDrag: ({ delta: [dx, dy], event, first, last }) => {
        if ((event.target as HTMLElement)?.closest("[data-topic-id]")) return;
        const me = event as PointerEvent;
        if (me.shiftKey) return;
        if (first) {
          userMovedCameraRef.current = true;
          setInteractingDom(true);
        }
        const next = {
          x: cameraRef.current.x + dx,
          y: cameraRef.current.y + dy,
          scale: cameraRef.current.scale,
        };
        cameraRef.current = next;
        applyTransformDom(next);
        if (last) {
          setInteractingDom(false);
          setCamera(next);
        }
      },
      onWheel: ({ event, delta: [, dy] }) => {
        event.preventDefault();
        userMovedCameraRef.current = true;
        setInteractingDom(true);
        const factor = Math.exp(-dy * 0.0014);
        const prev = cameraRef.current;
        const nextScale = Math.max(0.15, Math.min(3, prev.scale * factor));
        const rect = containerRef.current?.getBoundingClientRect();
        const mx = event.clientX - (rect?.left ?? 0);
        const my = event.clientY - (rect?.top ?? 0);
        const wx = (mx - prev.x) / prev.scale;
        const wy = (my - prev.y) / prev.scale;
        const next = {
          scale: nextScale,
          x: mx - wx * nextScale,
          y: my - wy * nextScale,
        };
        cameraRef.current = next;
        applyTransformDom(next);

        const el = containerRef.current as unknown as { _wt?: number };
        window.clearTimeout(el._wt);
        el._wt = window.setTimeout(() => {
          setInteractingDom(false);
          setCamera(cameraRef.current);
        }, 120);
      },
    },
    {
      target: containerRef,
      eventOptions: { passive: false },
      drag: { filterTaps: true },
    },
  );

  // Node drag-to-reparent / detach / Alt-drag manualOffset
  const handleStartDragTopic = useCallback(
    (topicId: string, e: React.PointerEvent) => {
      if (topicId === sheet.rootTopic.id) return;
      const startX = e.clientX;
      const startY = e.clientY;
      const altKey = e.altKey;
      const initTopic = topicMap.get(topicId);
      const initOffset = initTopic?.manualOffset ?? { dx: 0, dy: 0 };

      const state: DragState = {
        topicId,
        startClientX: startX,
        startClientY: startY,
        curClientX: startX,
        curClientY: startY,
        altKey,
        active: false,
        dropTargetId: null,
        dropMode: "floating",
      };

      const onMove = (ev: PointerEvent) => {
        const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
        if (!state.active && dist < 8) return;
        if (!state.active) {
          state.active = true;
          setInteractingDom(true);
        }
        state.curClientX = ev.clientX;
        state.curClientY = ev.clientY;

        if (altKey) {
          const dx = (ev.clientX - startX) / camera.scale;
          const dy = (ev.clientY - startY) / camera.scale;
          dispatch(
            {
              type: "topic/setManualOffset",
              sheetId: sheet.id,
              topicId,
              offset: { dx: initOffset.dx + dx, dy: initOffset.dy + dy },
            },
            { coalesceKey: `drag-offset:${topicId}` },
          );
          return;
        }

        const world = screenToWorld(ev.clientX, ev.clientY);
        const hits = layout.spatialIndex
          .search({ minX: world.x - 10, minY: world.y - 10, maxX: world.x + 10, maxY: world.y + 10 })
          .filter((h) => h.topicId !== topicId);

        if (hits.length > 0) {
          const targetId = hits[0].topicId;
          const targetNode = layout.nodes.get(targetId)!;
          const relY = (world.y - targetNode.contentBox.y) / Math.max(1, targetNode.contentBox.height);
          state.dropTargetId = targetId;
          state.dropMode =
            targetId === sheet.rootTopic.id
              ? "child"
              : relY < 0.25
                ? "before"
                : relY > 0.75
                  ? "after"
                  : "child";
        } else {
          state.dropTargetId = null;
          state.dropMode = "floating";
        }
        setDragState({ ...state });
      };

      const onUp = (ev: PointerEvent) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        if (state.active) {
          setInteractingDom(false);
          if (!altKey) {
            if (state.dropTargetId) {
              if (state.dropMode === "child") {
                dispatch({
                  type: "topic/reparent",
                  sheetId: sheet.id,
                  topicId,
                  newParentId: state.dropTargetId,
                });
              } else {
                const targetLoc = findTopicLocation(sheet, state.dropTargetId);
                if (targetLoc?.parent) {
                  const idx = state.dropMode === "before" ? targetLoc.index : targetLoc.index + 1;
                  dispatch({
                    type: "topic/reparent",
                    sheetId: sheet.id,
                    topicId,
                    newParentId: targetLoc.parent.id,
                    index: idx,
                  });
                }
              }
            } else {
              const world = screenToWorld(ev.clientX, ev.clientY);
              dispatch({
                type: "topic/detachToFloating",
                sheetId: sheet.id,
                topicId,
                pos: world,
              });
            }
          }
        }
        setDragState(null);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [sheet, topicMap, camera.scale, dispatch, layout, screenToWorld],
  );

  // Right-edge custom width drag
  const handleStartResizeWidth = useCallback(
    (topicId: string, e: React.PointerEvent) => {
      const node = layout.nodes.get(topicId);
      if (!node) return;
      const startX = e.clientX;
      const startW = node.contentBox.width;
      setInteractingDom(true);

      const onMove = (ev: PointerEvent) => {
        const nextW = Math.max(80, Math.min(640, startW + (ev.clientX - startX) / camera.scale));
        dispatch(
          { type: "topic/setCustomWidth", sheetId: sheet.id, topicId, width: nextW },
          { coalesceKey: `resize:${topicId}` },
        );
      };
      const onUp = () => {
        setInteractingDom(false);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [layout.nodes, camera.scale, dispatch, sheet.id],
  );

  // Relationship control handle drag
  const handleStartDragControl = useCallback(
    (relId: string, handle: "c1" | "c2", e: React.PointerEvent<SVGCircleElement>) => {
      const rel = sheet.relationships.find((r) => r.id === relId);
      const layoutRel = layout.relationships.find((r) => r.id === relId);
      if (!rel || !layoutRel) return;
      setInteractingDom(true);
      const startX = e.clientX;
      const startY = e.clientY;
      const baseOff =
        handle === "c1"
          ? rel.control1Offset ?? {
              dx: layoutRel.c1.x - (layoutRel.p0.x + (layoutRel.p3.x - layoutRel.p0.x) * 0.33),
              dy: layoutRel.c1.y - (layoutRel.p0.y + (layoutRel.p3.y - layoutRel.p0.y) * 0.33),
            }
          : rel.control2Offset ?? {
              dx: layoutRel.c2.x - (layoutRel.p0.x + (layoutRel.p3.x - layoutRel.p0.x) * 0.67),
              dy: layoutRel.c2.y - (layoutRel.p0.y + (layoutRel.p3.y - layoutRel.p0.y) * 0.67),
            };

      const onMove = (ev: PointerEvent) => {
        const dx = baseOff.dx + (ev.clientX - startX) / camera.scale;
        const dy = baseOff.dy + (ev.clientY - startY) / camera.scale;
        dispatch(
          {
            type: "relationship/upsert",
            sheetId: sheet.id,
            relationship: {
              ...rel,
              ...(handle === "c1" ? { control1Offset: { dx, dy } } : { control2Offset: { dx, dy } }),
            },
          },
          { coalesceKey: `rel-ctrl:${relId}:${handle}` },
        );
      };
      const onUp = () => {
        setInteractingDom(false);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [sheet.id, sheet.relationships, layout.relationships, camera.scale, dispatch, setInteractingDom],
  );

  // Shift+Drag Marquee selection
  const handleCanvasPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-topic-id]")) return;
    if (e.shiftKey && e.button === 0) {
      const rect = containerRef.current!.getBoundingClientRect();
      const startX = e.clientX - rect.left;
      const startY = e.clientY - rect.top;
      const m: MarqueeState = { startX, startY, curX: startX, curY: startY };
      setMarquee(m);

      const onMove = (ev: PointerEvent) => {
        m.curX = ev.clientX - rect.left;
        m.curY = ev.clientY - rect.top;
        setMarquee({ ...m });
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        const minX = (Math.min(m.startX, m.curX) - camera.x) / camera.scale;
        const minY = (Math.min(m.startY, m.curY) - camera.y) / camera.scale;
        const maxX = (Math.max(m.startX, m.curX) - camera.x) / camera.scale;
        const maxY = (Math.max(m.startY, m.curY) - camera.y) / camera.scale;
        const hits = layout.spatialIndex.search({ minX, minY, maxX, maxY }).map((h) => h.topicId);
        selectTopics(hits);
        setMarquee(null);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    }
  };

  // Clipboard image paste (Ctrl+V) onto selected topic
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (editingTopicId) return;
      const targetId = selectedTopicIds[0];
      if (!targetId || !e.clipboardData) return;
      const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
      if (!file) return;
      e.preventDefault();
      if (!isAllowedImageMimeType(file.type)) {
        reportRejection({
          code: "UNSUPPORTED_IMAGE_MIME",
          message: "仅支持 PNG、JPEG、WebP 或 SVG 图片格式。",
        });
        return;
      }
      const mimeType = file.type;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result ?? "");
        const base64 = dataUrl.split(",")[1];
        if (!base64) return;
        const resourceId = generateId("img", deletedSet);
        dispatch({
          type: "topic/setImage",
          sheetId: sheet.id,
          topicId: targetId,
          image: { resourceId, width: 180, height: 120, pos: "top" },
          asset: {
            resourceId,
            mimeType,
            width: 180,
            height: 120,
            sha256: resourceId,
            dataBase64: base64,
          },
        });
      };
      reader.readAsDataURL(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [editingTopicId, selectedTopicIds, deletedSet, dispatch, reportRejection, sheet.id]);

  // Global keyboard matrix (with strict IME guard)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (editingTopicId || pitchMode) return;
      const activeEl = document.activeElement as HTMLElement | null;
      const activeTag = activeEl?.tagName;
      if (activeTag === "INPUT" || activeTag === "TEXTAREA" || activeEl?.isContentEditable) return;

      const primaryId = selectedTopicIds[0];

      if (
        (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight") &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        e.preventDefault();
        const nextId = findNextTopicByArrow(sheet, layout, primaryId, e.key as ArrowDirection);
        if (nextId) {
          selectTopics([nextId]);
          const nextNode = layout.nodes.get(nextId);
          if (nextNode) {
            const pan = computePanToRevealNode(nextNode, cameraRef.current, viewportSize);
            if (pan) {
              userMovedCameraRef.current = true;
              const nextCam = { ...cameraRef.current, ...pan };
              cameraRef.current = nextCam;
              applyTransformDom(nextCam);
              setCamera(nextCam);
            }
          }
        }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }

      if (e.key === "F6" && primaryId) {
        e.preventDefault();
        setDrillRootId(drillRootId === primaryId ? null : primaryId === sheet.rootTopic.id ? null : primaryId);
        return;
      }

      if (e.key === "Tab" && primaryId) {
        e.preventDefault();
        const newId = generateId("t", deletedSet);
        dispatch({ type: "topic/addChild", sheetId: sheet.id, parentId: primaryId, newId });
        selectTopics([newId]);
        requestAnimationFrame(() => {
          setInitialEditChar(undefined);
          setEditingTopicId(newId);
        });
        return;
      }

      if (e.key === "Enter" && primaryId && primaryId !== sheet.rootTopic.id) {
        e.preventDefault();
        const newId = generateId("t", deletedSet);
        if (e.metaKey || e.ctrlKey) {
          dispatch({ type: "topic/addParent", sheetId: sheet.id, targetId: primaryId, newId });
        } else {
          dispatch({
            type: "topic/addSibling",
            sheetId: sheet.id,
            targetId: primaryId,
            position: "after",
            newId,
          });
        }
        selectTopics([newId]);
        requestAnimationFrame(() => {
          setInitialEditChar(undefined);
          setEditingTopicId(newId);
        });
        return;
      }

      if (e.key === "F2" && primaryId) {
        e.preventDefault();
        setInitialEditChar(undefined);
        setEditingTopicId(primaryId);
        return;
      }

      if (e.key === " " && primaryId) {
        e.preventDefault();
        dispatch({ type: "topic/toggleCollapse", sheetId: sheet.id, topicId: primaryId });
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedRelationshipId) {
          e.preventDefault();
          dispatch({ type: "relationship/remove", sheetId: sheet.id, relationshipId: selectedRelationshipId });
          selectRelationship(null);
        } else if (selectedBoundaryId) {
          e.preventDefault();
          dispatch({ type: "boundary/remove", sheetId: sheet.id, boundaryId: selectedBoundaryId });
          selectBoundary(null);
        } else if (selectedTopicIds.length > 0) {
          e.preventDefault();
          const deletable = selectedTopicIds.filter((id) => id !== sheet.rootTopic.id);
          if (deletable.length > 0) {
            dispatch({ type: "topic/delete", sheetId: sheet.id, topicIds: deletable });
            selectTopics([sheet.rootTopic.id]);
          }
        }
        return;
      }

      // Direct printable character typing -> start TipTap immediately
      if (
        primaryId &&
        e.key.length === 1 &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        e.preventDefault();
        setInitialEditChar(e.key);
        setEditingTopicId(primaryId);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    editingTopicId,
    pitchMode,
    selectedTopicIds,
    selectedRelationshipId,
    selectedBoundaryId,
    drillRootId,
    sheet,
    layout,
    viewportSize,
    deletedSet,
    dispatch,
    undo,
    redo,
    selectTopics,
    selectRelationship,
    selectBoundary,
    setEditingTopicId,
    setDrillRootId,
    applyTransformDom,
    setCamera,
  ]);

  const handleSelectTopic = useCallback(
    (topicId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (e.metaKey || e.ctrlKey || e.shiftKey) {
        const next = selectedSet.has(topicId)
          ? selectedTopicIds.filter((id) => id !== topicId)
          : [...selectedTopicIds, topicId];
        selectTopics(next);
      } else {
        selectTopics([topicId]);
      }
    },
    [selectedSet, selectedTopicIds, selectTopics],
  );

  const handleCommitEdit = useCallback(
    (topicId: string, title: RichTextDoc) => {
      dispatch({ type: "topic/setTitle", sheetId: sheet.id, topicId, title }, { coalesceKey: `edit:${topicId}` });
      setEditingTopicId(null);
      setInitialEditChar(undefined);
    },
    [dispatch, sheet.id, setEditingTopicId],
  );

  const handleDoubleClickBlank = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-topic-id]")) return;
    const world = screenToWorld(e.clientX, e.clientY);
    const newId = generateId("flt", deletedSet);
    dispatch({ type: "topic/addFloating", sheetId: sheet.id, newId, pos: world });
    selectTopics([newId]);
    requestAnimationFrame(() => {
      setInitialEditChar(undefined);
      setEditingTopicId(newId);
    });
  };

  // Multi-selection actions
  const addBoundaryForSelection = () => {
    const first = selectedTopicIds[0];
    if (!first) return;
    const firstLoc = findTopicLocation(sheet, first);
    let target: { kind: "subtree"; topicId: string } | { kind: "range"; parentId: string; startIndex: number; endIndex: number } = {
      kind: "subtree",
      topicId: first,
    };
    if (selectedTopicIds.length > 1 && firstLoc?.parent) {
      const indices = selectedTopicIds
        .map((id) => firstLoc.parent!.children.findIndex((c) => c.id === id))
        .filter((i) => i >= 0);
      if (indices.length > 1) {
        target = {
          kind: "range",
          parentId: firstLoc.parent.id,
          startIndex: Math.min(...indices),
          endIndex: Math.max(...indices),
        };
      }
    }
    dispatch({
      type: "boundary/upsert",
      sheetId: sheet.id,
      boundary: {
        id: generateId("bnd", deletedSet),
        target,
        shape: "rounded",
        title: t.canvas.defaultGroupBoundary,
      },
    });
  };

  const addSummaryForSelection = () => {
    const first = selectedTopicIds[0];
    if (!first) return;
    const loc = findTopicLocation(sheet, first);
    if (!loc || !loc.parent) return;
    const indices = selectedTopicIds
      .map((id) => loc.parent!.children.findIndex((c) => c.id === id))
      .filter((i) => i >= 0);
    const startIndex = Math.min(...indices);
    const endIndex = Math.max(...indices);
    dispatch({
      type: "summary/upsert",
      sheetId: sheet.id,
      summary: {
        id: generateId("sum", deletedSet),
        parentId: loc.parent.id,
        startIndex,
        endIndex,
        brace: "curly",
        topic: createTopic(generateId("sumt", deletedSet), t.canvas.defaultGroupSummary),
      },
    });
  };

  const dropTargetBox: LayoutBox | null =
    dragState?.active && dragState.dropTargetId
      ? layout.nodes.get(dragState.dropTargetId)?.contentBox ?? null
      : null;

  const handleStartEditTopic = useCallback(
    (id: string) => {
      setInitialEditChar(undefined);
      setEditingTopicId(id);
    },
    [setEditingTopicId],
  );

  const handleCancelEdit = useCallback(() => {
    setEditingTopicId(null);
    setInitialEditChar(undefined);
  }, [setEditingTopicId]);

  const handleToggleCollapse = useCallback(
    (id: string) => dispatch({ type: "topic/toggleCollapse", sheetId: sheet.id, topicId: id }),
    [dispatch, sheet.id],
  );

  const handleToggleTask = useCallback(
    (id: string) => dispatch({ type: "topic/toggleTask", sheetId: sheet.id, topicId: id }),
    [dispatch, sheet.id],
  );

  const handleContextMenuTopic = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      selectTopics([id]);
      onOpenContextMenu?.(id, { x: e.clientX, y: e.clientY });
    },
    [selectTopics, onOpenContextMenu],
  );

  const handleUpdateCallout = useCallback(
    (topicId: string, text: string | null) => {
      const existing = topicMap.get(topicId)?.callout;
      if (text === null || text.trim().length === 0) {
        dispatch({ type: "topic/setCallout", sheetId: sheet.id, topicId, callout: null });
      } else {
        dispatch({
          type: "topic/setCallout",
          sheetId: sheet.id,
          topicId,
          callout: { id: existing?.id ?? generateId("co", deletedSet), title: createRichText(text.trim()) },
        });
      }
    },
    [dispatch, sheet.id, topicMap, deletedSet],
  );

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full flex-1 overflow-hidden touch-none"
      style={{
        backgroundColor: hex8ToCss(palette.canvasBg),
        backgroundImage: palette.isDark
          ? "radial-gradient(ellipse 65% 55% at 50% 45%, rgba(122,162,247,0.06), transparent 72%), radial-gradient(rgba(148,163,184,0.13) 1px, transparent 1px)"
          : "radial-gradient(rgba(15,23,42,0.08) 1px, transparent 1px)",
        backgroundSize: palette.isDark ? "100% 100%, 24px 24px" : "24px 24px",
      }}
      onPointerDown={handleCanvasPointerDown}
      onClick={() => {
        selectTopics([]);
        setEditingTopicId(null);
      }}
      onDoubleClick={handleDoubleClickBlank}
    >
      {/* Layer 1: GPU-accelerated world container */}
      <div
        ref={worldRef}
        className="mindmap-world absolute left-0 top-0"
        style={{
          transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
          transformOrigin: "0 0",
          visibility: cameraReady ? "visible" : "hidden",
        }}
      >
        <SvgLayer
          layout={layout}
          selectedRelationshipId={selectedRelationshipId}
          selectedBoundaryId={selectedBoundaryId}
          onSelectRelationship={selectRelationship}
          onSelectBoundary={selectBoundary}
          onStartDragControl={handleStartDragControl}
        />

        <NodeLayer
          layout={layout}
          topicMap={topicMap}
          assets={doc.assets}
          camera={camera}
          viewportSize={viewportSize}
          selectedIds={selectedSet}
          editingTopicId={editingTopicId}
          initialEditChar={initialEditChar}
          onSelectTopic={handleSelectTopic}
          onStartEdit={handleStartEditTopic}
          onCommitEdit={handleCommitEdit}
          onCancelEdit={handleCancelEdit}
          onToggleCollapse={handleToggleCollapse}
          onToggleTask={handleToggleTask}
          onUpdateCallout={handleUpdateCallout}
          onStartDrag={handleStartDragTopic}
          onStartResizeWidth={handleStartResizeWidth}
          onContextMenu={handleContextMenuTopic}
        />

        {/* Drop Target Ghost Indicator */}
        {dropTargetBox && dragState && (
          <div
            className="pointer-events-none absolute rounded-lg border-2 border-dashed border-blue-500 bg-blue-500/10"
            style={
              dragState.dropMode === "child"
                ? {
                    left: dropTargetBox.x - 4,
                    top: dropTargetBox.y - 4,
                    width: dropTargetBox.width + 8,
                    height: dropTargetBox.height + 8,
                  }
                : {
                    left: dropTargetBox.x,
                    top:
                      dragState.dropMode === "before"
                        ? dropTargetBox.y - 6
                        : dropTargetBox.y + dropTargetBox.height + 2,
                    width: dropTargetBox.width,
                    height: 4,
                    backgroundColor: "#3B82F6",
                    border: "none",
                  }
            }
          />
        )}
      </div>

      {/* Layer 2: Screen-Space Overlays */}
      {workspaceCanvas && topicMap.size === 1 && !editingTopicId && (
        <p className="editor-start-hint">{t.canvas.startHintPrefix}<span> · </span>{t.canvas.startHintMiddle} <kbd>Tab</kbd> {t.canvas.startHintSuffix}</p>
      )}
      {marquee && (
        <div
          className="pointer-events-none absolute rounded border border-blue-500 bg-blue-500/10"
          style={{
            left: Math.min(marquee.startX, marquee.curX),
            top: Math.min(marquee.startY, marquee.curY),
            width: Math.abs(marquee.curX - marquee.startX),
            height: Math.abs(marquee.curY - marquee.startY),
          }}
        />
      )}

      {/* Drill Down Breadcrumb (F6) */}
      {drillRootId && (
        <div className="absolute left-4 top-3 z-30 flex items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-md backdrop-blur">
          <button
            type="button"
            onClick={() => setDrillRootId(null)}
            className="flex items-center gap-1 text-blue-600 hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t.canvas.backToFullMap}
          </button>
          <span className="text-slate-400">/</span>
          <span>
            {topicMap.get(drillRootId) ? richTextToPlainText(topicMap.get(drillRootId)!.title) : t.canvas.drilledFallback}
          </span>
        </div>
      )}

      {/* Multi-selection Floating Action Bar */}
      {selectedTopicIds.length > 1 && (
        <div className="absolute bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-slate-200 bg-white/95 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-lg backdrop-blur">
          <span className="px-1 text-slate-400">{t.canvas.selectedCount(selectedTopicIds.length)}</span>
          <button
            type="button"
            onClick={addBoundaryForSelection}
            className="flex items-center gap-1 rounded-full px-2.5 py-1 hover:bg-slate-100"
          >
            <SquareDashedBottom className="h-3.5 w-3.5" /> {t.canvas.addBoundary}
          </button>
          <button
            type="button"
            onClick={addSummaryForSelection}
            className="flex items-center gap-1 rounded-full px-2.5 py-1 hover:bg-slate-100"
          >
            <BoxSelect className="h-3.5 w-3.5" /> {t.canvas.addSummary}
          </button>
          <button
            type="button"
            onClick={() =>
              dispatch({
                type: "topic/setStyle",
                sheetId: sheet.id,
                topicIds: selectedTopicIds,
                style: { fillColor: "#EFF6FFFF", strokeColor: "#3B82F6FF", strokeWidth: 1.5 },
              })
            }
            className="flex items-center gap-1 rounded-full px-2.5 py-1 hover:bg-slate-100"
          >
            <Palette className="h-3.5 w-3.5" /> {t.canvas.recolor}
          </button>
          {onOpenAi && (
            <button
              type="button"
              onClick={onOpenAi}
              className="flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 text-violet-700 hover:bg-violet-100"
            >
              <Sparkles className="h-3.5 w-3.5" /> {t.canvas.aiCoCreate}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
