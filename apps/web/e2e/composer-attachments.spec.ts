import { expect } from "@playwright/test";
import { MindmapDocumentSchema, richTextToPlainText } from "@mindmap/core/model";
import { cloudBrowser, test } from "./cloud-worker.js";

test.use(cloudBrowser);

test("choose files on a phone and reopen the saved image in a fresh mobile session", async ({ browser, context, cloud }) => {
  test.setTimeout(60_000);
  const page = await cloud.openPage(context, "attachment-author");
  await page.goto(`${cloud.origin}/app`);
  const prompt = page.locator("#lm-home-prompt"), add = page.getByRole("button", { name: "Add attachments" });
  await expect(page.getByRole("link", { name: "Create from source" })).toHaveCount(0);
  await add.tap();
  const choose = page.getByRole("button", { name: /Choose files or images/ });
  await expect(choose).toBeInViewport({ ratio: 1 });
  expect((await add.boundingBox())!.width).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Escape"); await expect(choose).toBeHidden(); await expect(add).toBeFocused();
  await add.tap(); await page.locator(".lm-suggestion-row button").first().tap(); await expect(choose).toBeHidden();
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 20; canvas.height = 10;
    const brush = canvas.getContext("2d")!; brush.fillStyle = "#456"; brush.fillRect(0, 0, 20, 10);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const mutations: string[] = [];
  page.on("request", (request) => { if (request.method() !== "GET" && request.method() !== "HEAD") mutations.push(request.url()); });
  await prompt.fill("Field visit"); await add.tap();
  const picking = page.waitForEvent("filechooser"); await choose.tap();
  const chooser = await picking; expect(chooser.isMultiple()).toBe(true);
  await chooser.setFiles([
    { name: "minutes.md", mimeType: "text/markdown", buffer: Buffer.from("# Gate\nKeep the gate open.") },
    { name: "diagram.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") },
    { name: "extras.zip", mimeType: "application/zip", buffer: Buffer.from("unused") },
  ]);
  const create = page.getByRole("button", { name: "Create map", exact: true });
  await expect(page.getByRole("alert")).toContainText("Unsupported file"); await expect(create).toBeDisabled();
  await page.getByRole("button", { name: "Remove extras.zip" }).tap();
  await page.getByRole("button", { name: "Preview diagram.png" }).tap();
  await expect(page.getByRole("img", { name: "diagram.png" })).toBeVisible();
  await expect(prompt).toHaveValue("Field visit"); expect(mutations).toEqual([]);
  const saving = page.waitForResponse((response) => response.request().method() === "PUT" && /\/api\/mindmaps\/[^/]+$/.test(response.url()));
  await create.tap(); const saved = await saving; expect(saved.status()).toBe(200);
  const stored = await page.request.get(saved.url(), { headers: { "X-Loomind-Owner": "attachment-author" } });
  expect(stored.status()).toBe(200);
  const doc = MindmapDocumentSchema.parse((await stored.json()).document);
  const root = doc.sheets[0].rootTopic;
  expect(richTextToPlainText(root.title)).toBe("Field visit");
  expect(root.children[0].children[0].note?.text).toBe("minutes.md · Lines 1–2\n\n# Gate\nKeep the gate open.");
  const asset = doc.assets[root.children[1].image!.resourceId];
  expect(asset).toMatchObject({ width: 20, height: 10, dataBase64: expect.any(String) });
  const fresh = await browser.newContext({ ...cloudBrowser, isMobile: true, hasTouch: true, viewport: page.viewportSize() });
  try {
    const reader = await cloud.openPage(fresh, "attachment-author"); await reader.goto(page.url());
    const image = reader.getByRole("application").getByRole("treeitem").filter({ hasText: "diagram.png" }).locator('img[src^="data:image/"]');
    await expect(image).toBeVisible(); await expect(image).toHaveJSProperty("naturalWidth", 20); await expect(image).toHaveJSProperty("naturalHeight", 10);
    await expect(image).toHaveAttribute("src", `data:${asset.mimeType};base64,${asset.dataBase64}`);
  } finally { await fresh.close(); }
  expect(mutations.filter((url) => url.includes("/api/ai/"))).toEqual([]);
});

test("paste a screenshot or drop files without text; enforce the limit and allow reselecting a removed file", async ({ context, cloud }) => {
  const page = await cloud.openPage(context, "clipboard-author"); await page.goto(`${cloud.origin}/app`);
  const prompt = page.locator("#lm-home-prompt");
  await prompt.evaluate(async (element) => {
    const canvas = document.createElement("canvas"); const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!)));
    const data = new DataTransfer(); data.items.add(new File([blob], "screen.png", { type: "image/png" }));
    const event = new Event("paste", { bubbles: true, cancelable: true }); Object.defineProperty(event, "clipboardData", { value: data }); element.dispatchEvent(event);
  });
  const create = page.getByRole("button", { name: "Create map", exact: true });
  await expect(create).toBeEnabled(); await expect(prompt).toHaveValue("");
  await prompt.evaluate((element) => {
    const data = new DataTransfer(); data.items.add(new File(["First line"], "drop.txt", { type: "text/plain" }));
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }));
  });
  await expect(page.getByRole("button", { name: "Preview drop.txt" })).toBeEnabled();
  const input = page.getByLabel("Choose files or images", { exact: true });
  const file = { name: "again.txt", mimeType: "text/plain", buffer: Buffer.from("Hello") };
  await input.setInputFiles([file, file, file]); await expect(page.getByRole("alert")).toContainText("up to 4");
  await page.getByRole("button", { name: "Remove drop.txt" }).tap(); await input.setInputFiles(file);
  await page.getByRole("button", { name: "Remove again.txt" }).tap(); await input.setInputFiles(file);
  await expect(page.getByRole("button", { name: "Preview again.txt" })).toBeEnabled();
  await page.getByRole("button", { name: "Remove again.txt" }).tap();
  await prompt.press("Control+Enter"); await expect(page.getByRole("application")).toBeVisible();
  await expect(page.getByRole("application").getByText("screen", { exact: true })).toBeVisible();
});
