import {
  richTextToPlainText,
  type InlineAsset,
  type MindmapDocument,
  type MindmapSheet,
  type MindmapTopic,
} from "@mindmap/core";

export type PitchSlideLayout = "cover" | "toc-grid" | "bullet-list" | "split-media";

export interface PitchBullet {
  id: string;
  text: string;
  subItems: string[];
  taskStatus?: "todo" | "done";
}

export interface PitchSlide {
  id: string;
  layout: PitchSlideLayout;
  title: string;
  subtitle?: string;
  bullets: PitchBullet[];
  note?: string;
  imageDataUrl?: string;
  accentIndex: number;
}

const MAX_BULLETS_PER_SLIDE = 6;

export function compilePitchDeck(doc: MindmapDocument, sheetId?: string): PitchSlide[] {
  const sheet: MindmapSheet =
    doc.sheets.find((s) => s.id === (sheetId ?? doc.activeSheetId)) ?? doc.sheets[0];
  const root = sheet.rootTopic;
  const slides: PitchSlide[] = [];

  // 1. Cover slide
  const rootTitle = richTextToPlainText(root.title);
  slides.push({
    id: `slide-cover-${sheet.id}`,
    layout: "cover",
    title: rootTitle,
    subtitle:
      root.subtitle ??
      (sheet.title !== rootTitle
        ? `${sheet.title} · 共 ${root.children.length} 个核心章节`
        : `共 ${root.children.length} 个核心章节`),
    bullets: root.children.slice(0, 6).map((c) => ({
      id: c.id,
      text: richTextToPlainText(c.title),
      subItems: [],
    })),
    note: root.note?.text,
    accentIndex: 0,
  });

  // 2. TOC Grid slide
  if (root.children.length > 0) {
    slides.push({
      id: `slide-toc-${sheet.id}`,
      layout: "toc-grid",
      title: "目录概览",
      subtitle: richTextToPlainText(root.title),
      bullets: root.children.map((c) => ({
        id: c.id,
        text: richTextToPlainText(c.title),
        subItems: c.children.slice(0, 3).map((g) => richTextToPlainText(g.title)),
      })),
      accentIndex: 0,
    });
  }

  // 3. Branch content slides (auto-paginate & split-media if image or long note)
  const assetToUrl = (t: MindmapTopic): string | undefined => {
    if (!t.image) return undefined;
    const asset: InlineAsset | undefined = doc.assets[t.image.resourceId];
    return asset ? `data:${asset.mimeType};base64,${asset.dataBase64}` : undefined;
  };

  root.children.forEach((branch, idx) => {
    const branchTitle = richTextToPlainText(branch.title);
    const allBullets: PitchBullet[] = branch.children.map((c) => ({
      id: c.id,
      text: richTextToPlainText(c.title),
      subItems: c.children.map((g) => richTextToPlainText(g.title)),
      taskStatus: c.task?.status,
    }));

    const imgUrl = assetToUrl(branch);
    const hasSplit = Boolean(imgUrl || branch.note?.text);

    if (allBullets.length === 0) {
      slides.push({
        id: `slide-${branch.id}`,
        layout: hasSplit ? "split-media" : "bullet-list",
        title: branchTitle,
        subtitle: branch.subtitle,
        bullets: [],
        note: branch.note?.text,
        imageDataUrl: imgUrl,
        accentIndex: idx,
      });
      return;
    }

    const totalPages = Math.ceil(allBullets.length / MAX_BULLETS_PER_SLIDE);
    for (let p = 0; p < totalPages; p++) {
      const chunk = allBullets.slice(p * MAX_BULLETS_PER_SLIDE, (p + 1) * MAX_BULLETS_PER_SLIDE);
      slides.push({
        id: `slide-${branch.id}-${p}`,
        layout: p === 0 && hasSplit ? "split-media" : "bullet-list",
        title: totalPages > 1 ? `${branchTitle} (${p + 1}/${totalPages})` : branchTitle,
        subtitle: branch.subtitle,
        bullets: chunk,
        note: branch.note?.text,
        imageDataUrl: p === 0 ? imgUrl : undefined,
        accentIndex: idx,
      });
    }
  });

  return slides;
}
