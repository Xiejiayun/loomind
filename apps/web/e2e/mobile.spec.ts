import { expect, test, type Locator } from "@playwright/test";
import { documentFromTopic } from "../src/outline.js";
import { useLocalFixtures } from "./fixtures.js";

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

test("open the workspace drawer from an edited map and reopen it from Personal", async ({ page }) => {
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
  await drawer.getByRole("link", { name: "Personal", exact: true }).tap();
  const map = page.getByRole("main").getByRole("link", { name: title });
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
  await page.getByRole("link", { name: "Shared", exact: true }).tap();
  const main = page.getByRole("main");
  await expect(main.getByRole("link", { name: title })).toBeVisible();
  await expect(main.getByText("Read-only", { exact: true })).toBeVisible();
  await expect(main.getByRole("button", { name: `Delete ${title}` })).toHaveCount(0);
});

test("old Library links open Personal; Shared contains direct shares and joined workspaces", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await useLocalFixtures(page, true);
  const team = crypto.randomUUID();
  const work = crypto.randomUUID();
  const elsewhere = crypto.randomUUID();
  await page.route("**/api/workspaces", (route) => route.fulfill({ json: [
    { id: team, name: "Invited team", role: "viewer", createdAt: "" }, { id: work, name: "Work", role: "owner", createdAt: "" },
  ] }));
  const personal = { id: crypto.randomUUID(), title: "My plan", workspaceId: null, access: "owner", updatedAt: "" };
  const incoming = Array.from({ length: 11 }, (_, index) => ({ ...personal, id: crypto.randomUUID(), title: `Incoming ${index + 1}`, workspaceId: elsewhere, access: "viewer" }));
  await page.route("**/api/mindmaps", (route) => route.fulfill({ json: [personal, ...incoming,
    { ...personal, id: crypto.randomUUID(), title: "Team plan", workspaceId: team, access: "viewer" },
  ] }));
  await page.goto("/app/library");
  await expect(page).toHaveURL(/\/app\/personal$/);
  const sidebar = page.locator("#lm-workspace-sidebar");
  const main = page.getByRole("main");
  await expect(sidebar.getByRole("link", { name: "Library" })).toHaveCount(0);
  await expect(main.getByRole("link", { name: "My plan" })).toBeVisible();
  await expect(main.getByRole("button", { name: "Delete My plan" })).toBeAttached();
  await expect(main.getByText("Incoming 1", { exact: true })).toHaveCount(0);
  await sidebar.getByRole("button", { name: "Toggle mind maps in Shared" }).click();
  await expect(sidebar.getByRole("link", { name: "Invited team" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: /^Incoming / })).toHaveCount(10);
  await sidebar.getByRole("link", { name: "View all 11" }).click();
  await expect(page).toHaveURL(/\/app\/shared$/);
  await expect(main.getByRole("link", { name: /^Incoming / })).toHaveCount(11);
  await expect(main.getByRole("link", { name: "My plan" })).toHaveCount(0);
  await main.getByRole("link", { name: "Invited team" }).click();
  await expect(main.getByRole("link", { name: "Team plan" })).toBeVisible();
  await expect(main.getByRole("link", { name: "New Mind Map" })).toHaveCount(0);
  await page.goBack();
  await expect(main.getByRole("heading", { name: /Shared/ })).toBeVisible();
  await sidebar.getByRole("link", { name: "Work", exact: true }).click();
  await main.getByRole("link", { name: "New Mind Map" }).click();
  await expect(main.getByRole("combobox", { name: "Save to space" })).toHaveValue(work);
  await page.goto(`/app?workspace=${team}`);
  await expect(page).toHaveURL(`/app/workspaces/${team}`);
  await expect(main.getByRole("link", { name: "Team plan" })).toBeVisible();
});

