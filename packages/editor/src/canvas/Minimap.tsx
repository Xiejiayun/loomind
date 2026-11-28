import React from "react";
import { getThemePalette, hex8ToCss, type MindmapLayoutResult } from "@mindmap/core";
import { useMindmapStore } from "../context.js";

interface MinimapProps {
  appearance?: "dark" | "light";
  layout: MindmapLayoutResult;
}

export const Minimap: React.FC<MinimapProps> = ({ layout, appearance }) => {
  const open = useMindmapStore((s) => s.minimapOpen);
  const doc = useMindmapStore((s) => s.doc);
  const camera = useMindmapStore((s) => s.camera);
  const setCamera = useMindmapStore((s) => s.setCamera);
  const formatPanelOpen = useMindmapStore((s) => s.formatPanelOpen);

  if (!open) return null;

  const sheet = doc.sheets.find((s) => s.id === doc.activeSheetId) ?? doc.sheets[0];
  const palette = getThemePalette({ ...doc.theme, ...sheet.theme }, appearance);

  const w = 188;
  const h = 124;
  const pad = 48;
  const bx = layout.bounds.x - pad;
  const by = layout.bounds.y - pad;
  const bw = Math.max(200, layout.bounds.width + pad * 2);
  const bh = Math.max(150, layout.bounds.height + pad * 2);
  const scale = Math.min(w / bw, h / bh);

  const vw = typeof window !== "undefined" ? window.innerWidth - (formatPanelOpen ? 280 : 0) : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight - 76 : 800;

  // Current viewport rectangle in world coordinates
  const vpX = -camera.x / camera.scale;
  const vpY = -camera.y / camera.scale;
  const vpW = vw / camera.scale;
  const vpH = vh / camera.scale;

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const wx = bx + (e.clientX - rect.left) / scale;
    const wy = by + (e.clientY - rect.top) / scale;
    setCamera({
      x: vw / 2 - wx * camera.scale,
      y: vh / 2 - wy * camera.scale,
    });
  };

  return (
    <div
      className={`fixed bottom-11 z-30 overflow-hidden rounded-xl border p-1.5 shadow-lg backdrop-blur transition-all max-sm:absolute max-sm:right-2 max-sm:bottom-16 ${
        formatPanelOpen ? "right-4 md:right-[296px]" : "right-4"
      } ${
        palette.isDark
          ? "border-slate-700/80 bg-slate-900/90"
          : "border-slate-200 bg-white/95"
      }`}
    >
      <svg
        width={w}
        height={h}
        viewBox={`${bx} ${by} ${bw} ${bh}`}
        className="cursor-pointer"
        onClick={handleClick}
      >
        {Array.from(layout.nodes.values()).map((n) => (
          <rect
            key={n.id}
            x={n.contentBox.x}
            y={n.contentBox.y}
            width={Math.max(8, n.contentBox.width)}
            height={Math.max(6, n.contentBox.height)}
            rx={4}
            fill={hex8ToCss(n.accentColor)}
            opacity={n.depth === 0 ? 1 : 0.75}
          />
        ))}
        {/* Live Viewport Indicator */}
        <rect
          x={vpX}
          y={vpY}
          width={vpW}
          height={vpH}
          rx={6}
          fill="rgba(59, 130, 246, 0.08)"
          stroke="#3B82F6"
          strokeWidth={Math.max(2, 1.8 / scale)}
          strokeDasharray={`${Math.max(4, 4 / scale)} ${Math.max(3, 3 / scale)}`}
        />
      </svg>
    </div>
  );
};
