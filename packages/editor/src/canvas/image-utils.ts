import { isAllowedImageMimeType, type InlineAsset } from "@mindmap/core";

export const MAX_DISPLAY_WIDTH = 220;
export const MAX_DISPLAY_HEIGHT = 140;
export const MAX_STORED_DIMENSION = 1200;
export const MAX_ENCODED_IMAGE_BYTES = 512 * 1024;

export type ProcessedImageResult =
  | {
      ok: true;
      displayWidth: number;
      displayHeight: number;
      assetWidth: number;
      assetHeight: number;
      mimeType: InlineAsset["mimeType"];
      dataBase64: string;
      sha256: string;
    }
  | {
      ok: false;
      error: "UNSUPPORTED_IMAGE_MIME" | "IMAGE_TOO_LARGE" | "IMAGE_DECODE_FAILED";
    };

/**
 * Computes aspect-ratio-preserving dimensions fitted inside `(maxWidth, maxHeight)`.
 * Never upscales small images beyond their natural size.
 */
export function fitDimensionsPreservingAspect(
  naturalWidth: number,
  naturalHeight: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight) || naturalWidth <= 0 || naturalHeight <= 0) {
    return { width: 180, height: 120 };
  }
  const scale = Math.min(1, maxWidth / naturalWidth, maxHeight / naturalHeight);
  return {
    width: Math.max(1, Math.round(naturalWidth * scale)),
    height: Math.max(1, Math.round(naturalHeight * scale)),
  };
}

/**
 * Extracts intrinsic width/height from an SVG document via `viewBox` or `width`/`height` attributes.
 */
