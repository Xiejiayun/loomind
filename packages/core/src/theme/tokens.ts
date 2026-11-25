import type { PaletteId, SkeletonId, TopicShape } from "../model/document.js";

export interface DepthStyleToken {
  fontSize: number;
  fontWeight: 400 | 500 | 600 | 700;
  paddingX: number;
  paddingY: number;
  cornerRadius: number;
  strokeWidth: number;
  shape: Exclude<TopicShape, "auto">;
  underlineMode: boolean;
  softFillAlpha: number; // 0..1
  shadow: "none" | "soft" | "elevated";
}

export interface SkeletonSpec {
  id: SkeletonId;
  name: string;
  description: string;
  defaultEdgeKind: "tapered" | "bezier" | "elbow";
  depth0: DepthStyleToken;
  depth1: DepthStyleToken;
  depth2Plus: DepthStyleToken;
  levelGap: number;
  siblingGap: number;
}

export interface PaletteSpec {
  id: PaletteId;
  name: string;
  isDark: boolean;
  neonGlow?: boolean;
  canvasBg: string; // 8-digit hex
  rootFill: string;
  rootText: string;
  rootStroke: string;
  branches: string[]; // 8-digit hex rainbow colors
  cardBg: string;
  cardBorder: string;
  textPrimary: string;
  textMuted: string;
}

export function hexToRgba(hex8: string): { r: number; g: number; b: number; a: number } {
  const clean = hex8.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const aRaw = clean.length >= 8 ? parseInt(clean.slice(6, 8), 16) : 255;
  return {
    r: Number.isNaN(r) ? 0 : r,
    g: Number.isNaN(g) ? 0 : g,
    b: Number.isNaN(b) ? 0 : b,
    a: (Number.isNaN(aRaw) ? 255 : aRaw) / 255,
  };
}

export function relativeLuminance(hex8: string): number {
  const { r, g, b } = hexToRgba(hex8);
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function mixHexWithAlpha(hex8: string, alpha: number): string {
  const clean = hex8.replace("#", "").slice(0, 6).toUpperCase();
  const aHex = Math.max(0, Math.min(255, Math.round(alpha * 255)))
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
  return `#${clean}${aHex}`;
}

export function hex8ToCss(hex8: string): string {
  const { r, g, b, a } = hexToRgba(hex8);
  if (a >= 0.999) return `rgb(${r}, ${g}, ${b})`;
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
}

export function isDarkFill(hex8: string): boolean {
  return relativeLuminance(hex8) < 0.32;
}

/** Alpha-composites fgHex8 over bgHex8 and returns an opaque 8-digit hex color */
export function compositeHexOverBg(fgHex8: string, bgHex8: string): string {
  const fg = hexToRgba(fgHex8);
  const bg = hexToRgba(bgHex8);
  const r = Math.round(fg.r * fg.a + bg.r * (1 - fg.a));
  const g = Math.round(fg.g * fg.a + bg.g * (1 - fg.a));
  const b = Math.round(fg.b * fg.a + bg.b * (1 - fg.a));
  const toHex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0").toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}FF`;
}
