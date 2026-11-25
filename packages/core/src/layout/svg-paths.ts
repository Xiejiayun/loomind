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

function mulberry32(seed: number): () => number {
  let a = (seed | 1) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function signedRand(rng: () => number): number {
  return rng() * 2 - 1;
}

function midPt(a: Point, b: Point): Point {
  return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
}

function emitRoughLine(
  a: Point,
  b: Point,
  rng: () => number,
  subtle: boolean,
  out: string[],
): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 4) {
    out.push(`L ${r(b.x)} ${r(b.y)}`);
    return;
  }

  const nx = -dy / len;
  const ny = dx / len;
  const maxAmp = subtle ? 0.75 : 1.5;
  const amp = Math.min(maxAmp, len * (subtle ? 0.032 : 0.048));
  const spans = Math.max(1, Math.min(14, Math.round(len / 65)));

  if (spans === 1) {
    const s1 = rng() < 0.5 ? -1 : 1;
    const s2 = rng() < 0.55 ? -s1 : s1;
    const o1 = s1 * (0.35 + rng() * 0.65) * amp;
    const o2 = s2 * (0.3 + rng() * 0.7) * amp;
    const t1 = 0.3 + signedRand(rng) * 0.06;
    const t2 = 0.7 + signedRand(rng) * 0.06;
    const c1x = a.x + dx * t1 + nx * o1;
    const c1y = a.y + dy * t1 + ny * o1;
    const c2x = a.x + dx * t2 + nx * o2;
    const c2y = a.y + dy * t2 + ny * o2;
    out.push(`C ${r(c1x)} ${r(c1y)}, ${r(c2x)} ${r(c2y)}, ${r(b.x)} ${r(b.y)}`);
    return;
  }

  // Multi-span C1-smooth Catmull-Rom hand tremor for long lines (endpoints stay strictly pinned)
  const pts: Point[] = [a];
  let prevSign = rng() < 0.5 ? -1 : 1;
  for (let k = 1; k < spans; k++) {
    const t = k / spans;
    prevSign = rng() < 0.65 ? -prevSign : prevSign;
    const off = prevSign * (0.25 + rng() * 0.35) * amp;
    pts.push({
      x: a.x + dx * t + nx * off,
      y: a.y + dy * t + ny * off,
    });
  }
  pts.push(b);

  const tangents: Point[] = pts.map((_, k) => {
    if (k === 0) return { x: pts[1].x - pts[0].x, y: pts[1].y - pts[0].y };
    if (k === spans) return { x: pts[spans].x - pts[spans - 1].x, y: pts[spans].y - pts[spans - 1].y };
    return {
      x: (pts[k + 1].x - pts[k - 1].x) * 0.5,
      y: (pts[k + 1].y - pts[k - 1].y) * 0.5,
    };
  });

  for (let k = 0; k < spans; k++) {
    const p0 = pts[k];
    const p1 = pts[k + 1];
    let c1x = p0.x + tangents[k].x / 3;
    let c1y = p0.y + tangents[k].y / 3;
    let c2x = p1.x - tangents[k + 1].x / 3;
    let c2y = p1.y - tangents[k + 1].y / 3;
    if (k === 0) {
      const o = signedRand(rng) * amp * 0.35;
      c1x += nx * o;
      c1y += ny * o;
    }
    if (k === spans - 1) {
      const o = signedRand(rng) * amp * 0.35;
      c2x += nx * o;
      c2y += ny * o;
    }
    out.push(`C ${r(c1x)} ${r(c1y)}, ${r(c2x)} ${r(c2y)}, ${r(p1.x)} ${r(p1.y)}`);
  }
}

