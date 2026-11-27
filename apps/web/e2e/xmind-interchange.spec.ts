import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium, expect, webkit, type Page } from "@playwright/test";
import { createDocument, createSheet, createTopic, type MindmapDocument } from "@mindmap/core/model";
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
  await dialog.locator("input[type=file]").setInputFiles(fileURLToPath(new URL("./fixtures/xmind-generator-image.xmind", import.meta.url)));
  await expect(dialog).toBeHidden();
  const canvas = page.getByRole("application");
  for (const title of ["Partner workbook", "Imported from Xmind"]) await expect(canvas.getByText(title, { exact: true }).first()).toBeVisible();
  await expect(canvas.locator("[data-topic-id] img").first()).toHaveJSProperty("naturalWidth", 32);
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
    const importing = await fileDialog(reader);
    const persisted = reader.waitForResponse((response) => response.url() === api && response.request().method() === "PUT" && response.request().postDataJSON().assets?.photo);
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
