import { expect, test } from "@playwright/test";

test("edits the selected topic in AI Chat with or without a written instruction", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route("https://fonts.googleapis.com/**", route => route.fulfill({ contentType: "text/css", body: "" }));
  await page.route("**/api/auth/session", route => route.fulfill({ json: { user: null, expiresAt: null } }));
  await page.route("**/api/ai/config?*", route => route.fulfill({ json: {
    tier: "free", available: true, isMock: true, providerLabel: "Test fixture", modelLabel: "Fixture", dailyLimit: 3, remainingToday: 3, requiresLogin: false,
  } }));
  const question = "请用法语画出水的三态";
  const title = "États de l’eau";
  const mapSummary = "Voici les trois états de l’eau.";
  const nodeSummary = "Un exemple a été ajouté.";
  const instruction = "请用日语展开这个节点";
  const japaneseSummary = "例を追加しました。";
  let streamRequests = 0;
  await page.route("**/api/ai/stream", route => {
    streamRequests++;
    const { intent, targetTopicId, prompt } = route.request().postDataJSON();
    const item = { title: prompt === instruction ? "氷" : "Glace" };
    const events = intent === "generate_map"
      ? [["map_patch", { partial: { root: { title, children: ["Solide", "Liquide", "Gaz"].map(title => ({ title })) } } }], ["done", { summary: mapSummary, appliedCount: 3 }]]
      : [["commands", { ops: [{ kind: "addChildren", targetTopicId, items: [item] }] }], ["done", { summary: prompt === instruction ? japaneseSummary : nodeSummary, appliedCount: 1 }]];
    return route.fulfill({ contentType: "text/event-stream", body: events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join("") });
  });

  await page.goto("/try");
  const chat = page.getByRole("complementary", { name: "AI Chat Assistant" });
  const composer = chat.getByRole("textbox");
  await composer.fill(question);
  const writtenRequest = page.waitForRequest("**/api/ai/stream");
  await chat.getByRole("button", { name: "Send" }).click();
  expect((await writtenRequest).postDataJSON()).toMatchObject({ intent: "generate_map", prompt: question, locale: "en" });
  await expect(chat.getByText(mapSummary, { exact: true }).first()).toBeVisible();

  await page.keyboard.press("Control+j");
  await expect(chat).toBeHidden();
  await page.keyboard.press("Control+Shift+J");
  await expect(chat).toBeHidden();
  await expect(page.getByPlaceholder("Enter AI command for this node and press Enter…")).toHaveCount(0);

  const topic = page.getByRole("treeitem", { name: /^Solide,/ });
  const targetTopicId = await topic.getAttribute("data-topic-id");
  const askInChat = page.getByRole("button", { name: "Ask about this topic in AI Chat" });
  await page.getByTitle("Zen Mode").click();
  await topic.click({ button: "right" });
  await askInChat.click();
  await expect(composer).toBeFocused();
  await expect(composer).toHaveAttribute("placeholder", 'Ask AI about "Solide"…');
  expect(streamRequests).toBe(1);

  const topicActions = chat.getByRole("button", { name: "Topic actions" });
  const expand = page.getByRole("dialog", { name: "Topic actions" }).getByRole("button", { name: "Expand", exact: true });
  await topicActions.click();
  const shortcutRequest = page.waitForRequest("**/api/ai/stream");
  await expand.click();
  expect((await shortcutRequest).postDataJSON()).toMatchObject({ intent: "expand", targetTopicId, prompt: "", context: { outline: { title } } });
  await expect(chat.getByText(nodeSummary, { exact: true }).first()).toBeVisible();

  await composer.fill(instruction);
  await chat.getByRole("button", { name: "Switch to full map context" }).click();
  await expect(topicActions).toHaveCount(0);
  await topic.click({ button: "right" });
  await askInChat.click();
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue(instruction);
  await topicActions.click();
  const instructedShortcut = page.waitForRequest("**/api/ai/stream");
  await expand.click();
  expect((await instructedShortcut).postDataJSON()).toMatchObject({ intent: "expand", targetTopicId, prompt: instruction });
  await expect(chat.getByText(japaneseSummary, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("treeitem", { name: /^氷,/ })).toBeVisible();
  expect(streamRequests).toBe(3);
});
