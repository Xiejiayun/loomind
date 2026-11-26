import { describe, expect, it } from "vitest";
import { createDocument, LocalImmerSyncAdapter, richTextToPlainText } from "@mindmap/core";
import {
  AiClientError,
  createHttpAiTransport,
  parsePartialJson,
  reconcileStreamingTree,
  runNodeAiAction,
  sanitizeAiMindmapPartial,
  serializeAiContext,
  streamGenerateMindmap,
} from "../src/index.js";

function sseResponse(blocks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const block of blocks) {
        controller.enqueue(encoder.encode(block));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream; charset=utf-8" },
  });
}

describe("@mindmap/ai streaming & actions", () => {
  it("reconciles streaming partial trees incrementally without duplicating nodes", () => {
    const doc = createDocument();
    const adapter = new LocalImmerSyncAdapter(doc);
    const sheetId = doc.activeSheetId;
    const rootId = doc.sheets[0].rootTopic.id;

    reconcileStreamingTree(
      adapter,
      sheetId,
      rootId,
      { title: "AI 规划", children: [{ title: "阶段一" }] },
      "testai",
    );
    reconcileStreamingTree(
      adapter,
      sheetId,
      rootId,
      {
        title: "AI 规划",
        children: [
          { title: "阶段一（更新）", children: [{ title: "子任务 A" }] },
          { title: "阶段二" },
        ],
      },
      "testai",
    );

    const root = adapter.getDocument().sheets[0].rootTopic;
    expect(richTextToPlainText(root.title)).toBe("AI 规划");
    const aiChildren = root.children.filter((c) => c.id.startsWith("testai-"));
    expect(aiChildren).toHaveLength(2);
    expect(richTextToPlainText(aiChildren[0].title)).toBe("阶段一（更新）");
    expect(aiChildren[0].children).toHaveLength(1);
  });

  it("executes node-level AI actions (expand, tasks, restyle)", async () => {
    const doc = createDocument();
    const adapter = new LocalImmerSyncAdapter(doc);
    const sheetId = doc.activeSheetId;
    const targetId = doc.sheets[0].rootTopic.children[0].id;

    await runNodeAiAction(adapter, sheetId, targetId, "tasks");
    const updated = adapter.getDocument().sheets[0].rootTopic.children[0];
    expect(updated.children).toHaveLength(4);
    expect(updated.children.every((c) => c.task?.status === "todo")).toBe(true);
  });

  it("returns localized English output when locale is set to en", async () => {
    const doc = createDocument();
    const adapter = new LocalImmerSyncAdapter(doc);
    const sheetId = doc.activeSheetId;
    const targetId = doc.sheets[0].rootTopic.children[0].id;

    const msg = await runNodeAiAction(adapter, sheetId, targetId, "expand", "en");
    expect(msg).toContain("Expanded 4 subtopics");
    const updated = adapter.getDocument().sheets[0].rootTopic.children[0];
    expect(richTextToPlainText(updated.children[0].title)).toContain("Key Elements");
  });

  it("parses partial/fenced JSON and enforces mindmap output guardrails", () => {
    const parsed = parsePartialJson('```json\n{"title":"Roadmap","root":{"title":"Roadmap","children":[{"title":"Q1"');
    expect(parsed).toEqual({
      title: "Roadmap",
      root: { title: "Roadmap", children: [{ title: "Q1" }] },
    });

    const oversized = sanitizeAiMindmapPartial({
      title: "x".repeat(200),
      recommendedStructure: "invalid" as never,
      recommendedPalette: "aurora",
      root: {
        title: "Root",
        children: Array.from({ length: 20 }, (_, i) => ({
          title: `Branch ${i}`,
          labels: ["a", "b", "c", "d"],
        })),
      },
    });
    expect(oversized.title).toHaveLength(120);
    expect(oversized.recommendedStructure).toBeUndefined();
    expect(oversized.recommendedPalette).toBe("aurora");
    expect(oversized.root?.children).toHaveLength(12);
    expect(oversized.root?.children?.[0]?.labels).toHaveLength(3);
  });

  it("serializes compact AI context without binary assets", () => {
    const doc = createDocument();
    doc.assets["img-1"] = {
      resourceId: "img-1",
      mimeType: "image/png",
      sha256: "deadbeef",
      dataBase64: "A".repeat(20_000),
      width: 100,
      height: 100,
    };
    const sheet = doc.sheets[0];
    const ctx = serializeAiContext(doc, sheet.id, sheet.rootTopic.children[0].id, [sheet.rootTopic.children[0].id]);
    const raw = JSON.stringify(ctx);
    expect(raw).not.toContain("AAAA");
    expect(ctx.activeTopicId).toBe(sheet.rootTopic.children[0].id);
    expect(ctx.outline.children?.length).toBeGreaterThan(0);
  });

  it("streams full mindmap via HTTP SSE transport with single-step undo and heartbeat skipping", async () => {
    const doc = createDocument();
    const initialTitle = richTextToPlainText(doc.sheets[0].rootTopic.title);
    const adapter = new LocalImmerSyncAdapter(doc);
    const sheetId = doc.activeSheetId;

    const transport = createHttpAiTransport("/api/ai/stream", async () =>
      sseResponse([
        `: ping\n\n`,
        `event: meta\ndata: ${JSON.stringify({ requestId: "req-1", tier: "pro", providerLabel: "Pro LLM", modelLabel: "gpt-6.2-sol", isMock: false, remainingToday: 99, dailyLimit: 100 })}\n\n`,
        `event: map_patch\ndata: ${JSON.stringify({ partial: { title: "Launch Plan", recommendedStructure: "timeline", recommendedPalette: "aurora", root: { title: "Launch Plan", children: [{ title: "Phase 1" }] } } })}\n\n`,
        `event: map_patch\ndata: ${JSON.stringify({ partial: { title: "Launch Plan", recommendedStructure: "timeline", recommendedPalette: "aurora", root: { title: "Launch Plan", children: [{ title: "Phase 1", children: [{ title: "Beta", task: "todo" }] }, { title: "Phase 2" }] } } })}\n\n`,
        `event: done\ndata: ${JSON.stringify({ summary: "Generated launch plan", appliedCount: 3 })}\n\n`,
      ]),
    );

    const res = await streamGenerateMindmap({
      adapter,
      sheetId,
      prompt: "Launch Plan",
      transport,
      tier: "pro",
      locale: "en",
    });

    expect(res?.meta?.tier).toBe("pro");
    expect(adapter.getDocument().sheets[0].structure).toBe("timeline");
    expect(richTextToPlainText(adapter.getDocument().sheets[0].rootTopic.title)).toBe("Launch Plan");
    expect(adapter.getDocument().sheets[0].rootTopic.children).toHaveLength(2);

    // Single Undo rolls back the whole streaming transaction
    adapter.undo();
    expect(richTextToPlainText(adapter.getDocument().sheets[0].rootTopic.title)).toBe(initialTitle);
  });

  it("executes remote node actions via SSE commands and surfaces typed rate-limit errors", async () => {
    const doc = createDocument();
    const adapter = new LocalImmerSyncAdapter(doc);
    const sheetId = doc.activeSheetId;
    const targetId = doc.sheets[0].rootTopic.children[0].id;

    const okTransport = createHttpAiTransport("/api/ai/stream", async () =>
      sseResponse([
        `event: commands\ndata: ${JSON.stringify({ ops: [{ kind: "addChildren", targetTopicId: targetId, items: [{ title: "Remote Idea A", task: "todo" }, { title: "Remote Idea B" }] }] })}\n\n`,
        `event: message_delta\ndata: ${JSON.stringify({ delta: "Added 2 remote ideas" })}\n\n`,
        `event: done\ndata: ${JSON.stringify({ summary: "Added 2 remote ideas", appliedCount: 2 })}\n\n`,
      ]),
    );

    const msg = await runNodeAiAction(adapter, sheetId, targetId, "expand", "en", {
      transport: okTransport,
      tier: "free",
    });
    expect(msg).toBe("Added 2 remote ideas");
    expect(adapter.getDocument().sheets[0].rootTopic.children[0].children).toHaveLength(2);

    const rateLimitedTransport = createHttpAiTransport("/api/ai/stream", async () =>
      new Response(JSON.stringify({ code: "RATE_LIMITED", error: "Daily limit reached", retryAfterSec: 3600 }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      runNodeAiAction(adapter, sheetId, targetId, "expand", "en", {
        transport: rateLimitedTransport,
        tier: "free",
      }),
    ).rejects.toMatchObject({
      name: "AiClientError",
      code: "RATE_LIMITED",
      status: 429,
      retryAfterSec: 3600,
    } satisfies Partial<AiClientError>);
  });
});
