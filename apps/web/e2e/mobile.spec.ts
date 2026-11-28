import { expect, test, type Locator, type Page } from "@playwright/test";
import { documentFromTopic } from "../src/outline.js";

async function useLocalFixtures(page: Page, signedIn = false) {
  await page.route("https://fonts.googleapis.com/**", (route) => route.fulfill({ contentType: "text/css", body: "" }));
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/session") {
      return route.fulfill({ json: { user: signedIn ? { id: "mobile-test", email: "mobile@example.test" } : null, expiresAt: null } });
    }
    if (url.pathname === "/api/workspaces" || url.pathname === "/api/mindmaps") return route.fulfill({ json: [] });
    if (url.pathname === "/api/ai/config") {
      return route.fulfill({ json: { tier: url.searchParams.get("tier"), available: true, isMock: true, providerLabel: "Test fixture", modelLabel: "Test fixture", dailyLimit: 3, remainingToday: 3 } });
    }
    return route.fulfill({ status: 503, json: { error: "Offline fixture: cloud services are unavailable" } });
  });
}

async function expectTouchTarget(button: Locator) {
  await expect(button).toBeInViewport({ ratio: 1 });
  const bounds = await button.boundingBox();
  expect(bounds!.width).toBeGreaterThanOrEqual(44);
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
  await button.tap({ trial: true });
}

test("landing to playground: edit a topic without losing the dock or save action", async ({ page }) => {
  await useLocalFixtures(page);
  await page.goto("/");
  const header = page.locator(".lm-site-header");
  await expect(header).toBeVisible();
  for (const control of await header.locator("a, button").all()) await expectTouchTarget(control);
  await header.getByRole("button", { name: /Switch to Chinese/ }).tap();
  for (const control of await header.locator("a, button").all()) await expectTouchTarget(control);
  await header.getByRole("button", { name: /Switch to English/ }).tap();
  await header.getByRole("link", { name: "Try Free AI" }).tap();
  await expect(page.getByRole("application")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "AI Chat Assistant" })).toBeHidden();
  const dock = page.getByRole("toolbar", { name: "Canvas quick actions" });
  await expect(dock.getByRole("button")).toHaveCount(4);
  for (const button of await dock.getByRole("button").all()) await expectTouchTarget(button);
  await dock.getByTitle("Insert Subtopic (Tab)").tap();
  const editor = page.locator(".ProseMirror[contenteditable=true]");
  await expect(editor).toBeFocused();
  await expect(editor).toHaveCSS("user-select", "text");
  await editor.fill("Touch topic");
  await editor.press("Enter");
  await expect(page.getByRole("application").getByText("Touch topic", { exact: true }).first()).toBeVisible();
  await expectTouchTarget(page.getByRole("button", { name: "Clear canvas" }));
  await expectTouchTarget(page.getByRole("button", { name: "Sign in to save" }));
});

