import { errors, jwtVerify, SignJWT } from "jose";
import { HttpError, json, readJson, requireOrigin } from "./http.js";
import {
  allowMock,
  hasRealFreeConfig,
  hasRealProConfig,
  resolveFreeModel,
  resolveProModel,
  runMockAiStream,
  runProOpenAiStream,
  runWorkersAiStream,
  type ProviderMeta,
  type WorkerAiIntent,
  type WorkerAiRequest,
  type WorkerAiTier,
} from "./ai-providers.js";

const MAX_AI_BODY_BYTES = 64 * 1024;
const TRIAL_COOKIE_HTTPS = "__Host-loomind-trial";
const TRIAL_COOKIE_HTTP = "loomind-trial";
const TRIAL_COOKIE_AUD = "loomind-trial";
const TRIAL_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;
const TRIAL_LIFETIME_KEY = "lifetime";

const VALID_INTENTS = new Set<WorkerAiIntent>([
  "generate_map",
  "expand",
  "tasks",
  "summarize",
  "cluster",
  "elaborateNote",
  "restyle",
  "chat",
]);

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function getQuotaLimit(env: Env, tier: WorkerAiTier): number {
  return tier === "pro"
    ? parsePositiveInt(env.AI_PRO_DAILY_LIMIT, 100)
    : parsePositiveInt(env.AI_FREE_DAILY_LIMIT, 3);
}

function getFreeIpDailyLimit(env: Env): number {
  return Math.max(getQuotaLimit(env, "free"), parsePositiveInt(env.AI_FREE_IP_DAILY_LIMIT, 30));
}

function utcDayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function secondsUntilUtcMidnight(): number {
  const now = new Date();
  const nextMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(60, Math.ceil((nextMidnight - now.getTime()) / 1000));
}

async function sha256Bytes(input: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)));
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = await sha256Bytes(input);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function trialSigningKey(env: Env): Promise<Uint8Array> {
  return sha256Bytes(`loomind-trial:${env.SESSION_SECRET || "loomind-free-salt"}`);
}

function trialIssuer(env: Env): string {
  return env.AUTH_ORIGIN || "https://loomind.local";
}

function isHttpsRequest(request: Request): boolean {
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return true;
  }
}

async function readTrialId(request: Request, env: Env): Promise<string | null> {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";").map((part) => part.trim());
  const rawToken =
    parts.find((p) => p.startsWith(`${TRIAL_COOKIE_HTTPS}=`))?.slice(TRIAL_COOKIE_HTTPS.length + 1) ||
    parts.find((p) => p.startsWith(`${TRIAL_COOKIE_HTTP}=`))?.slice(TRIAL_COOKIE_HTTP.length + 1);
  if (!rawToken) return null;
  try {
    const { payload } = await jwtVerify(rawToken, await trialSigningKey(env), {
      algorithms: ["HS256"],
      audience: TRIAL_COOKIE_AUD,
      issuer: trialIssuer(env),
      requiredClaims: ["exp", "sub"],
    });
    return typeof payload.sub === "string" && payload.sub.length >= 16 && payload.sub.length <= 64
      ? payload.sub
      : null;
  } catch (err) {
    if (err instanceof errors.JOSEError) return null;
    return null;
  }
}

async function issueTrialCookie(request: Request, env: Env, trialId: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + TRIAL_COOKIE_MAX_AGE;
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(trialIssuer(env))
    .setAudience(TRIAL_COOKIE_AUD)
    .setSubject(trialId)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(await trialSigningKey(env));
  if (isHttpsRequest(request)) {
    return `${TRIAL_COOKIE_HTTPS}=${token}; Max-Age=${TRIAL_COOKIE_MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`;
  }
  return `${TRIAL_COOKIE_HTTP}=${token}; Max-Age=${TRIAL_COOKIE_MAX_AGE}; Path=/; HttpOnly; SameSite=Lax`;
}

async function resolveIpBucketKey(request: Request, env: Env): Promise<string> {
  const ip =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "local-dev";
  const salt = env.SESSION_SECRET || "loomind-free-salt";
  return `ip:${(await sha256Hex(`${ip}:${salt}`)).slice(0, 32)}`;
}

