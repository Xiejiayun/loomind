import { chromium, expect, webkit, type Page, type Response } from "@playwright/test";
import { cloudBrowser, test as cloudTest } from "./cloud-worker.js";

const test = cloudTest.extend<{ team: { author: Page; reviewer: Page; mapApi: string; reopen(): Promise<Page> } }>({
  team: async ({ browserName, context, cloud }, use) => {
    const author = await cloud.openPage(context, "author");
    await author.goto(`${cloud.origin}/app`);
    await author.locator("#lm-home-prompt").fill("Planning\n- Research\n- Delivery");
    const created = author.waitForResponse((response) => response.request().method() === "PUT" && /\/api\/mindmaps\/[^/]+$/.test(response.url()));
    await author.getByRole("button", { name: "Create from Outline" }).click();
    expect((await created).status()).toBe(200);
    await expect(topic(author, "Research")).toBeVisible();
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
      const reviewer = await cloud.openPage(await otherBrowser.newContext(cloudBrowser), "reviewer");
      await reviewer.goto(invite);
      await reviewer.getByRole("button", { name: "Accept invite" }).click();
      await expect(topic(reviewer, "Delivery")).toBeVisible();
      await use({ author, reviewer, mapApi, async reopen() {
        const fresh = await cloud.openPage(await otherBrowser.newContext(cloudBrowser), "reviewer");
        await fresh.goto(mapUrl);
        return fresh;
      } });
    } finally { await otherBrowser.close(); }
  },
});

test.use({ ...cloudBrowser, isMobile: false, hasTouch: false, viewport: { width: 1280, height: 800 } });
test.describe.configure({ timeout: 75_000 });

function topic(page: Page, title: string) {
  return page.getByRole("application").getByRole("treeitem").filter({ hasText: title });
}

async function rename(page: Page, from: string, to: string) {
  await topic(page, from).dblclick();
  const field = page.locator(".ProseMirror[contenteditable=true]");
  await field.fill(to);
  await field.press("Enter");
}

function postedDelta(response: Response) {
  return response.request().method() === "POST" && response.url().endsWith("/collab") && !!response.request().postDataJSON().updateB64;
}

function savedMap(page: Page, mapApi: string, title: string) {
  return page.waitForResponse((response) => response.url() === mapApi && response.request().method() === "PUT" && response.ok()
    && JSON.stringify(response.request().postDataJSON().sheets ?? []).includes(title));
}

async function holdSaves(page: Page, mapApi: string) {
  let held = true;
  await page.route(mapApi, (route) => held && route.request().method() === "PUT" && route.request().headers()["x-loomind-checkpoint"] !== "seed"
    ? route.abort("internetdisconnected") : route.continue());
  return () => { held = false; };
}

test("two independent editors see each other's unsaved changes and reopen the merged map", async ({ team: { author, reviewer, mapApi, reopen } }) => {
  const resume = await holdSaves(author, mapApi);
  await holdSaves(reviewer, mapApi);
  const [authorPost, reviewerPost] = await Promise.all([
    author.waitForResponse(postedDelta), reviewer.waitForResponse(postedDelta),
    rename(author, "Research", "Evidence"), rename(reviewer, "Delivery", "Decision"),
  ]);
  expect([authorPost.status(), reviewerPost.status()]).toEqual([200, 200]);
  for (const editor of [author, reviewer]) {
    await expect(topic(editor, "Evidence")).toHaveCount(1, { timeout: 12_000 });
    await expect(topic(editor, "Decision")).toHaveCount(1, { timeout: 12_000 });
  }
  resume();
  await Promise.all([savedMap(author, mapApi, "Decision"), author.evaluate(() => window.dispatchEvent(new Event("online")))]);
  const fresh = await reopen();
  await expect(topic(fresh, "Decision")).toBeVisible();
  await expect(topic(fresh, "Evidence")).toBeVisible();
});

test("a late editor retries unacknowledged frames without another edit and syncs in both directions", async ({ team: { author, reviewer, mapApi, reopen } }) => {
  await Promise.all([savedMap(author, mapApi, "Baseline"), rename(author, "Research", "Baseline")]);
  await reviewer.close();
  const late = await reopen();
  await expect(topic(late, "Baseline")).toBeVisible();
  await Promise.all([holdSaves(late, mapApi), holdSaves(author, mapApi)]);
  let interrupted = "";
  await late.route(`${mapApi}/collab`, (route) => {
    const frame = route.request().method() === "POST" && route.request().postDataJSON().updateB64;
    if (frame && !interrupted) { interrupted = frame; return route.fulfill({ status: 503, body: "Temporary test outage" }); }
    return route.continue();
  });
  const retry = late.waitForResponse((res) => postedDelta(res) && res.ok() && res.request().postDataJSON().updateB64 === interrupted);
  await Promise.all([late.waitForResponse((res) => postedDelta(res) && res.status() === 503), rename(late, "Delivery", "First draft")]);
  await rename(late, "First draft", "Second draft");
  await retry;
  await expect(topic(author, "Second draft")).toBeVisible({ timeout: 12_000 });
  await rename(author, "Baseline", "Follow-up");
  await expect(topic(late, "Follow-up")).toBeVisible({ timeout: 12_000 });
});