test("phone panels stay below their toolbar and preserve a covered chat draft", async ({ page }) => {
  await useLocalFixtures(page);
  await page.goto("/try");
  const chatToggle = page.getByTitle("Toggle AI Chat Panel (⌘J)");
  const chat = page.getByRole("complementary", { name: "AI Chat Assistant" });
  await chatToggle.tap();
  await chat.getByRole("textbox").fill("Keep this draft");
  const header = await page.locator(".lm-try-editor-wrap header").boundingBox();
  expect((await chat.boundingBox())!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
  const format = page.getByRole("button", { name: "Format", exact: true });
  await format.tap();
  await expect(page.getByRole("tab", { name: "Canvas", exact: true })).toBeVisible();
  await expect(chat).toBeHidden();
  await chatToggle.tap();
  await expect(chat.getByRole("textbox")).toHaveValue("Keep this draft");
  await expect(format).toHaveAttribute("aria-pressed", "false");
  await page.setViewportSize({ width: 740, height: 360 });
  await expect(chat.getByRole("textbox")).toBeInViewport({ ratio: 1 });
  await chatToggle.tap();
  await expect(chat).toBeHidden();
});

test("open the workspace drawer from an edited map and reopen it from the library", async ({ page }) => {
  await useLocalFixtures(page, true);
  await page.goto("/app");
  const title = "Mobile map with a deliberately long title";
  await page.locator("#lm-home-prompt").fill(`${title}\n  - First branch`);
  await page.getByRole("button", { name: "Create from Outline" }).tap();
  await expect(page.getByRole("application")).toBeVisible();
  const opener = page.getByRole("button", { name: "Toggle sidebar" });
  await expectTouchTarget(opener);
  await expectTouchTarget(page.getByRole("button", { name: "Export", exact: true }));
  await opener.tap();
  const drawer = page.locator("#lm-workspace-sidebar");
  await expect(drawer.getByRole("button", { name: "Close sidebar" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(opener).toBeFocused();
  await opener.tap();
  await drawer.getByRole("link", { name: "Library" }).tap();
  const map = page.getByRole("link", { name: title });
  await expect(map).toBeInViewport({ ratio: 1 });
  expect((await map.boundingBox())!.width).toBeGreaterThan(80);
  await page.getByRole("button", { name: "Open sidebar" }).tap();
  await drawer.getByRole("button", { name: /Search/ }).tap();
  await expect(page.getByRole("dialog").getByRole("textbox")).toBeFocused();
  await page.keyboard.press("Escape");
  await map.tap();
  await expect(page.getByRole("application")).toBeVisible();
});

test("shared viewers can navigate without editing controls covering the map", async ({ page }) => {
  await useLocalFixtures(page, true);
  const id = "b20d682c-988a-48e2-8278-01796ed4faab";
  const title = "Shared map on a phone";
  await page.route("**/api/mindmaps", (route) => route.fulfill({ json: [{ id, title, access: "viewer", workspaceId: null, updatedAt: "2026-01-01T00:00:00Z" }] }));
  await page.route(`**/api/mindmaps/${id}`, (route) => route.fulfill({ json: { revision: 1, document: documentFromTopic(title) } }));
  await page.goto(`/app/mindmaps/${id}`);
  await expect(page.getByRole("application")).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "Canvas quick actions" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Format", exact: true })).toBeHidden();
  await expectTouchTarget(page.getByRole("button", { name: "Export", exact: true }));
  await page.getByRole("button", { name: "Toggle sidebar" }).tap();
  await page.getByRole("link", { name: "Library" }).tap();
  await expect(page.getByRole("link", { name: title })).toBeVisible();
});

test("wide layouts still show chat beside the canvas", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await useLocalFixtures(page);
  await page.goto("/try");
  const chat = page.getByRole("complementary", { name: "AI Chat Assistant" });
  await expect(chat).toBeVisible();
  await page.getByRole("button", { name: "Format", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Canvas", exact: true })).toBeVisible();
  const panel = await chat.boundingBox();
  const canvas = await page.getByRole("application").boundingBox();
  expect(canvas!.x).toBeGreaterThanOrEqual(panel!.x + panel!.width);
});

test("desktop editor shows only one sidebar toggle icon whether expanded or collapsed", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await useLocalFixtures(page, true);
  const id = "b20d682c-988a-48e2-8278-01796ed4faab";
  const title = "Desktop sidebar toggle check";
  await page.route("**/api/mindmaps", (route) => route.fulfill({ json: [{ id, title, access: "owner", workspaceId: null, updatedAt: "2026-01-01T00:00:00Z" }] }));
  await page.route(`**/api/mindmaps/${id}`, (route) => route.fulfill({ json: { revision: 1, document: documentFromTopic(title) } }));
  await page.goto(`/app/mindmaps/${id}`);
  await expect(page.getByRole("application")).toBeVisible();

  const sidebarToggle = page.locator(".lm-sidebar-collapse-btn");
  const editorToggle = page.locator(".lm-editor-sidebar-toggle");

  // Collapsed by default in editor: only editor header toggle is visible
  await expect(editorToggle).toBeVisible();
  await expect(sidebarToggle).toBeHidden();
  await expect(page.getByRole("button", { name: "Toggle sidebar" })).toHaveCount(1);

  // Expand sidebar: only sidebar header toggle is visible
  await editorToggle.click();
  await expect(sidebarToggle).toBeVisible();
  await expect(editorToggle).toBeHidden();
  await expect(page.getByRole("button", { name: "Toggle sidebar" })).toHaveCount(1);

  // Collapse sidebar again: editor header toggle returns
  await sidebarToggle.click();
  await expect(editorToggle).toBeVisible();
  await expect(sidebarToggle).toBeHidden();
  await expect(page.getByRole("button", { name: "Toggle sidebar" })).toHaveCount(1);
});
