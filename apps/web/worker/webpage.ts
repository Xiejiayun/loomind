import { decodeHTML } from "entities";
import { SOURCE_PASSAGE_LIMIT, SOURCE_TEXT_LIMIT, type WebpageSource } from "../src/webpage-contract.js";
import { HttpError, json, readJson, requireOrigin } from "./http.js";

const HTML_BYTES = 1024 * 1024;
const redirects = new Set([301, 302, 303, 307, 308]);
const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]);

function origins(env: Env) {
  const local = URL.canParse(env.AUTH_ORIGIN) && loopback.has(new URL(env.AUTH_ORIGIN).hostname);
  return (env.SOURCE_WEB_ORIGINS ?? "").split(",").map((entry) => entry.trim()).filter((entry) => {
    if (!URL.canParse(entry)) return false;
    const url = new URL(entry);
    return url.origin === entry && entry !== env.AUTH_ORIGIN && (url.protocol === "https:" || (local && url.protocol === "http:" && loopback.has(url.hostname)));
  });
}

function destination(value: unknown, allowed: string[], base?: URL) {
  if (typeof value !== "string" || !value.trim() || value.length > 2048 || !URL.canParse(value, base)) throw new HttpError(400, "address");
  const url = new URL(value, base);
  if (url.username || url.password || url.href.length > 2048 || !allowed.includes(url.origin)) throw new HttpError(422, "publisher");
  url.hash = "";
  return url;
}

async function readHtml(response: Response) {
  const contentType = response.headers.get("Content-Type") ?? "";
  const charset = /;\s*charset\s*=\s*["']?([^\s;"']+)/i.exec(contentType)?.[1];
  if (contentType.split(";")[0].trim().toLowerCase() !== "text/html" || (charset && !/^(?:utf-?8|us-ascii)$/i.test(charset))) {
    await response.body?.cancel(); throw new HttpError(415, "format");
  }
  if (Number(response.headers.get("Content-Length")) > HTML_BYTES) { await response.body?.cancel(); throw new HttpError(413, "size"); }
  const reader = response.body?.getReader();
  if (!reader) throw new HttpError(422, "empty");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > HTML_BYTES) { await reader.cancel(); throw new HttpError(413, "size"); }
    chunks.push(chunk.value);
  }
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  try { return chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join("") + decoder.decode(); }
  catch { throw new HttpError(415, "format"); }
}

async function extract(html: string, url: URL): Promise<WebpageSource> {
  const clean = new HTMLRewriter();
  for (const selector of ["nav", "aside", "header", "footer", "form", "script", "style", "noscript", "template", "[hidden]", '[aria-hidden="true"]', '[role="navigation"]', '[role="complementary"]', '[role="banner"]', '[role="contentinfo"]', ".advertisement", ".navbox"]) {
    clean.on(selector, { element(element) { element.remove(); } });
  }
  clean.on("br", { element(element) { element.replace(" "); } });
  const reader = new HTMLRewriter();
  const plain = (parts: string[]) => decodeHTML(parts.join("")).replace(/\s+/gu, " ").trim();
  const firstText = (selector: string) => {
    const parts: string[] = [];
    let seen = false, first = false;
    reader.on(selector, { element() { first = !seen; seen = true; }, text(chunk) { if (first) parts.push(chunk.text); } });
    return parts;
  };
  const titleParts = firstText("title"), headingParts = firstText("h1");
  const scopes = ["article", "main", '[role="main"]', "body"].map((selector) => {
    const paragraphs: string[] = [];
    const scope = { present: false, paragraphs, truncated: false, flush };
    let parts: string[] = [], length = 0;
    function flush() {
      if (!parts.length) return;
      const quote = plain(parts); parts = [];
      if (!quote) return;
      if (paragraphs.length === SOURCE_PASSAGE_LIMIT || length + quote.length > SOURCE_TEXT_LIMIT) { scope.truncated = true; return; }
      paragraphs.push(quote); length += quote.length;
    }
    reader.on(selector, { element() { scope.present = true; } });
    reader.on(`${selector} p`, { element: flush, text(chunk) { if (!scope.truncated) parts.push(chunk.text); } });
    return scope;
  });
  const filtered = clean.transform(new Response(html));
  await reader.transform(filtered).body!.pipeTo(new WritableStream({ write() {} }));
  scopes.forEach((scope) => scope.flush());
  const semantic = scopes.slice(0, -1).filter((scope) => scope.present);
  const scope = semantic.length ? semantic.find((candidate) => candidate.paragraphs.length || candidate.truncated) : scopes.at(-1);
  if (!scope?.paragraphs.length) throw new HttpError(422, scope?.truncated ? "paragraphSize" : "empty");
  const title = plain(titleParts) || plain(headingParts) || url.hostname;
  return { title: title.slice(0, 120), url: url.href, paragraphs: scope.paragraphs, truncated: scope.truncated };
}

export async function handleWebpage(request: Request, env: Env, subject?: string) {
  if (!subject) throw new HttpError(401, "signin");
  const allowed = origins(env);
  if (request.method === "GET") return json(allowed);
  if (request.method !== "POST") return json({ error: "method" }, 405, [], { Allow: "GET, POST" });
  requireOrigin(request, env);
  const body = await readJson(request, 4096, "address");
  let url = destination(body && typeof body === "object" && "url" in body ? body.url : null, allowed);
  if (!(await env.WEB_SOURCE_LIMIT.limit({ key: subject })).success) throw new HttpError(429, "limit");
  const signal = AbortSignal.timeout(8000);
  try {
    for (let hop = 0; hop <= 3; hop++) {
      const response = await fetch(url.href, { redirect: "manual", signal, headers: { Accept: "text/html", "User-Agent": "Loomind-SourceReader/1.0" } });
      if (redirects.has(response.status)) {
        await response.body?.cancel();
        url = destination(response.headers.get("Location"), allowed, url);
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new HttpError(422, "unavailable"); }
      return json(await extract(await readHtml(response), url));
    }
    throw new HttpError(422, "unavailable");
  } catch (reason) {
    if (reason instanceof HttpError) throw reason;
    throw new HttpError(signal.aborted ? 504 : 502, "unavailable");
  }
}
