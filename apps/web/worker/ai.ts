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

function getDailyLimit(env: Env, tier: WorkerAiTier): number {
  return tier === "pro"
    ? parsePositiveInt(env.AI_PRO_DAILY_LIMIT, 100)
    : parsePositiveInt(env.AI_FREE_DAILY_LIMIT, 10);
}

function utcDayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function secondsUntilUtcMidnight(): number {
  const now = new Date();
  const nextMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(60, Math.ceil((nextMidnight - now.getTime()) / 1000));
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function resolveBucketKey(request: Request, env: Env, tier: WorkerAiTier, subject?: string): Promise<string> {
  if (tier === "pro" && subject) {
    return `sub:${subject}`;
  }
  const ip =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "local-dev";
  const salt = env.SESSION_SECRET || "loomind-free-salt";
  return `ip:${(await sha256Hex(`${ip}:${salt}`)).slice(0, 32)}`;
}

async function readDailyUsage(env: Env, bucketKey: string, tier: WorkerAiTier): Promise<number> {
  if (!env.DB) return 0;
  try {
    const row = await env.DB.prepare(
      "SELECT request_count AS count FROM ai_usage_daily WHERE bucket_key = ? AND day_utc = ? AND tier = ?",
    )
      .bind(bucketKey, utcDayKey(), tier)
      .first<{ count: number }>();
    return Number(row?.count ?? 0);
  } catch {
    return 0;
  }
}

async function consumeDailyQuota(
  env: Env,
  bucketKey: string,
  tier: WorkerAiTier,
  limit: number,
): Promise<{ allowed: boolean; remaining: number }> {
  if (!env.DB) return { allowed: true, remaining: Math.max(0, limit - 1) };
  const day = utcDayKey();
  try {
    const current = await readDailyUsage(env, bucketKey, tier);
    if (current >= limit) {
      return { allowed: false, remaining: 0 };
    }
    await env.DB.prepare(
      `INSERT INTO ai_usage_daily (bucket_key, day_utc, tier, request_count)
       VALUES (?, ?, ?, 1)
       ON CONFLICT(bucket_key, day_utc, tier)
       DO UPDATE SET request_count = request_count + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    )
      .bind(bucketKey, day, tier)
      .run();
    return { allowed: true, remaining: Math.max(0, limit - (current + 1)) };
  } catch {
    // Graceful fallback if migration 0005 has not been applied in an isolated test
    return { allowed: true, remaining: Math.max(0, limit - 1) };
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
      providerLabel: real ? "Loomind Pro LLM" : "Loomind Pro LLM (Mock)",
      modelLabel: model,
      requiresLogin: !subject,
    };
  }
  const real = hasRealFreeConfig(env);
  const model = resolveFreeModel(env);
  return {
    available: real || mockAllowed,
    isMock: !real && mockAllowed,
    providerLabel: real ? "Cloudflare Workers AI" : "Cloudflare Workers AI (Mock)",
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
  if (!prompt || prompt.length > 2_000) {
    throw new HttpError(400, "提示词须在 1 到 2000 字之间。");
  }
  const locale = obj.locale === "en" ? "en" : "zh";
  const targetTopicId =
    typeof obj.targetTopicId === "string" && obj.targetTopicId.trim()
      ? obj.targetTopicId.trim().slice(0, 120)
      : "root";
  const context =
    obj.context && typeof obj.context === "object" && !Array.isArray(obj.context)
      ? (obj.context as WorkerAiRequest["context"])
      : undefined;

  return { tier, intent, prompt, locale, targetTopicId, context };
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
    const dailyLimit = getDailyLimit(env, tier);
    const bucketKey = await resolveBucketKey(request, env, tier, subject);
    const used = tier === "pro" && !subject ? 0 : await readDailyUsage(env, bucketKey, tier);
    return json({
      tier,
      available: status.available,
      isMock: status.isMock,
      providerLabel: status.providerLabel,
      modelLabel: status.modelLabel,
      dailyLimit,
      remainingToday: Math.max(0, dailyLimit - used),
      requiresLogin: status.requiresLogin,
    });
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
    return json({ code: "AUTH_REQUIRED", error: "请先登录 Loomind 账号后使用付费 Pro 模型。" }, 401);
  }

  const status = buildConfigStatus(env, req.tier, subject);
  if (!status.available) {
    return json(
      {
        code: req.tier === "pro" ? "PRO_NOT_CONFIGURED" : "FREE_UNAVAILABLE",
        error:
          req.tier === "pro"
            ? "付费 Pro LLM 尚未完成服务端配置，请联系管理员补齐密钥。"
            : "Cloudflare Workers AI 免费体验服务暂不可用，请稍后重试。",
      },
      503,
    );
  }

  const dailyLimit = getDailyLimit(env, req.tier);
  const bucketKey = await resolveBucketKey(request, env, req.tier, subject);
  const quota = await consumeDailyQuota(env, bucketKey, req.tier, dailyLimit);
  if (!quota.allowed) {
    const retryAfterSec = secondsUntilUtcMidnight();
    return json(
      {
        code: "RATE_LIMITED",
        error:
          req.tier === "free"
            ? "今日免费体验次数已用完，登录账号即可解锁更强付费模型与更高配额。"
            : "今日 AI 调用额度已达上限，明天 UTC 00:00 自动重置。",
        retryAfterSec,
      },
      429,
      [],
      { "Retry-After": String(retryAfterSec) },
    );
  }

  const meta: ProviderMeta = {
    requestId: crypto.randomUUID(),
    tier: req.tier,
    providerLabel: status.providerLabel,
    modelLabel: status.modelLabel,
    isMock: status.isMock,
    remainingToday: quota.remaining,
    dailyLimit,
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

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
