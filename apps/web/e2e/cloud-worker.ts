import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { test as base, type BrowserContext, type Page } from "@playwright/test";
import { SignJWT } from "jose";
import { createTestHarness } from "wrangler";

export const cloudBrowser = { locale: "en-US", ignoreHTTPSErrors: true };

interface CloudWorker {
  origin: string;
  openPage(context: BrowserContext, subject?: string): Promise<Page>;
  pruneUpdates(mapId: string): Promise<number>;
}

export function cloudPages(url: URL, secret: string): Pick<CloudWorker, "origin" | "openPage"> {
  return { origin: url.origin, async openPage(context, subject) {
    if (subject) {
      const name = "__Host-loomind-session";
      const value = await new SignJWT({ email: `${subject}@example.test` }).setProtectedHeader({ alg: "HS256" })
        .setIssuer(url.origin).setAudience(name).setSubject(subject).setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode(secret));
      await context.addCookies([{ name, value, domain: url.hostname, path: "/", secure: true, httpOnly: true, sameSite: "Strict" }]);
    }
    await context.route("https://fonts.googleapis.com/**", (route) => route.fulfill({ contentType: "text/css", body: "" }));
    return context.newPage();
  } };
}

export const test = base.extend<{ cloud: CloudWorker }>({
  cloud: async ({}, use) => {
    const secret = randomBytes(32).toString("hex");
    const configPath = fileURLToPath(new URL("./wrangler.jsonc", import.meta.url));
    const worker = { configPath, secrets: { SESSION_SECRET: secret } };
    const server = createTestHarness({ workers: [worker] });
    try {
      const { url } = await server.listen();
      await server.update({ workers: [{ ...worker, vars: { AUTH_ORIGIN: url.origin } }] });
      await server.getWorker().applyD1Migrations("DB");
      await use({ ...cloudPages(url, secret), async pruneUpdates(mapId) {
        const { DB } = await server.getWorker<{ DB: D1Database }>().getEnv();
        const result = await DB.prepare("DELETE FROM mindmap_crdt_updates WHERE mindmap_id = ?").bind(mapId).run();
        return result.meta.changes;
      } });
    } finally { await server.close(); }
  },
});
