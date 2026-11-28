import { expect, type Page } from "@playwright/test";
import { cloudBrowser, test } from "./cloud-worker.js";

test.use({ ...cloudBrowser, isMobile: false, hasTouch: false, viewport: { width: 1280, height: 800 } });

function topic(page: Page, title: string) {
  return page.getByRole("treeitem").filter({ has: page.getByText(title, { exact: true }) });
}

test("member node reviews survive renames and deletion without granting map edits or exposing discussions to outsiders", async ({ browser, context, cloud }) => {
  test.setTimeout(120_000);
  const writer = await cloud.openPage(context, "review-owner");
  await writer.goto(`${cloud.origin}/app`);
  await writer.locator("#lm-home-prompt").fill("# Launch review\n- Pricing\n- Timeline");
  const saved = () => writer.waitForResponse((response) => response.request().method() === "PUT" && /\/api\/mindmaps\/[^/]+$/.test(response.url()));
  const created = saved();
  await writer.getByRole("button", { name: "Create from Outline" }).click();
  expect((await created).status()).toBe(200);
  await expect(topic(writer, "Pricing")).toBeVisible();

  await writer.getByRole("button", { name: "Share", exact: true }).click();
  const sharing = writer.getByRole("dialog", { name: "Share Mind Map" });
  const commentsUrl = `${cloud.origin}/api/mindmaps/${new URL(writer.url()).pathname.split("/").at(-1)}/comments`;
  await sharing.getByRole("button", { name: /^Can view/i }).click();
  await sharing.getByRole("button", { name: "Create Invite Link" }).click();
  const invitation = await sharing.locator("#lm-share-url").inputValue();
  await sharing.getByRole("button", { name: "Close" }).click();

  const memberContext = await browser.newContext({ ...cloudBrowser, locale: "zh-CN", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const publicContext = await browser.newContext(cloudBrowser);
  const question = "Can we confirm the price with Finance?";
  const answer = "Finance confirmed the figure.";
  try {
    const member = await cloud.openPage(memberContext, "invited-reviewer");
    await member.goto(invitation);
    await member.getByRole("button", { name: "接受邀请" }).click();
    await topic(member, "Pricing").click();
    const memberButton = member.getByRole("button", { name: "节点评论" });
    await memberButton.click();
    const reader = member.getByRole("dialog", { name: "节点评论" });
    await expect(reader.getByText(/只有所有者允许后/)).toBeVisible();
    await expect(reader.getByRole("textbox")).toHaveCount(0);
    await expect(reader.getByRole("checkbox")).toHaveCount(0);
    expect(await reader.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

    const ownerButton = writer.getByRole("button", { name: "Node comments" });
    const owner = writer.getByRole("dialog", { name: "Node comments" });
    await ownerButton.click();
    const policy = owner.getByRole("checkbox", { name: "Allow viewers to comment" });
    await expect(policy).not.toBeChecked();
    await policy.click();
    await expect(policy).toBeChecked();
    await reader.getByRole("button", { name: "刷新讨论" }).click();
    await expect(reader.getByText("当前节点：Pricing")).toBeVisible();
    await reader.getByRole("textbox", { name: "新评论" }).fill(question);
    await reader.getByRole("button", { name: "发起讨论" }).click();
    await expect(reader.getByText(question, { exact: true })).toBeVisible();
    await expect(reader.getByText("invited-reviewer@example.test", { exact: false })).toBeVisible();
    await expect(reader.getByRole("button", { name: "标为已解决" })).toHaveCount(0);
    await reader.getByRole("button", { name: "聚焦此节点" }).click();
    await expect(topic(member, "Pricing")).toHaveAttribute("aria-selected", "true");
    await expect(topic(member, "Pricing")).toBeInViewport();
    await topic(member, "Pricing").dblclick();
    await expect(member.locator(".ProseMirror[contenteditable=true]")).toHaveCount(0);

    await owner.getByRole("button", { name: "Refresh discussions" }).click();
    await owner.getByRole("button").filter({ hasText: question }).click();
    await owner.getByRole("textbox", { name: "Reply" }).fill(answer);
    await owner.getByRole("button", { name: "Post reply" }).click();
    await expect(owner.getByText(answer, { exact: true })).toBeVisible();
    await owner.getByRole("button", { name: "Resolve discussion" }).click();
    await expect(owner.getByText("Resolved by review-owner@example.test")).toBeVisible();
    await owner.getByRole("button", { name: "Reopen discussion" }).click();
    await expect(owner.getByRole("textbox", { name: "Reply" })).toBeVisible();
    await owner.getByRole("button", { name: "Resolve discussion" }).click();
    await expect(owner.getByRole("button", { name: "Reopen discussion" })).toBeVisible();
    await owner.getByRole("button", { name: "Back" }).click();
    await policy.click();
    await expect(policy).not.toBeChecked();
    await owner.getByRole("button", { name: "Close" }).click();

    async function rename(previous: string, next: string) {
      await topic(writer, previous).dblclick();
      const field = writer.locator(".ProseMirror[contenteditable=true]");
      await expect(field).toBeFocused();
      await field.press("ControlOrMeta+a");
      await field.press("Backspace");
      await expect(field).toHaveText("");
      await writer.keyboard.insertText(next);
      await expect(field).toHaveText(next);
      const update = saved();
      await field.press("Enter");
      expect((await update).status()).toBe(200);
    }
    await rename("Pricing", "Budget");
    await rename("Timeline", "Pricing");
    await ownerButton.click();
    const row = owner.getByRole("button").filter({ hasText: question });
    await expect(row).toContainText("Launch review · Budget");
    await owner.getByRole("button", { name: "Close" }).click();
    await topic(writer, "Budget").click();
    const deleted = saved();
    await writer.keyboard.press("Delete");
    expect((await deleted).status()).toBe(200);
    await expect(topic(writer, "Budget")).toHaveCount(0);

    await member.bringToFront();
    await member.reload();
    await expect(topic(member, "Pricing")).toBeVisible();
    await memberButton.click();
    await expect(reader.getByText(/只有所有者允许后/)).toBeVisible();
    const old = reader.getByRole("button").filter({ hasText: question });
    await expect(old).toContainText("Pricing · 节点已移除");
    await old.click();
    await expect(reader.getByText(answer, { exact: true })).toBeVisible();
    await expect(reader.getByText("由 review-owner@example.test 解决")).toBeVisible();
    await expect(reader.getByRole("textbox")).toHaveCount(0);
    await expect(reader.getByRole("button", { name: "聚焦此节点" })).toHaveCount(0);

    const guest = await cloud.openPage(publicContext);
    let reviewReads = 0;
    guest.on("request", (request) => { if (/\/comments(?:[/?]|$)/.test(new URL(request.url()).pathname)) reviewReads++; });
    await guest.goto(`${cloud.origin}/try`);
    await expect(guest.getByRole("application")).toBeVisible();
    await expect(guest.getByRole("button", { name: "Node comments" })).toHaveCount(0);
    await expect(guest.getByText(question, { exact: true })).toHaveCount(0);
    expect(reviewReads).toBe(0);
    expect((await guest.request.get(commentsUrl)).status()).toBe(401);
    const outsider = await cloud.openPage(publicContext, "uninvited");
    expect((await outsider.request.get(commentsUrl, { headers: { "X-Loomind-Owner": "uninvited" } })).status()).toBe(404);
  } finally { await memberContext.close(); await publicContext.close(); }
});
