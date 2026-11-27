import { chromium, expect, webkit, type Page } from "@playwright/test";
import { cloudBrowser, test } from "./cloud-worker.js";

test.use({ ...cloudBrowser, isMobile: false, hasTouch: false, viewport: { width: 1280, height: 800 } });

function topic(page: Page, title: string) {
  return page.getByRole("application").getByRole("treeitem").filter({ hasText: title });
}

test("public and invited viewers follow saved edits; revoking the public link keeps the member's access", async ({ browser, browserName, context, cloud }) => {
  test.setTimeout(120_000);
  const writer = await cloud.openPage(context, "author");
  await writer.goto(`${cloud.origin}/app`);
  await writer.locator("#lm-home-prompt").fill("Review brief\n  - First proposal");
  const created = writer.waitForResponse((response) => response.request().method() === "PUT" && /\/api\/mindmaps\/[^/]+$/.test(response.url()));
  await writer.getByRole("button", { name: "Create from Outline" }).click();
  expect((await created).status()).toBe(200);
  await expect(topic(writer, "First proposal")).toBeVisible();
  await writer.getByTitle("New sheet").click();
  const firstSheet = writer.locator("footer").getByText("Review brief", { exact: true });
  const twoSheets = writer.waitForResponse((response) => {
    if (response.request().method() !== "PUT" || !/\/api\/mindmaps\/[^/]+$/.test(response.url())) return false;
    const doc = response.request().postDataJSON();
    return doc.sheets.length === 2 && doc.activeSheetId === doc.sheets[0].id;
  });
  await firstSheet.click();
  expect((await twoSheets).status()).toBe(200);

  const sharing = writer.getByRole("dialog", { name: "Share Mind Map" });
  const share = writer.getByRole("button", { name: "Share", exact: true });
  await share.click();
  await sharing.getByRole("button", { name: "Enable read-only link" }).click();
  const address = sharing.locator("#lm-public-url");
  await expect(address).toBeVisible();
  const link = await address.inputValue();
  const mapId = writer.url().split("/").at(-1);
  expect(new URL(link).pathname).toBe(`/view/${mapId}`);
  expect(new URL(link).hash.length).toBeGreaterThan(1);
  await sharing.getByRole("button", { name: /^Can view/i }).click();
  await sharing.getByRole("button", { name: "Create Invite Link" }).click();
  const invitation = await sharing.locator("#lm-share-url").inputValue();
  await sharing.getByRole("button", { name: "Close" }).click();
  await share.click();
  await expect(address).toHaveValue(link);
  if (browserName === "chromium") await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: cloud.origin });
  const copy = sharing.getByRole("button", { name: "Copy read-only link" });
  await copy.click();
  if (browserName === "chromium") expect(await writer.evaluate(() => navigator.clipboard.readText())).toBe(link);
  else await expect.poll(async () => await copy.locator(".lucide-check").count() === 1 || await address.evaluate((input: HTMLInputElement) =>
    document.activeElement === input && input.selectionStart === 0 && input.selectionEnd === input.value.length)).toBe(true);
  await sharing.getByRole("button", { name: "Close" }).click();

  const memberContext = await browser.newContext(cloudBrowser);
  const guestBrowser = await (browserName === "chromium" ? webkit : chromium).launch();
  try {
    const member = await cloud.openPage(memberContext, "reviewer");
    await member.goto(invitation);
    await member.getByRole("button", { name: "Accept invite" }).click();
    await expect(topic(member, "First proposal")).toBeVisible();
    const guestContext = await guestBrowser.newContext(cloudBrowser);
    const guest = await cloud.openPage(guestContext);
    expect(await guestContext.cookies()).toHaveLength(0);
    await guest.goto(link);
    await guest.bringToFront();
    const guestTopic = topic(guest, "First proposal");
    await expect(guestTopic).toBeVisible();
    await guestTopic.dblclick();
    await expect(guest.locator(".ProseMirror[contenteditable=true]")).toHaveCount(0);
    await expect(guest.getByTitle("New sheet")).toHaveCount(0);
    await expect(guest.getByTitle("Drag to resize width")).toHaveCount(0);
    const guestSheets = guest.locator("footer");
    await guestSheets.getByText("Sheet 2", { exact: true }).click();
    await expect(topic(guest, "Sheet 2")).toBeInViewport();
    await guestSheets.getByText("Review brief", { exact: true }).click();
    const guestRoot = topic(guest, "Review brief");
    await guestRoot.getByRole("button", { name: "Collapse branch" }).click();
    await expect(guestTopic).toHaveCount(0);
    await guestRoot.getByRole("button", { name: "Expand branch" }).click();
    await expect(guestTopic).toBeVisible();
    await expect(guest.getByRole("button", { name: /^(Format|History|Share)$/ })).toHaveCount(0);
    await expect(guest.getByTitle("Toggle AI Chat Panel (⌘J)")).toHaveCount(0);
    await test.step("Check that the visible reader issues conditional reads", async () => {
      await expect.poll(() => guest.evaluate(() => document.visibilityState)).toBe("visible");
      const request = await guest.waitForRequest((request) => request.url().endsWith(`/api/public-maps/${mapId}`) && Boolean(request.headers()["if-none-match"]), { timeout: 20_000 });
      expect(await request.headerValue("If-None-Match")).toMatch(/^"\d+"$/);
    });

    await topic(writer, "First proposal").dblclick();
    const editor = writer.locator(".ProseMirror[contenteditable=true]");
    await editor.fill("Reviewed proposal");
    const saved = writer.waitForResponse((response) => response.request().method() === "PUT" && response.url().endsWith(`/api/mindmaps/${mapId}`));
    await editor.press("Enter");
    expect((await saved).status()).toBe(200);
    await expect(topic(guest, "Reviewed proposal")).toBeVisible({ timeout: 20_000 });
    await expect(topic(member, "Reviewed proposal")).toBeVisible({ timeout: 20_000 });

    await share.click();
    writer.once("dialog", (dialog) => dialog.accept());
    await sharing.getByRole("button", { name: "Revoke read-only link" }).click();
    await expect(sharing.getByRole("button", { name: "Enable read-only link" })).toBeVisible();
    await expect(guest.getByRole("heading", { name: "Cannot open shared map" })).toBeVisible({ timeout: 20_000 });
    await expect(guest.getByRole("application")).toHaveCount(0);
    const freshGuest = await cloud.openPage(await guestBrowser.newContext(cloudBrowser));
    await test.step("Check a cold anonymous visit after revocation", async () => {
      const denied = freshGuest.waitForResponse((response) => response.url().endsWith(`/api/public-maps/${mapId}`), { timeout: 20_000 });
      await freshGuest.bringToFront();
      await freshGuest.goto(link);
      expect((await denied).status()).toBe(404);
      await expect(freshGuest.getByRole("heading", { name: "Cannot open shared map" })).toBeVisible({ timeout: 15_000 });
    });
    await member.bringToFront();
    await member.reload();
    await expect(topic(member, "Reviewed proposal")).toBeVisible();
    await expect(member.getByRole("button", { name: "Format", exact: true })).toHaveCount(0);
  } finally { await guestBrowser.close(); await memberContext.close(); }
});
