import React from "react";
import { hex8ToCss, type MindmapLayoutResult } from "@mindmap/core";
import { useMindmapStore } from "../context.js";

interface MinimapProps {
  layout: MindmapLayoutResult;
}

export const Minimap: React.FC<MinimapProps> = ({ layout }) => {
  const open = useMindmapStore((s) => s.minimapOpen);
  const camera = useMindmapStore((s) => s.camera);
  const setCamera = useMindmapStore((s) => s.setCamera);

  if (!open) return null;

  const w = 180;
  const h = 120;
  const pad = 40;
  const bx = layout.bounds.x - pad;
  const by = layout.bounds.y - pad;
  const bw = Math.max(200, layout.bounds.width + pad * 2);
  const bh = Math.max(150, layout.bounds.height + pad * 2);
  const scale = Math.min(w / bw, h / bh);

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const wx = bx + (e.clientX - rect.left) / scale;
    const wy = by + (e.clientY - rect.top) / scale;
    const vw = window.innerWidth - 280;
    const vh = window.innerHeight - 80;
    setCamera({
      x: vw / 2 - wx * camera.scale,
      y: vh / 2 - wy * camera.scale,
    });
  };

  return (
    <div className="fixed bottom-11 right-4 z-30 overflow-hidden rounded-xl border border-slate-200 bg-white/95 p-1.5 shadow-lg backdrop-blur">
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
            opacity={n.depth === 0 ? 1 : 0.7}
          />
        ))}
      </svg>
    </div>
  );
};
