import {
  serializeToSvg,
  type MindmapDocument,
  type MindmapLayoutResult,
} from "@mindmap/core";

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportToSvgFile(
  doc: MindmapDocument,
  layout: MindmapLayoutResult,
  filename = "mindmap.svg",
  transparentBg = false,
): void {
  const svg = serializeToSvg(doc, { layout, transparentBg });
  downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), filename);
}

export async function exportToPngFile(
  doc: MindmapDocument,
  layout: MindmapLayoutResult,
  opts?: { scale?: 2 | 3; transparentBg?: boolean; filename?: string },
): Promise<void> {
  const scale = opts?.scale ?? 2;
  const svgStr = serializeToSvg(doc, { layout, transparentBg: opts?.transparentBg });
  const parser = new DOMParser();
  const svgEl = parser.parseFromString(svgStr, "image/svg+xml").documentElement;
  const width = Number(svgEl.getAttribute("width") ?? 1200);
  const height = Number(svgEl.getAttribute("height") ?? 800);

  const img = new Image();
  const svgBlob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = (err) => reject(err);
    img.src = url;
  });

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, width, height);
  URL.revokeObjectURL(url);

  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
  if (blob) downloadBlob(blob, opts?.filename ?? `mindmap-${scale}x.png`);
}

/**
 * True vector searchable PDF export using jsPDF + svg2pdf.js on pure SVG (zero foreignObject).
 */
export async function exportToVectorPdf(
  doc: MindmapDocument,
  layout: MindmapLayoutResult,
  filename = "mindmap.pdf",
): Promise<void> {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([
    import("jspdf"),
    import("svg2pdf.js"),
  ]);
  const svgStr = serializeToSvg(doc, { layout, transparentBg: false });
  const parser = new DOMParser();
  const svgEl = parser.parseFromString(svgStr, "image/svg+xml").documentElement;
  const width = Number(svgEl.getAttribute("width") ?? 1200);
  const height = Number(svgEl.getAttribute("height") ?? 800);

  const pdf = new jsPDF({
    orientation: width >= height ? "landscape" : "portrait",
    unit: "pt",
    format: [width, height],
  });

  await svg2pdf(svgEl, pdf, { x: 0, y: 0, width, height });
  pdf.save(filename);
}
