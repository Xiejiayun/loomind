import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1100, height: 800 }, isMobile: false, hasTouch: false });

test("Enter saves exactly the typed paragraphs, Shift+Enter adds a line, and Escape discards an edit", async ({ page }) => {
  await page.goto("/try");
  const topic = page.getByRole("application").getByRole("treeitem").first();
  const field = page.locator(".ProseMirror[contenteditable=true]");
  const paragraphs = field.locator(":scope > p");
  const expectedText = ["First observation", "保留第二行"];

  await topic.dblclick();
  await expect(field).toBeFocused();
  await field.press("ControlOrMeta+a");
  await field.press("Backspace");
  await expect(field).toHaveText("");
  await page.keyboard.insertText(expectedText[0]);
  await field.press("Shift+Enter");
  await page.keyboard.insertText(expectedText[1]);
  await field.press("Enter");
  await expect(field).toHaveCount(0);

  await topic.dblclick();
  await expect(paragraphs).toHaveText(expectedText);
  await field.press("ControlOrMeta+a");
  await page.keyboard.insertText("Discarded draft");
  await field.press("Escape");
  await expect(field).toHaveCount(0);
  await topic.dblclick();
  await expect(paragraphs).toHaveText(expectedText);
});
