import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  computeSha256Hex,
  estimateBase64ByteLength,
  fitDimensionsPreservingAspect,
  parseSvgDimensions,
  processImageFileForTopic,
} from "../src/canvas/image-utils.js";

describe("image-utils", () => {
  it("preserves aspect ratio for wide, tall, and small images without upscaling", () => {
    // 16:9 screenshot fitted into 220x140 -> constrained by width (220x124)
    expect(fitDimensionsPreservingAspect(1920, 1080, 220, 140)).toEqual({ width: 220, height: 124 });
    // 9:16 portrait fitted into 220x140 -> constrained by height (79x140)
    expect(fitDimensionsPreservingAspect(900, 1600, 220, 140)).toEqual({ width: 79, height: 140 });
    // Small 64x48 icon is never upscaled
    expect(fitDimensionsPreservingAspect(64, 48, 220, 140)).toEqual({ width: 64, height: 48 });
    // Invalid dimensions fall back safely
    expect(fitDimensionsPreservingAspect(0, -10, 220, 140)).toEqual({ width: 180, height: 120 });
  });

  it("extracts intrinsic dimensions from SVG viewBox and width/height attributes", () => {
    expect(parseSvgDimensions('<svg viewBox="0 0 400 200"></svg>')).toEqual({ width: 400, height: 200 });
    expect(parseSvgDimensions('<svg width="300px" height="150px"></svg>')).toEqual({ width: 300, height: 150 });
    expect(parseSvgDimensions("<svg></svg>")).toEqual({ width: 180, height: 120 });
  });

  it("estimates decoded byte length from base64 accurately", () => {
    expect(estimateBase64ByteLength("AAAA")).toBe(3);
    expect(estimateBase64ByteLength("AA==")).toBe(1);
    expect(estimateBase64ByteLength("AAA=")).toBe(2);
  });

  it("computes real SHA-256 hex digest", async () => {
    const hash = await computeSha256Hex(new TextEncoder().encode("loomind"));
    const expected = createHash("sha256").update("loomind").digest("hex");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(expected);
  });

  it("rejects unsupported image MIME types", async () => {
    const gifBlob = new Blob(["GIF89a"], { type: "image/gif" });
    const res = await processImageFileForTopic(gifBlob, "image/gif");
    expect(res).toEqual({ ok: false, error: "UNSUPPORTED_IMAGE_MIME" });
  });
});