function emitRoughCubic(
  p0: Point,
  c1: Point,
  c2: Point,
  p3: Point,
  rng: () => number,
  subtle: boolean,
  out: string[],
): void {
  const dx = p3.x - p0.x;
  const dy = p3.y - p0.y;
  const len = Math.hypot(dx, dy);
  if (len < 4) {
    out.push(`C ${r(c1.x)} ${r(c1.y)}, ${r(c2.x)} ${r(c2.y)}, ${r(p3.x)} ${r(p3.y)}`);
    return;
  }

  const nx = -dy / len;
  const ny = dx / len;
  const ux = dx / len;
  const uy = dy / len;
  const amp = Math.min(subtle ? 1.1 : 2.1, len * (subtle ? 0.035 : 0.058));

  if (len > 110) {
    // Subdivide at t = 0.5 with exact de Casteljau and preserve C1 continuity across midpoint
    const m01 = midPt(p0, c1);
    const m12 = midPt(c1, c2);
    const m23 = midPt(c2, p3);
    const m012 = midPt(m01, m12);
    const m123 = midPt(m12, m23);
    const m = midPt(m012, m123);

    const tx = m123.x - m012.x;
    const ty = m123.y - m012.y;
    const tl = Math.hypot(tx, ty) || 1;
    const mnx = -ty / tl;
    const mny = tx / tl;

    const sMid = rng() < 0.5 ? -1 : 1;
    const mo = sMid * (0.3 + rng() * 0.45) * amp;
    const dmx = mnx * mo;
    const dmy = mny * mo;

    const o1 = -sMid * (0.25 + rng() * 0.55) * amp;
    const o2 = -sMid * (0.25 + rng() * 0.55) * amp;

    const l1 = { x: m01.x + nx * o1, y: m01.y + ny * o1 };
    const l2 = { x: m012.x + dmx, y: m012.y + dmy };
    const mid = { x: m.x + dmx, y: m.y + dmy };
    const r1 = { x: m123.x + dmx, y: m123.y + dmy };
    const r2 = { x: m23.x + nx * o2, y: m23.y + ny * o2 };

    out.push(
      `C ${r(l1.x)} ${r(l1.y)}, ${r(l2.x)} ${r(l2.y)}, ${r(mid.x)} ${r(mid.y)}`,
      `C ${r(r1.x)} ${r(r1.y)}, ${r(r2.x)} ${r(r2.y)}, ${r(p3.x)} ${r(p3.y)}`,
    );
    return;
  }

  const s1 = rng() < 0.5 ? -1 : 1;
  const s2 = rng() < 0.55 ? -s1 : s1;
  const o1 = s1 * (0.35 + rng() * 0.65) * amp;
  const o2 = s2 * (0.3 + rng() * 0.7) * amp;
  const t1 = signedRand(rng) * amp * 0.25;
  const t2 = signedRand(rng) * amp * 0.25;

  out.push(
    `C ${r(c1.x + nx * o1 + ux * t1)} ${r(c1.y + ny * o1 + uy * t1)}, ` +
      `${r(c2.x + nx * o2 + ux * t2)} ${r(c2.y + ny * o2 + uy * t2)}, ` +
      `${r(p3.x)} ${r(p3.y)}`,
  );
}

