import { createHash, randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { createDocument, createSheet, createTopic, richTextToPlainText, type MindmapDocument } from "@mindmap/core/model";
import { cloudBrowser, test } from "./cloud-worker.js";

const desktop = { ...cloudBrowser, isMobile: false, hasTouch: false, viewport: { width: 1280, height: 800 } };
test.use(desktop);

async function fieldMap(page: Page) {
  const data = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 640;
    const context = canvas.getContext("2d")!, pixels = context.createImageData(640, 640);
    const bytes = new Uint8Array(pixels.data.buffer);
    for (let offset = 0; offset < bytes.length; offset += 65_536) crypto.getRandomValues(bytes.subarray(offset, offset + 65_536));
    for (let alpha = 3; alpha < bytes.length; alpha += 4) bytes[alpha] = 255;
    context.putImageData(pixels, 0, 0); return canvas.toDataURL("image/png").split(",")[1];
  });
  const digest = createHash("sha256").update(Buffer.from(data, "base64")).digest("hex");
  const image = { resourceId: "inspection-photo", width: 120, height: 120, pos: "top" as const };
  const topic = createTopic("evidence-topic", "Original evidence", { image, note: { format: "markdown", text: "Field inspection: original observation." } });
  const map = createDocument([createSheet("inspection-sheet", "Field inspection", createTopic("inspection-root", "Field inspection", { children: [topic] }))]);
  map.assets[image.resourceId] = { resourceId: image.resourceId, width: 640, height: 640, mimeType: "image/png", sha256: digest, dataBase64: data };
  expect(Buffer.byteLength(JSON.stringify(map))).toBeGreaterThan(1024 * 1024);
  return { document: map, digest };
}

test("an editor publishes a large map as a team template; independently editable copies outlive their source and template", async ({ browser, context, cloud }) => {
  test.setTimeout(120_000);
  const owner = await cloud.openPage(context, "field-owner"), originHeaders = { Origin: cloud.origin };
  const api = `${cloud.origin}/api`;
  const space = await owner.request.post(`${api}/workspaces`, { headers: originHeaders, data: { name: "Field lab" } }); expect(space.status()).toBe(201);
  const { id: workspace } = await space.json(); const source = randomUUID();
  const sourceHeaders = { ...originHeaders, "X-Loomind-Owner": "field-owner" };
  const { document, digest } = await fieldMap(owner);
  const seeded = await owner.request.put(`${api}/mindmaps/${source}`, { headers: { ...sourceHeaders, "If-Match": '"0"', "X-Loomind-Workspace": workspace }, data: document });
  expect(seeded.status()).toBe(200);
  const invitation = await owner.request.post(`${api}/shares`, { headers: originHeaders, data: { type: "workspace", resourceId: workspace, role: "editor" } });
  expect(invitation.status()).toBe(201); const { token } = await invitation.json();
  const colleague = await browser.newContext(browser.browserType().name() === "webkit" ? { ...cloudBrowser, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : desktop);
  try {
    const member = await cloud.openPage(colleague, "field-editor"); await member.goto(`${cloud.origin}/invite/${token}`);
    await member.getByRole("button", { name: /Accept Invite|Accept invitation/i }).click(); await expect(member).toHaveURL(/\/app\?workspace=/);
    await member.goto(`${cloud.origin}/app/library?workspace=${workspace}`);
    await member.getByRole("button", { name: "Save as team template: Field inspection" }).click();
    await expect(member.getByRole("status").filter({ hasText: "Saved team template: Field inspection" })).toBeVisible();
    expect(await member.getByRole("region", { name: "Team templates in Field lab" }).evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await owner.goto(`${cloud.origin}/app/create?workspace=${workspace}`);
    await owner.getByRole("link", { name: "Browse team templates" }).click();
    const catalog = owner.getByRole("region", { name: "Team templates in Field lab" });
    const makeCopy = async (page: Page) => {
      const creating = page.waitForResponse((response) => response.url().endsWith("/copies") && response.request().method() === "POST");
      await page.getByRole("region", { name: "Team templates in Field lab" }).getByRole("button", { name: "Create copy from template: Field inspection" }).click();
      const result = await creating; expect(result.status()).toBe(201); const { id } = await result.json(); await expect(page).toHaveURL(new RegExp(`/app/mindmaps/${id}$`)); return id as string;
    };
    await expect(catalog).toBeVisible(); const first = await makeCopy(owner); expect(first).not.toBe(source);
    const canvas = owner.getByRole("application"); await expect(canvas.locator('img[src^="data:image/"]')).toHaveJSProperty("naturalWidth", 640);
    await canvas.getByText("Original evidence", { exact: true }).dblclick(); const text = owner.locator(".ProseMirror[contenteditable=true]");
    await expect(text).toBeFocused(); await text.press("ControlOrMeta+a"); await text.press("Backspace"); await expect(text).toHaveText("");
    await owner.keyboard.insertText("Revised observation"); await expect(text).toHaveText("Revised observation");
    const saving = owner.waitForResponse((response) => response.url() === `${api}/mindmaps/${first}` && response.request().method() === "PUT" && JSON.stringify(response.request().postDataJSON().sheets ?? []).includes('"text":"Revised observation"'));
    await canvas.getByText("Field inspection", { exact: true }).click(); expect((await saving).status()).toBe(200);
    const verify = async (page: Page, id: string, subject: string, expected: string) => {
      const response = await page.request.get(`${api}/mindmaps/${id}`, { headers: { "X-Loomind-Owner": subject } }); expect(response.status()).toBe(200);
      const snapshot = (await response.json()).document as MindmapDocument;
      const child = snapshot.sheets[0].rootTopic.children[0]; expect(richTextToPlainText(child.title)).toBe(expected); expect(child.note?.text).toBe("Field inspection: original observation.");
      expect(createHash("sha256").update(Buffer.from(snapshot.assets[child.image!.resourceId].dataBase64, "base64")).digest("hex")).toBe(digest);
    };
    await verify(member, source, "field-editor", "Original evidence"); await verify(owner, first, "field-owner", "Revised observation");
    expect((await owner.request.delete(`${api}/mindmaps/${source}`, { headers: sourceHeaders })).status()).toBe(200);
    const second = await makeCopy(member); expect(new Set([source, first, second]).size).toBe(3);
    await expect(member.getByRole("application").getByText("Original evidence", { exact: true })).toBeVisible();
    await owner.goto(`${cloud.origin}/app/library?workspace=${workspace}`); owner.once("dialog", (dialog) => dialog.accept());
    await catalog.getByRole("button", { name: "Remove template: Field inspection" }).click(); await expect(catalog.getByText(/No team templates yet/)).toBeVisible();
    await member.reload(); await expect(member.getByRole("application").locator('img[src^="data:image/"]')).toHaveJSProperty("naturalWidth", 640);
    await verify(member, second, "field-editor", "Original evidence"); await verify(owner, first, "field-owner", "Revised observation");
  } finally { await colleague.close(); }
});
