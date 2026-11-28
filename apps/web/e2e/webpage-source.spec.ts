import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { createServer as createSocket, type AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test as base } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { unstable_dev } from "wrangler";
import { cloudBrowser, cloudPages } from "./cloud-worker.js";

const first = "The field team confirmed the launch date.";
const second = "预算通过：A & B。";
const bulletin = `<!doctype html><html><head><title>Field bulletin</title></head><body><nav><p>Navigation copy</p></nav><main><p>Promoted content outside the article</p><article><h1>Field bulletin</h1><p>The field team <em>confirmed</em> the launch date.</p><aside><p>Advertisement</p></aside><p>预算通过：A &amp; B。</p><p hidden>Hidden words</p><script src="/not-content.js"></script></article></main><footer><p>Footer copy</p></footer></body></html>`;
type Publisher = { origin: string; reads: { path: string; cookie?: string; authorization?: string }[] };
const test = base.extend<{ publisher: Publisher; cloud: ReturnType<typeof cloudPages> }>({
  publisher: async ({}, use) => {
    const reads: Publisher["reads"] = [];
    const server = createServer((request, response) => {
      const path = request.url!;
      reads.push({ path, cookie: request.headers.cookie, authorization: request.headers.authorization });
      if (path === "/bulletin" || path === "/other-publisher") {
        response.writeHead(302, { Location: path === "/bulletin" ? "/news/evidence" : "https://unlisted.example.invalid/article" }).end(); return;
      }
      if (path === "/document") { response.writeHead(200, { "Content-Type": "application/pdf" }).end("Not HTML"); return; }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      if (path === "/large") { response.write(" ".repeat(600_000)); response.end(" ".repeat(600_000)); return; }
      response.end(path === "/news/evidence" ? bulletin : path === "/long" ? `<article>${"<p>Evidence.</p>".repeat(81)}</article>` : "<html><body><p>Publisher promotions</p><main><nav><p>Only navigation</p></nav></main></body></html>");
    });
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    try { await use({ origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, reads }); }
    finally { await new Promise<void>((done, reject) => { server.close((error) => error ? reject(error) : done()); server.closeAllConnections(); }); }
  },
  cloud: async ({ publisher }, use, testInfo) => {
    const config = fileURLToPath(new URL("./wrangler.jsonc", import.meta.url));
    await mkdir(testInfo.project.outputDir, { recursive: true });
    const persistTo = await mkdtemp(join(testInfo.project.outputDir, "web-"));
    await promisify(execFile)(process.execPath, [fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url)), "d1", "migrations", "apply", "DB", "--local", "--config", config, "--persist-to", persistTo]);
    const socket = createSocket(); await new Promise<void>((ready) => socket.listen(0, "127.0.0.1", ready));
    const port = (socket.address() as AddressInfo).port; await new Promise<void>((done) => socket.close(() => done()));
    const url = new URL(`https://127.0.0.1:${port}`), secret = randomBytes(32).toString("hex");
    // Native workerd exposes each redirect; createTestHarness's Node transport follows it before the Worker sees it.
    const worker = await unstable_dev(fileURLToPath(new URL("../worker/auth.ts", import.meta.url)), {
      config, ip: url.hostname, port, local: true, localProtocol: "https", inspect: false, logLevel: "error", persist: true, persistTo,
      vars: { AUTH_ORIGIN: url.origin, SESSION_SECRET: secret, SOURCE_WEB_ORIGINS: publisher.origin },
      experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false },
    });
    try { await use(cloudPages(url, secret)); } finally { await worker.stop(); }
  },
});

const desktop = { ...cloudBrowser, isMobile: false, hasTouch: false, viewport: { width: 1280, height: 800 } };
test.use(desktop);
test.describe.configure({ timeout: 90_000 });

