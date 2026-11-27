import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { getPlatformProxy, unstable_readConfig, type PlatformProxy } from "wrangler";
import { createRichText, getTemplate } from "@mindmap/core";
import { LoroSyncAdapter } from "@mindmap/core/loro";
import worker from "../worker/auth.js";
import { DRAFT_LIMIT, LIVE_HEADER, OWNER_HEADER, type LiveCheckpoint } from "../src/drafts/shared.js";

const origin = "https://loomind.test";
const client = "unit-test.apps.googleusercontent.com";
const tokenKey = await generateKeyPair("RS256");
const publicKey = { ...await exportJWK(tokenKey.publicKey), alg: "RS256", kid: "fixture" };
let platform: PlatformProxy<Env>;
let env: Env;
const used = new Set<string>();

async function request(path: string, method = "GET", cookie = "", body?: unknown, headers?: Record<string, string>) {
  return worker.fetch(new Request(`${origin}/api/${path}`, {
    method, headers: { Origin: origin, Cookie: cookie, ...(body !== undefined && { "Content-Type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
}

async function challenge() {
  const response = await request("auth/challenge", "POST");
  expect(response.status).toBe(200);
  return { nonce: (await response.json() as { nonce: string }).nonce, cookie: response.headers.getSetCookie()[0].split(";")[0] };
}

function googleToken(nonce: string, sub: string, overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ nonce, sub, email: `${sub}@example.test`, email_verified: true, aud: client, iss: "https://accounts.google.com", iat: now, exp: now + 300, ...overrides })
    .setProtectedHeader({ alg: "RS256", kid: "fixture" }).sign(tokenKey.privateKey);
}

async function login(owner: string) {
  const item = await challenge();
  const result = await request("auth/google", "POST", item.cookie, { credential: await googleToken(item.nonce, owner), turnstileToken: crypto.randomUUID() });
  expect(result.status).toBe(200);
  return result.headers.getSetCookie()[0].split(";")[0];
}

beforeAll(async () => {
  platform = await getPlatformProxy<Env>({ configPath: fileURLToPath(new URL("./fixtures/wrangler.jsonc", import.meta.url)), persist: false, remoteBindings: false });
  const migration = await readFile(new URL("../migrations/0001_account_drafts.sql", import.meta.url), "utf8");
  await platform.env.DB.prepare(migration).run();
  await platform.env.DB.prepare(migration).run();
  const legacyDocument = getTemplate("blank-organic").create();
  await platform.env.DB.prepare("INSERT INTO account_drafts (owner, revision, document) VALUES (?, ?, ?)")
    .bind("legacy", 3, JSON.stringify(legacyDocument)).run();
  const mindmapsMigration = await readFile(new URL("../migrations/0002_mindmaps.sql", import.meta.url), "utf8");
  for (const statement of mindmapsMigration.split(";").map((part) => part.trim()).filter(Boolean)) {
    await platform.env.DB.prepare(statement).run();
  }
  const cleanupMigration = await readFile(new URL("../migrations/0003_remove_account_drafts.sql", import.meta.url), "utf8");
  await platform.env.DB.prepare(cleanupMigration).run();
  const collaborationMigration = await readFile(new URL("../migrations/0004_collaboration.sql", import.meta.url), "utf8");
  for (const statement of collaborationMigration.split(";").map((part) => part.trim()).filter(Boolean)) {
    await platform.env.DB.prepare(statement).run();
  }
  const aiUsageMigration = await readFile(new URL("../migrations/0005_ai_usage.sql", import.meta.url), "utf8");
  for (const statement of aiUsageMigration.split(";").map((part) => part.trim()).filter(Boolean)) {
    await platform.env.DB.prepare(statement).run();
  }
  const revisionsMigration = await readFile(new URL("../migrations/0006_mindmap_revisions.sql", import.meta.url), "utf8");
  for (const statement of revisionsMigration.split(";").map((part) => part.trim()).filter(Boolean)) {
    await platform.env.DB.prepare(statement).run();
  }
  const collabMigration = await readFile(new URL("../migrations/0007_mindmap_collab.sql", import.meta.url), "utf8");
  for (const statement of collabMigration.split(";").map((part) => part.trim()).filter(Boolean)) {
    await platform.env.DB.prepare(statement).run();
  }
  const aiChatMigration = await readFile(new URL("../migrations/0008_ai_chat.sql", import.meta.url), "utf8");
  for (const statement of aiChatMigration.split(";").map((part) => part.trim()).filter(Boolean)) {
    await platform.env.DB.prepare(statement).run();
  }
  const blocksMigration = await readFile(new URL("../migrations/0009_mindmap_document_blocks.sql", import.meta.url), "utf8");
  for (const statement of blocksMigration.split(";").map((part) => part.trim()).filter(Boolean)) {
    await platform.env.DB.prepare(statement).run();
  }
  const checkpoints = await readFile(new URL("../migrations/0012_live_checkpoints.sql", import.meta.url), "utf8");
  for (const statement of checkpoints.split(";").map((part) => part.trim()).filter(Boolean)) await platform.env.DB.prepare(statement).run();
  expect(await platform.env.DB.prepare("SELECT revision, document, workspace_id AS workspaceId FROM mindmaps WHERE owner = ?")
    .bind("legacy").first()).toEqual({ revision: 3, document: JSON.stringify(legacyDocument), workspaceId: null });
  env = { DB: platform.env.DB, AUTH_ORIGIN: origin, GOOGLE_CLIENT_ID: client, TURNSTILE_SITE_KEY: "test-site", TURNSTILE_SECRET: "test-widget-secret", SESSION_SECRET: "test-only-session-secret-not-for-production" };
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://www.googleapis.com/oauth2/v3/certs") return Response.json({ keys: [publicKey] });
    if (url === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
      const body = init?.body as URLSearchParams;
      expect(body.get("secret")).toBe(env.TURNSTILE_SECRET);
      const token = body.get("response")!;
      const success = !used.has(token) && token !== "expired";
      used.add(token);
      return Response.json({ success, hostname: token === "wrong-host" ? "other.test" : "loomind.test", action: token === "wrong-action" ? "contact" : "google_login" });
    }
    const host = new URL(input instanceof Request ? input.url : url).hostname;
    if (host === "pro-llm.test") {
      const sse = [
        `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: '{"title":"Pro Plan","recommendedStructure":"mindmap","recommendedPalette":"aurora","root":{"title":"Pro Plan","children":[{"title":"Pillar 1"}]}}' })}\n\n`,
        `event: response.completed\ndata: {}\n\n`,
      ].join("");
      return new Response(sse, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }
    if (host === "127.0.0.1" || host === "localhost" || host === "[::1]") return realFetch(input, init);
    throw new Error("Unexpected outbound request during isolated test");
  });
}, 30_000);

afterAll(async () => { vi.unstubAllGlobals(); await platform?.dispose(); });

describe("Worker login (fixture Google JWKS and mock Siteverify)", () => {
  it("issues a signed, private session and clears both cookies at logout", async () => {
    const item = await challenge();
    const body = { credential: await googleToken(item.nonce, "alice"), turnstileToken: "single-use" };
    const response = await request("auth/google", "POST", item.cookie, body);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const [session, clearedChallenge] = response.headers.getSetCookie();
    expect(session).toMatch(/__Host-loomind-session=.*HttpOnly; Secure; SameSite=Strict/);
    expect(clearedChallenge).toContain("Max-Age=0");
    const pair = session.split(";")[0];
    expect((await (await request("auth/session", "GET", pair)).json() as { user: { id: string } | null }).user?.id).toBe("alice");
    expect((await (await request("auth/session", "GET", pair + "broken")).json() as { user: unknown }).user).toBeNull();
    expect((await request("auth/google", "POST", item.cookie, body)).status).toBe(403);
    const logout = await request("auth/logout", "POST", pair);
    expect(logout.headers.getSetCookie().filter(value => value.includes("Max-Age=0"))).toHaveLength(2);
    expect((await (await request("auth/session")).json() as { user: unknown }).user).toBeNull();
  });
  it.each(["wrong-host", "wrong-action", "expired"])("rejects Siteverify result: %s", async token => {
    const item = await challenge();
    const response = await request("auth/google", "POST", item.cookie, { credential: await googleToken(item.nonce, "alice"), turnstileToken: token });
    expect(response.status).toBe(403);
    expect(response.headers.has("Set-Cookie")).toBe(false);
  });
  it.each([{ aud: "other" }, { nonce: "wrong" }, { iss: "other" }, { exp: 1 }, { email_verified: false }, { azp: "other" }])("rejects invalid Google claims %o", async claims => {
    const item = await challenge();
    expect((await request("auth/google", "POST", item.cookie, { credential: await googleToken(item.nonce, "alice", claims), turnstileToken: crypto.randomUUID() })).status).toBe(401);
  });
  it("requires a same-origin challenge and fails closed without the provider configuration", async () => {
    expect((await request("auth/challenge", "POST", "", undefined, { Origin: "https://other.test" })).status).toBe(403);
    expect((await request("auth/google", "POST", "", {})).status).toBe(401);
    const missing = await worker.fetch(new Request(`${origin}/api/auth/challenge`, { method: "POST", headers: { Origin: origin } }), { ...env, TURNSTILE_SECRET: "" });
    expect(missing.status).toBe(503);
  });
});

describe("collaboration API (signed sessions and local D1)", () => {
  async function share(cookie: string, type: "workspace" | "mindmap", resourceId: string, role: "editor" | "viewer") {
    const response = await request("shares", "POST", cookie, { type, resourceId, role });
    expect(response.status).toBe(201);
    const created = await response.json() as { id: string; token: string; role: "editor" | "viewer"; expiresAt: string };
    expect(created.role).toBe(role);
    return created;
  }

  it("keeps ownership and revision while granting workspace editors and viewers distinct rights", async () => {
    const alice = await login("space-owner");
    const bob = await login("space-editor");
    const carol = await login("space-viewer");
    const outsider = await login("space-outsider");
    expect((await request("workspaces", "POST", "", { name: "Denied" })).status).toBe(401);
    expect((await request("workspaces", "POST", alice, { name: "Denied" }, { Origin: "https://other.test" })).status).toBe(403);
    const created = await request("workspaces", "POST", alice, { name: "  产品团队  " });
    expect(created.status).toBe(201);
    const workspace = await created.json() as { id: string; name: string; role: string; createdAt: string };
    expect(workspace).toMatchObject({ name: "产品团队", role: "owner" });
    expect((await (await request("workspaces", "GET", alice)).json())).toEqual([workspace]);
    expect((await (await request("workspaces", "GET", bob)).json())).toEqual([]);

    const doc = getTemplate("blank-organic").create();
    const first = "33333333-3333-4333-8333-333333333333";
    const second = "44444444-4444-4444-8444-444444444444";
    const aliceHeader = { [OWNER_HEADER]: "space-owner", "If-Match": '"0"' };
    expect((await request("mindmaps/" + first, "PUT", alice, doc, aliceHeader)).status).toBe(200);
    expect((await request("mindmaps/" + first, "PUT", alice, doc, { ...aliceHeader, "If-Match": '"1"' })).status).toBe(200);
    expect((await request("workspaces/" + workspace.id + "/mindmaps", "POST", alice, { mindmapId: first })).status).toBe(200);
    expect(await env.DB.prepare("SELECT revision, workspace_id AS workspaceId FROM mindmaps WHERE id = ?").bind(first).first())
      .toMatchObject({ revision: 2, workspaceId: workspace.id });

    const editorInvite = await share(alice, "workspace", workspace.id, "editor");
    const viewerInvite = await share(alice, "workspace", workspace.id, "viewer");
    expect((await request("invites/" + editorInvite.token + "/accept", "POST", bob)).status).toBe(200);
    expect((await request("invites/" + viewerInvite.token + "/accept", "POST", carol)).status).toBe(200);
    expect((await (await request("workspaces", "GET", bob)).json())).toMatchObject([{ id: workspace.id, role: "editor" }]);
    expect((await (await request("workspaces", "GET", carol)).json())).toMatchObject([{ id: workspace.id, role: "viewer" }]);
    const bobMaps = await (await request("mindmaps", "GET", bob, undefined, { [OWNER_HEADER]: "space-editor" })).json() as { id: string; access: string; workspaceId: string }[];
    expect(bobMaps).toMatchObject([{ id: first, access: "editor", workspaceId: workspace.id }]);
    const carolMaps = await (await request("mindmaps", "GET", carol, undefined, { [OWNER_HEADER]: "space-viewer" })).json() as { id: string; access: string }[];
    expect(carolMaps).toMatchObject([{ id: first, access: "viewer" }]);
    expect(await (await request("mindmaps/" + first, "GET", carol, undefined, { [OWNER_HEADER]: "space-viewer" })).json())
      .toMatchObject({ revision: 2 });
    expect((await request("mindmaps/" + first, "PUT", carol, doc, { [OWNER_HEADER]: "space-viewer", "If-Match": '"2"' })).status).toBe(403);
    expect((await request("mindmaps/" + second, "PUT", carol, doc, {
      [OWNER_HEADER]: "space-viewer", "If-Match": '"0"', "X-Loomind-Workspace": workspace.id,
    })).status).toBe(403);
    expect((await request("mindmaps/" + second, "PUT", outsider, doc, {
      [OWNER_HEADER]: "space-outsider", "If-Match": '"0"', "X-Loomind-Workspace": workspace.id,
    })).status).toBe(403);
    expect((await request("workspaces/" + workspace.id + "/mindmaps", "POST", carol, { mindmapId: first })).status).toBe(403);
    expect((await request("mindmaps/" + first, "DELETE", bob, undefined, { [OWNER_HEADER]: "space-editor" })).status).toBe(404);

    const edited = { ...doc, sheets: [{ ...doc.sheets[0], title: "协作修改" }] };
    expect(await (await request("mindmaps/" + first, "PUT", bob, edited, {
      [OWNER_HEADER]: "space-editor", "If-Match": '"2"',
    })).json()).toEqual({ revision: 3 });
    expect((await request("mindmaps/" + first, "PUT", bob, doc, {
      [OWNER_HEADER]: "space-editor", "If-Match": '"2"',
    })).status).toBe(409);
    const directEditor = await share(alice, "mindmap", first, "editor");
    expect((await request("invites/" + directEditor.token + "/accept", "POST", carol)).status).toBe(200);
    const promoted = await (await request("mindmaps", "GET", carol, undefined,
      { [OWNER_HEADER]: "space-viewer" })).json() as { id: string; access: string }[];
    expect(promoted.find((item) => item.id === first)?.access).toBe("editor");
    expect((await request("mindmaps/" + first, "PUT", carol, edited, {
      [OWNER_HEADER]: "space-viewer", "If-Match": '"3"',
    })).status).toBe(200);
    expect((await request("mindmaps/" + second, "PUT", bob, doc, {
      [OWNER_HEADER]: "space-editor", "If-Match": '"0"', "X-Loomind-Workspace": workspace.id,
    })).status).toBe(200);
    expect((await request("workspaces/" + workspace.id + "/mindmaps", "POST", bob, { mindmapId: second })).status).toBe(200);
    expect((await request("workspaces/" + workspace.id + "/mindmaps", "POST", alice, { mindmapId: second })).status).toBe(404);
    const aliceMaps = await (await request("mindmaps", "GET", alice, undefined, { [OWNER_HEADER]: "space-owner" })).json() as { id: string; access: string }[];
    expect(aliceMaps.find((item) => item.id === second)?.access).toBe("editor");
    expect((await request("mindmaps/" + second, "DELETE", alice, undefined, { [OWNER_HEADER]: "space-owner" })).status).toBe(404);
    expect((await request("mindmaps/" + second, "DELETE", bob, undefined, { [OWNER_HEADER]: "space-editor" })).status).toBe(200);
    expect((await (await request("mindmaps", "GET", outsider, undefined, { [OWNER_HEADER]: "space-outsider" })).json())).toEqual([]);
    expect(await (await request("mindmaps/" + first, "GET", outsider, undefined, { [OWNER_HEADER]: "space-outsider" })).json())
      .toEqual({ revision: 0, document: null });
  });

  it("stores only invitation hashes, enforces revocation and expiry, and never downgrades a member", async () => {
    const alice = await login("share-owner");
    const bob = await login("share-member");
    const carol = await login("share-pending");
    const mapId = "55555555-5555-4555-8555-555555555555";
    const doc = getTemplate("blank-organic").create();
    expect((await request("mindmaps/" + mapId, "PUT", alice, doc, { [OWNER_HEADER]: "share-owner", "If-Match": '"0"' })).status).toBe(200);
    const viewerInvite = await share(alice, "mindmap", mapId, "viewer");
    const stored = await env.DB.prepare("SELECT token_hash AS tokenHash FROM share_invites WHERE id = ?")
      .bind(viewerInvite.id).first<{ tokenHash: string }>();
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(viewerInvite.token)));
    expect(stored?.tokenHash).toBe(Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(""));
    expect(stored?.tokenHash).not.toBe(viewerInvite.token);
    expect(await (await request("invites/" + viewerInvite.token)).json())
      .toMatchObject({ type: "mindmap", id: mapId, role: "viewer", expiresAt: viewerInvite.expiresAt });
    const listed = await (await request("shares?type=mindmap&resourceId=" + mapId, "GET", alice)).json();
    expect(listed).toMatchObject([{ id: viewerInvite.id, role: "viewer" }]);
    expect(JSON.stringify(listed)).not.toContain(viewerInvite.token);
    expect((await request("shares?type=mindmap&resourceId=" + mapId, "GET", bob)).status).toBe(404);
    expect((await request("shares", "POST", bob, { type: "mindmap", resourceId: mapId, role: "editor" })).status).toBe(404);
    expect((await request("shares", "POST", alice, { type: "mindmap", resourceId: mapId, role: "editor" },
      { Origin: "https://other.test" })).status).toBe(403);
    expect((await request("invites/" + viewerInvite.token + "/accept", "POST", bob,
      undefined, { Origin: "https://other.test" })).status).toBe(403);
    expect((await request("invites/" + viewerInvite.token + "/accept", "POST", bob)).status).toBe(200);
    expect((await request("mindmaps/" + mapId, "PUT", bob, doc,
      { [OWNER_HEADER]: "share-member", "If-Match": '"1"' })).status).toBe(403);
    const editorInvite = await share(alice, "mindmap", mapId, "editor");
    expect((await request("invites/" + editorInvite.token + "/accept", "POST", bob)).status).toBe(200);
    expect((await request("invites/" + viewerInvite.token + "/accept", "POST", bob)).status).toBe(200);
    const bobMaps = await (await request("mindmaps", "GET", bob, undefined, { [OWNER_HEADER]: "share-member" })).json() as { id: string; access: string }[];
    expect(bobMaps.find((item) => item.id === mapId)?.access).toBe("editor");
    expect((await request("mindmaps/" + mapId, "PUT", bob, doc,
      { [OWNER_HEADER]: "share-member", "If-Match": '"1"' })).status).toBe(200);

    const revoked = await share(alice, "mindmap", mapId, "viewer");
    expect((await request("shares/" + revoked.id, "DELETE", bob)).status).toBe(404);
    expect((await request("shares/" + revoked.id, "DELETE", alice, undefined,
      { Origin: "https://other.test" })).status).toBe(403);
    expect((await request("shares/" + revoked.id, "DELETE", alice)).status).toBe(200);
    expect((await request("invites/" + revoked.token)).status).toBe(404);
    expect((await request("invites/" + revoked.token + "/accept", "POST", carol)).status).toBe(404);
    const expired = await share(alice, "mindmap", mapId, "viewer");
    await env.DB.prepare("UPDATE share_invites SET expires_at = ? WHERE id = ?").bind(Date.now() - 1, expired.id).run();
    expect((await request("invites/" + expired.token)).status).toBe(404);
    expect((await request("invites/" + expired.token + "/accept", "POST", carol)).status).toBe(404);
    expect((await request("mindmaps/" + mapId, "DELETE", alice, undefined,
      { [OWNER_HEADER]: "share-owner", Origin: "https://other.test" })).status).toBe(403);
    expect((await request("mindmaps/" + mapId, "DELETE", alice, undefined, { [OWNER_HEADER]: "share-owner" })).status).toBe(200);
    expect((await (await request("mindmaps", "GET", bob, undefined, { [OWNER_HEADER]: "share-member" })).json())).toEqual([]);
    expect(await env.DB.prepare("SELECT count(*) AS count FROM mindmap_members WHERE mindmap_id = ?").bind(mapId).first())
      .toMatchObject({ count: 0 });
  });
});

describe("mindmaps API (local workerd D1)", () => {
  it("migrates the former one-map account record without changing its revision", async () => {
    const legacy = await login("legacy");
    const owner = { [OWNER_HEADER]: "legacy" };
    const maps = await (await request("mindmaps", "GET", legacy, undefined, owner)).json() as { id: string }[];
    expect(maps).toHaveLength(1);
    expect(maps[0]).toMatchObject({ workspaceId: null, access: "owner" });
    const path = `mindmaps/${maps[0].id}`;
    const current = await (await request(path, "GET", legacy, undefined, owner)).json() as { revision: number; document: unknown };
    expect(current).toMatchObject({ revision: 3, document: { format: "mindmap-document" } });
    expect(await (await request(`${path}/revisions/3`, "GET", legacy, undefined, owner)).json()).toMatchObject(current);
  });
  it("keeps multiple maps per account and preserves the winning revision on concurrent saves", async () => {
    const alice = await login("alice");
    const bob = await login("bob");
    const owner = { [OWNER_HEADER]: "alice" };
    const doc = getTemplate("blank-organic").create();
    const first = "11111111-1111-4111-8111-111111111111";
    const second = "22222222-2222-4222-8222-222222222222";
    expect((await request("mindmaps")).status).toBe(401);
    expect(await (await request(`mindmaps/${first}`, "GET", alice, undefined, owner)).json()).toEqual({ revision: 0, document: null });
    expect((await request(`mindmaps/${first}`, "PUT", alice, doc, owner)).status).toBe(428);
    const create = { ...owner, "If-Match": '"0"' };
    expect((await request(`mindmaps/${first}`, "PUT", alice, doc, { ...create, Origin: "https://other.test" })).status).toBe(403);
    expect((await request(`mindmaps/${first}`, "PUT", bob, doc, create)).status).toBe(403);
    expect((await request(`mindmaps/${first}`, "GET", bob, undefined, owner)).status).toBe(403);
    expect((await request(`mindmaps/${first}`, "PUT", alice, { ...doc, activeSheetId: "missing" }, create)).status).toBe(422);
    expect((await request(`mindmaps/${first}`, "PUT", alice, "x".repeat(DRAFT_LIMIT), create)).status).toBe(413);
    expect(await (await request(`mindmaps/${first}`, "PUT", alice, doc, create)).json()).toEqual({ revision: 1 });
    expect((await request(`mindmaps/${first}`, "PUT", alice, doc, create)).status).toBe(409);
    expect(await (await request(`mindmaps/${second}`, "PUT", alice, { ...doc, sheets: [{ ...doc.sheets[0], title: "第二张" }] }, create)).json()).toEqual({ revision: 1 });
    expect((await (await request("mindmaps", "GET", alice, undefined, owner)).json() as { id: string }[]).map((item) => item.id).sort()).toEqual([first, second]);
    const variants = ["laptop", "phone"].map(title => ({ ...doc, sheets: [{ ...doc.sheets[0], title }] }));
    const responses = await Promise.all(variants.map(draft => request(`mindmaps/${first}`, "PUT", alice, draft, { ...owner, "If-Match": '"1"' })));
    expect(responses.map(value => value.status).sort()).toEqual([200, 409]);
    expect(await (await request(`mindmaps/${first}`, "GET", alice, undefined, owner)).json()).toEqual({ revision: 2, document: variants[responses.findIndex(value => value.ok)] });
    expect(await (await request(`mindmaps/${first}`, "GET", bob, undefined, { [OWNER_HEADER]: "bob" })).json()).toEqual({ revision: 0, document: null });
    expect(await (await request(`mindmaps/${second}`, "GET", bob, undefined, { [OWNER_HEADER]: "bob" })).json()).toEqual({ revision: 0, document: null });
  });
});

describe("dual-tier AI API (free Workers AI + logged-in Pro LLM)", () => {
  it("uses the deployed Workers AI model by default for guest node expansion", async () => {
    const config = unstable_readConfig({ config: fileURLToPath(new URL("../wrangler.jsonc", import.meta.url)) });
    const model = "@cf/google/gemma-4-26b-a4b-it";
    expect(config.vars.AI_FREE_MODEL).toBe(model);
    expect(config.vars.AI_FREE_DAILY_LIMIT).toBe("3");

    const ops = [{ kind: "addChildren", targetTopicId: "root", items: ["选址", "馆藏", "服务", "活动"].map(title => ({ title })) }];
    const chunk = { choices: [{ delta: { content: JSON.stringify({ ops }) } }] };
    const run = vi.fn(async () => new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`).body);
    const response = await worker.fetch(new Request(`${origin}/api/ai/stream`, {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ tier: "free", intent: "expand", prompt: "为当前节点扩展 4 个关键子主题", targetTopicId: "root" }),
    }), { ...env, AI: { run } as unknown as Ai, AI_ALLOW_MOCK: "false" });

    const stream = await response.text();
    expect(run).toHaveBeenCalledWith(model, expect.objectContaining({ stream: true }));
    expect(stream).toContain(`event: commands\ndata: ${JSON.stringify({ ops })}`);
    expect(stream).toContain("event: done");

    // Tolerates leading/trailing prose wrapped around structured JSON (e.g. Gemma-4)
    const proseRun = vi.fn(async () =>
      new Response(
        `data: ${JSON.stringify({ choices: [{ delta: { content: `Sure! Here is the JSON:\n${JSON.stringify({ ops, message: "Expanded 4 subtopics" })}\nHope this helps.` } }] })}\n\ndata: [DONE]\n\n`,
      ).body,
    );
    const proseRes = await worker.fetch(new Request(`${origin}/api/ai/stream`, {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.55" },
      body: JSON.stringify({ tier: "free", intent: "expand", prompt: "Expand 4 subtopics", targetTopicId: "root", locale: "en" }),
    }), { ...env, AI: { run: proseRun } as unknown as Ai, AI_ALLOW_MOCK: "false" });
    const proseStream = await proseRes.text();
    expect(proseStream).toContain(`event: commands\ndata: ${JSON.stringify({ ops })}`);
    expect(proseStream).not.toContain("event: error");
  });

  it("reports free config for guests and enforces auth + origin + quota + streaming", async () => {
    const guestFreeCfg = await (await request("ai/config?tier=free")).json() as { tier: string; available: boolean; isMock: boolean; requiresLogin: boolean };
    expect(guestFreeCfg).toMatchObject({ tier: "free", available: true, isMock: true, requiresLogin: false });

    const guestProCfg = await (await request("ai/config?tier=pro")).json() as { tier: string; available: boolean; requiresLogin: boolean };
    expect(guestProCfg).toMatchObject({ tier: "pro", available: false, requiresLogin: true });

    // Cross-origin rejected
    expect((await request("ai/stream", "POST", "", { tier: "free", intent: "generate_map", prompt: "Hi", locale: "en" }, { Origin: "https://evil.test" })).status).toBe(403);
    // Pro requires login
    expect((await request("ai/stream", "POST", "", { tier: "pro", intent: "generate_map", prompt: "Hi", locale: "en" })).status).toBe(401);

    // Free Workers AI real binding path
    const fakeAiEnv: Env = {
      ...env,
      AI_FREE_DAILY_LIMIT: "2",
      AI_ALLOW_MOCK: "false",
      AI: {
        run: async () => {
          const enc = new TextEncoder();
          return new ReadableStream({
            start(controller) {
              controller.enqueue(enc.encode(`data: ${JSON.stringify({ response: '{"title":"Free Map","recommendedStructure":"mindmap","recommendedPalette":"aurora","root":{"title":"Free Map","children":[{"title":"A"}]}}' })}\n\n`));
              controller.enqueue(enc.encode("data: [DONE]\n\n"));
              controller.close();
            },
          });
        },
      } as unknown as Ai,
    };

    const freeRes1 = await worker.fetch(new Request(`${origin}/api/ai/stream`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.10" },
      body: JSON.stringify({ tier: "free", intent: "generate_map", prompt: "Free Map", locale: "en" }),
    }), fakeAiEnv);
    expect(freeRes1.status).toBe(200);
    expect(freeRes1.headers.get("Content-Type")).toContain("text/event-stream");
    const freeBody1 = await freeRes1.text();
    expect(freeBody1).toContain("event: meta");
    expect(freeBody1).toContain('"isMock":false');
    expect(freeBody1).toContain("event: map_patch");
    expect(freeBody1).toContain("event: done");

    // Exhaust 2/day free quota on same IP
    const freeRes2 = await worker.fetch(new Request(`${origin}/api/ai/stream`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.10" },
      body: JSON.stringify({ tier: "free", intent: "generate_map", prompt: "Second", locale: "en" }),
    }), fakeAiEnv);
    expect(freeRes2.status).toBe(200);
    await freeRes2.text();

    const freeRes3 = await worker.fetch(new Request(`${origin}/api/ai/stream`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.10" },
      body: JSON.stringify({ tier: "free", intent: "generate_map", prompt: "Third", locale: "en" }),
    }), fakeAiEnv);
    expect(freeRes3.status).toBe(429);
    expect(await freeRes3.json()).toMatchObject({ code: "RATE_LIMITED" });

    // Logged-in Pro path with real upstream OpenAI Responses API
    const proCookie = await login("pro-user");
    const proEnv: Env = {
      ...env,
      PRO_LLM_BASE_URL: "https://pro-llm.test/v1",
      PRO_LLM_API_KEY: "test-key",
      PRO_LLM_MODEL: "gpt-6.2-sol",
      AI_ALLOW_MOCK: "false",
    };
    const proRes = await worker.fetch(new Request(`${origin}/api/ai/stream`, {
      method: "POST",
      headers: { Origin: origin, Cookie: proCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ tier: "pro", intent: "generate_map", prompt: "Pro Plan", locale: "en" }),
    }), proEnv);
    expect(proRes.status).toBe(200);
    const proBody = await proRes.text();
    expect(proBody).toContain('"tier":"pro"');
    expect(proBody).toContain('"isMock":false');
    expect(proBody).toContain("Pillar 1");

    // Pro fails closed with 503 when unconfigured and mock is disabled
    const noProRes = await worker.fetch(new Request(`${origin}/api/ai/stream`, {
      method: "POST",
      headers: { Origin: origin, Cookie: proCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ tier: "pro", intent: "generate_map", prompt: "Pro Plan", locale: "en" }),
    }), { ...env, AI_ALLOW_MOCK: "false" });
    expect(noProRes.status).toBe(503);
    expect(await noProRes.json()).toMatchObject({ code: "PRO_NOT_CONFIGURED" });
  });

  it("tracks per-device trial quota via signed HttpOnly cookie independently behind a shared IP and refunds on upstream error", async () => {
    const sharedIp = "198.51.100.77";
    const okRun = vi.fn(async () => {
      const enc = new TextEncoder();
      return new ReadableStream({
        start(controller) {
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ response: '{"title":"Shared IP","recommendedStructure":"mindmap","recommendedPalette":"workspace","root":{"title":"Shared IP","children":[{"title":"A"}]}}' })}\n\n`));
          controller.enqueue(enc.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
    });
    const trialEnv: Env = {
      ...env,
      AI_FREE_DAILY_LIMIT: "2",
      AI_FREE_IP_DAILY_LIMIT: "10",
      AI_ALLOW_MOCK: "false",
      AI: { run: okRun } as unknown as Ai,
    };

    // Device A gets a signed HttpOnly trial cookie on config fetch
    const cfgA = await worker.fetch(new Request(`${origin}/api/ai/config?tier=free`, {
      headers: { Origin: origin, "CF-Connecting-IP": sharedIp },
    }), trialEnv);
    expect(cfgA.status).toBe(200);
    const setCookieA = cfgA.headers.getSetCookie()[0];
    expect(setCookieA).toContain("__Host-loomind-trial=");
    expect(setCookieA).toContain("HttpOnly");
    const cookieA = setCookieA.split(";")[0];
    expect(await cfgA.json()).toMatchObject({ dailyLimit: 2, remainingToday: 2 });

    // Device A uses both trials
    for (let i = 0; i < 2; i++) {
      const res = await worker.fetch(new Request(`${origin}/api/ai/stream`, {
        method: "POST",
        headers: { Origin: origin, Cookie: cookieA, "Content-Type": "application/json", "CF-Connecting-IP": sharedIp },
        body: JSON.stringify({ tier: "free", intent: "generate_map", prompt: `Run ${i}`, locale: "en" }),
      }), trialEnv);
      expect(res.status).toBe(200);
      await res.text();
    }

    // Device A's 3rd attempt is blocked
    const blockedA = await worker.fetch(new Request(`${origin}/api/ai/stream`, {
      method: "POST",
      headers: { Origin: origin, Cookie: cookieA, "Content-Type": "application/json", "CF-Connecting-IP": sharedIp },
      body: JSON.stringify({ tier: "free", intent: "generate_map", prompt: "Blocked", locale: "en" }),
    }), trialEnv);
    expect(blockedA.status).toBe(429);

    // Device B on the exact same shared IP still gets its full 2 trials
    const cfgB = await worker.fetch(new Request(`${origin}/api/ai/config?tier=free`, {
      headers: { Origin: origin, "CF-Connecting-IP": sharedIp },
    }), trialEnv);
    const cookieB = cfgB.headers.getSetCookie()[0].split(";")[0];
    expect(await cfgB.json()).toMatchObject({ dailyLimit: 2, remainingToday: 2 });

    // If upstream fails on Device B, the trial is refunded
    const failingEnv: Env = {
      ...trialEnv,
      AI: { run: async () => { throw new Error("upstream boom"); } } as unknown as Ai,
    };
    const failedRes = await worker.fetch(new Request(`${origin}/api/ai/stream`, {
      method: "POST",
      headers: { Origin: origin, Cookie: cookieB, "Content-Type": "application/json", "CF-Connecting-IP": sharedIp },
      body: JSON.stringify({ tier: "free", intent: "generate_map", prompt: "Fail", locale: "en" }),
    }), failingEnv);
    expect(failedRes.status).toBe(200);
    const failedBody = await failedRes.text();
    expect(failedBody).toContain("event: error");

    const cfgBAfterFail = await worker.fetch(new Request(`${origin}/api/ai/config?tier=free`, {
      headers: { Origin: origin, "CF-Connecting-IP": sharedIp, Cookie: cookieB },
    }), trialEnv);
    expect(await cfgBAfterFail.json()).toMatchObject({ dailyLimit: 2, remainingToday: 2 });
  });
});