test("sidebar order can be canceled, retried and saved from a phone without changing other accounts", async ({ page }) => {
  await useLocalFixtures(page, true);
  const work = crypto.randomUUID();
  let account = "first";
  const joined = ["Design", "Research"].map((name) => ({ id: crypto.randomUUID(), name, role: "viewer", createdAt: "" }));
  const orders = new Map<string, string[]>();
  let failNextSave = true;
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { user: { id: account, email: `${account}@example.test` }, expiresAt: null } }));
  await page.route("**/api/workspaces", (route) => route.fulfill({ json: [{ id: work, name: "Work", role: "owner", createdAt: "" }, ...joined] }));
  await page.route("**/api/workspaces/order", (route) => {
    expect(route.request().headers()["x-loomind-owner"]).toBe(account);
    if (route.request().method() === "PUT") {
      if (failNextSave) { failNextSave = false; return route.fulfill({ status: 503, json: { error: "Could not save order" } }); }
      orders.set(account, route.request().postDataJSON());
    }
    return route.fulfill({ json: orders.get(account) ?? [] });
  });
  const sidebar = page.locator("#lm-workspace-sidebar");
  const names = sidebar.locator(".lm-space-list > .lm-space-group > .lm-space-row .lm-space-name");
  const open = () => page.getByRole("button", { name: "Open sidebar" }).tap();
  const reorder = sidebar.getByRole("button", { name: "Reorder workspaces" });
  const dialog = page.getByRole("dialog", { name: "Reorder workspaces" });
  await page.goto("/app");
  await open();
  await expect(names).toHaveText(["Personal", "Shared", "Work"]);
  await expectTouchTarget(reorder);
  await reorder.tap();
  await dialog.getByRole("button", { name: "Move Work up" }).tap();
  await dialog.getByRole("button", { name: "Cancel" }).tap();
  await expect(names).toHaveText(["Personal", "Shared", "Work"]);
  await reorder.tap();
  await expectTouchTarget(dialog.getByRole("button", { name: "Move Shared up" }));
  await dialog.getByRole("button", { name: "Move Shared up" }).press("Enter");
  await dialog.getByRole("button", { name: "Move Research up" }).tap();
  await dialog.getByRole("button", { name: "Save order" }).tap();
  await expect(dialog.getByRole("alert")).toHaveText("Could not save order");
  await dialog.getByRole("button", { name: "Save order" }).tap();
  await expect(dialog).toBeHidden();
  await expect(names).toHaveText(["Shared", "Personal", "Work"]);
  await page.reload();
  await open();
  await expect(names).toHaveText(["Shared", "Personal", "Work"]);
  await sidebar.getByRole("button", { name: "Toggle mind maps in Shared" }).tap();
  await expect(sidebar.locator(".lm-space-maps .lm-space-name")).toHaveText(["Research", "Design"]);
  account = "second";
  await page.reload();
  await open();
  await expect(names).toHaveText(["Personal", "Shared", "Work"]);
});

test("indented outline siblings retain their levels from preview through a local reopen", async ({ page }) => {
  await useLocalFixtures(page, true);
  await page.goto("/app/create?mode=outline");
  await page.locator("#lm-outline-input").fill("Launch\n  - Pricing\n    - Costs\n  - Timeline");
  await expect(page.getByText("4 nodes · 2 top-level branches", { exact: true })).toBeVisible();
  await expect(page.locator(".lm-outline-tree > ul > li > span")).toHaveText(["Pricing", "Timeline"]);
  await expect(page.locator(".lm-outline-tree li li > span")).toHaveText(["Costs"]);
  await page.getByRole("button", { name: "Create Map" }).tap();
  const checkLevels = async () => {
    const canvas = page.getByRole("application");
    await expect(canvas.getByRole("treeitem", { name: /^Pricing,/ })).toHaveAttribute("aria-level", "2");
    await expect(canvas.getByRole("treeitem", { name: /^Timeline,/ })).toHaveAttribute("aria-level", "2");
    await expect(canvas.getByRole("treeitem", { name: /^Costs,/ })).toHaveAttribute("aria-level", "3");
  };
  await checkLevels();
  await page.reload();
  await checkLevels();
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