test("offline edits survive reconnect after the server's saved delta log is pruned", async ({ team: { author, reviewer, mapApi, reopen }, cloud }) => {
  await reviewer.context().setOffline(true);
  await rename(reviewer, "Delivery", "Offline decision");
  await Promise.all([savedMap(author, mapApi, "Online evidence"), rename(author, "Research", "Online evidence")]);
  expect(await cloud.pruneUpdates(mapApi.split("/").at(-1)!)).toBeGreaterThan(0);
  const combined = savedMap(reviewer, mapApi, "Online evidence");
  await reviewer.context().setOffline(false);
  await expect(topic(reviewer, "Online evidence")).toBeVisible({ timeout: 12_000 });
  await expect(topic(author, "Offline decision")).toBeVisible({ timeout: 12_000 });
  await combined;
  const fresh = await reopen();
  await expect(topic(fresh, "Offline decision")).toBeVisible();
  await expect(topic(fresh, "Online evidence")).toBeVisible();
});

async function imageFixture(page: Page, large: boolean, seed = 0x7ced3761) {
  return page.evaluate(({ large, seed }) => {
    const canvas = document.createElement("canvas");
    canvas.width = large ? 768 : 288; canvas.height = large ? 576 : 216;
    const context = canvas.getContext("2d")!;
    const pixels = context.createImageData(canvas.width, canvas.height);
    for (let offset = 0; offset < pixels.data.length; offset += 4) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      pixels.data.set([seed & 255, (seed >>> 8) & 255, (seed >>> 16) & 255, 255], offset);
    }
    context.putImageData(pixels, 0, 0);
    return canvas.toDataURL("image/png").split(",")[1];
  }, { large, seed });
}

