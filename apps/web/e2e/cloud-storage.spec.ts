import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { chromium, expect, webkit, type Page } from "@playwright/test";
import { createDocument, createSheet, createTopic, MindmapDocumentSchema, type MindmapDocument } from "@mindmap/core/model";
import { cloudBrowser, test } from "./cloud-worker.js";

const mib = 1024 * 1024;
const desktop = { ...cloudBrowser, isMobile: false, hasTouch: false, viewport: { width: 1440, height: 1000 } };
test.use(desktop);

const topic = (page: Page, title: string) => page.getByRole("application").getByRole("treeitem").filter({ hasText: title });

async function uploadPhoto(page: Page, title: string, seed: number) {
  const png = await page.evaluate((seed) => {
    const canvas = document.createElement("canvas");
    canvas.width = 800; canvas.height = 600;
    const context = canvas.getContext("2d")!;
    const pixels = context.createImageData(canvas.width, canvas.height);
    for (let offset = 0; offset < pixels.data.length; offset += 4) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      pixels.data[offset] = seed & 255;
      pixels.data[offset + 1] = (seed >>> 8) & 255;
      pixels.data[offset + 2] = (seed >>> 16) & 255;
      pixels.data[offset + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    return canvas.toDataURL("image/png").split(",")[1];
  }, seed);
  await page.getByTitle(/^Fit to view/i).click();
  await topic(page, title).click();
  await page.locator('input[type="file"][accept*="image/png"]').setInputFiles({ name: `${seed}.png`, mimeType: "image/png", buffer: Buffer.from(png, "base64") });
}

async function imageDigest(page: Page, title: string) {
  const image = topic(page, title).locator('img[src^="data:image/"]');
  await expect(image).toHaveJSProperty("naturalWidth", 800);
  const source = await image.getAttribute("src");
  return createHash("sha256").update(Buffer.from(source!.split(",")[1], "base64")).digest("hex");
}

test("large source-linked maps keep photos, private reviews and revocable public snapshots separate", async ({ browserName, context, cloud }) => {
  test.setTimeout(150_000);
  const author = await cloud.openPage(context, "field-editor");
  await author.goto(`${cloud.origin}/app/create/source`);
  const titles = ["North elevation", "South elevation", "Entrance detail", "Roof detail", "Window detail", "Floor detail"];
  const quote = "Surveyors measured the elevation twice on site.";
  const original = "https://example.test/field-report";
  await author.getByLabel("Source title", { exact: true }).fill("Field minutes");
  await author.getByLabel("Original link (optional)").fill(original);
  await author.getByLabel("Source text", { exact: true }).fill(titles.map((title) => `- ${title}\n${quote}`).join("\n\n"));
  await author.getByRole("button", { name: "Create source-linked map" }).click();
  await expect(topic(author, titles[0])).toBeVisible();
  const mapId = new URL(author.url()).pathname.split("/").at(-1);
  const api = `${cloud.origin}/api/mindmaps/${mapId}`;
  let documentBytes = 0;
  for (const [index, title] of titles.entries()) {
    const saved = author.waitForResponse((response) => response.url() === api && response.request().method() === "PUT" && Object.keys(response.request().postDataJSON().assets ?? {}).length === index + 1);
    await uploadPhoto(author, title, 123 + index);
    const response = await saved;
    expect(response.status()).toBe(200);
    documentBytes = Buffer.byteLength(JSON.stringify(MindmapDocumentSchema.parse(response.request().postDataJSON())));
    if (documentBytes > mib) break;
  }
  expect(documentBytes).toBeGreaterThan(mib);
  const digest = await imageDigest(author, titles[0]);
  const label = `Field minutes · Lines 1–2 · ${original}\n\n- ${titles[0]}\n${quote}`;
  const privateText = "Review team only: verify this measurement before sign-off.";
  const share = author.getByRole("button", { name: "Share", exact: true });
  const sharing = author.getByRole("dialog", { name: "Share Mind Map" });
  await share.click();
  await sharing.getByRole("button", { name: "Enable read-only link" }).click();
  const link = await sharing.locator("#lm-public-url").inputValue();
  await sharing.getByRole("button", { name: /^Can view/i }).click();
  await sharing.getByRole("button", { name: "Create Invite Link" }).click();
  const invite = await sharing.locator("#lm-share-url").inputValue();
  await sharing.getByRole("button", { name: "Close" }).click();
  const review = author.getByRole("dialog", { name: "Node comments" });
  await author.getByRole("button", { name: "Node comments" }).click();
  const policy = review.getByRole("checkbox", { name: "Allow viewers to comment" });
  await expect(policy).not.toBeChecked();
  await policy.click();
  await expect(policy).toBeChecked();
  await review.getByRole("button", { name: "Close" }).click();

  const readers = await (browserName === "chromium" ? webkit : chromium).launch();
  try {
    const member = await cloud.openPage(await readers.newContext(desktop), "field-reviewer");
    await member.goto(invite);
    await member.getByRole("button", { name: "Accept invite" }).click();
    expect(await imageDigest(member, titles[0])).toBe(digest);
    await topic(member, titles[0]).click();
    await member.getByRole("button", { name: "Node comments" }).click();
    const comments = member.getByRole("dialog", { name: "Node comments" });
    await comments.getByRole("textbox", { name: "New comment" }).fill(privateText);
    const posted = member.waitForResponse((response) => response.url() === `${api}/comments` && response.request().method() === "POST");
    await comments.getByRole("button", { name: "Start discussion" }).click();
    expect((await posted).status()).toBe(201);
    await expect(comments.getByText(privateText, { exact: true })).toBeVisible();
    await comments.getByRole("button", { name: "Close" }).click();

    const guest = await cloud.openPage(await readers.newContext(desktop));
    const publicApi = `${cloud.origin}/api/public-maps/${mapId}`;
    const loaded = guest.waitForResponse(publicApi);
    await guest.goto(link);
    const snapshot = await loaded;
    expect(snapshot.status()).toBe(200);
    const tag = (await snapshot.allHeaders()).etag;
    expect(tag).toMatch(/^"\d+"$/);
    const published = await snapshot.text();
    expect(published).not.toContain(privateText);
    expect(published).not.toContain("field-reviewer@example.test");
    expect(await imageDigest(guest, titles[0])).toBe(digest);
    await expect(topic(guest, titles[0]).getByTitle(label, { exact: true })).toHaveCount(1);
    await expect(guest.getByRole("button", { name: "Node comments" })).toHaveCount(0);
    const headers = { Authorization: `Bearer ${new URL(link).hash.slice(1)}`, "If-None-Match": tag };
    expect((await guest.request.get(publicApi, { headers })).status()).toBe(304);
    expect((await guest.request.get(`${api}/comments`, { headers })).status()).toBe(401);
    await share.click();
    author.once("dialog", (dialog) => dialog.accept());
    await sharing.getByRole("button", { name: "Revoke read-only link" }).click();
    await expect(sharing.getByRole("button", { name: "Enable read-only link" })).toBeVisible();
    expect((await guest.request.get(publicApi, { headers })).status()).toBe(404);
    await guest.bringToFront();
    await expect(guest.getByRole("heading", { name: "Cannot open shared map" })).toBeVisible({ timeout: 20_000 });
    await member.bringToFront();
    await member.reload();
    expect(await imageDigest(member, titles[0])).toBe(digest);
    await member.getByRole("button", { name: "Node comments" }).click();
    await expect(comments.getByText(privateText, { exact: true })).toBeVisible();
  } finally { await readers.close(); }
});

test("large maps retain every uploaded photo across browsers and in a downloaded earlier version", async ({ browserName, context, cloud }) => {
  test.setTimeout(120_000);
  const writer = await cloud.openPage(context, "reporter");
  await writer.goto(`${cloud.origin}/app`);
  const titles = Array.from({ length: 10 }, (_, index) => `Photo ${String(index + 1).padStart(2, "0")}`);
  await writer.locator("#lm-home-prompt").fill(["Field report", ...titles.map((title) => `- ${title}`)].join("\n"));
  const created = writer.waitForResponse((response) => response.request().method() === "PUT" && /\/api\/mindmaps\/[^/]+$/.test(response.url()));
  await writer.getByRole("button", { name: "Create from Outline" }).click();
  expect((await created).status()).toBe(200);
  const mapUrl = writer.url();
  const api = `${cloud.origin}/api/mindmaps/${mapUrl.split("/").at(-1)}`;
  const digests = new Map<string, string>();
  let earlier: { revision: number; document: MindmapDocument } | undefined;
  let latestRevision = 0;
  for (const [index, title] of titles.entries()) {
    const count = index + 1;
    const saving = writer.waitForResponse((response) => response.url() === api && response.request().method() === "PUT" &&
      Object.keys(response.request().postDataJSON().assets ?? {}).length === count);
    const [saved] = await Promise.all([saving, uploadPhoto(writer, title, count)]);
    expect(saved.status()).toBe(200);
    latestRevision = (await saved.json()).revision;
    const document = MindmapDocumentSchema.parse(saved.request().postDataJSON());
    digests.set(title, await imageDigest(writer, title));
    if (earlier) break;
    if (Buffer.byteLength(JSON.stringify(document)) > 2 * mib) earlier = { revision: latestRevision, document };
  }
  expect(earlier).toBeDefined();
  expect(latestRevision).toBe(earlier!.revision + 1);
  expect(new Set(digests.values()).size).toBe(digests.size);
  await writer.close();

  const otherBrowser = await (browserName === "chromium" ? webkit : chromium).launch();
  try {
    const reader = await cloud.openPage(await otherBrowser.newContext(desktop), "reporter");
    await reader.goto(mapUrl);
    await reader.getByTitle(/^Fit to view/i).click();
    for (const [title, digest] of digests) expect(await imageDigest(reader, title)).toBe(digest);
    await reader.getByRole("button", { name: "History", exact: true }).click();
    const history = reader.getByRole("dialog", { name: /Version History/i });
    await history.getByRole("option").filter({ has: reader.getByText(`v${earlier!.revision}`, { exact: true }) }).click();
    await expect(history.locator(".lm-history-meta strong")).toContainText(`v${earlier!.revision} ·`);
    const downloading = reader.waitForEvent("download");
    await history.getByRole("button", { name: /Download JSON/i }).click();
    const download = await downloading;
    expect(JSON.parse(await readFile((await download.path())!, "utf8"))).toEqual(earlier!.document);
  } finally { await otherBrowser.close(); }
});

test("edits over 4 MiB survive a local reload without replacing the last cloud version", async ({ browser, context, cloud }) => {
  test.setTimeout(90_000);
  const subject = "field-reviewer";
  const writer = await cloud.openPage(context, subject);
  const mapId = randomUUID();
  const api = `${cloud.origin}/api/mindmaps/${mapId}`;
  const mapUrl = `${cloud.origin}/app/mindmaps/${mapId}`;
  const title = "Evidence";
  const document = createDocument([createSheet("review", "Field report", createTopic("photo", title))]);
  document.sheets[0].rootTopic.note = { format: "markdown", text: "field notes ".repeat(340000) };
  expect(Buffer.byteLength(JSON.stringify(document))).toBeLessThan(4 * mib);
  const headers = { "X-Loomind-Owner": subject, Origin: cloud.origin };
  const initial = await context.request.put(api, { data: document, headers: { ...headers, "If-Match": '"0"' } });
  expect(initial.status()).toBe(200);
  await writer.goto(mapUrl);
  await uploadPhoto(writer, title, 1234);
  const localDigest = await imageDigest(writer, title);
  await expect(writer.getByTitle(/exceeds 4 MiB/i)).toBeVisible({ timeout: 15_000 });
  await writer.reload();
  expect(await imageDigest(writer, title)).toBe(localDigest);

  const fresh = await browser.newContext(desktop);
  try {
    const reader = await cloud.openPage(fresh, subject);
    await reader.goto(mapUrl);
    await expect(topic(reader, title)).toBeVisible();
    await expect(topic(reader, title).locator('img[src^="data:image/"]')).toHaveCount(0);
    expect(await (await fresh.request.get(api, { headers })).json()).toEqual({ revision: 1, document });
  } finally { await fresh.close(); }
});
