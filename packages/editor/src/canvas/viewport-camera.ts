import type { CameraState, LayoutBox } from "@mindmap/core";

export const MIN_CAMERA_SCALE = 0.15;
export const MAX_CAMERA_SCALE = 3;

export function clampCameraScale(scale: number): number {
  return Math.max(MIN_CAMERA_SCALE, Math.min(MAX_CAMERA_SCALE, scale));
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
  const clamped = clampCameraScale(nextScale);
  const wx = (anchorX - camera.x) / camera.scale;
  const wy = (anchorY - camera.y) / camera.scale;
  return {
    scale: clamped,
    x: anchorX - wx * clamped,
    y: anchorY - wy * clamped,
  };
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
  const panned: CameraState = {
    ...camera,
    x: camera.x + originDelta.dx,
    y: camera.y + originDelta.dy,
  };
  return zoomAroundPoint(panned, nextScale, anchor.x, anchor.y);
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
  const pad = opts?.pad ?? 72;
  const minScale = opts?.minScale ?? 0.25;
  const maxScale = opts?.maxScale ?? 1.6;
  const scaleX = (viewportWidth - pad) / Math.max(160, bounds.width);
  const scaleY = (viewportHeight - pad) / Math.max(120, bounds.height);
  const scale = Math.max(minScale, Math.min(maxScale, scaleX, scaleY));
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  return {
    x: viewportWidth / 2 - cx * scale,
    y: viewportHeight / 2 - cy * scale,
    scale,
  };
}
