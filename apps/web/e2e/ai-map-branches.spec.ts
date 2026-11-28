import { randomUUID } from "node:crypto";
import { createDocument, createSheet, createTopic, validateDocumentInvariants } from "@mindmap/core/model";
import { LoroSyncAdapter } from "@mindmap/core/loro";
import { expect, type Page } from "@playwright/test";
import { cloudBrowser, test } from "./cloud-worker.js";

const rootTitle = "GitHub Copilot CLI 整体架构";
const titles = ["产品边界", "终端入口与会话上下文", "代理编排与模型服务", "工具执行与权限边界", "配置与扩展", "端到端示例"];
const branches = titles.map((title) => ({ title, children: [{ title: `${title}说明` }] }));
test.use({ ...cloudBrowser, isMobile: false, hasTouch: false, viewport: { width: 1600, height: 1100 } });

async function checkCanvas(page: Page) {
  const canvas = page.getByRole("application");
  await expect(canvas.getByRole("treeitem")).toHaveCount(1 + titles.length * 2);
  for (const title of [rootTitle, ...branches.flatMap((branch) => [branch.title, branch.children[0].title])]) {
    await expect(canvas.getByRole("treeitem", { name: new RegExp(`^${title},`) })).toBeVisible();
  }
  await expect(canvas.locator('[data-layer="tree-edges"] > path')).toHaveCount(titles.length * 2);
  await expect.poll(() => canvas.evaluate((element) => {
    const root = element.querySelector('[aria-level="1"]')!.getBoundingClientRect();
    return [...element.querySelectorAll('[aria-level="2"]')].filter((card) => card.getBoundingClientRect().right <= root.left + 1).length;
  })).toBe(3);
}

async function seedOldWriterDraft(page: Page, mapId: string) {
  return page.evaluate((id) => new Promise<number>((resolve, reject) => {
    const open = indexedDB.open("loomind-db", 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction("docs", "readwrite");
      let changed = 0;
      const scan = tx.objectStore("docs").openCursor();
      scan.onsuccess = () => {
        const row = scan.result;
        if (!row) return;
        const draft = row.value;
        if (draft.kind === "draft" && draft.mapId === id && draft.history) {
          delete draft.history;
          delete draft.fingerprint;
          const root = draft.document.sheets[0].rootTopic;
          root.children = root.children.flatMap((child: unknown) => [child, structuredClone(child)]);
          row.update(draft);
          changed++;
        }
        row.continue();
      };
      tx.oncomplete = () => { db.close(); resolve(changed); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), mapId);
}

const cases = {
  regenerate: "regenerating a saved bilateral map replaces its branches and lines, including after reopening",
  pending: "reopening a pending AI map keeps acknowledged branch identities when its collaboration frames replay",
  legacy: "a pre-fix JSON draft with duplicated branches reopens against its original published updates",
};
for (const [mode, description] of Object.entries(cases)) test(description, async ({ cloud, context, browser }) => {
  test.setTimeout(60_000);
  const recover = mode !== "regenerate";
  const page = await cloud.openPage(context, "map-author");
  const mapId = randomUUID();
  const url = `${cloud.origin}/app/mindmaps/${mapId}`;
  const api = `${cloud.origin}/api/mindmaps/${mapId}`;
  const headers = { "X-Loomind-Owner": "map-author", Origin: cloud.origin };
  const original = createDocument([createSheet("sheet", "Architecture", createTopic("root", rootTitle, {
    children: recover ? [] : titles.map((title, index) => createTopic(`old-${index}`, title)),
  }))]);
  expect((await page.request.put(api, { data: original, headers: { ...headers, "If-Match": '"0"' } })).status()).toBe(200);
  await page.route("**/api/ai/stream", (route) => {
    const events = [branches.slice(0, 2), branches, branches].map((children) =>
      `event: map_patch\ndata: ${JSON.stringify({ partial: { root: { title: rootTitle, children } } })}\n\n`);
    return route.fulfill({ contentType: "text/event-stream", body: events.join("") + 'event: done\ndata: {"summary":"Fixture complete","appliedCount":1}\n\n' });
  });
  await page.goto(url);
  const synced = page.getByRole("button", { name: "Synced", exact: true });
  await expect(synced).toBeVisible();
  let hold = recover;
  await page.route(api, (route) => hold && route.request().method() === "PUT" ? route.abort("internetdisconnected") : route.continue());
  const chat = page.getByRole("complementary", { name: "AI Chat Assistant" });
  if (!await chat.isVisible()) await page.getByTitle("Toggle AI Chat Panel (⌘J)").click();
  await chat.getByRole("textbox").fill("Draw this map again");
  const pendingWrite = recover ? page.waitForRequest((req) => req.url() === api && req.method() === "PUT") : undefined;
  const published = recover ? page.waitForResponse((response) => response.url() === api + "/collab" && response.request().method() === "POST"
    && !!response.request().postDataJSON().updateB64 && response.ok()) : undefined;
  await chat.getByRole("button", { name: "Send" }).click();
  await expect(chat.getByText("Fixture complete", { exact: true }).first()).toBeVisible();
  await checkCanvas(page);
  if (recover) {
    await Promise.all([pendingWrite, published]);
    const baseline = await (await page.request.get(api, { headers: { ...headers, "X-Loomind-Checkpoint": "1" } })).json();
    expect(baseline.document.sheets[0].rootTopic.children).toHaveLength(0);
    const replica = LoroSyncAdapter.fromSnapshot(Buffer.from(baseline.checkpoint.snapshot, "base64"));
    let cursor = baseline.checkpoint.cursor;
    await expect.poll(async () => {
      const reply = await page.request.get(`${api}/collab?since=${cursor}`, { headers: { ...headers, "X-Loomind-Room": baseline.checkpoint.room } });
      for (const entry of (await reply.json()).updates) {
        expect(replica.importUpdates(Buffer.from(entry.updateB64, "base64"))).toBe(true);
        cursor = entry.seq;
      }
      return replica.getDocument().sheets[0].rootTopic.children.flatMap((child) => child.children).length;
    }, { timeout: 12_000 }).toBe(titles.length);
    if (mode === "legacy") expect(await seedOldWriterDraft(page, mapId)).toBeGreaterThan(0);
    hold = false;
    const caughtUp = page.waitForRequest((req) => req.url().startsWith(api + "/collab?since=") && Number(new URL(req.url()).searchParams.get("since")) > 0);
    const replay = page.waitForResponse((response) => response.url().startsWith(api + "/collab?since=") && response.ok());
    await page.reload();
    expect((await (await replay).json()).updates.length).toBeGreaterThan(0);
    await caughtUp;
    await checkCanvas(page);
  }
  await expect(synced).toBeVisible();
  const { document } = await (await page.request.get(api, { headers })).json();
  expect(validateDocumentInvariants(document)).toEqual([]);
  expect(document.sheets[0].rootTopic.children).toHaveLength(titles.length);
  expect(document.sheets[0].rootTopic.children.map((topic: { id: string }) => topic.id)).not.toContain("old-0");
  const freshContext = await browser.newContext({ ...cloudBrowser, viewport: { width: 1600, height: 1100 } });
  try {
    const fresh = await cloud.openPage(freshContext, "map-author");
    await fresh.goto(url);
    await expect(fresh.getByRole("button", { name: "Synced", exact: true })).toBeVisible();
    await checkCanvas(fresh);
  } finally { await freshContext.close(); }
});
