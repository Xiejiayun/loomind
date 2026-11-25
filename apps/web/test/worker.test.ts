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

describe("mindmaps API (local workerd D1)", () => {
  it("migrates the former one-map account record without changing its revision", async () => {
    const legacy = await login("legacy");
    const owner = { [OWNER_HEADER]: "legacy" };
    const maps = await (await request("mindmaps", "GET", legacy, undefined, owner)).json() as { id: string }[];
    expect(maps).toHaveLength(1);
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
