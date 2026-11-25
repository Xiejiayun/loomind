import rough from "roughjs";
import type { LayoutBox, Point } from "./types.js";

/** Deterministic FNV-1a 32-bit hash for non-flickering roughjs seed */
export function fnv1aSeed(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) | 1;
}

const r = (n: number) => Math.round(n * 10) / 10;

function evalCubic(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return {
    x: mt2 * mt * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t2 * t * p3.x,
    y: mt2 * mt * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t2 * t * p3.y,
  };
}

function evalCubicTangent(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const mt = 1 - t;
  return {
    x: 3 * mt * mt * (p1.x - p0.x) + 6 * mt * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
    y: 3 * mt * mt * (p1.y - p0.y) + 6 * mt * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y),
  };
}

export function buildBezierPath(p0: Point, p3: Point, horizontal = true): {
  svgPath: string;
  p1: Point;
  p2: Point;
} {
  let p1: Point;
  let p2: Point;
  if (horizontal) {
    const dx = (p3.x - p0.x) * 0.52;
    p1 = { x: p0.x + dx, y: p0.y };
    p2 = { x: p3.x - dx, y: p3.y };
  } else {
    const dy = (p3.y - p0.y) * 0.52;
    p1 = { x: p0.x, y: p0.y + dy };
    p2 = { x: p3.x, y: p3.y - dy };
  }
  const svgPath = `M ${r(p0.x)} ${r(p0.y)} C ${r(p1.x)} ${r(p1.y)}, ${r(p2.x)} ${r(p2.y)}, ${r(p3.x)} ${r(p3.y)}`;
  return { svgPath, p1, p2 };
}

/** Organic tapered cubic ribbon closed SVG fill path */
export function buildTaperedRibbonPath(
  p0: Point,
  p3: Point,
  wStart = 7.0,
  wEnd = 1.6,
  samples = 16,
): { svgPath: string; fillPath: string } {
  const { svgPath, p1, p2 } = buildBezierPath(p0, p3, true);
  const upper: Point[] = [];
  const lower: Point[] = [];

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const pt = evalCubic(p0, p1, p2, p3, t);
    const tan = evalCubicTangent(p0, p1, p2, p3, t);
    const len = Math.hypot(tan.x, tan.y) || 1;
    const nx = -tan.y / len;
    const ny = tan.x / len;
    const mt = 1 - t;
    const halfW = 0.5 * (wStart * mt * mt + wEnd * (1 - mt * mt));
    upper.push({ x: pt.x + nx * halfW, y: pt.y + ny * halfW });
    lower.push({ x: pt.x - nx * halfW, y: pt.y - ny * halfW });
  }

  const parts: string[] = [`M ${r(upper[0].x)} ${r(upper[0].y)}`];
  for (let i = 1; i < upper.length; i++) {
    parts.push(`L ${r(upper[i].x)} ${r(upper[i].y)}`);
  }
  for (let i = lower.length - 1; i >= 0; i--) {
    parts.push(`L ${r(lower[i].x)} ${r(lower[i].y)}`);
  }
  parts.push("Z");
  return { svgPath, fillPath: parts.join(" ") };
}

export function buildElbowPath(p0: Point, p3: Point, verticalFirst = false): string {
  if (verticalFirst) {
    const ym = (p0.y + p3.y) / 2;
    return `M ${r(p0.x)} ${r(p0.y)} V ${r(ym)} H ${r(p3.x)} V ${r(p3.y)}`;
  }
  const xm = (p0.x + p3.x) / 2;
  return `M ${r(p0.x)} ${r(p0.y)} H ${r(xm)} V ${r(p3.y)} H ${r(p3.x)}`;
}

/** Calligraphic curly brace path */
export function buildCurlyBracePath(
  cx: number,
  y0: number,
  y1: number,
  dir: 1 | -1,
  width = 14,
): string {
  const ym = (y0 + y1) / 2;
  const xOuter = cx - dir * (width * 0.5);
  const xTip = cx + dir * (width * 0.5);
  return (
    `M ${r(xOuter)} ${r(y0)} ` +
    `C ${r(cx)} ${r(y0)}, ${r(cx)} ${r(ym)}, ${r(xTip)} ${r(ym)} ` +
    `C ${r(cx)} ${r(ym)}, ${r(cx)} ${r(y1)}, ${r(xOuter)} ${r(y1)}`
  );
}

/** Deterministic scalloped cloud boundary */
export function buildCloudBoundaryPath(box: LayoutBox, step = 26): string {
  const { x, y, width, height } = box;
  const parts: string[] = [];

  const addSide = (x0: number, y0: number, x1: number, y1: number) => {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const count = Math.max(2, Math.round(dist / step));
    const segLen = dist / count;
    const rad = segLen * 0.56;
    for (let i = 1; i <= count; i++) {
      const nx = x0 + ((x1 - x0) * i) / count;
      const ny = y0 + ((y1 - y0) * i) / count;
      parts.push(`A ${r(rad)} ${r(rad)} 0 0 1 ${r(nx)} ${r(ny)}`);
    }
  };

  parts.push(`M ${r(x)} ${r(y)}`);
  addSide(x, y, x + width, y);
  addSide(x + width, y, x + width, y + height);
  addSide(x + width, y + height, x, y + height);
  addSide(x, y + height, x, y);
  parts.push("Z");
  return parts.join(" ");
}

export function buildBoundaryPath(
  box: LayoutBox,
  shape: "rounded" | "cloud" | "bracket" | "waves",
): string {
  const { x, y, width, height } = box;
  if (shape === "cloud") return buildCloudBoundaryPath(box);
  if (shape === "bracket") {
    const lip = 12;
    return (
      `M ${r(x + lip)} ${r(y)} H ${r(x)} V ${r(y + height)} H ${r(x + lip)} ` +
      `M ${r(x + width - lip)} ${r(y)} H ${r(x + width)} V ${r(y + height)} H ${r(x + width - lip)}`
    );
  }
  if (shape === "waves") return buildCloudBoundaryPath(box, 34);
  const rad = 14;
  return (
    `M ${r(x + rad)} ${r(y)} H ${r(x + width - rad)} ` +
    `Q ${r(x + width)} ${r(y)} ${r(x + width)} ${r(y + rad)} ` +
    `V ${r(y + height - rad)} ` +
    `Q ${r(x + width)} ${r(y + height)} ${r(x + width - rad)} ${r(y + height)} ` +
    `H ${r(x + rad)} ` +
    `Q ${r(x)} ${r(y + height)} ${r(x)} ${r(y + height - rad)} ` +
    `V ${r(y + rad)} Q ${r(x)} ${r(y)} ${r(x + rad)} ${r(y)} Z`
  );
}

const roughGen = rough.generator();

/** Deterministic handdrawn SVG path conversion (zero Math.random flicker) */
export function buildRoughSvgPath(svgPath: string, seed: number, subtle = false): string {
  const drawable = roughGen.path(svgPath, {
    seed: seed | 1,
    roughness: subtle ? 0.35 : 1.0,
    bowing: subtle ? 0.3 : 0.8,
    maxRandomnessOffset: subtle ? 0.35 : 1.2,
    disableMultiStroke: true,
  });
  const paths = roughGen.toPaths(drawable);
  return paths.map((p) => p.d).join(" ") || svgPath;
}
