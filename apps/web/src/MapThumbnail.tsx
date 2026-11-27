import { richTextToPlainText, type MindmapDocument, type MindmapTopic } from "@mindmap/core";

function truncateLabel(text: string, maxChars: number) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const chars = Array.from(clean);
  return chars.length > maxChars ? `${chars.slice(0, maxChars - 1).join("")}…` : clean;
}

function hashSeed(input: string) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function verticalSlots(count: number, top: number, bottom: number) {
  if (count <= 0) return [];
  if (count === 1) return [(top + bottom) / 2];
  const step = (bottom - top) / (count - 1);
  return Array.from({ length: count }, (_, idx) => top + idx * step);
}

interface BranchPreview {
  label: string;
  subCount: number;
}

function extractTree(doc: MindmapDocument | undefined, fallbackTitle: string, id: string): {
  rootLabel: string;
  left: BranchPreview[];
  right: BranchPreview[];
  schematic: boolean;
  oneSided: boolean;
} {
  if (!doc) {
    const seed = hashSeed(id);
    const leftCount = 1 + (seed % 2);
    const rightCount = 2;
    return {
      rootLabel: truncateLabel(fallbackTitle, 11),
      left: Array.from({ length: leftCount }, (_, i) => ({ label: "", subCount: (seed + i) % 2 })),
      right: Array.from({ length: rightCount }, (_, i) => ({ label: "", subCount: (seed + i + 1) % 2 })),
      schematic: true,
      oneSided: false,
    };
  }

  const sheet = doc.sheets.find((s) => s.id === doc.activeSheetId) ?? doc.sheets[0];
  const root: MindmapTopic | undefined = sheet?.rootTopic;
  const rootLabel = truncateLabel((root ? richTextToPlainText(root.title) : "") || fallbackTitle, 11);
  const children = root?.children ?? [];
  const structure = root?.structure ?? "";
  const oneSided =
    structure === "logic" ||
    structure === "timeline" ||
    structure === "fishbone" ||
    structure === "brace" ||
    structure === "indented";

  if (!children.length) {
    return { rootLabel, left: [], right: [], schematic: false, oneSided: false };
  }

  const capped = children.slice(0, oneSided ? 4 : 6).map((child) => ({
    label: truncateLabel(richTextToPlainText(child.title), 7),
    subCount: Math.min(child.children?.length ?? 0, 3),
  }));

  if (oneSided) {
    return { rootLabel, left: [], right: capped, schematic: false, oneSided: true };
  }

  const rightCount = Math.ceil(capped.length / 2);
  const right = capped.slice(0, rightCount);
  const left = capped.slice(rightCount);
  return { rootLabel, left, right, schematic: false, oneSided: false };
}

