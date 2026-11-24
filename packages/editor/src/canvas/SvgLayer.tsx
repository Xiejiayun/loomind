import React from "react";
import { hex8ToCss, type MindmapLayoutResult } from "@mindmap/core";

interface SvgLayerProps {
  layout: MindmapLayoutResult;
  selectedRelationshipId: string | null;
  selectedBoundaryId: string | null;
  onSelectRelationship: (id: string) => void;
  onSelectBoundary: (id: string) => void;
  onStartDragControl?: (
    relId: string,
    handle: "c1" | "c2",
    e: React.PointerEvent<SVGCircleElement>,
  ) => void;
}

export const SvgLayer: React.FC<SvgLayerProps> = React.memo(
  ({
    layout,
    selectedRelationshipId,
    selectedBoundaryId,
    onSelectRelationship,
    onSelectBoundary,
    onStartDragControl,
  }) => {
    const pad = 400;
    const minX = layout.bounds.x - pad;
    const minY = layout.bounds.y - pad;
    const width = Math.max(800, layout.bounds.width + pad * 2);
    const height = Math.max(600, layout.bounds.height + pad * 2);

    return (
      <svg
        className="pointer-events-none absolute overflow-visible"
        style={{ left: minX, top: minY, width, height }}
        viewBox={`${minX} ${minY} ${width} ${height}`}
      >
        <defs>
          <marker
            id="rel-arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.5 L 8.5 5 L 0 8.5 z" fill="currentColor" />
          </marker>
        </defs>

        {/* Boundaries */}
        <g>
          {layout.boundaries.map((b) => {
            const isSel = selectedBoundaryId === b.id;
            return (
              <g
                key={b.id}
                className="pointer-events-auto cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectBoundary(b.id);
                }}
              >
                <path
                  d={b.svgPath}
                  fill={hex8ToCss(b.fillColor)}
                  stroke={hex8ToCss(b.strokeColor)}
                  strokeWidth={isSel ? 2.5 : 1.6}
                  strokeDasharray="6 4"
                />
                {b.badgeBox && b.title && (
                  <g>
                    <rect
                      x={b.badgeBox.x}
                      y={b.badgeBox.y}
                      width={b.badgeBox.width}
                      height={b.badgeBox.height}
                      rx={6}
                      fill={hex8ToCss(b.badgeColor)}
                    />
                    <text
                      x={b.badgeBox.x + b.badgeBox.width / 2}
                      y={b.badgeBox.y + 15}
                      textAnchor="middle"
                      fontSize={11}
                      fontWeight={600}
                      fill="#FFFFFF"
                    >
                      {b.title}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </g>

        {/* Tree Edges */}
        <g>
          {layout.edges.map((edge) =>
            edge.fillPath ? (
              <path key={edge.id} d={edge.fillPath} fill={hex8ToCss(edge.color)} />
            ) : (
              <path
                key={edge.id}
                d={edge.svgPath}
                fill="none"
                stroke={hex8ToCss(edge.color)}
                strokeWidth={edge.strokeWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ),
          )}
        </g>

        {/* Summary Braces */}
        <g>
          {layout.summaries.map((s) => (
            <path
              key={s.id}
              d={s.bracePath}
              fill="none"
              stroke={hex8ToCss(s.color)}
              strokeWidth={2}
              strokeLinecap="round"
            />
          ))}
        </g>

        {/* Relationships */}
        <g>
          {layout.relationships.map((rel) => {
            const isSel = selectedRelationshipId === rel.id;
            const dashArray =
              rel.dash === "dashed" ? "6 4" : rel.dash === "dotted" ? "2 4" : undefined;
            return (
              <g
                key={rel.id}
                style={{ color: hex8ToCss(rel.color) }}
                className="pointer-events-auto cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectRelationship(rel.id);
                }}
              >
                {/* Invisible wider hit area */}
                <path d={rel.svgPath} fill="none" stroke="transparent" strokeWidth={12} />
                <path
                  d={rel.svgPath}
                  fill="none"
                  stroke={hex8ToCss(rel.color)}
                  strokeWidth={isSel ? rel.strokeWidth + 1 : rel.strokeWidth}
                  strokeDasharray={dashArray}
                  markerEnd="url(#rel-arrow)"
                />
                {rel.labelPos && rel.title && (
                  <g>
                    <rect
                      x={rel.labelPos.x - Math.max(24, rel.title.length * 6 + 8)}
                      y={rel.labelPos.y - 11}
                      width={Math.max(48, rel.title.length * 12 + 16)}
                      height={22}
                      rx={6}
                      fill="#FFFFFF"
                      stroke={hex8ToCss(rel.color)}
                      strokeWidth={1}
                    />
                    <text
                      x={rel.labelPos.x}
                      y={rel.labelPos.y + 4}
                      textAnchor="middle"
                      fontSize={11}
                      fill="#0F172A"
                    >
                      {rel.title}
                    </text>
                  </g>
                )}
                {isSel && (
                  <g>
                    <line
                      x1={rel.p0.x}
                      y1={rel.p0.y}
                      x2={rel.c1.x}
                      y2={rel.c1.y}
                      stroke="#3B82F6"
                      strokeWidth={1}
                      strokeDasharray="3 3"
                    />
                    <line
                      x1={rel.p3.x}
                      y1={rel.p3.y}
                      x2={rel.c2.x}
                      y2={rel.c2.y}
                      stroke="#3B82F6"
                      strokeWidth={1}
                      strokeDasharray="3 3"
                    />
                    <circle
                      cx={rel.c1.x}
                      cy={rel.c1.y}
                      r={5}
                      fill="#FFFFFF"
                      stroke="#3B82F6"
                      strokeWidth={2}
                      className="cursor-grab"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        onStartDragControl?.(rel.id, "c1", e);
                      }}
                    />
                    <circle
                      cx={rel.c2.x}
                      cy={rel.c2.y}
                      r={5}
                      fill="#FFFFFF"
                      stroke="#3B82F6"
                      strokeWidth={2}
                      className="cursor-grab"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        onStartDragControl?.(rel.id, "c2", e);
                      }}
                    />
                  </g>
                )}
              </g>
            );
          })}
        </g>
      </svg>
    );
  },
);
SvgLayer.displayName = "SvgLayer";
