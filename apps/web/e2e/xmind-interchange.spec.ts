import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium, expect, webkit, type Page } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import { createDocument, createSheet, createTopic, type MindmapDocument } from "@mindmap/core/model";
import { nativeSheet } from "../../../packages/core/test/fixtures/xmind-appearance.js";
import { cloudBrowser, test } from "./cloud-worker.js";

const desktop = { ...cloudBrowser, isMobile: false, hasTouch: false, viewport: { width: 1280, height: 800 } };
test.use(desktop);

async function fileDialog(page: Page) {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  return page.getByRole("dialog", { name: "Import & Export" });
}

async function openSavedMap(page: Page, origin: string, subject: string, document: MindmapDocument) {
  const mapId = randomUUID();
  const api = `${origin}/api/mindmaps/${mapId}`;
  const headers = { "X-Loomind-Owner": subject, Origin: origin };
  const saved = await page.request.put(api, { data: document, headers: { ...headers, "If-Match": '"0"' } });
  expect(saved.status()).toBe(200);
  await page.goto(`${origin}/app/mindmaps/${mapId}`);
  return { api, headers };
}

test("opens the topics and embedded picture from a workbook produced by Xmind's generator", async ({ context, cloud }) => {
  const page = await cloud.openPage(context);
  await page.goto(`${cloud.origin}/try`);
  const dialog = await fileDialog(page);
  page.once("dialog", (confirmation) => confirmation.accept());
  await dialog.locator("input[type=file]").setInputFiles(fileURLToPath(new URL("./fixtures/xmind-generator-image.xmind", import.meta.url)));
  await expect(dialog).toBeHidden();
  const canvas = page.getByRole("application");
  for (const title of ["Partner workbook", "Imported from Xmind"]) await expect(canvas.getByText(title, { exact: true }).first()).toBeVisible();
  await expect(canvas.locator("[data-topic-id] img").first()).toHaveJSProperty("naturalWidth", 32);
});

test("renders native sheet styles and clockwise branches after import, save and reload", async ({ context, cloud }) => {
  const page = await cloud.openPage(context, "designer");
  const { api } = await openSavedMap(page, cloud.origin, "designer", createDocument());
  const synced = page.getByRole("button", { name: "Synced", exact: true });
  await expect(synced).toBeVisible();
  const dialog = await fileDialog(page);
  const sheets = [nativeSheet("typeset", false), nativeSheet("handwriting", true)];
  const saved = page.waitForResponse((response) => response.url() === api && response.request().method() === "PUT" && response.request().postDataJSON().sheets?.[0]?.id === "typeset");
  page.once("dialog", (confirmation) => confirmation.accept());
  await dialog.locator("input[type=file]").setInputFiles({ name: "styles.xmind", mimeType: "application/zip",
    buffer: Buffer.from(zipSync({ "content.json": strToU8(JSON.stringify(sheets)) })) });
  await expect(dialog).toBeHidden();
  expect((await saved).status()).toBe(200);
  await page.reload();
  // Binding the live checkpoint replaces the editor initially shown from the local cache.
  await expect(synced).toBeVisible();
  const canvas = page.getByRole("application");
  for (const [index, sheet] of sheets.entries()) {
    if (index) await page.getByText(sheet.title, { exact: true }).click();
    await expect(canvas).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(canvas).toHaveCSS("background-image", "none");
    const tree = canvas.getByRole("tree", { name: sheet.title, exact: true });
    const title = tree.getByRole("treeitem", { level: 1 }).getByText(sheet.rootTopic.title, { exact: true });
    await expect(title).toBeVisible();
    await expect(title).toHaveCSS("font-family", index ? /NeverMind Hand.*cursive/ : /Arvo.*serif/);
    await expect.poll(() => title.evaluate((element) => {
      const text = element.getBoundingClientRect();
      const card = element.closest('[role="treeitem"]')?.getBoundingClientRect();
      return !!card && card.width > 0 && card.height > 0 && text.width > 0 && text.height > 0 &&
        text.left >= card.left && text.right <= card.right + 1;
    }), { message: `${sheet.title}: the title must fit inside the root topic` }).toBe(true);
    const main = tree.locator(`[role="treeitem"][data-topic-id="${sheet.id}-0"] > div`).first();
    await expect(main).toHaveCSS("background-color", index ? "rgb(249, 66, 58)" : "rgba(0, 0, 0, 0)");
    await expect(main).toHaveCSS("background-image", index ? /repeating-linear-gradient/ : "none");
    const edges = canvas.locator(index ? 'svg path[fill="rgb(249, 66, 58)"]' : 'svg path[stroke="rgb(249, 66, 58)"][d*=" L "]');
    await expect(edges.first()).toBeVisible();
    const labels = sheet.rootTopic.children.attached.map((topic) => topic.id);
    const split = index ? 4 : 3;
    await expect.poll(() => tree.getByRole("treeitem").evaluateAll((nodes) => {
      const root = nodes.find((node) => node.getAttribute("aria-level") === "1")?.getBoundingClientRect();
      if (!root || !root.width || !root.height) return null;
      const positions = nodes.filter((node) => node.getAttribute("aria-level") === "2").map((node) => {
        const { x, y } = node.getBoundingClientRect(); return { id: node.getAttribute("data-topic-id"), x, y };
      }).sort((a, b) => a.y - b.y);
      return [positions.filter((node) => node.x > root.x), positions.filter((node) => node.x < root.x)].map((side) => side.map((node) => node.id));
    })).toEqual([labels.slice(0, split), labels.slice(split).reverse()]);
  }
});