export function parseSvgDimensions(svgText: string): { width: number; height: number } {
  const openTag = /<svg\b[^>]*>/i.exec(svgText)?.[0] ?? "";
  const vbMatch = /\bviewBox\s*=\s*["']([^"']+)["']/i.exec(openTag);
  if (vbMatch) {
    const nums = vbMatch[1]
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (nums.length === 4 && Number.isFinite(nums[2]) && Number.isFinite(nums[3]) && nums[2] > 0 && nums[3] > 0) {
      return { width: nums[2], height: nums[3] };
    }
  }
  const wMatch = /\bwidth\s*=\s*["'](\d+(?:\.\d+)?)(?:px)?["']/i.exec(openTag);
  const hMatch = /\bheight\s*=\s*["'](\d+(?:\.\d+)?)(?:px)?["']/i.exec(openTag);
  if (wMatch && hMatch) {
    const w = Number(wMatch[1]);
    const h = Number(hMatch[1]);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      return { width: w, height: h };
    }
  }
  return { width: 180, height: 120 };
}

export function estimateBase64ByteLength(base64: string): number {
  const cleaned = base64.replace(/=+$/, "");
  return Math.floor((cleaned.length * 3) / 4);
}

export async function computeSha256Hex(bytes: Uint8Array): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle?.digest) {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const digest = await crypto.subtle.digest("SHA-256", copy);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Deterministic fallback hash when WebCrypto Subtle is unavailable
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 0x01000193);
    h2 = Math.imul(h2 ^ bytes[i], 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, "0")}${(h2 >>> 0).toString(16).padStart(8, "0")}`;
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(blob);
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode image"));
    img.src = src;
  });
}

function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Validates, preserves aspect ratio, downscales, and compresses an uploaded or pasted
 * image to WebP (with lossless/original fallback when smaller) to limit draft and transfer size.
 */
export async function processImageFileForTopic(file: Blob, rawMimeType?: string): Promise<ProcessedImageResult> {
  const mimeType = rawMimeType || file.type;
  if (!isAllowedImageMimeType(mimeType)) {
    return { ok: false, error: "UNSUPPORTED_IMAGE_MIME" };
  }

  let dataUrl: string;
  try {
    dataUrl = await readBlobAsDataUrl(file);
  } catch {
    return { ok: false, error: "IMAGE_DECODE_FAILED" };
  }

  const origBase64 = dataUrl.split(",")[1];
  if (!origBase64) return { ok: false, error: "IMAGE_DECODE_FAILED" };

  if (mimeType === "image/svg+xml") {
    if (estimateBase64ByteLength(origBase64) > MAX_ENCODED_IMAGE_BYTES) {
      return { ok: false, error: "IMAGE_TOO_LARGE" };
    }
    const svgText = await file.text().catch(() => "");
    const natural = parseSvgDimensions(svgText);
    const display = fitDimensionsPreservingAspect(natural.width, natural.height, MAX_DISPLAY_WIDTH, MAX_DISPLAY_HEIGHT);
    const sha256 = await computeSha256Hex(base64ToBytes(origBase64));
    return {
      ok: true,
      displayWidth: display.width,
      displayHeight: display.height,
      assetWidth: Math.round(natural.width),
      assetHeight: Math.round(natural.height),
      mimeType: "image/svg+xml",
      dataBase64: origBase64,
      sha256,
    };
  }

  let img: HTMLImageElement;
  try {
    img = await loadImageElement(dataUrl);
  } catch {
    return { ok: false, error: "IMAGE_DECODE_FAILED" };
  }

  const naturalW = img.naturalWidth || 180;
  const naturalH = img.naturalHeight || 120;
  const display = fitDimensionsPreservingAspect(naturalW, naturalH, MAX_DISPLAY_WIDTH, MAX_DISPLAY_HEIGHT);

  let finalMime: InlineAsset["mimeType"] = mimeType;
  let finalBase64 = origBase64;
  let finalW = naturalW;
  let finalH = naturalH;

  // Attempt canvas downscale + WebP compression with progressive quality fallback
  const attempts: Array<{ maxDim: number; quality: number }> = [
    { maxDim: MAX_STORED_DIMENSION, quality: 0.82 },
    { maxDim: 840, quality: 0.68 },
    { maxDim: 600, quality: 0.56 },
  ];

  const canUseCanvas = typeof document !== "undefined" && typeof document.createElement === "function";
  if (canUseCanvas) {
    const needsDownscale = naturalW > MAX_STORED_DIMENSION || naturalH > MAX_STORED_DIMENSION;
    for (const attempt of attempts) {
      const target = fitDimensionsPreservingAspect(naturalW, naturalH, attempt.maxDim, attempt.maxDim);
      const canvas = document.createElement("canvas");
      canvas.width = target.width;
      canvas.height = target.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) break;
      ctx.drawImage(img, 0, 0, target.width, target.height);

      const webpUrl = canvas.toDataURL("image/webp", attempt.quality);
      const isWebp = webpUrl.startsWith("data:image/webp;base64,");
      const candidateUrl = isWebp ? webpUrl : canvas.toDataURL("image/jpeg", attempt.quality);
      const candidateMime: InlineAsset["mimeType"] = isWebp ? "image/webp" : "image/jpeg";
      const candidateBase64 = candidateUrl.split(",")[1];
      if (!candidateBase64) continue;

      const candidateBytes = estimateBase64ByteLength(candidateBase64);
      const currentBytes = estimateBase64ByteLength(finalBase64);

      if (needsDownscale || candidateBytes < currentBytes) {
        finalMime = candidateMime;
        finalBase64 = candidateBase64;
        finalW = target.width;
        finalH = target.height;
      }

      if (estimateBase64ByteLength(finalBase64) <= MAX_ENCODED_IMAGE_BYTES) {
        break;
      }
    }
  }

  if (estimateBase64ByteLength(finalBase64) > MAX_ENCODED_IMAGE_BYTES) {
    return { ok: false, error: "IMAGE_TOO_LARGE" };
  }

  const sha256 = await computeSha256Hex(base64ToBytes(finalBase64));
  return {
    ok: true,
    displayWidth: display.width,
    displayHeight: display.height,
    assetWidth: finalW,
    assetHeight: finalH,
    mimeType: finalMime,
    dataBase64: finalBase64,
    sha256,
  };
}
