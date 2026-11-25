import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { getPlatformProxy, type PlatformProxy } from "wrangler";
import { getTemplate } from "@mindmap/core";
import worker from "../worker/auth.js";
import { DRAFT_LIMIT, OWNER_HEADER } from "../src/drafts/shared.js";

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
  return { nonce: (await response.json()).nonce as string, cookie: response.headers.getSetCookie()[0].split(";")[0] };
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
    expect((await (await request("auth/session", "GET", pair)).json()).user.id).toBe("alice");
    expect((await (await request("auth/session", "GET", pair + "broken")).json()).user).toBeNull();
    expect((await request("auth/google", "POST", item.cookie, body)).status).toBe(403);
    const logout = await request("auth/logout", "POST", pair);
    expect(logout.headers.getSetCookie().filter(value => value.includes("Max-Age=0"))).toHaveLength(2);
    expect((await (await request("auth/session")).json()).user).toBeNull();
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
    expect(await (await request(`mindmaps/${maps[0].id}`, "GET", legacy, undefined, owner)).json()).toMatchObject({ revision: 3 });
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
    expect((await (await request("mindmaps", "GET", alice, undefined, owner)).json()).map((item: { id: string }) => item.id).sort()).toEqual([first, second]);
    const variants = ["laptop", "phone"].map(title => ({ ...doc, sheets: [{ ...doc.sheets[0], title }] }));
    const responses = await Promise.all(variants.map(draft => request(`mindmaps/${first}`, "PUT", alice, draft, { ...owner, "If-Match": '"1"' })));
    expect(responses.map(value => value.status).sort()).toEqual([200, 409]);
    expect(await (await request(`mindmaps/${first}`, "GET", alice, undefined, owner)).json()).toEqual({ revision: 2, document: variants[responses.findIndex(value => value.ok)] });
    expect(await (await request(`mindmaps/${first}`, "GET", bob, undefined, { [OWNER_HEADER]: "bob" })).json()).toEqual({ revision: 0, document: null });
    expect(await (await request(`mindmaps/${second}`, "GET", bob, undefined, { [OWNER_HEADER]: "bob" })).json()).toEqual({ revision: 0, document: null });
  });
});