const SVG_TOKEN_RE = /[MmLlHhVvCcQqAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

/**
 * Deterministic vertex-pinned hand-drawn SVG path conversion (zero Math.random flicker).
 * Preserves exact start/end anchors and unbroken corner joins while adding organic,
 * length-proportional pen wobble across straight and curved segments.
 */
export function buildRoughSvgPath(svgPath: string, seed: number, subtle = false): string {
  const tokens = svgPath.match(SVG_TOKEN_RE);
  if (!tokens || tokens.length === 0) return svgPath;

  const rng = mulberry32(seed);
  const out: string[] = [];
  let idx = 0;
  let cmd = "";
  let cur: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };

  const isCmd = (tok: string) => /^[A-Za-z]$/.test(tok);
  const nextNum = (): number => Number(tokens[idx++]);

  while (idx < tokens.length) {
    if (isCmd(tokens[idx])) {
      cmd = tokens[idx++];
    } else if (!cmd) {
      break;
    }

    if (cmd === "Z" || cmd === "z") {
      if (Math.hypot(start.x - cur.x, start.y - cur.y) >= 1) {
        emitRoughLine(cur, start, rng, subtle, out);
      }
      out.push("Z");
      cur = { ...start };
      cmd = "";
      continue;
    }

    if (cmd === "M" || cmd === "m") {
      const x = nextNum();
      const y = nextNum();
      const pt = cmd === "m" ? { x: cur.x + x, y: cur.y + y } : { x, y };
      cur = pt;
      start = { ...pt };
      out.push(`M ${r(pt.x)} ${r(pt.y)}`);
      // Subsequent coordinate pairs after M/m are implicit L/l
      cmd = cmd === "m" ? "l" : "L";
      continue;
    }

    if (cmd === "L" || cmd === "l") {
      const x = nextNum();
      const y = nextNum();
      const pt = cmd === "l" ? { x: cur.x + x, y: cur.y + y } : { x, y };
      emitRoughLine(cur, pt, rng, subtle, out);
      cur = pt;
      continue;
    }

    if (cmd === "H" || cmd === "h") {
      const x = nextNum();
      const pt = { x: cmd === "h" ? cur.x + x : x, y: cur.y };
      emitRoughLine(cur, pt, rng, subtle, out);
      cur = pt;
      continue;
    }

    if (cmd === "V" || cmd === "v") {
      const y = nextNum();
      const pt = { x: cur.x, y: cmd === "v" ? cur.y + y : y };
      emitRoughLine(cur, pt, rng, subtle, out);
      cur = pt;
      continue;
    }

    if (cmd === "C" || cmd === "c") {
      const x1 = nextNum();
      const y1 = nextNum();
      const x2 = nextNum();
      const y2 = nextNum();
      const x = nextNum();
      const y = nextNum();
      const rel = cmd === "c";
      const c1 = rel ? { x: cur.x + x1, y: cur.y + y1 } : { x: x1, y: y1 };
      const c2 = rel ? { x: cur.x + x2, y: cur.y + y2 } : { x: x2, y: y2 };
      const p3 = rel ? { x: cur.x + x, y: cur.y + y } : { x, y };
      emitRoughCubic(cur, c1, c2, p3, rng, subtle, out);
      cur = p3;
      continue;
    }

    if (cmd === "Q" || cmd === "q") {
      const x1 = nextNum();
      const y1 = nextNum();
      const x = nextNum();
      const y = nextNum();
      const rel = cmd === "q";
      const q1 = rel ? { x: cur.x + x1, y: cur.y + y1 } : { x: x1, y: y1 };
      const p2 = rel ? { x: cur.x + x, y: cur.y + y } : { x, y };
      const len = Math.hypot(p2.x - cur.x, p2.y - cur.y);
      const amp = Math.min(subtle ? 0.8 : 1.5, len * 0.04);
      const ox = signedRand(rng) * amp;
      const oy = signedRand(rng) * amp;
      out.push(`Q ${r(q1.x + ox)} ${r(q1.y + oy)} ${r(p2.x)} ${r(p2.y)}`);
      cur = p2;
      continue;
    }

    if (cmd === "A" || cmd === "a") {
      const rx = nextNum();
      const ry = nextNum();
      const rot = nextNum();
      const largeArc = nextNum();
      const sweep = nextNum();
      const x = nextNum();
      const y = nextNum();
      const pt = cmd === "a" ? { x: cur.x + x, y: cur.y + y } : { x, y };
      out.push(`A ${r(rx)} ${r(ry)} ${rot} ${largeArc} ${sweep} ${r(pt.x)} ${r(pt.y)}`);
      cur = pt;
      continue;
    }

    // Unsupported command: return original path safely
    return svgPath;
  }

  return out.join(" ") || svgPath;
}
