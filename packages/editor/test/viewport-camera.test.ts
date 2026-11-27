import { describe, expect, it } from "vitest";
import {
  applyTouchPinchStep,
  applyWheelGesture,
  computeFitCameraForBounds,
  computePinchCameraStep,
  isValidCamera,
  MAX_CAMERA_SCALE,
  MIN_CAMERA_SCALE,
  resetZoomCentered,
  sanitizeCamera,
  stepZoomCamera,
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

  it("steps zoom through presets and resets to 100% around viewport center", () => {
    const cam = { x: 200, y: 150, scale: 1 };
    const zoomedIn = stepZoomCamera(cam, "in", 1000, 800);
    expect(zoomedIn.scale).toBe(1.15);
    // Viewport center world point remains invariant
    expect((500 - zoomedIn.x) / zoomedIn.scale).toBeCloseTo((500 - cam.x) / cam.scale, 5);
    expect((400 - zoomedIn.y) / zoomedIn.scale).toBeCloseTo((400 - cam.y) / cam.scale, 5);

    const zoomedOut = stepZoomCamera(zoomedIn, "out", 1000, 800);
    expect(zoomedOut.scale).toBe(1);

    const reset = resetZoomCentered({ x: 100, y: 100, scale: 2 }, 800, 600, 1);
    expect(reset.scale).toBe(1);
    expect((400 - reset.x) / reset.scale).toBeCloseTo((400 - 100) / 2, 5);
    expect((300 - reset.y) / reset.scale).toBeCloseTo((300 - 100) / 2, 5);
  });

  it("computes safe native two-finger touch pinch steps and resists NaN, near-zero spacing, and origin jumps", () => {
    const cam = { x: 40, y: 80, scale: 1 };

    // Normal 2-finger pinch-out (100px -> 150px) with slight midpoint shift
    const zoomed = computePinchCameraStep(
      cam,
      { distance: 100, cx: 180, cy: 260 },
      { distance: 150, cx: 190, cy: 250 },
    );
    expect(zoomed.scale).toBeCloseTo(1.5, 5);
    expect(isValidCamera(zoomed)).toBe(true);
    // World point under previous midpoint remains under new midpoint
    expect((190 - zoomed.x) / zoomed.scale).toBeCloseTo((180 - cam.x) / cam.scale, 5);
    expect((250 - zoomed.y) / zoomed.scale).toBeCloseTo((260 - cam.y) / cam.scale, 5);

    // Near-zero finger distance must NOT explode scale to Infinity or NaN
    const tooClose = computePinchCameraStep(
      cam,
      { distance: 2, cx: 180, cy: 260 },
      { distance: 120, cx: 180, cy: 260 },
    );
    expect(tooClose).toEqual(cam);

    // NaN coordinates or scale must cleanly preserve fallback camera
    const nanSafe = computePinchCameraStep(
      cam,
      { distance: Number.NaN, cx: 180, cy: 260 },
      { distance: 150, cx: Number.NaN, cy: 260 },
    );
    expect(nanSafe).toEqual(cam);
    expect(sanitizeCamera({ x: Number.NaN, y: 0, scale: Number.POSITIVE_INFINITY }, cam)).toEqual(cam);

    // Sudden >160px origin jump (e.g. one finger lifted & re-placed) must NOT fling canvas off-screen
    const jumped = computePinchCameraStep(
      cam,
      { distance: 100, cx: 100, cy: 100 },
      { distance: 110, cx: 360, cy: 360 },
    );
    expect(isValidCamera(jumped)).toBe(true);
    expect(Math.abs(jumped.x - cam.x)).toBeLessThan(80);
    expect(Math.abs(jumped.y - cam.y)).toBeLessThan(80);
  });
});