test("previews a webpage's source but reopens and exports only its text", async ({ browser, context, cloud, publisher }, testInfo) => {
  const author = await cloud.openPage(context, "web-reader");
  const browserFetches: string[] = [];
  author.on("request", (request) => { if (request.url().startsWith(publisher.origin)) browserFetches.push(request.url()); });
  await author.goto(`${cloud.origin}/app`);
  await author.getByRole("button", { name: "Add attachments" }).click();
  await author.getByRole("button", { name: "Import webpage" }).click();
  await expect(author.getByText(`Supported sources: ${new URL(publisher.origin).host}`)).toBeVisible();
  const address = author.getByLabel("Webpage URL"), read = author.getByRole("button", { name: "Read webpage", exact: true });
  const create = author.getByRole("button", { name: "Create map", exact: true });
  await address.fill(`${publisher.origin}/bulletin`);
  expect(publisher.reads).toEqual([]); await expect(create).toBeDisabled();
  await read.click();
  const details = author.locator("details");
  await expect(details).toHaveCount(2);
  await expect(author.getByRole("status")).toContainText(`Field bulletin · Read from: ${publisher.origin}/news/evidence`);
  await expect(details.nth(1).locator("summary")).toContainText("Paragraph 2");
  await details.nth(1).locator("summary").click();
  await expect(details.nth(1).locator("p")).toHaveText(second);
  await address.fill(`${publisher.origin}/empty`); await expect(create).toBeDisabled(); await read.click();
  await expect(author.getByRole("alert")).toContainText("No readable paragraphs"); await expect(details).toHaveCount(0);
  await address.fill(`${publisher.origin}/bulletin`); await read.click();
  await expect(details).toHaveCount(2); expect(browserFetches).toEqual([]);
  expect(publisher.reads.map((entry) => entry.path)).toEqual(["/bulletin", "/news/evidence", "/empty", "/bulletin", "/news/evidence"]);
  expect(publisher.reads.every((entry) => !entry.cookie && !entry.authorization)).toBe(true);
  await author.getByRole("button", { name: "Add to composer" }).click();
  await expect(author.locator("#lm-home-prompt")).toBeEmpty();
  const saving = author.waitForResponse((response) => response.request().method() === "PUT" && /\/api\/mindmaps\/[^/]+$/.test(response.url()));
  await create.click(); const saved = await saving; expect(saved.status()).toBe(200);
  const stored = await author.request.get(saved.url(), { headers: { "X-Loomind-Owner": "web-reader" } });
  expect(stored.status()).toBe(200);
  const document = (await stored.json()).document;
  const topics = document.sheets[0].rootTopic.children;
  expect(topics).toHaveLength(2); expect(topics[0].note.text).toBe(first); expect(topics[1].note.text).toBe(second);
  expect(JSON.stringify(document)).not.toContain(publisher.origin);
  expect(JSON.stringify(document)).not.toMatch(/Field bulletin|Paragraph [12]|"paragraph"\s*:|"href"\s*:/);
  const fresh = await browser.newContext(desktop);
  try {
    const reader = await cloud.openPage(fresh, "web-reader"); await reader.goto(author.url());
    const canvas = reader.getByRole("application"); await expect(canvas.getByTitle(first, { exact: true })).toHaveCount(1);
    await canvas.getByText(second, { exact: true }).dblclick();
    const field = reader.locator(".ProseMirror[contenteditable=true]"); await expect(field).toBeFocused();
    await field.press("ControlOrMeta+a"); await field.press("Backspace"); await expect(field).toHaveText("");
    await reader.keyboard.insertText("Confirmed launch"); await expect(field).toHaveText("Confirmed launch");
    const updating = reader.waitForResponse((response) => response.url() === saved.url() && response.request().method() === "PUT" && JSON.stringify(response.request().postDataJSON().sheets ?? []).includes('"text":"Confirmed launch"'));
    await field.press("Enter"); expect((await updating).status()).toBe(200);
    await reader.getByRole("button", { name: "Export", exact: true }).click(); const downloading = reader.waitForEvent("download");
    await reader.getByRole("dialog", { name: "Import & Export" }).getByRole("button", { name: /Pitch Slides/ }).click();
    const path = testInfo.outputPath("web-evidence.pptx"); await (await downloading).saveAs(path);
    const files = Object.entries(unzipSync(await readFile(path)));
    expect(files.some(([name, bytes]) => /^ppt\/slides\/slide\d+\.xml$/.test(name) && strFromU8(bytes).includes("Confirmed launch"))).toBe(true);
    const notes = files.filter(([name]) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name)).map(([, bytes]) => strFromU8(bytes));
    expect(notes.some((note) => note.includes(first))).toBe(true);
    expect(notes.some((note) => note.includes("预算通过：A &amp; B。"))).toBe(true);
    for (const [name, bytes] of files) if (/\.(xml|rels)$/.test(name)) {
      expect(strFromU8(bytes)).not.toContain(publisher.origin); expect(strFromU8(bytes)).not.toMatch(/Field bulletin|Paragraph [12]/);
    }
  } finally { await fresh.close(); }
});

test("only reads supported HTML on request and reports omissions and incompatible sources", async ({ context, cloud, publisher }) => {
  const api = `${cloud.origin}/api/sources/webpage`;
  const read = (path: string, origin = cloud.origin) => context.request.post(api, { headers: { Origin: origin }, data: { url: `${publisher.origin}${path}` } });
  expect((await read("/bulletin")).status()).toBe(401);
  await cloud.openPage(context, "publisher-checks");
  expect((await read("/bulletin", "https://other.example.test")).status()).toBe(403);
  expect(publisher.reads).toEqual([]);
  const redirect = await read("/other-publisher"); expect(redirect.status()).toBe(422); expect(await redirect.json()).toEqual({ error: "publisher" });
  expect((await read("/document")).status()).toBe(415); expect((await read("/large")).status()).toBe(413);
  const long = await read("/long"); expect(long.status()).toBe(200);
  const preview = await long.json(); expect(preview.truncated).toBe(true); expect(preview.paragraphs).toHaveLength(80);
});