test("transfers both sheets, editable rich titles, equation source and identical image bytes to another browser", async ({ browserName, context, cloud }, testInfo) => {
  test.setTimeout(60_000);
  const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="blue"/></svg>');
  const root = createTopic("rich", "Field report", {
    image: { resourceId: "photo", width: 20, height: 20, pos: "top" }, equation: { latex: "x^2" },
  });
  root.title.content[0].content![0].marks = [{ type: "bold" }];
  const original = createDocument([createSheet("one", "Notes"), createSheet("two", "Report", root)]);
  original.activeSheetId = "two";
  original.assets.photo = { resourceId: "photo", mimeType: "image/svg+xml", width: 20, height: 20,
    sha256: createHash("sha256").update(bytes).digest("hex"), dataBase64: bytes.toString("base64") };
  const writer = await cloud.openPage(context, "author");
  await openSavedMap(writer, cloud.origin, "author", original);
  await expect(writer.getByRole("application").getByText("Field report", { exact: true }).first()).toBeVisible();
  const files = await fileDialog(writer);
  const downloading = writer.waitForEvent("download");
  await files.getByRole("button", { name: /XMind Workbook/ }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/\.xmind$/);
  const path = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(path);

  const other = await (browserName === "chromium" ? webkit : chromium).launch();
  try {
    const reader = await cloud.openPage(await other.newContext(desktop), "reviewer");
    const { api, headers } = await openSavedMap(reader, cloud.origin, "reviewer", createDocument());
    await expect(reader.getByRole("button", { name: "Synced", exact: true })).toBeVisible();
    const importing = await fileDialog(reader);
    const persisted = reader.waitForResponse((response) => response.url() === api && response.request().method() === "PUT" && response.request().postDataJSON().assets?.photo);
    reader.once("dialog", (confirmation) => confirmation.accept());
    await importing.locator("input[type=file]").setInputFiles(path);
    await expect(importing).toBeHidden();
    expect((await persisted).status()).toBe(200);
    const topic = reader.getByRole("application").locator('[data-topic-id="rich"]').filter({ hasText: "Field report" }).last();
    await expect(topic.locator("strong")).toHaveText("Field report");
    await expect(topic.locator(".katex")).toBeVisible();
    await expect(topic.locator("img")).toHaveJSProperty("naturalWidth", 20);
    const saved = await reader.request.get(api, { headers });
    expect(saved.status()).toBe(200);
    const restored = (await saved.json()).document;
    expect(restored.sheets).toEqual(original.sheets);
    expect(restored.activeSheetId).toBe("two");
    expect(restored.assets).toEqual(original.assets);
  } finally { await other.close(); }
});
