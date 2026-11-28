import { createHash } from "node:crypto";
import { chromium, expect, webkit, type Page } from "@playwright/test";
import { cloudBrowser, test } from "./cloud-worker.js";

const desktop = { ...cloudBrowser, isMobile: false, hasTouch: false, viewport: { width: 1280, height: 800 } };
test.use(desktop);

async function noisePng(page: Page, seed: number) {
  const png = await page.evaluate((seed) => {
    const canvas = document.createElement("canvas");
    canvas.width = 416; canvas.height = 288;
    const context = canvas.getContext("2d")!;
    const image = context.createImageData(canvas.width, canvas.height);
    for (let offset = 0; offset < image.data.length; offset += 4) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      image.data.set([seed & 255, (seed >>> 8) & 255, (seed >>> 16) & 255, 255], offset);
    }
    context.putImageData(image, 0, 0);
    return canvas.toDataURL("image/png").split(",")[1];
  }, seed);
  return { name: `evidence-${seed}.png`, mimeType: "image/png", buffer: Buffer.from(png, "base64") };
}

const topic = (page: Page, title: string) => page.getByRole("application").getByRole("treeitem").filter({ hasText: title });

test("three different photos use individual collaboration frames and reopen intact in another browser", async ({ browserName, context, cloud }) => {
  test.setTimeout(75_000);
  const writer = await cloud.openPage(context, "photographer");
  await writer.goto(`${cloud.origin}/app`);
  const titles = ["Exhibit A", "Exhibit B", "Exhibit C"];
  await writer.locator("#lm-home-prompt").fill(["Evidence", ...titles.map((title) => `- ${title}`)].join("\n"));
  const created = writer.waitForResponse((response) => response.request().method() === "PUT" && /\/api\/mindmaps\/[^/]+$/.test(response.url()));
  await writer.getByRole("button", { name: "Create from Outline" }).click();
  expect((await created).status()).toBe(200);
  const mapUrl = writer.url();
  const api = `${cloud.origin}/api/mindmaps/${mapUrl.split("/").at(-1)}`;
  const checksums: string[] = [];
  const frames: number[] = [];
  let bytes = 0;
  for (const [index, title] of titles.entries()) {
    await writer.getByTitle(/^Fit to view/i).click();
    await topic(writer, title).click();
    const photo = await noisePng(writer, index + 1);
    const [frame, save] = await Promise.all([
      writer.waitForResponse((response) => response.url() === `${api}/collab` && response.request().method() === "POST" && (response.request().postDataJSON().updateB64?.length ?? 0) > 32 * 1024),
      writer.waitForResponse((response) => response.url() === api && response.request().method() === "PUT" && Object.keys(response.request().postDataJSON().assets ?? {}).length === index + 1),
      writer.locator('input[type="file"][accept*="image/png"]').setInputFiles(photo),
    ]);
    frames.push(frame.request().postDataJSON().updateB64.length);
    expect([frame.status(), save.status()]).toEqual([200, 200]);
    const assets = save.request().postDataJSON().assets;
    bytes = Buffer.byteLength(JSON.stringify(assets));
    const source = await topic(writer, title).locator('img[src^="data:image/"]').getAttribute("src");
    checksums.push(createHash("sha256").update(Buffer.from(source!.split(",")[1], "base64")).digest("hex"));
  }
  expect(bytes).toBeGreaterThan(192 * 1024);
  expect(Math.max(...frames)).toBeLessThan(192 * 1024);
  expect(Math.max(...frames)).toBeLessThan(Math.min(...frames) * 1.2);
  expect(new Set(checksums).size).toBe(titles.length);
  const otherBrowser = await (browserName === "chromium" ? webkit : chromium).launch();
  try {
    const fresh = await cloud.openPage(await otherBrowser.newContext(desktop), "photographer");
    await fresh.goto(mapUrl);
    await fresh.getByTitle(/^Fit to view/i).click();
    for (const [index, title] of titles.entries()) {
      const image = topic(fresh, title).locator('img[src^="data:image/"]');
      await expect(image).toHaveJSProperty("naturalWidth", 416);
      const source = await image.getAttribute("src");
      expect(createHash("sha256").update(Buffer.from(source!.split(",")[1], "base64")).digest("hex")).toBe(checksums[index]);
    }
  } finally { await otherBrowser.close(); }
});
