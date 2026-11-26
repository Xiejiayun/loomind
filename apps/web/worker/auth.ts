import { createRemoteJWKSet, errors, jwtVerify, SignJWT } from "jose";
import { LOGIN_ACTION, type AuthUser, type LoginChallenge, type Session } from "../src/auth/shared.js";
import { handleAi } from "./ai.js";
import { handleDraft } from "./drafts.js";
import { HttpError, json, readJson, requireOrigin } from "./http.js";
import { handleShare, handleInvite } from "./sharing.js";
import { handleWorkspace } from "./workspaces.js";

const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const challengeCookie = "__Host-loomind-login";
const sessionCookie = "__Host-loomind-session";
const challengeTtl = 10 * 60;
const sessionTtl = 12 * 60 * 60;
const guest: Session = { user: null, expiresAt: null };

function cookie(name: string, value = "", maxAge = 0) {
  return `${name}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

function signingKey(env: Env) {
  const key = new TextEncoder().encode(env.SESSION_SECRET);
  if (key.length < 32) throw new HttpError(503, "账号登录尚未配置。游客编辑不受影响。");
  return key;
}

function issue(env: Env, audience: string, subject: string, expires: number, email?: string) {
  return new SignJWT(email ? { email } : {}).setProtectedHeader({ alg: "HS256" })
    .setIssuer(env.AUTH_ORIGIN).setAudience(audience).setSubject(subject)
    .setIssuedAt().setExpirationTime(expires).sign(signingKey(env));
}

async function readCookie(request: Request, env: Env, name: string) {
  const entry = request.headers.get("Cookie")?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!entry) return null;
  const key = signingKey(env);
  try {
    const { payload } = await jwtVerify(entry.slice(name.length + 1), key, {
      algorithms: ["HS256"], audience: name, issuer: env.AUTH_ORIGIN, requiredClaims: ["exp", "sub"],
    });
    return payload;
  } catch (err) {
    if (err instanceof errors.JOSEError) return null;
    throw err;
  }
}

async function loginBody(request: Request) {
  const input = await readJson(request, 16_384, "登录请求过大。");
  if (!input || typeof input !== "object" || !("credential" in input) || !("turnstileToken" in input) ||
      typeof input.credential !== "string" || !input.credential || input.credential.length > 12_288 ||
      typeof input.turnstileToken !== "string" || !input.turnstileToken || input.turnstileToken.length > 2048) {
    throw new HttpError(400, "缺少或无效的登录凭证。");
  }
  return { credential: input.credential, turnstileToken: input.turnstileToken };
}

async function verifyTurnstile(env: Env, token: string, ip: string | null) {
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
  if (ip) body.set("remoteip", ip);
  const unavailable = () => new HttpError(503, "暂时无法验证人机挑战，请稍后重试。");
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST", body, signal: AbortSignal.timeout(8_000),
  }).catch(() => { throw unavailable(); });
  if (!response.ok) throw unavailable();
  const result = await response.json<{ success?: boolean; hostname?: string; action?: string }>().catch(() => { throw unavailable(); });
  if (result?.success !== true || result.hostname !== new URL(env.AUTH_ORIGIN).hostname || result.action !== LOGIN_ACTION) {
    throw new HttpError(403, "人机验证失败或已过期，请重新验证。");
  }
}

async function verifyGoogle(env: Env, credential: string, nonce: string): Promise<AuthUser> {
  const invalid = () => new HttpError(401, "Google 登录凭证无效或已过期，请重新登录。");
  const { payload } = await jwtVerify(credential, googleKeys, {
    algorithms: ["RS256"], issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: env.GOOGLE_CLIENT_ID, requiredClaims: ["exp", "iat", "sub", "nonce"], maxTokenAge: "10m",
  }).catch((err: unknown) => {
    if (err instanceof errors.JWTClaimValidationFailed || err instanceof errors.JWTExpired ||
        err instanceof errors.JWSInvalid || err instanceof errors.JWTInvalid || err instanceof errors.JOSEAlgNotAllowed ||
        err instanceof errors.JWSSignatureVerificationFailed || err instanceof errors.JWKSNoMatchingKey) throw invalid();
    throw new HttpError(503, "暂时无法向 Google 验证身份，请稍后重试。");
  });
  if (payload.nonce !== nonce || typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 255 || payload.email_verified !== true ||
      typeof payload.email !== "string" || !payload.email ||
      ((payload.azp !== undefined || (Array.isArray(payload.aud) && payload.aud.length > 1)) && payload.azp !== env.GOOGLE_CLIENT_ID)) {
    throw invalid();
  }
  return { id: payload.sub, email: payload.email };
}

async function handle(request: Request, env: Env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === "/api/mindmaps" || path.startsWith("/api/mindmaps/")) {
    const session = await readCookie(request, env, sessionCookie);
    return handleDraft(request, env, session?.sub, path === "/api/mindmaps" ? undefined : path.slice("/api/mindmaps/".length));
  }
  if (path === "/api/workspaces" || path.startsWith("/api/workspaces/")) {
    const session = await readCookie(request, env, sessionCookie);
    return handleWorkspace(request, env, session?.sub, path);
  }
  if (path === "/api/shares" || path.startsWith("/api/shares/")) {
    const session = await readCookie(request, env, sessionCookie);
    return handleShare(request, env, session?.sub, path);
  }
  if (path.startsWith("/api/invites/")) {
    const session = request.method === "GET" ? null : await readCookie(request, env, sessionCookie);
    return handleInvite(request, env, session?.sub, path);
  }
  if (path === "/api/ai/config" || path === "/api/ai/stream") {
    const session = await readCookie(request, env, sessionCookie);
    return handleAi(request, env, session?.sub, path);
  }
  if (!["/api/auth/session", "/api/auth/challenge", "/api/auth/google", "/api/auth/logout"].includes(path)) {
    return json({ error: "接口不存在。" }, 404);
  }
  const method = path === "/api/auth/session" ? "GET" : "POST";
  if (request.method !== method) return json({ error: "请求方法不支持。" }, 405, [], { Allow: method });
  if (method === "GET") {
    const payload = await readCookie(request, env, sessionCookie);
    const session: Session = payload?.sub && payload.exp && typeof payload.email === "string"
      ? { user: { id: payload.sub, email: payload.email }, expiresAt: payload.exp * 1000 } : guest;
    return json(session);
  }
  if (path !== "/api/auth/logout" && (!env.GOOGLE_CLIENT_ID || !env.TURNSTILE_SITE_KEY || !env.TURNSTILE_SECRET)) {
    throw new HttpError(503, "账号登录尚未配置。游客编辑不受影响。");
  }
  requireOrigin(request, env);
  if (path === "/api/auth/logout") return json(guest, 200, [cookie(sessionCookie), cookie(challengeCookie)]);

  const now = Math.floor(Date.now() / 1000);
  if (path === "/api/auth/challenge") {
    const nonce = crypto.randomUUID();
    const proof = await issue(env, challengeCookie, nonce, now + challengeTtl);
    const challenge: LoginChallenge = { nonce, googleClientId: env.GOOGLE_CLIENT_ID, turnstileSiteKey: env.TURNSTILE_SITE_KEY };
    return json(challenge, 200, [cookie(challengeCookie, proof, challengeTtl)]);
  }
  const challenge = await readCookie(request, env, challengeCookie);
  if (!challenge?.sub) throw new HttpError(401, "登录请求已过期，请重试。");
  const { credential, turnstileToken } = await loginBody(request);
  await verifyTurnstile(env, turnstileToken, request.headers.get("CF-Connecting-IP"));
  const user = await verifyGoogle(env, credential, challenge.sub);
  const expires = now + sessionTtl;
  const signed = await issue(env, sessionCookie, user.id, expires, user.email);
  return json({ user, expiresAt: expires * 1000 } satisfies Session, 200, [cookie(sessionCookie, signed, sessionTtl), cookie(challengeCookie)]);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try { return await handle(request, env); } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error("Loomind API error", err instanceof Error ? err.name : "unknown");
      return json({ error: "服务暂不可用，请稍后重试。" }, 503);
    }
  },
};