describe("Version history API (D1 snapshots & pruning)", () => {
  it("accepts the exact UTF-8 size limit and preserves the saved map when the next edit exceeds it", async () => {
    const owner = "map-limit-owner";
    const session = await login(owner);
    const path = `mindmaps/${crypto.randomUUID()}`;
    const headers = { [OWNER_HEADER]: owner };
    const doc = getTemplate("blank-organic").create();
    doc.sheets[0].title = "资料".repeat(400);
    const note = doc.sheets[0].rootTopic.note = { format: "markdown", text: "" };
    note.text = "x".repeat(DRAFT_LIMIT - Buffer.byteLength(JSON.stringify(doc)));
    expect((await request(path, "PUT", session, doc, { ...headers, "If-Match": '"0"' })).status).toBe(200);
    note.text += "图";
    expect((await request(path, "PUT", session, doc, { ...headers, "If-Match": '"1"' })).status).toBe(413);
    note.text = note.text.slice(0, -1);
    const snapshot = await (await request(`${path}/revisions/1`, "GET", session, undefined, headers)).json();
    expect(snapshot).toMatchObject({ revision: 1, title: doc.sheets[0].title, document: doc });
    expect(await (await request(path, "GET", session, undefined, headers)).json()).toEqual({ revision: 1, document: doc });
  });

  it("round-trips an image map larger than one D1 row without mixing concurrent revisions", async () => {
    const owner = "large-map-owner";
    const session = await login(owner);
    const mapId = crypto.randomUUID();
    const path = `mindmaps/${mapId}`;
    const headers = { [OWNER_HEADER]: owner };
    const original = getTemplate("blank-organic").create();
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><desc>${"资料🧵".repeat(165000)}</desc><circle r="4"/></svg>`);
    const sha256 = Buffer.from(await crypto.subtle.digest("SHA-256", svg)).toString("hex");
    original.assets.chart = { resourceId: "chart", width: 10, height: 10, mimeType: "image/svg+xml", sha256, dataBase64: svg.toString("base64") };
    original.sheets[0].rootTopic.image = { resourceId: "chart", width: 10, height: 10, pos: "top" };
    expect(Buffer.byteLength(JSON.stringify(original))).toBeGreaterThan(2_000_000);
    const write = (revision: number, doc: typeof original) => request(path, "PUT", session, doc, { ...headers, "If-Match": `"${revision}"` });
    expect((await write(0, original)).status).toBe(200);
    const contenders = ["Review A", "Review B"].map((title) => ({ ...original, sheets: [{ ...original.sheets[0], title }] }));
    const responses = await Promise.all(contenders.map((doc) => write(1, doc)));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const winner = contenders[responses.findIndex((response) => response.ok)];
    for (const [endpoint, expected, revision] of [[path, winner, 2], [`${path}/revisions/2`, winner, 2], [`${path}/revisions/1`, original, 1]] as const) {
      const read = await request(endpoint, "GET", session, undefined, headers);
      expect(read.status).toBe(200);
      const saved = await read.json() as { revision: number; document: typeof original };
      expect(saved.revision).toBe(revision);
      expect(saved.document).toEqual(expected);
    }
    const viewer = "large-map-viewer";
    const viewerSession = await login(viewer);
    await env.DB.prepare("INSERT INTO mindmap_members (mindmap_id, subject, role) VALUES (?, ?, 'viewer')").bind(mapId, viewer).run();
    const visible = await request(`${path}/revisions/1`, "GET", viewerSession, undefined, { [OWNER_HEADER]: viewer });
    expect((await visible.json() as { document: typeof original }).document).toEqual(original);
    expect((await request(path, "PUT", viewerSession, original, { [OWNER_HEADER]: viewer, "If-Match": '"2"' })).status).toBe(403);

    const manifests = await env.DB.prepare("SELECT document FROM mindmap_revisions WHERE mindmap_id = ? ORDER BY revision").bind(mapId).all<{ document: string }>();
    const [first, second] = manifests.results.map((row) => JSON.parse(row.document) as string[]);
    expect(first.some((digest) => second.includes(digest))).toBe(true);
    const blockCount = () => env.DB.prepare("SELECT count(*) AS total FROM mindmap_document_blocks WHERE mindmap_id = ?").bind(mapId).first<number>("total");
    expect(await blockCount()).toBe(new Set([...first, ...second]).size);
    const small = getTemplate("blank-organic").create();
    for (let revision = 2; revision < 22; revision++) expect((await write(revision, small)).status).toBe(200);
    expect(await blockCount()).toBe(0);
    expect((await request(`${path}/revisions/2`, "GET", session, undefined, headers)).status).toBe(404);
    expect((await write(22, original)).status).toBe(200);
    expect(await blockCount()).toBeGreaterThan(0);
    await env.DB.prepare("DELETE FROM mindmap_document_blocks WHERE mindmap_id = ? AND digest = ?").bind(mapId, first[0]).run();
    expect((await request(path, "GET", session, undefined, headers)).status).toBe(503);
    expect((await request(`${path}/revisions/23`, "GET", session, undefined, headers)).status).toBe(503);
    expect((await request(path, "DELETE", session, undefined, headers)).status).toBe(200);
    expect(await blockCount()).toBe(0);
  });

  it("keeps the previous draft and all of its history when a block insert fails", async () => {
    const owner = "atomic-map-owner";
    const session = await login(owner);
    const mapId = crypto.randomUUID();
    const path = `mindmaps/${mapId}`;
    const headers = { [OWNER_HEADER]: owner };
    const original = getTemplate("blank-organic").create();
    expect((await request(path, "PUT", session, original, { ...headers, "If-Match": '"0"' })).status).toBe(200);
    const large = structuredClone(original);
    large.sheets[0].rootTopic.note = { format: "markdown", text: "🧵资料".repeat(125000) };
    await env.DB.prepare(`CREATE TRIGGER fail_test_blocks BEFORE INSERT ON mindmap_document_blocks BEGIN SELECT RAISE(ABORT, 'fixture write failure'); END`).run();
    try {
      expect((await request(path, "PUT", session, large, { ...headers, "If-Match": '"1"' })).status).toBe(503);
    } finally { await env.DB.prepare("DROP TRIGGER fail_test_blocks").run(); }
    expect(await (await request(path, "GET", session, undefined, headers)).json()).toEqual({ revision: 1, document: original });
    expect((await request(`${path}/revisions/2`, "GET", session, undefined, headers)).status).toBe(404);
    expect((await request(path, "PUT", session, large, { ...headers, "If-Match": '"1"' })).status).toBe(200);
    expect(await (await request(path, "GET", session, undefined, headers)).json()).toEqual({ revision: 2, document: large });
  });

  it("records revision snapshots on PUT, caps at 20 revisions, enforces permissions, and cleans up on DELETE", async () => {
    const ownerCookie = await login("hist-owner");
    const strangerCookie = await login("hist-stranger");
    const mapId = crypto.randomUUID();
    const base = getTemplate("blank-organic").create();

    // Save 22 revisions so pruning to latest 20 is exercised
    for (let rev = 0; rev < 22; rev += 1) {
      const next = structuredClone(base);
      next.sheets[0].title = `Version ${rev + 1}`;
      next.sheets[0].rootTopic.title = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: `Version ${rev + 1}` }] }],
      };
      const put = await request(`mindmaps/${mapId}`, "PUT", ownerCookie, next, {
        [OWNER_HEADER]: "hist-owner",
        "If-Match": `"${rev}"`,
      });
      expect(put.status).toBe(200);
    }

    // List revisions: capped at 20, newest first (22 down to 3)
    const listRes = await request(`mindmaps/${mapId}/revisions`, "GET", ownerCookie, undefined, {
      [OWNER_HEADER]: "hist-owner",
    });
    expect(listRes.status).toBe(200);
    const list = await listRes.json() as Array<{ revision: number; title: string; savedBy: string; createdAt: string }>;
    expect(list).toHaveLength(20);
    expect(list[0].revision).toBe(22);
    expect(list[0].title).toBe("Version 22");
    expect(list[19].revision).toBe(3);

    // Read an older revision (v5) and verify full document snapshot
    const snapRes = await request(`mindmaps/${mapId}/revisions/5`, "GET", ownerCookie, undefined, {
      [OWNER_HEADER]: "hist-owner",
    });
    expect(snapRes.status).toBe(200);
    const snap = await snapRes.json() as { revision: number; title: string; document: typeof base };
    expect(snap.revision).toBe(5);
    expect(snap.title).toBe("Version 5");
    expect(snap.document.sheets[0].title).toBe("Version 5");

    // Pruned revision (v1) returns 404
    const prunedRes = await request(`mindmaps/${mapId}/revisions/1`, "GET", ownerCookie, undefined, {
      [OWNER_HEADER]: "hist-owner",
    });
    expect(prunedRes.status).toBe(404);

    // Stranger cannot access revisions
    const strangerRes = await request(`mindmaps/${mapId}/revisions`, "GET", strangerCookie, undefined, {
      [OWNER_HEADER]: "hist-stranger",
    });
    expect(strangerRes.status).toBe(404);

    // Deleting the mindmap also cleans up stored revision snapshots
    const delRes = await request(`mindmaps/${mapId}`, "DELETE", ownerCookie, undefined, {
      [OWNER_HEADER]: "hist-owner",
    });
    expect(delRes.status).toBe(200);
    const remaining = await platform.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM mindmap_revisions WHERE mindmap_id = ?",
    ).bind(mapId).first<{ count: number }>();
    expect(remaining?.count).toBe(0);
  });
});


describe("revision-bound live checkpoints (local D1)", () => {
  const headers = (subject: string, revision = 0, mode = "1") => ({ [OWNER_HEADER]: subject, [LIVE_HEADER]: mode, "If-Match": `"${revision}"` });
  const checkpoint = (adapter: LoroSyncAdapter, room = crypto.randomUUID(), cursor = 0): LiveCheckpoint =>
    ({ room, cursor, snapshot: Buffer.from(adapter.exportSnapshot()).toString("base64") });

  it("only lets one editor seed legacy JSON without changing its revision or disclosing the snapshot to other accounts", async () => {
    const owner = "seed-owner", editor = "seed-editor", viewer = "seed-viewer", outsider = "seed-outsider";
    const [alice, bob, cara, dan] = await Promise.all([owner, editor, viewer, outsider].map(login));
    const id = crypto.randomUUID();
    const path = `mindmaps/${id}`;
    const doc = getTemplate("blank-organic").create();
    expect((await request(path, "PUT", alice, doc, { [OWNER_HEADER]: owner, "If-Match": '"0"' })).status).toBe(200);
    for (const [member, role] of [[editor, "editor"], [viewer, "viewer"]]) {
      await env.DB.prepare("INSERT INTO mindmap_members (mindmap_id, subject, role) VALUES (?, ?, ?)").bind(id, member, role).run();
    }
    const offer = (cookie: string, subject: string, seed: LiveCheckpoint) => request(path, "PUT", cookie, { checkpoint: seed }, headers(subject, 1, "seed"));
    const seeds = [checkpoint(new LoroSyncAdapter(doc)), checkpoint(new LoroSyncAdapter(doc))];
    expect((await offer(cara, viewer, seeds[0])).status).toBe(403);
    expect((await offer(bob, editor, { ...seeds[0], cursor: 9 })).status).toBe(422);
    const claims = await Promise.all([offer(alice, owner, seeds[0]), offer(bob, editor, seeds[1])]);
    expect(claims.map((res) => res.status).sort()).toEqual([200, 409]);
    const winner = seeds[claims.findIndex((res) => res.ok)];
    expect(await (await request(path, "GET", cara, undefined, headers(viewer))).json()).toEqual({ revision: 1, document: doc, checkpoint: winner });
    expect(await (await request(path, "GET", dan, undefined, headers(outsider))).json()).toEqual({ revision: 0, document: null });
    expect(await (await request(path, "GET", alice, undefined, { [OWNER_HEADER]: owner })).json()).toEqual({ revision: 1, document: doc });
    expect(await env.DB.prepare("SELECT count(*) FROM mindmap_revisions WHERE mindmap_id = ?").bind(id).first("count(*)")).toBe(1);
  });

  it("atomically stores a multipart snapshot, rejects stale saves and cursors, and retires the room on a legacy write", async () => {
    const owner = "parts-owner", cookie = await login(owner);
    const id = crypto.randomUUID(), path = `mindmaps/${id}`;
    const doc = getTemplate("blank-organic").create(), adapter = new LoroSyncAdapter(doc);
    const first = checkpoint(adapter);
    const put = (rev: number, draft: LiveCheckpoint) => request(path, "PUT", cookie, { ...adapter.getDocument(), checkpoint: draft }, headers(owner, rev));
    const read = async () => (await request(path, "GET", cookie, undefined, headers(owner))).json();
    const roomHeaders = { [OWNER_HEADER]: owner, "X-Loomind-Room": first.room };
    const delta = { peerId: "sender", updateB64: Buffer.from(adapter.exportUpdates()).toString("base64") };
    expect((await put(0, first)).status).toBe(200);
    const posted = await request(`${path}/collab`, "POST", cookie, delta, roomHeaders);
    expect(posted.status).toBe(200);
    const { seq } = await posted.json() as { seq: number };
    for (let index = 0; index < 19; index++) {
      adapter.applyCommand({ type: "topic/setTitle", sheetId: doc.activeSheetId, topicId: "b1", title: createRichText(randomBytes(96 * 1024).toString("base64")) });
    }
    adapter.applyCommand({ type: "topic/setTitle", sheetId: doc.activeSheetId, topicId: "b1", title: createRichText("Compact document, long history") });
    const second = { ...checkpoint(adapter), room: first.room, cursor: seq };
    expect(second.snapshot.length).toBeGreaterThan(2 * 1024 * 1024);
    expect((await put(1, second)).status).toBe(200);
    expect((await put(1, first)).status).toBe(409);
    expect((await put(2, { ...second, cursor: seq + 1 })).status).toBe(409);
    expect((await put(2, { ...first, room: crypto.randomUUID() })).status).toBe(409);
    const current = await read() as { revision: number; document: unknown; checkpoint: LiveCheckpoint };
    expect(current.revision).toBe(2);
    expect(current.checkpoint.snapshot === second.snapshot).toBe(true);
    expect(LoroSyncAdapter.fromSnapshot(Buffer.from(current.checkpoint.snapshot, "base64")).getDocument()).toEqual(current.document);
    expect(await env.DB.prepare("SELECT count(*) FROM mindmap_revisions WHERE mindmap_id = ?").bind(id).first("count(*)")).toBe(2);
    expect((await request(path, "PUT", cookie, doc, { [OWNER_HEADER]: owner, "If-Match": '"2"' })).status).toBe(200);
    expect(await read()).toEqual({ revision: 3, document: doc, checkpoint: null });
    expect((await request(`${path}/collab`, "POST", cookie, delta, roomHeaders)).status).toBe(409);
    expect((await request(`${path}/collab`, "GET", cookie, undefined, roomHeaders)).status).toBe(409);
    expect((await request(path, "PUT", cookie, { checkpoint: checkpoint(new LoroSyncAdapter(doc)) }, headers(owner, 3, "seed"))).status).toBe(200);
    await env.DB.prepare("UPDATE mindmaps SET revision = revision + 1 WHERE id = ?").bind(id).run();
    expect(await read()).toEqual({ revision: 4, document: doc, checkpoint: null });
    expect((await request(path, "PUT", cookie, { checkpoint: checkpoint(new LoroSyncAdapter(doc)) }, headers(owner, 4, "seed"))).status).toBe(200);
    expect((await request(path, "DELETE", cookie, undefined, { [OWNER_HEADER]: owner })).status).toBe(200);
    expect(await env.DB.prepare("SELECT count(*) FROM mindmap_live_parts WHERE mindmap_id = ?").bind(id).first("count(*)")).toBe(0);
  });
});

describe("Loro CRDT realtime collab API (updates & peer presence)", () => {
  it("prunes the oldest frames by bytes or by count without touching another map", async () => {
    const owner = await login("retention-owner");
    const headers = { [OWNER_HEADER]: "retention-owner" };
    const initial = getTemplate("blank-organic").create();
    const { LoroSyncAdapter } = await import("@mindmap/core/loro");
    const nextFrame = Buffer.from(new LoroSyncAdapter(initial).exportUpdates()).toString("base64");
    const previousMaps: string[] = [];
    for (const [count, size] of [[25, 1536 * 1024], [200, 4]]) {
      const mapId = crypto.randomUUID();
      expect((await request(`mindmaps/${mapId}`, "PUT", owner, initial, { ...headers, "If-Match": '"0"' })).status).toBe(200);
      const db = platform.env.DB;
      await db.prepare(`WITH RECURSIVE items(position) AS (SELECT 1 UNION ALL SELECT position + 1 FROM items WHERE position < ?)
        INSERT INTO mindmap_crdt_updates (mindmap_id, peer_id, actor, update_b64) SELECT ?, 'fixture', 'retention-owner', ? FROM items`)
        .bind(count, mapId, "A".repeat(size)).run();
      const oldest = await db.prepare("SELECT MIN(seq) AS first FROM mindmap_crdt_updates WHERE mindmap_id = ?").bind(mapId).first<number>("first");
      const push = await request(`mindmaps/${mapId}/collab`, "POST", owner, { peerId: "author", updateB64: nextFrame }, headers);
      expect(push.status).toBe(200);
      const { seq } = await push.json() as { seq: number };
      const retained = await db.prepare("SELECT COUNT(*) AS count, MIN(seq) AS first, MAX(seq) AS latest FROM mindmap_crdt_updates WHERE mindmap_id = ?").bind(mapId).first();
      expect(retained).toEqual({ count, first: oldest! + 1, latest: seq });
      previousMaps.push(mapId);
    }
    expect(await platform.env.DB.prepare("SELECT COUNT(*) AS count FROM mindmap_crdt_updates WHERE mindmap_id = ?").bind(previousMaps[0]).first<number>("count")).toBe(25);
  });

  it("pages large valid deltas without skipping their causal predecessor and rejects frames above the row budget", async () => {
    const { LoroSyncAdapter } = await import("@mindmap/core/loro");
    const mapId = crypto.randomUUID();
    const owner = await login("image-owner");
    const headers = { [OWNER_HEADER]: "image-owner" };
    const initial = getTemplate("blank-organic").create();
    expect((await request(`mindmaps/${mapId}`, "PUT", owner, initial, { ...headers, "If-Match": '"0"' })).status).toBe(200);
    const author = new LoroSyncAdapter(initial, 10n);
    const reviewer = LoroSyncAdapter.fromSnapshot(author.exportSnapshot(), 20n);
    const endpoint = `mindmaps/${mapId}/collab`;
    const sequences: number[] = [];
    for (const topic of initial.sheets[0].rootTopic.children.slice(0, 2)) {
      const version = author.getVersion();
      author.applyCommand({ type: "topic/setNote", sheetId: initial.activeSheetId, topicId: topic.id, text: randomBytes(640 * 1024).toString("base64") });
      const updateB64 = Buffer.from(author.exportUpdates(version)).toString("base64");
      expect(updateB64.length).toBeGreaterThan(768 * 1024);
      const pushed = await request(endpoint, "POST", owner, { peerId: "author", updateB64 }, headers);
      expect(pushed.status).toBe(200);
      sequences.push((await pushed.json() as { seq: number }).seq);
    }
    const overBudget = await request(endpoint, "POST", owner, { peerId: "author", updateB64: "A".repeat(1536 * 1024 + 4) }, headers);
    expect(overBudget.status).toBe(413);
    let since = 0;
    for (const seq of sequences) {
      const pulled = await request(`${endpoint}?since=${since}`, "GET", owner, undefined, headers);
      expect(pulled.status).toBe(200);
      const page = await pulled.json() as { latestSeq: number; updates: Array<{ seq: number; updateB64: string }> };
      expect(page.updates.map((row) => row.seq)).toEqual([seq]);
      expect(page.latestSeq).toBe(seq);
      reviewer.importUpdates(Buffer.from(page.updates[0].updateB64, "base64"));
      since = page.latestSeq;
    }
    expect(reviewer.getDocument()).toEqual(author.getDocument());
    const empty = await request(`${endpoint}?since=${since}`, "GET", owner, undefined, headers);
    expect(await empty.json()).toMatchObject({ latestSeq: since, updates: [] });
  });

  it("exchanges binary Loro CRDT updates and live presence between collaborators while blocking viewers from writing", async () => {
    const { LoroSyncAdapter } = await import("@mindmap/core/loro");
    const ownerCookie = await login("collab-owner");
    const viewerCookie = await login("collab-viewer");
    const strangerCookie = await login("collab-stranger");
    const mapId = crypto.randomUUID();
    const initial = getTemplate("blank-organic").create();

    // Owner creates the mindmap
    const put = await request(`mindmaps/${mapId}`, "PUT", ownerCookie, initial, {
      [OWNER_HEADER]: "collab-owner",
      "If-Match": '"0"',
    });
    expect(put.status).toBe(200);

    // Grant viewer access via share invite
    const inviteRes = await request("shares", "POST", ownerCookie, {
      type: "mindmap",
      resourceId: mapId,
      role: "viewer",
    });
    expect(inviteRes.status).toBe(201);
    const { token } = await inviteRes.json() as { token: string };
    const accept = await request(`invites/${token}/accept`, "POST", viewerCookie);
    expect(accept.status).toBe(200);

    // Owner makes a Loro CRDT edit and posts the binary update delta
    const peerA = new LoroSyncAdapter(initial, 101n);
    const peerB = LoroSyncAdapter.fromSnapshot(peerA.exportSnapshot(), 202n);
    const verBefore = peerA.getVersion();
    peerA.applyCommand({
      type: "topic/addChild",
      sheetId: initial.activeSheetId,
      parentId: initial.sheets[0].rootTopic.id,
      newId: "live-crdt-node",
    });
    const delta = peerA.exportUpdates(verBefore);
    const deltaB64 = Buffer.from(delta).toString("base64");

    const postOwner = await request(`mindmaps/${mapId}/collab`, "POST", ownerCookie, {
      peerId: "peer-a",
      name: "Owner",
      color: "#3B82F6FF",
      selectedTopicIds: ["live-crdt-node"],
      updateB64: deltaB64,
    }, { [OWNER_HEADER]: "collab-owner" });
    expect(postOwner.status).toBe(200);
    const postOwnerBody = await postOwner.json() as { seq: number; peers: Array<{ peerId: string; name: string }> };
    expect(postOwnerBody.seq).toBeGreaterThan(0);

    // Viewer can post presence (without updateB64), but cannot push CRDT edits
    const viewerPresence = await request(`mindmaps/${mapId}/collab`, "POST", viewerCookie, {
      peerId: "peer-v",
      name: "Viewer",
      color: "#10B981FF",
      selectedTopicIds: ["b1"],
    }, { [OWNER_HEADER]: "collab-viewer" });
    expect(viewerPresence.status).toBe(200);

    const viewerWrite = await request(`mindmaps/${mapId}/collab`, "POST", viewerCookie, {
      peerId: "peer-v",
      name: "Viewer",
      color: "#10B981FF",
      updateB64: deltaB64,
    }, { [OWNER_HEADER]: "collab-viewer" });
    expect(viewerWrite.status).toBe(403);

    // Viewer pulls updates & presence and converges peerB via Loro
    const pullRes = await request(`mindmaps/${mapId}/collab?since=0`, "GET", viewerCookie, undefined, {
      [OWNER_HEADER]: "collab-viewer",
    });
    expect(pullRes.status).toBe(200);
    const pulled = await pullRes.json() as {
      latestSeq: number;
      updates: Array<{ seq: number; peerId: string; updateB64: string }>;
      peers: Array<{ peerId: string; name: string; selectedTopicIds: string[] }>;
    };
    expect(pulled.updates).toHaveLength(1);
    expect(pulled.peers.map((p) => p.peerId).sort()).toEqual(["peer-a", "peer-v"]);

    peerB.importUpdates(new Uint8Array(Buffer.from(pulled.updates[0].updateB64, "base64")));
    expect(peerB.getDocument().sheets[0].rootTopic.children.some((c) => c.id === "live-crdt-node")).toBe(true);

    // Stranger is denied with 404
    const strangerPull = await request(`mindmaps/${mapId}/collab?since=0`, "GET", strangerCookie, undefined, {
      [OWNER_HEADER]: "collab-stranger",
    });
    expect(strangerPull.status).toBe(404);

    // DELETE cleans up collab rows
    const del = await request(`mindmaps/${mapId}`, "DELETE", ownerCookie, undefined, {
      [OWNER_HEADER]: "collab-owner",
    });
    expect(del.status).toBe(200);
    const leftUpdates = await platform.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM mindmap_crdt_updates WHERE mindmap_id = ?",
    ).bind(mapId).first<{ count: number }>();
    expect(leftUpdates?.count).toBe(0);
  });
});

describe("AI chat persistence & streaming plan API (D1)", () => {
  it("persists structured plan/steps/outcome per mindmap with shared viewer read-only access, idempotent upsert, clear, and delete cleanup", async () => {
    const ownerCookie = await login("aichat-owner");
    const viewerCookie = await login("aichat-viewer");
    const strangerCookie = await login("aichat-stranger");
    const mapId = crypto.randomUUID();
    const initial = getTemplate("blank-organic").create();

    const saveMap = await request(`mindmaps/${mapId}`, "PUT", ownerCookie, initial, {
      "If-Match": '"0"',
      [OWNER_HEADER]: "aichat-owner",
    });
    expect(saveMap.status).toBe(200);

    // Share with viewer
    const shareRes = await request("shares", "POST", ownerCookie, {
      type: "mindmap",
      resourceId: mapId,
      role: "viewer",
    });
    expect(shareRes.status).toBe(201);
    const { token } = await shareRes.json() as { token: string };
    const accept = await request(`invites/${token}/accept`, "POST", viewerCookie);
    expect(accept.status).toBe(200);

    // Owner saves a user + assistant turn containing plan, steps, and outcome
    const postMessages = await request(`mindmaps/${mapId}/ai-chat`, "POST", ownerCookie, {
      messages: [
        { id: "u-1", role: "user", content: "规划 Q4 产品发布", createdAt: "2026-11-27T10:00:00.000Z" },
        {
          id: "a-1",
          role: "assistant",
          content: "已生成 Q4 发布导图",
          status: "done",
          plan: { goal: "梳理 Q4 发布节奏", approach: "按 4 个阶段拆解", steps: ["需求冻结", "灰度发布"] },
          steps: [
            { id: "analyze", phase: "analyze", title: "已解析上下文", status: "done" },
            { id: "b-1", phase: "execute", title: "写入分支「灰度发布」", status: "done", topicId: "ai-0-0", count: 3 },
          ],
          outcome: {
            summary: "已生成 Q4 发布导图",
            appliedCount: 4,
            stats: { addedNodes: 4, updatedNodes: 1, layoutChanged: "timeline", durationMs: 1200 },
            highlights: [{ topicId: "ai-0-0", title: "灰度发布" }],
          },
          createdAt: "2026-11-27T10:00:02.000Z",
        },
      ],
    }, { [OWNER_HEADER]: "aichat-owner" });
    expect(postMessages.status).toBe(200);
    expect(await postMessages.json()).toEqual({ saved: 2 });

    // Re-posting the same IDs is idempotent (no duplicate rows)
    const repost = await request(`mindmaps/${mapId}/ai-chat`, "POST", ownerCookie, {
      messages: [{ id: "u-1", role: "user", content: "规划 Q4 产品发布" }],
    }, { [OWNER_HEADER]: "aichat-owner" });
    expect(repost.status).toBe(200);

    // Viewer can read full structured plan/steps/outcome history
    const viewerGet = await request(`mindmaps/${mapId}/ai-chat`, "GET", viewerCookie, undefined, {
      [OWNER_HEADER]: "aichat-viewer",
    });
    expect(viewerGet.status).toBe(200);
    const loaded = await viewerGet.json() as {
      messages: Array<{ id: string; plan?: { goal: string }; steps?: unknown[]; outcome?: { stats: { addedNodes: number } } }>;
    };
    expect(loaded.messages).toHaveLength(2);
    expect(loaded.messages[1].plan?.goal).toBe("梳理 Q4 发布节奏");
    expect(loaded.messages[1].steps).toHaveLength(2);
    expect(loaded.messages[1].outcome?.stats.addedNodes).toBe(4);

    // Viewer cannot write or clear AI chat history
    const viewerPost = await request(`mindmaps/${mapId}/ai-chat`, "POST", viewerCookie, {
      messages: [{ id: "u-v", role: "user", content: "unauthorized" }],
    }, { [OWNER_HEADER]: "aichat-viewer" });
    expect(viewerPost.status).toBe(403);
    const viewerDelete = await request(`mindmaps/${mapId}/ai-chat`, "DELETE", viewerCookie, undefined, {
      [OWNER_HEADER]: "aichat-viewer",
    });
    expect(viewerDelete.status).toBe(403);

    // Stranger cannot see or write history
    const strangerGet = await request(`mindmaps/${mapId}/ai-chat`, "GET", strangerCookie, undefined, {
      [OWNER_HEADER]: "aichat-stranger",
    });
    expect(strangerGet.status).toBe(200);
    expect(await strangerGet.json()).toEqual({ messages: [] });
    const strangerPost = await request(`mindmaps/${mapId}/ai-chat`, "POST", strangerCookie, {
      messages: [{ id: "u-s", role: "user", content: "nope" }],
    }, { [OWNER_HEADER]: "aichat-stranger" });
    expect(strangerPost.status).toBe(404);

    // Mock AI stream emits structured `plan` event and accepts multi-turn `history`
    const streamRes = await worker.fetch(
      new Request(`${origin}/api/ai/stream`, {
        method: "POST",
        headers: { Origin: origin, Cookie: ownerCookie, "Content-Type": "application/json" },
        body: JSON.stringify({
          tier: "pro",
          intent: "generate_map",
          prompt: "设计一套安静的软件",
          locale: "zh",
          history: [
            { role: "user", content: "先梳理核心原则" },
            { role: "assistant", content: "已列出四项原则", planSummary: "4 维拆解", resultSummary: "新增 8 节点" },
          ],
        }),
      }),
      { ...env, AI_ALLOW_MOCK: "true" },
    );
    expect(streamRes.status).toBe(200);
    const sseText = await streamRes.text();
    expect(sseText).toContain("event: plan");
    expect(sseText).toContain("event: map_patch");
    expect(sseText).toContain("event: done");

    // Owner DELETE /api/mindmaps/:id cleans up mindmap_ai_messages
    const delMap = await request(`mindmaps/${mapId}`, "DELETE", ownerCookie, undefined, {
      [OWNER_HEADER]: "aichat-owner",
    });
    expect(delMap.status).toBe(200);
    const leftMsgs = await platform.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM mindmap_ai_messages WHERE mindmap_id = ?",
    ).bind(mapId).first<{ count: number }>();
    expect(leftMsgs?.count).toBe(0);
  });
});
