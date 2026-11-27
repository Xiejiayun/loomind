import { expect, type Page } from "@playwright/test";
import { getTemplate, getTemplateInfo, richTextToPlainText, TEMPLATES, type MindmapDocument } from "@mindmap/core";
import { cloudBrowser, test } from "./cloud-worker.js";

async function saveNewMap(page: Page, create: () => Promise<void>) {
  const saved = page.waitForResponse((response) => response.request().method() === "PUT" && /\/api\/mindmaps\/[^/]+$/.test(response.url()));
  await create();
  const response = await saved;
  expect(response.status()).toBe(200);
  return response.request().postDataJSON() as MindmapDocument;
}

test("the full template catalog applies layouts to user content or creates a separate copy of the sample", async ({ browser, browserName, cloud }) => {
  test.setTimeout(90_000);
  const locale = browserName === "webkit" ? "zh" : "en";
  const context = await browser.newContext({ ...cloudBrowser, locale, viewport: { width: locale === "zh" ? 390 : 1280, height: 844 } });
  try {
    const page = await cloud.openPage(context, "planner");
    const aiRequests: string[] = [];
    page.on("request", (request) => { if (request.url().endsWith("/api/ai/stream")) aiRequests.push(request.method()); });
    await page.goto(`${cloud.origin}/app`);
    const quick = page.getByRole("combobox", { name: locale === "en" ? "Layout template" : "布局模板" });
    await expect(quick.locator("option")).toHaveText(TEMPLATES.map((template) => getTemplateInfo(template.id, locale).name));
    await quick.selectOption("decision-tree");
    await page.locator("#lm-home-prompt").fill("Design review\n  - Verify user research");
    const own = await saveNewMap(page, () => page.getByRole("button", { name: locale === "en" ? "Create from Outline" : "从大纲创建" }).click());
    expect(own.sheets[0].structure).toBe("brace");
    expect(own.sheets[0].rootTopic.children.map((topic) => richTextToPlainText(topic.title))).toEqual(["Verify user research"]);
    const ownUrl = page.url();
    await page.goto(`${cloud.origin}/app/create?mode=outline`);
    const cards = page.locator(".lm-template-grid").getByRole("button");
    await expect(cards).toHaveCount(TEMPLATES.length);
    const example = getTemplate("reading-notes");
    await cards.filter({ hasText: getTemplateInfo(example.id, locale).name }).click();
    await expect(page.locator(".lm-structure-preview")).toContainText("锚定效应");
    const createSample = page.getByRole("button", { name: locale === "en" ? "Create from Template" : "从模板创建" });
    await page.locator("#lm-outline-input").fill("No branches yet");
    await expect(createSample).toHaveCount(0);
    await expect(page.getByRole("button", { name: locale === "en" ? "Create Map" : "创建导图", exact: true })).toBeDisabled();
    const ideaTab = page.getByRole("tab", { name: locale === "en" ? "Start with an Idea" : "从想法开始" });
    const outlineTab = page.getByRole("tab", { name: locale === "en" ? "Import Outline" : "导入已有大纲" });
    await ideaTab.click();
    await expect(createSample).toBeEnabled();
    await outlineTab.click();
    await expect(page.locator("#lm-outline-input")).toHaveValue("No branches yet");
    await expect(createSample).toHaveCount(0);
    await ideaTab.click();
    const copied = await saveNewMap(page, () => createSample.click());
    expect(copied).toEqual(example.create());
    expect(page.url()).not.toBe(ownUrl);
    const reader = await cloud.openPage(await browser.newContext({ ...cloudBrowser, locale }), "planner");
    try {
      await reader.goto(page.url());
      await expect(reader.getByRole("treeitem").filter({ hasText: "锚定效应" })).toBeVisible();
      await reader.goto(ownUrl);
      await expect(reader.getByRole("treeitem").filter({ hasText: "Verify user research" })).toBeVisible();
    } finally { await reader.context().close(); }
    expect(aiRequests).toEqual([]);
  } finally { await context.close(); }
});
