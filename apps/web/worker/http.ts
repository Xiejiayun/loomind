export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function signingKey(env: Env) {
  const key = new TextEncoder().encode(env.SESSION_SECRET);
  if (key.length < 32) throw new HttpError(503, "账号登录尚未配置。游客编辑不受影响。");
  return key;
}

export function json(data: unknown, status = 200, cookies: string[] = [], extraHeaders?: HeadersInit) {
  const headers = new Headers(extraHeaders);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return Response.json(data, { status, headers });
}

export function requireOrigin(request: Request, env: Env) {
  if (!env.AUTH_ORIGIN || request.headers.get("Origin") !== env.AUTH_ORIGIN) {
    throw new HttpError(403, "请从已配置的 Loomind 站点重试。");
  }
}

export async function readJson(request: Request, limit: number, sizeError: string): Promise<unknown> {
  if (request.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json") {
    throw new HttpError(415, "请求必须使用 JSON。");
  }
  if (Number(request.headers.get("Content-Length")) > limit) throw new HttpError(413, sizeError);
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "缺少请求内容。");
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new HttpError(413, sizeError);
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  try { return JSON.parse(text + decoder.decode()); }
  catch { throw new HttpError(400, "无效的 JSON。"); }
}