async function readUsage(
  env: Env,
  bucketKey: string,
  dayKey: string,
  tier: WorkerAiTier,
): Promise<number> {
  if (!env.DB) return 0;
  const row = await env.DB.prepare(
    "SELECT request_count AS count FROM ai_usage_daily WHERE bucket_key = ? AND day_utc = ? AND tier = ?",
  )
    .bind(bucketKey, dayKey, tier)
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

type QuotaConsumeResult =
  | { allowed: true; remaining: number }
  | { allowed: false; remaining: 0; dbError?: boolean };

async function consumeQuotaAtomic(
  env: Env,
  bucketKey: string,
  dayKey: string,
  tier: WorkerAiTier,
  limit: number,
): Promise<QuotaConsumeResult> {
  if (!env.DB) return { allowed: true, remaining: Math.max(0, limit - 1) };
  try {
    const [, updateRes] = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO ai_usage_daily (bucket_key, day_utc, tier, request_count)
         VALUES (?, ?, ?, 0)
         ON CONFLICT(bucket_key, day_utc, tier) DO NOTHING`,
      ).bind(bucketKey, dayKey, tier),
      env.DB.prepare(
        `UPDATE ai_usage_daily
         SET request_count = request_count + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE bucket_key = ? AND day_utc = ? AND tier = ? AND request_count < ?
         RETURNING request_count AS count`,
      ).bind(bucketKey, dayKey, tier, limit),
    ]);
    const rows = (updateRes as { results?: Array<{ count: number }> }).results ?? [];
    if (rows.length === 0) {
      return { allowed: false, remaining: 0 };
    }
    const nextCount = Number(rows[0].count);
    return { allowed: true, remaining: Math.max(0, limit - nextCount) };
  } catch {
    return { allowed: false, remaining: 0, dbError: true };
  }
}

async function refundQuota(
  env: Env,
  bucketKey: string,
  dayKey: string,
  tier: WorkerAiTier,
): Promise<void> {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      `UPDATE ai_usage_daily
       SET request_count = MAX(0, request_count - 1), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE bucket_key = ? AND day_utc = ? AND tier = ?`,
    )
      .bind(bucketKey, dayKey, tier)
      .run();
  } catch {
    // Best-effort refund
  }
}

function buildConfigStatus(env: Env, tier: WorkerAiTier, subject: string | undefined) {
  const mockAllowed = allowMock(env);
  if (tier === "pro") {
    const real = hasRealProConfig(env);
    const model = resolveProModel(env);
    return {
      available: Boolean(subject) && (real || mockAllowed),
      isMock: !real && mockAllowed,
      providerLabel: !real && mockAllowed ? "Loomind AI (Mock)" : "Loomind AI",
      modelLabel: model,
      requiresLogin: !subject,
    };
  }
  const real = hasRealFreeConfig(env);
  const model = resolveFreeModel(env);
  return {
    available: real || mockAllowed,
    isMock: !real && mockAllowed,
    providerLabel: !real && mockAllowed ? "Loomind AI (Mock)" : "Loomind AI",
    modelLabel: model.replace(/^@cf\/[^/]+\//, ""),
    requiresLogin: false,
  };
}

function parseStreamBody(raw: unknown): WorkerAiRequest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new HttpError(400, "无效的 AI 请求体。");
  }
  const obj = raw as Record<string, unknown>;
  const tier = obj.tier === "pro" ? "pro" : obj.tier === "free" ? "free" : null;
  if (!tier) throw new HttpError(400, "缺少有效的 AI 档位 (free / pro)。");
  const intent = typeof obj.intent === "string" && VALID_INTENTS.has(obj.intent as WorkerAiIntent)
    ? (obj.intent as WorkerAiIntent)
    : null;
  if (!intent) throw new HttpError(400, "不支持的 AI 意图类型。");
  const prompt = typeof obj.prompt === "string" ? obj.prompt.trim() : "";
  const locale = obj.locale === "en" || obj.locale === "zh" ? obj.locale : undefined;
  const targetTopicId =
    typeof obj.targetTopicId === "string" && obj.targetTopicId.trim()
      ? obj.targetTopicId.trim().slice(0, 120)
      : "root";
  const context =
    obj.context && typeof obj.context === "object" && !Array.isArray(obj.context)
      ? (obj.context as WorkerAiRequest["context"])
      : undefined;
  const nodeShortcut = intent !== "generate_map" && intent !== "chat" && typeof obj.targetTopicId === "string"
    && obj.targetTopicId.trim() && context?.outline;
  if (typeof obj.prompt !== "string" || (!prompt && !nodeShortcut) || prompt.length > 2_000) {
    throw new HttpError(400, "请提供有效的提问或节点快捷操作，提示词不能超过 2000 字。");
  }
  const history = Array.isArray(obj.history)
    ? obj.history
        .filter((h): h is Record<string, unknown> => Boolean(h && typeof h === "object" && !Array.isArray(h)))
        .slice(-6)
        .map((h) => {
          const role = h.role === "assistant" ? ("assistant" as const) : ("user" as const);
          const content = typeof h.content === "string" ? h.content.trim().slice(0, 400) : "";
          const planSummary = typeof h.planSummary === "string" ? h.planSummary.trim().slice(0, 220) : undefined;
          const resultSummary = typeof h.resultSummary === "string" ? h.resultSummary.trim().slice(0, 220) : undefined;
          return {
            role,
            content,
            ...(planSummary ? { planSummary } : {}),
            ...(resultSummary ? { resultSummary } : {}),
          };
        })
        .filter((h) => h.content.length > 0)
    : undefined;

  return { tier, intent, prompt, locale, targetTopicId, context, ...(history?.length ? { history } : {}) };
}

export async function handleAi(
  request: Request,
  env: Env,
  subject: string | undefined,
  path: string,
): Promise<Response> {
  if (path === "/api/ai/config") {
    if (request.method !== "GET") {
      return json({ error: "请求方法不支持。" }, 405, [], { Allow: "GET" });
    }
    const url = new URL(request.url);
    const tierParam = url.searchParams.get("tier");
    const tier: WorkerAiTier = tierParam === "pro" ? "pro" : tierParam === "free" ? "free" : subject ? "pro" : "free";
    const status = buildConfigStatus(env, tier, subject);
    const limit = getQuotaLimit(env, tier);
    const cookies: string[] = [];

    let remaining = limit;
    try {
      if (tier === "pro") {
        const used = subject ? await readUsage(env, `sub:${subject}`, utcDayKey(), "pro") : 0;
        remaining = Math.max(0, limit - used);
      } else {
        let trialId = await readTrialId(request, env);
        if (!trialId) {
          trialId = crypto.randomUUID();
          cookies.push(await issueTrialCookie(request, env, trialId));
        }
        const [deviceUsed, ipUsed] = await Promise.all([
          readUsage(env, `trial:${trialId}`, TRIAL_LIFETIME_KEY, "free"),
          readUsage(env, await resolveIpBucketKey(request, env), utcDayKey(), "free"),
        ]);
        const ipLimit = getFreeIpDailyLimit(env);
        remaining = ipUsed >= ipLimit ? 0 : Math.max(0, limit - deviceUsed);
      }
    } catch {
      remaining = 0;
    }

    return json(
      {
        tier,
        available: status.available,
        isMock: status.isMock,
        providerLabel: status.providerLabel,
        modelLabel: status.modelLabel,
        dailyLimit: limit,
        remainingToday: remaining,
        requiresLogin: status.requiresLogin,
      },
      200,
      cookies,
    );
  }

  if (path !== "/api/ai/stream") {
    return json({ error: "接口不存在。" }, 404);
  }
  if (request.method !== "POST") {
    return json({ error: "请求方法不支持。" }, 405, [], { Allow: "POST" });
  }

  requireOrigin(request, env);
  const rawBody = await readJson(request, MAX_AI_BODY_BYTES, "AI 请求上下文过大（上限 64 KiB）。");
  const req = parseStreamBody(rawBody);

  if (req.tier === "pro" && !subject) {
    return json({ code: "AUTH_REQUIRED", error: "请先登录 Loomind 账号后继续使用 AI。" }, 401);
  }

  const status = buildConfigStatus(env, req.tier, subject);
  if (!status.available) {
    return json(
      {
        code: req.tier === "pro" ? "PRO_NOT_CONFIGURED" : "FREE_UNAVAILABLE",
        error: "AI 服务暂不可用，请稍后重试。",
      },
      503,
    );
  }

  const limit = getQuotaLimit(env, req.tier);
  const setCookies: string[] = [];
  const consumedBuckets: Array<{ bucketKey: string; dayKey: string; tier: WorkerAiTier }> = [];
  let remainingAfterConsume = 0;

  if (req.tier === "pro") {
    const bucketKey = `sub:${subject!}`;
    const dayKey = utcDayKey();
    const quota = await consumeQuotaAtomic(env, bucketKey, dayKey, "pro", limit);
    if (!quota.allowed) {
      if (quota.dbError) {
        return json({ code: "UPSTREAM_ERROR", error: "服务暂时繁忙，请稍后重试。" }, 503);
      }
      const retryAfterSec = secondsUntilUtcMidnight();
      return json(
        {
          code: "RATE_LIMITED",
          error: "今日 AI 调用额度已达上限，明天自动重置。",
          retryAfterSec,
        },
        429,
        [],
        { "Retry-After": String(retryAfterSec) },
      );
    }
    consumedBuckets.push({ bucketKey, dayKey, tier: "pro" });
    remainingAfterConsume = quota.remaining;
  } else {
    const existingTrialId = await readTrialId(request, env);
    const ipBucket = await resolveIpBucketKey(request, env);
    const today = utcDayKey();

    if (existingTrialId) {
      // Two-layer quota: per-device total trial limit + per-IP daily anti-abuse cap
      const deviceBucket = `trial:${existingTrialId}`;
      const deviceQuota = await consumeQuotaAtomic(env, deviceBucket, TRIAL_LIFETIME_KEY, "free", limit);
      if (!deviceQuota.allowed) {
        if (deviceQuota.dbError) {
          return json({ code: "UPSTREAM_ERROR", error: "服务暂时繁忙，请稍后重试。" }, 503);
        }
        return json(
          {
            code: "RATE_LIMITED",
            error: "体验次数已用完，登录账号即可保存导图并继续使用 AI。",
          },
          429,
        );
      }
      consumedBuckets.push({ bucketKey: deviceBucket, dayKey: TRIAL_LIFETIME_KEY, tier: "free" });

      const ipLimit = getFreeIpDailyLimit(env);
      const ipQuota = await consumeQuotaAtomic(env, ipBucket, today, "free", ipLimit);
      if (!ipQuota.allowed) {
        await refundQuota(env, deviceBucket, TRIAL_LIFETIME_KEY, "free");
        if (ipQuota.dbError) {
          return json({ code: "UPSTREAM_ERROR", error: "服务暂时繁忙，请稍后重试。" }, 503);
        }
        const retryAfterSec = secondsUntilUtcMidnight();
        return json(
          {
            code: "RATE_LIMITED",
            error: "当前网络体验次数已达上限，登录账号即可保存导图并继续使用 AI。",
            retryAfterSec,
          },
          429,
          [],
          { "Retry-After": String(retryAfterSec) },
        );
      }
      consumedBuckets.push({ bucketKey: ipBucket, dayKey: today, tier: "free" });
      remainingAfterConsume = deviceQuota.remaining;
    } else {
      // Cookie-less client (e.g. stateless script or first direct POST): cap strictly by IP at free limit
      const ipQuota = await consumeQuotaAtomic(env, ipBucket, today, "free", limit);
      if (!ipQuota.allowed) {
        if (ipQuota.dbError) {
          return json({ code: "UPSTREAM_ERROR", error: "服务暂时繁忙，请稍后重试。" }, 503);
        }
        return json(
          {
            code: "RATE_LIMITED",
            error: "体验次数已用完，登录账号即可保存导图并继续使用 AI。",
          },
          429,
        );
      }
      consumedBuckets.push({ bucketKey: ipBucket, dayKey: today, tier: "free" });
      remainingAfterConsume = ipQuota.remaining;
      const mintedTrialId = crypto.randomUUID();
      setCookies.push(await issueTrialCookie(request, env, mintedTrialId));
    }
  }

  const meta: ProviderMeta = {
    requestId: crypto.randomUUID(),
    tier: req.tier,
    providerLabel: status.providerLabel,
    modelLabel: status.modelLabel,
    isMock: status.isMock,
    remainingToday: remainingAfterConsume,
    dailyLimit: limit,
  };

  const encoder = new TextEncoder();
  const abortController = new AbortController();
  request.signal.addEventListener("abort", () => abortController.abort(), { once: true });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const emit = (event: string, data: unknown) => {
        safeEnqueue(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const heartbeat = setInterval(() => {
        safeEnqueue(": ping\n\n");
      }, 15_000);

      void (async () => {
        try {
          emit("meta", meta);
          emit("status", { stage: "connecting" });

          if (status.isMock) {
            await runMockAiStream(req, emit, abortController.signal);
          } else if (req.tier === "pro") {
            await runProOpenAiStream(env, req, emit, abortController.signal);
          } else {
            await runWorkersAiStream(env, req, emit);
          }
        } catch (err) {
          // Refund quota if generation failed so users don't lose a trial on upstream errors
          for (const b of consumedBuckets) {
            await refundQuota(env, b.bucketKey, b.dayKey, b.tier);
          }
          if (!abortController.signal.aborted) {
            const msg = err instanceof Error ? err.message : "AI 服务生成失败，请稍后重试。";
            emit("error", { code: "UPSTREAM_ERROR", message: msg });
          }
        } finally {
          clearInterval(heartbeat);
          if (!closed) {
            closed = true;
            try {
              controller.close();
            } catch {
              // stream already cancelled
            }
          }
        }
      })();
    },
    cancel() {
      abortController.abort();
    },
  });

  const headers = new Headers({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff",
  });
  for (const c of setCookies) headers.append("Set-Cookie", c);

  return new Response(stream, { status: 200, headers });
}
