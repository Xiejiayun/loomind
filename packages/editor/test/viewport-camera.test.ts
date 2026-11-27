import { describe, expect, it } from "vitest";
import {
  applyTouchPinchStep,
  applyWheelGesture,
  computeFitCameraForBounds,
  MAX_CAMERA_SCALE,
  MIN_CAMERA_SCALE,
  zoomAroundPoint,
} from "../src/canvas/viewport-camera.js";

describe("viewport camera gestures", () => {
  it("pans on unmodified two-finger trackpad scroll / wheel without changing scale", () => {
    const cam = { x: 100, y: 200, scale: 1.25 };
    const next = applyWheelGesture(
      cam,
      { deltaX: 30, deltaY: -45, ctrlKey: false, metaKey: false, shiftKey: false },
      { x: 400, y: 300 },
    );
    expect(next).toEqual({ x: 70, y: 245, scale: 1.25 });
  });

  it("pans horizontally on Shift + vertical wheel", () => {
    const cam = { x: 100, y: 200, scale: 1 };
    const next = applyWheelGesture(
      cam,
      { deltaX: 0, deltaY: 60, ctrlKey: false, metaKey: false, shiftKey: true },
      { x: 400, y: 300 },
    );
    expect(next).toEqual({ x: 40, y: 200, scale: 1 });
  });

  it("zooms around cursor anchor on Ctrl/Cmd + wheel (trackpad pinch) and preserves world point", () => {
    const cam = { x: 120, y: 80, scale: 1 };
    const anchor = { x: 320, y: 240 };
    const worldBeforeX = (anchor.x - cam.x) / cam.scale;
    const worldBeforeY = (anchor.y - cam.y) / cam.scale;

    const next = applyWheelGesture(
      cam,
      { deltaX: 0, deltaY: -12, ctrlKey: true, metaKey: false, shiftKey: false },
      anchor,
    );

    expect(next.scale).toBeGreaterThan(1);
    const worldAfterX = (anchor.x - next.x) / next.scale;
    const worldAfterY = (anchor.y - next.y) / next.scale;
    expect(worldAfterX).toBeCloseTo(worldBeforeX, 5);
    expect(worldAfterY).toBeCloseTo(worldBeforeY, 5);
  });

  it("normalizes line-mode wheel deltas and clamps scale bounds", () => {
    const cam = { x: 0, y: 0, scale: 1 };
    const panned = applyWheelGesture(
      cam,
      { deltaX: 0, deltaY: 3, deltaMode: 1, ctrlKey: false, metaKey: false, shiftKey: false },
      { x: 0, y: 0 },
    );
    expect(panned.y).toBe(-48);

    const maxZoom = zoomAroundPoint({ x: 0, y: 0, scale: 2.9 }, 10, 100, 100);
    expect(maxZoom.scale).toBe(MAX_CAMERA_SCALE);
    const minZoom = zoomAroundPoint({ x: 0, y: 0, scale: 0.2 }, 0.01, 100, 100);
    expect(minZoom.scale).toBe(MIN_CAMERA_SCALE);
  });

  it("applies touch pinch scale with simultaneous midpoint pan", () => {
    const cam = { x: 50, y: 60, scale: 1 };
    const next = applyTouchPinchStep(cam, 1.5, { x: 250, y: 200 }, { dx: 10, dy: -20 });
    expect(next.scale).toBe(1.5);
    // Point at (240, 220) before pan moved to (250, 200) after pan -> same world coordinate after zoom
    const worldBeforeX = (240 - cam.x) / cam.scale;
    const worldBeforeY = (220 - cam.y) / cam.scale;
    const worldAfterX = (250 - next.x) / next.scale;
    const worldAfterY = (200 - next.y) / next.scale;
    expect(worldAfterX).toBeCloseTo(worldBeforeX, 5);
    expect(worldAfterY).toBeCloseTo(worldBeforeY, 5);
  });

  it("computes centered fit camera for bounds", () => {
    const fit = computeFitCameraForBounds({ x: -200, y: -100, width: 400, height: 200 }, 872, 472, {
      pad: 72,
      minScale: 0.25,
      maxScale: 2,
    });
    expect(fit.scale).toBeCloseTo(2, 5);
    expect(fit.x).toBeCloseTo(436, 5);
    expect(fit.y).toBeCloseTo(236, 5);
  });
});
