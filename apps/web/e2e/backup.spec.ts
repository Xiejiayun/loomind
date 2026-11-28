import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { createDocument, createSheet, createTopic } from "@mindmap/core/model";
import { useLocalFixtures } from "./fixtures.js";

function demoDocument() {
  const image = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="blue"/></svg>');
  const root = createTopic("rich", "Field report", {
    image: { resourceId: "photo", width: 20, height: 20, pos: "top" },
    equation: { latex: "x^2" },
  });
  root.title.content[0].content![0].marks = [{ type: "bold" }];
  const document = createDocument([createSheet("one", "Notes"), createSheet("two", "Report", root)]);
  document.activeSheetId = "two";
  document.deletedIds = ["old-topic"];
  document.assets.photo = { resourceId: "photo", mimeType: "image/svg+xml", width: 20, height: 20,
    sha256: createHash("sha256").update(image).digest("hex"), dataBase64: image.toString("base64") };
  return document;
}

async function openFiles(page: Page) {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  return page.getByRole("dialog", { name: "Import & Export" });
}

test("full backup restores rich content and every sheet in a fresh browser context", async ({ page, browser, baseURL }, testInfo) => {
  const original = demoDocument();
  await useLocalFixtures(page, true);
  await page.goto("/app");
  await page.locator("#lm-home-prompt").fill("Local draft\n  - First branch");
  await page.getByRole("button", { name: "Create from Outline" }).click();
  const files = await openFiles(page);
  page.once("dialog", (dialog) => dialog.accept());
  await files.locator("input[type=file]").setInputFiles({ name: "old-revision.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(original)) });
  await expect(files).toBeHidden();
  await openFiles(page);
  const downloading = page.waitForEvent("download");
  await files.getByRole("button", { name: /Loomind full backup/ }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("Report.loomind.json");
  const saved = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(saved);
  expect(JSON.parse(await readFile(saved, "utf8"))).toEqual(original);

  const fresh = await browser.newContext({ baseURL, locale: "en-US" });
  try {
    const restored = await fresh.newPage();
    await useLocalFixtures(restored);
    await restored.goto("/try");
    const restoreFiles = await openFiles(restored);
    restored.once("dialog", (dialog) => dialog.accept());
    await restoreFiles.locator("input[type=file]").setInputFiles(saved);
    await expect(restoreFiles).toBeHidden();
    const topic = restored.locator('[data-topic-id="rich"]').filter({ hasText: "Field report" }).last();
    await expect(topic.locator("img")).toHaveJSProperty("naturalWidth", 20);
    await expect(topic.locator(".katex")).toBeVisible();
    await openFiles(restored);
    const rejected = { ...original, assets: {} };
    await restoreFiles.locator("input[type=file]").setInputFiles({ name: "missing-image.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(rejected)) });
    await expect(restoreFiles.getByRole("status")).toContainText("Missing image: photo");
    restored.once("dialog", (dialog) => dialog.dismiss());
    await restoreFiles.locator("input[type=file]").setInputFiles({ name: "other.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(createDocument())) });
    const nextDownload = restored.waitForEvent("download");
    await restoreFiles.getByRole("button", { name: /Loomind full backup/ }).click();
    expect(JSON.parse(await readFile((await (await nextDownload).path())!, "utf8"))).toEqual(original);
  } finally {
    await fresh.close();
  }
});