test("concurrent photos on different topics survive both live canvases and a cold reopen", async ({ team: { author, reviewer, mapApi, reopen } }) => {
  const resume = await holdSaves(author, mapApi);
  await holdSaves(reviewer, mapApi);
  async function attach(page: Page, title: string, seed: number) {
    const png = await imageFixture(page, false, seed);
    await topic(page, title).click();
    await page.locator('input[type="file"][accept*="image/png"]').setInputFiles({ name: `${seed}.png`, mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  }
  const [first, second] = await Promise.all([author.waitForResponse(postedDelta), reviewer.waitForResponse(postedDelta),
    attach(author, "Research", 21), attach(reviewer, "Delivery", 42)]);
  expect([first.status(), second.status()]).toEqual([200, 200]);
  const images = [[author, "Research"], [reviewer, "Delivery"]] as const;
  for (const [source, title] of images) {
    const image = (page: Page) => topic(page, title).locator('img[src^="data:image/"]');
    const src = await image(source).getAttribute("src");
    await expect(image(source === author ? reviewer : author)).toHaveAttribute("src", src!, { timeout: 12_000 });
  }
  resume();
  const [saved] = await Promise.all([savedMap(author, mapApi, "Delivery"), author.evaluate(() => window.dispatchEvent(new Event("online")))]);
  expect(Object.keys(saved.request().postDataJSON().assets)).toHaveLength(2);
  const fresh = await reopen();
  for (const [source, title] of images) {
    const src = await topic(source, title).locator('img[src^="data:image/"]').getAttribute("src");
    await expect(topic(fresh, title).locator('img[src^="data:image/"]')).toHaveAttribute("src", src!);
  }
});

test("an unsynced editor can save a new cloud map without changing the original", async ({ team: { author, reviewer, mapApi } }) => {
  await author.route(mapApi, (route) => route.request().method() === "PUT" && route.request().headers()["x-loomind-checkpoint"] !== "seed"
    ? route.fulfill({ status: 413, json: { error: "Test checkpoint size limit" } }) : route.continue());
  await author.route(`${mapApi}/collab`, (route) => route.request().method() === "POST" && route.request().postDataJSON().updateB64
    ? route.abort("internetdisconnected") : route.continue());
  await rename(author, "Research", "Recovered copy");
  await author.getByRole("button", { name: "Unsynced", exact: true }).click();
  const saved = author.waitForResponse((response) => response.url() !== mapApi && /\/api\/mindmaps\/[^/]+$/.test(response.url())
    && response.request().method() === "PUT" && response.ok() && response.request().postData()?.includes("Recovered copy") === true);
  await author.getByRole("button", { name: "Save as new map" }).click();
  const copy = await saved;
  const options = { headers: { "X-Loomind-Owner": "author" } };
  expect(JSON.stringify((await (await author.request.get(copy.url(), options)).json()).document)).toContain("Recovered copy");
  const original = JSON.stringify((await (await author.request.get(mapApi, options)).json()).document);
  expect(original).toContain("Research");
  expect(original).not.toContain("Recovered copy");
  const outside = await reviewer.request.get(copy.url(), { headers: { "X-Loomind-Owner": "reviewer" } });
  expect(await outside.json()).toEqual({ revision: 0, document: null });
});

test("an image reaches the open peer through deltas as well as a fresh browser through the saved map", async ({ team: { author, reviewer, mapApi, reopen } }) => {
  const large = process.env.LOOMIND_E2E_LARGE_FRAME === "1";
  const png = await imageFixture(author, large);
  await reviewer.route(mapApi, (route) => route.request().method() === "GET" ? route.abort("internetdisconnected") : route.continue());
  await topic(author, "Research").click();
  const [delta, saved] = await Promise.all([
    author.waitForResponse((response) => postedDelta(response) && response.request().postDataJSON().updateB64.length > (large ? 192 : 16) * 1024),
    author.waitForResponse((response) => response.url() === mapApi && response.request().method() === "PUT" && Object.keys(response.request().postDataJSON().assets).length > 0),
    author.locator('input[type="file"][accept*="image/png"]').setInputFiles({ name: "noise-fixture.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") }),
  ]);
  const deltaBytes = Buffer.from(delta.request().postDataJSON().updateB64, "base64").length;
  expect(saved.status()).toBe(200);
  expect(delta.status(), `CRDT: ${deltaBytes} bytes, HTTP ${delta.status()}; document: ${saved.request().postDataBuffer()?.length} bytes, HTTP ${saved.status()}`).toBe(200);
  const image = (page: Page) => topic(page, "Research").locator('img[src^="data:image/"]');
  await expect(image(reviewer)).toBeVisible({ timeout: 12_000 });
  const source = await image(author).getAttribute("src");
  expect(await image(reviewer).getAttribute("src")).toBe(source);
  const fresh = await reopen();
  await expect(image(fresh)).toBeVisible();
  expect(await image(fresh).getAttribute("src")).toBe(source);
});

test("a rejected large image frame recovers from a saved checkpoint without losing the peer's edit", async ({ team: { author, reviewer, mapApi, reopen } }) => {
  const png = await imageFixture(author, true);
  const resume = await holdSaves(reviewer, mapApi);
  await reviewer.route(`${mapApi}/collab`, (route) => route.request().method() === "POST" && route.request().postDataJSON().updateB64
    ? route.abort("internetdisconnected") : route.continue());
  await rename(reviewer, "Delivery", "Unsaved review");
  await author.route(`${mapApi}/collab`, (route) => route.request().method() === "POST" && route.request().postDataJSON().updateB64?.length > 192 * 1024
    ? route.fulfill({ status: 413, body: "Test transport limit" }) : route.continue());
  await topic(author, "Research").click();
  const [rejected, saved] = await Promise.all([
    author.waitForResponse((res) => postedDelta(res) && res.status() === 413),
    savedMap(author, mapApi, "Research"),
    author.locator('input[type="file"][accept*="image/png"]').setInputFiles({ name: "large.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") }),
  ]);
  expect(rejected.request().postDataJSON().updateB64.length).toBeGreaterThan(192 * 1024);
  expect(Object.keys(saved.request().postDataJSON().assets)).not.toHaveLength(0);
  const image = (page: Page) => topic(page, "Research").locator('img[src^="data:image/"]');
  await expect(image(reviewer)).toBeVisible({ timeout: 15_000 });
  await expect(topic(reviewer, "Unsaved review")).toBeVisible();
  resume();
  await Promise.all([savedMap(reviewer, mapApi, "Unsaved review"), reviewer.evaluate(() => window.dispatchEvent(new Event("online")))]);
  const fresh = await reopen();
  await expect(topic(fresh, "Unsaved review")).toBeVisible();
  await expect(image(fresh)).toHaveAttribute("src", (await image(author).getAttribute("src"))!);
});
