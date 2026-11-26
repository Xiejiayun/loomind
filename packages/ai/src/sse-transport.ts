import {
  AiClientError,
  type AiErrorCode,
  type AiStreamEvent,
  type AiStreamRequest,
  type AiTransport,
} from "./protocol.js";

function mapHttpStatusToCode(status: number, bodyCode?: string): AiErrorCode {
  if (bodyCode) {
    switch (bodyCode) {
      case "AUTH_REQUIRED":
      case "RATE_LIMITED":
      case "PRO_NOT_CONFIGURED":
      case "FREE_UNAVAILABLE":
      case "UPSTREAM_ERROR":
      case "UPSTREAM_TIMEOUT":
      case "INVALID_OUTPUT":
      case "INVALID_REQUEST":
      case "ABORTED":
      case "NETWORK_ERROR":
        return bodyCode;
    }
  }
  if (status === 401) return "AUTH_REQUIRED";
  if (status === 429) return "RATE_LIMITED";
  if (status === 400 || status === 413 || status === 415) return "INVALID_REQUEST";
  if (status === 504) return "UPSTREAM_TIMEOUT";
  if (status === 503) return "PRO_NOT_CONFIGURED";
  return "UPSTREAM_ERROR";
}

/**
 * Parses a standard SSE byte stream into typed `AiStreamEvent` frames.
 * Comment lines (e.g. `: ping`) are ignored cleanly.
 */
export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<AiStreamEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const abortError = () => new AiClientError("ABORTED", "Request aborted");

  const onAbort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    for (;;) {
      if (signal?.aborted) throw abortError();
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");

      let sepIndex: number;
      while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
        const rawBlock = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        const parsed = parseSseBlock(rawBlock);
        if (parsed) yield parsed;
      }
    }

    buffer += decoder.decode();
    buffer = buffer.replace(/\r\n/g, "\n").trim();
    if (buffer) {
      const parsed = parseSseBlock(buffer);
      if (parsed) yield parsed;
    }
  } catch (err) {
    if (signal?.aborted) throw abortError();
    if (err instanceof AiClientError) throw err;
    throw new AiClientError(
      "NETWORK_ERROR",
      err instanceof Error ? err.message : "SSE stream interrupted",
    );
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}

function parseSseBlock(block: string): AiStreamEvent | null {
  let eventName = "";
  const dataLines: string[] = [];

  for (const line of block.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (!eventName || dataLines.length === 0) return null;
  const payload = dataLines.join("\n");
  try {
    const data = JSON.parse(payload);
    return { event: eventName, data } as AiStreamEvent;
  } catch {
    return null;
  }
}

/**
 * Browser/Node HTTP transport targeting Loomind's `/api/ai/stream` SSE endpoint.
 */
export function createHttpAiTransport(
  endpoint = "/api/ai/stream",
  fetchImpl: typeof fetch = fetch,
): AiTransport {
  return {
    async *stream(request: AiStreamRequest, signal?: AbortSignal): AsyncIterable<AiStreamEvent> {
      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify(request),
          signal,
        });
      } catch (err) {
        if (signal?.aborted) {
          throw new AiClientError("ABORTED", "Request aborted");
        }
        throw new AiClientError(
          "NETWORK_ERROR",
          err instanceof Error ? err.message : "Unable to reach AI service",
        );
      }

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string; message?: string; code?: string; retryAfterSec?: number }
          | null;
        const retryHeader = Number(response.headers.get("Retry-After"));
        const retryAfterSec =
          typeof body?.retryAfterSec === "number"
            ? body.retryAfterSec
            : Number.isFinite(retryHeader) && retryHeader > 0
              ? retryHeader
              : undefined;
        throw new AiClientError(
          mapHttpStatusToCode(response.status, body?.code),
          body?.error || body?.message || `AI service error (${response.status})`,
          response.status,
          retryAfterSec,
        );
      }

      if (!response.body) {
        throw new AiClientError("UPSTREAM_ERROR", "AI service returned an empty stream");
      }

      for await (const ev of parseSseStream(response.body, signal)) {
        if (ev.event === "error") {
          throw new AiClientError(ev.data.code, ev.data.message, undefined, ev.data.retryAfterSec);
        }
        yield ev;
      }
    },
  };
}