export function MapThumbnail({ doc, title, mapId }: {
  doc?: MindmapDocument;
  title: string;
  mapId: string;
}) {
  const { rootLabel, left, right, schematic, oneSided } = extractTree(doc, title, mapId);
  const hasBranches = left.length > 0 || right.length > 0;

  if (!hasBranches) {
    return (
      <svg className="lm-thumb-svg" viewBox="0 0 240 124" aria-hidden="true">
        <rect x="74" y="48" width="92" height="28" rx="7" className="lm-thumb-root"/>
        <text x="120" y="65" textAnchor="middle" className="lm-thumb-root-text">{rootLabel}</text>
      </svg>
    );
  }

  const rootW = oneSided ? 64 : 72;
  const rootH = 26;
  const rootX = oneSided ? 22 : (240 - rootW) / 2;
  const rootY = (124 - rootH) / 2;
  const rootCy = rootY + rootH / 2;

  const leftYs = verticalSlots(left.length, left.length === 3 ? 24 : 34, left.length === 3 ? 100 : 90);
  const rightYs = verticalSlots(right.length, right.length >= 3 ? 22 : 34, right.length >= 3 ? 102 : 90);

  const nodeW = oneSided ? 64 : 48;
  const nodeH = 16;
  const leftNodeX = 16;
  const rightNodeX = oneSided ? 132 : 240 - 16 - nodeW;

  return (
    <svg className={`lm-thumb-svg ${schematic ? "is-schematic" : ""}`} viewBox="0 0 240 124" aria-hidden="true">
      {/* Connectors */}
      {left.map((_, idx) => {
        const y = leftYs[idx];
        const x1 = rootX;
        const x2 = leftNodeX + nodeW;
        const mid = (x1 + x2) / 2;
        return <path key={`lc-${idx}`} d={`M ${x1} ${rootCy} C ${mid} ${rootCy}, ${mid} ${y}, ${x2} ${y}`} className="lm-thumb-edge"/>;
      })}
      {right.map((_, idx) => {
        const y = rightYs[idx];
        const x1 = rootX + rootW;
        const x2 = rightNodeX;
        const mid = (x1 + x2) / 2;
        return <path key={`rc-${idx}`} d={`M ${x1} ${rootCy} C ${mid} ${rootCy}, ${mid} ${y}, ${x2} ${y}`} className="lm-thumb-edge"/>;
      })}

      {/* Grandchild subtle stubs */}
      {left.map((branch, idx) => {
        if (!branch.subCount) return null;
        const y = leftYs[idx];
        const offsets = branch.subCount === 1 ? [0] : branch.subCount === 2 ? [-4, 4] : [-6, 0, 6];
        return offsets.map((dy, sIdx) => (
          <path
            key={`ls-${idx}-${sIdx}`}
            d={`M ${leftNodeX} ${y} C ${leftNodeX - 5} ${y}, ${leftNodeX - 5} ${y + dy}, ${leftNodeX - 10} ${y + dy}`}
            className="lm-thumb-sub-edge"
          />
        ));
      })}
      {right.map((branch, idx) => {
        if (!branch.subCount) return null;
        const y = rightYs[idx];
        const rx = rightNodeX + nodeW;
        const offsets = branch.subCount === 1 ? [0] : branch.subCount === 2 ? [-4, 4] : [-6, 0, 6];
        return offsets.map((dy, sIdx) => (
          <path
            key={`rs-${idx}-${sIdx}`}
            d={`M ${rx} ${y} C ${rx + 5} ${y}, ${rx + 5} ${y + dy}, ${rx + 10} ${y + dy}`}
            className="lm-thumb-sub-edge"
          />
        ));
      })}

      {/* Left branch nodes */}
      {left.map((branch, idx) => {
        const y = leftYs[idx];
        return (
          <g key={`ln-${idx}`}>
            <rect x={leftNodeX} y={y - nodeH / 2} width={nodeW} height={nodeH} rx="4" className="lm-thumb-node"/>
            {branch.label ? (
              <text x={leftNodeX + nodeW / 2} y={y + 2.4} textAnchor="middle" className="lm-thumb-node-text">{branch.label}</text>
            ) : (
              <line x1={leftNodeX + 10} y1={y} x2={leftNodeX + nodeW - 10} y2={y} className="lm-thumb-placeholder-line"/>
            )}
          </g>
        );
      })}

      {/* Right branch nodes */}
      {right.map((branch, idx) => {
        const y = rightYs[idx];
        return (
          <g key={`rn-${idx}`}>
            <rect x={rightNodeX} y={y - nodeH / 2} width={nodeW} height={nodeH} rx="4" className="lm-thumb-node"/>
            {branch.label ? (
              <text x={rightNodeX + nodeW / 2} y={y + 2.4} textAnchor="middle" className="lm-thumb-node-text">{branch.label}</text>
            ) : (
              <line x1={rightNodeX + 10} y1={y} x2={rightNodeX + nodeW - 10} y2={y} className="lm-thumb-placeholder-line"/>
            )}
          </g>
        );
      })}

      {/* Central root node */}
      <rect x={rootX} y={rootY} width={rootW} height={rootH} rx="6" className="lm-thumb-root"/>
      <text x={rootX + rootW / 2} y={rootCy + 2.8} textAnchor="middle" className="lm-thumb-root-text">{rootLabel}</text>
    </svg>
  );
}
