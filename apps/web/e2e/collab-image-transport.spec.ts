import { createHash } from "node:crypto";
import { chromium, expect, webkit, type Page } from "@playwright/test";
import { cloudBrowser, test } from "./cloud-worker.js";

test.use({ ...cloudBrowser, isMobile: false, hasTouch: false, viewport: { width: 1280, height: 800 } });

async function imageFixture(page: Page) {
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 768; canvas.height = 576;
    const context = canvas.getContext("2d")!;
    const pixels = context.createImageData(canvas.width, canvas.height);
    let seed = 0x7ced3761;
    for (let offset = 0; offset < pixels.data.length; offset += 4) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      pixels.data.set([seed & 255, (seed >>> 8) & 255, (seed >>> 16) & 255, 255], offset);
    }
    context.putImageData(pixels, 0, 0);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  return { name: "noise-fixture.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") };
}

function checksum(base64: string) {
  return createHash("sha256").update(Buffer.from(base64, "base64")).digest("hex");
}

test("an invited editor pulls the exact large image delta from D1 and can reopen the saved image", async ({ browserName, context, cloud }) => {
  test.setTimeout(75_000);
  const author = await cloud.openPage(context, "author");
  await author.goto(`${cloud.origin}/app`);
  await author.locator("#lm-home-prompt").fill("Review\n- Evidence");
  const created = author.waitForResponse((response) => response.request().method() === "PUT" && /\/api\/mindmaps\/[^/]+$/.test(response.url()));
  await author.getByRole("button", { name: "Create from Outline" }).click();
  expect((await created).status()).toBe(200);
  const topic = (page: Page) => page.getByRole("application").getByRole("treeitem").filter({ hasText: "Evidence" });
  await expect(topic(author)).toBeVisible();
  const mapUrl = author.url();
  const mapApi = `${cloud.origin}/api/mindmaps/${mapUrl.split("/").at(-1)}`;
  await author.getByRole("button", { name: "Share", exact: true }).click();
  const sharing = author.getByRole("dialog", { name: "Share Mind Map" });
  await sharing.getByRole("button", { name: /^Can edit/i }).click();
  await sharing.getByRole("button", { name: "Create Invite Link" }).click();
  const invite = await sharing.locator("#lm-share-url").inputValue();
  await sharing.getByRole("button", { name: "Close" }).click();

  const otherBrowser = await (browserName === "chromium" ? webkit : chromium).launch();
  try {
    const peer = await cloud.openPage(await otherBrowser.newContext(cloudBrowser), "reviewer");
    await peer.goto(invite);
    await peer.getByRole("button", { name: "Accept invite" }).click();
    await expect(topic(peer)).toBeVisible();
    await topic(author).click();
    const file = await imageFixture(author);
    type Poll = { updates: Array<{ seq: number; updateB64: string }> };
    const [delta, saved, pulled] = await Promise.all([
      author.waitForResponse((response) => response.url() === `${mapApi}/collab` && response.request().method() === "POST" && (response.request().postDataJSON().updateB64?.length ?? 0) > 192 * 1024),
      author.waitForResponse((response) => response.url() === mapApi && response.request().method() === "PUT" && Object.keys(response.request().postDataJSON().assets).length > 0),
      peer.waitForResponse(async (response) => response.request().method() === "GET" && response.url().startsWith(`${mapApi}/collab?`) && response.ok() &&
        (await response.json() as Poll).updates.some((row) => row.updateB64.length > 192 * 1024)),
      author.locator('input[type="file"][accept*="image/png"]').setInputFiles(file),
    ]);
    expect(saved.status()).toBe(200);
    expect(delta.status()).toBe(200);
    const { seq } = await delta.json() as { seq: number };
    const received = (await pulled.json() as Poll).updates.find((row) => row.seq === seq);
    expect(received).toBeDefined();
    expect(checksum(received!.updateB64)).toBe(checksum(delta.request().postDataJSON().updateB64));
    const fresh = await cloud.openPage(await otherBrowser.newContext(cloudBrowser), "reviewer");
    await fresh.goto(mapUrl);
    const image = topic(fresh).locator('img[src^="data:image/"]');
    await expect(image).toBeVisible();
    const source = await image.getAttribute("src");
    const asset = Object.values(saved.request().postDataJSON().assets)[0] as { sha256: string };
    expect(checksum(source!.split(",")[1])).toBe(asset.sha256);
  } finally { await otherBrowser.close(); }
});
