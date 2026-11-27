import { hex8ToCss, type LayoutNode, type PeerPresence } from "@mindmap/core";

export interface SelectionOverlaySpec {
  kind: "selected" | "search-active" | "search-match" | "remote-peer";
  inset: number;
  borderRadius: number;
  border: string;
  boxShadow: string;
  backgroundColor?: string;
}

export interface SelectionVisualInput {
  layoutNode: Pick<LayoutNode, "shape" | "cornerRadius" | "underlineMode" | "fillColor">;
  selected: boolean;
  editing: boolean;
  isDarkCanvas: boolean;
  searchHighlight?: "match" | "active";
  remotePeer?: Pick<PeerPresence, "color">;
}

/**
 * Computes dedicated overlay ring styles for selected, search-matched, and remote-peer
 * focused topic cards. Rendering on an overlay avoids CSS `box-shadow` / `border-radius`
 * collisions with card elevation shadows, neon glows, underline mode, and SVG shapes.
 */
export function computeSelectionOverlay(input: SelectionVisualInput): SelectionOverlaySpec | null {
  const { layoutNode, selected, editing, isDarkCanvas, searchHighlight, remotePeer } = input;
  const isSvgShape =
    layoutNode.shape === "diamond" ||
    layoutNode.shape === "hexagon" ||
    layoutNode.shape === "cloud";
  const isTransparentFill = layoutNode.fillColor.toUpperCase().endsWith("00");
  const isFrameless = layoutNode.underlineMode || isTransparentFill;

  const inset = isFrameless ? -4 : -3;
  const borderRadius =
    layoutNode.underlineMode || isSvgShape
      ? 8
      : layoutNode.cornerRadius >= 999
        ? 9999
        : Math.max(6, layoutNode.cornerRadius + Math.abs(inset));

  if (selected) {
    const stroke = isDarkCanvas ? "#60A5FA" : "#2563EB";
    const halo = editing
      ? isDarkCanvas
        ? "0 0 0 3px rgba(96, 165, 250, 0.22)"
        : "0 0 0 3px rgba(37, 99, 235, 0.16)"
      : isDarkCanvas
        ? "0 0 0 4px rgba(96, 165, 250, 0.30), 0 0 16px rgba(59, 130, 246, 0.24)"
        : "0 0 0 4px rgba(37, 99, 235, 0.18), 0 4px 12px rgba(37, 99, 235, 0.12)";
    const tint = isFrameless
      ? isDarkCanvas
        ? "rgba(96, 165, 250, 0.14)"
        : "rgba(37, 99, 235, 0.08)"
      : undefined;

    return {
      kind: "selected",
      inset,
      borderRadius,
      border: `2.5px solid ${stroke}`,
      boxShadow: halo,
      backgroundColor: tint,
    };
  }

  if (searchHighlight === "active") {
    return {
      kind: "search-active",
      inset,
      borderRadius,
      border: "2.5px solid #F59E0B",
      boxShadow: isDarkCanvas
        ? "0 0 0 4px rgba(245, 158, 11, 0.32)"
        : "0 0 0 4px rgba(245, 158, 11, 0.22)",
      backgroundColor: isFrameless ? "rgba(245, 158, 11, 0.12)" : undefined,
    };
  }

  if (searchHighlight === "match") {
    return {
      kind: "search-match",
      inset: -3,
      borderRadius,
      border: "2px solid rgba(245, 158, 11, 0.78)",
      boxShadow: "0 0 0 2px rgba(245, 158, 11, 0.16)",
      backgroundColor: isFrameless ? "rgba(245, 158, 11, 0.08)" : undefined,
    };
  }

  if (remotePeer) {
    const peerCss = hex8ToCss(remotePeer.color);
    return {
      kind: "remote-peer",
      inset: -3,
      borderRadius,
      border: `2px solid ${peerCss}`,
      boxShadow: `0 0 0 2px color-mix(in srgb, ${peerCss} 22%, transparent)`,
    };
  }

  return null;
}

export function computeHoverOverlayRadius(
  layoutNode: Pick<LayoutNode, "shape" | "cornerRadius" | "underlineMode">,
): number {
  const isSvgShape =
    layoutNode.shape === "diamond" ||
    layoutNode.shape === "hexagon" ||
    layoutNode.shape === "cloud";
  if (layoutNode.underlineMode || isSvgShape) return 8;
  return layoutNode.cornerRadius >= 999 ? 9999 : Math.max(6, layoutNode.cornerRadius + 2);
}
