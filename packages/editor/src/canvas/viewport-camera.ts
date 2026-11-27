import type { CameraState, LayoutBox } from "@mindmap/core";

export const MIN_CAMERA_SCALE = 0.15;
export const MAX_CAMERA_SCALE = 3;
export const MIN_PINCH_DISTANCE = 10;
export const MAX_PINCH_STEP_RATIO = 1.6;
export const MAX_PINCH_ORIGIN_JUMP = 160;

export const ZOOM_PRESETS = [0.15, 0.25, 0.33, 0.5, 0.67, 0.75, 0.85, 1, 1.15, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;

export function clampCameraScale(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return Math.max(MIN_CAMERA_SCALE, Math.min(MAX_CAMERA_SCALE, scale));
}

export function isValidCamera(camera: CameraState): boolean {
  return (
    Number.isFinite(camera.x) &&
    Number.isFinite(camera.y) &&
    Number.isFinite(camera.scale) &&
    camera.scale > 0
  );
}

export function sanitizeCamera(
  camera: CameraState,
  fallback: CameraState = { x: 0, y: 0, scale: 1 },
): CameraState {
  if (!isValidCamera(camera)) {
    return isValidCamera(fallback)
      ? { x: fallback.x, y: fallback.y, scale: clampCameraScale(fallback.scale) }
      : { x: 0, y: 0, scale: 1 };
  }
  return {
    x: camera.x,
    y: camera.y,
    scale: clampCameraScale(camera.scale),
  };
}

/**
 * Steps camera zoom to the next or previous ergonomic preset, centered on the viewport.
 */
export function stepZoomCamera(
  camera: CameraState,
  direction: "in" | "out",
  viewportWidth: number,
  viewportHeight: number,
): CameraState {
  const eps = 0.01;
  let targetScale = camera.scale;
  if (direction === "in") {
    targetScale = ZOOM_PRESETS.find((s) => s > camera.scale + eps) ?? MAX_CAMERA_SCALE;
  } else {
    for (let i = ZOOM_PRESETS.length - 1; i >= 0; i--) {
      if (ZOOM_PRESETS[i] < camera.scale - eps) {
        targetScale = ZOOM_PRESETS[i];
        break;
      }
    }
    if (camera.scale <= MIN_CAMERA_SCALE + eps) targetScale = MIN_CAMERA_SCALE;
  }
  return zoomAroundPoint(camera, targetScale, viewportWidth / 2, viewportHeight / 2);
}

/**
 * Resets zoom to `targetScale` (default 100%) around the viewport center.
 */
export function resetZoomCentered(
  camera: CameraState,
  viewportWidth: number,
  viewportHeight: number,
  targetScale = 1,
): CameraState {
  return zoomAroundPoint(camera, targetScale, viewportWidth / 2, viewportHeight / 2);
}

/**
 * Scales the camera to `nextScale` while keeping the world point under
 * `(anchorX, anchorY)` (in viewport-local pixels) visually stationary.
 */
export function zoomAroundPoint(
  camera: CameraState,
  nextScale: number,
  anchorX: number,
  anchorY: number,
): CameraState {
  const safeCam = sanitizeCamera(camera);
  if (!Number.isFinite(nextScale) || nextScale <= 0 || !Number.isFinite(anchorX) || !Number.isFinite(anchorY)) {
    return safeCam;
  }
  const clamped = clampCameraScale(nextScale);
  const wx = (anchorX - safeCam.x) / safeCam.scale;
  const wy = (anchorY - safeCam.y) / safeCam.scale;
  return sanitizeCamera(
    {
      scale: clamped,
      x: anchorX - wx * clamped,
      y: anchorY - wy * clamped,
    },
    safeCam,
  );
}

export interface WheelGestureInput {
  deltaX: number;
  deltaY: number;
  deltaMode?: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/**
 * Handles wheel / trackpad gestures like modern canvas tools (Figma / XMind Web):
 * - Ctrl/Cmd + wheel (including trackpad pinch-to-zoom) zooms toward the pointer.
 * - Unmodified two-finger scroll / mouse wheel pans the canvas.
 * - Shift + vertical wheel pans horizontally.
 */
export function applyWheelGesture(
  camera: CameraState,
  input: WheelGestureInput,
  anchor: { x: number; y: number },
): CameraState {
  const unit = input.deltaMode === 1 ? 16 : input.deltaMode === 2 ? 400 : 1;
  let dx = input.deltaX * unit;
  let dy = input.deltaY * unit;

  if (input.ctrlKey || input.metaKey) {
    // Trackpad pinch emits small deltas (~1..20); discrete mouse wheels emit ~100..120
    const sensitivity = Math.abs(dy) < 40 ? 0.008 : 0.0022;
    const clampedDy = Math.max(-180, Math.min(180, dy));
    const factor = Math.exp(-clampedDy * sensitivity);
    return zoomAroundPoint(camera, camera.scale * factor, anchor.x, anchor.y);
  }

  if (input.shiftKey && Math.abs(dx) < 0.01) {
    dx = dy;
    dy = 0;
  }

  return {
    ...camera,
    x: camera.x - dx,
    y: camera.y - dy,
  };
}

/**
 * Applies a two-finger touch pinch step with simultaneous midpoint pan.
 */
export function applyTouchPinchStep(
  camera: CameraState,
  nextScale: number,
  anchor: { x: number; y: number },
  originDelta: { dx: number; dy: number },
): CameraState {
  const safeCam = sanitizeCamera(camera);
  if (
    !Number.isFinite(nextScale) ||
    nextScale <= 0 ||
    !Number.isFinite(anchor.x) ||
    !Number.isFinite(anchor.y) ||
    !Number.isFinite(originDelta.dx) ||
    !Number.isFinite(originDelta.dy)
  ) {
    return safeCam;
  }
  const panned: CameraState = {
    ...safeCam,
    x: safeCam.x + originDelta.dx,
    y: safeCam.y + originDelta.dy,
  };
  return zoomAroundPoint(panned, nextScale, anchor.x, anchor.y);
}

export interface TouchPinchSample {
  distance: number;
  cx: number;
  cy: number;
}

/**
 * Computes a safe incremental camera update from two consecutive two-finger
 * touch samples (in viewport-local pixels). Guards against near-zero finger
 * spacing, NaN coordinates, and sudden finger-lift origin jumps.
 */
export function computePinchCameraStep(
  camera: CameraState,
  prev: TouchPinchSample,
  next: TouchPinchSample,
): CameraState {
  const safeCam = sanitizeCamera(camera);
  if (
    !Number.isFinite(prev.distance) ||
    !Number.isFinite(next.distance) ||
    prev.distance < MIN_PINCH_DISTANCE ||
    next.distance < MIN_PINCH_DISTANCE ||
    !Number.isFinite(prev.cx) ||
    !Number.isFinite(prev.cy) ||
    !Number.isFinite(next.cx) ||
    !Number.isFinite(next.cy)
  ) {
    return safeCam;
  }

  const rawRatio = next.distance / prev.distance;
  const clampedRatio = Math.max(1 / MAX_PINCH_STEP_RATIO, Math.min(MAX_PINCH_STEP_RATIO, rawRatio));
  const rawDx = next.cx - prev.cx;
  const rawDy = next.cy - prev.cy;
  const dx = Math.abs(rawDx) > MAX_PINCH_ORIGIN_JUMP ? 0 : rawDx;
  const dy = Math.abs(rawDy) > MAX_PINCH_ORIGIN_JUMP ? 0 : rawDy;

  return applyTouchPinchStep(
    safeCam,
    safeCam.scale * clampedRatio,
    { x: next.cx, y: next.cy },
    { dx, dy },
  );
}

/**
 * Computes a camera that centers and fits `bounds` inside `(viewportWidth, viewportHeight)`.
 */
export function computeFitCameraForBounds(
  bounds: LayoutBox,
  viewportWidth: number,
  viewportHeight: number,
  opts?: { pad?: number; minScale?: number; maxScale?: number },
): CameraState {
  const vw = Math.max(160, Number.isFinite(viewportWidth) ? viewportWidth : 360);
  const vh = Math.max(160, Number.isFinite(viewportHeight) ? viewportHeight : 360);
  const pad = Math.min(opts?.pad ?? 72, Math.floor(Math.min(vw, vh) * 0.25));
  const minScale = opts?.minScale ?? 0.25;
  const maxScale = opts?.maxScale ?? 1.6;
  const scaleX = (vw - pad) / Math.max(160, bounds.width);
  const scaleY = (vh - pad) / Math.max(120, bounds.height);
  const scale = clampCameraScale(Math.max(minScale, Math.min(maxScale, scaleX, scaleY)));
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  return sanitizeCamera({
    x: vw / 2 - cx * scale,
    y: vh / 2 - cy * scale,
    scale,
  });
}
