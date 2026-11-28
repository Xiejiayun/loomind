import { describe, expect, it, vi } from "vitest";
import type { LanguageModelV1 } from "ai";
import { createDocument, LocalImmerSyncAdapter, richTextToPlainText } from "@mindmap/core";
import {
  AiClientError,
  createHttpAiTransport,
  parsePartialJson,
  reconcileStreamingTree,
  runNodeAiAction,
  runNodeAiActionDetailed,
  sanitizeAiMindmapPartial,
  sanitizeAiPlan,
  serializeAiContext,
  streamGenerateMindmap,
  type AiStreamEvent,
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
  it("keeps path IDs stable within a stream but never reuses a previous run at the same time", async () => {
    const adapter = new LocalImmerSyncAdapter(createDocument());
    const transport = createHttpAiTransport("/api/ai/stream", async () => sseResponse([
      'event: map_patch\ndata: {"partial":{"root":{"title":"Map","children":[{"title":"Same name"},{"title":"Same name"}]}}}\n\n',
      'event: done\ndata: {"summary":"Done","appliedCount":1}\n\n',
    ]));
    const clock = vi.spyOn(Date, "now").mockReturnValue(12345678);
    try {
      const run = async () => {
        await streamGenerateMindmap({ adapter, sheetId: adapter.getDocument().activeSheetId, prompt: "Draw", transport });
        return adapter.getDocument().sheets[0].rootTopic.children.map((topic) => topic.id);
      };
      const first = await run(), second = await run();
      expect(new Set([...first, ...second]).size).toBe(4);
      expect(adapter.getDocument().deletedIds).toEqual(expect.arrayContaining(first));
    } finally { clock.mockRestore(); }
  });

  it("reconciles streaming partial trees incrementally without duplicating nodes", () => {
    const doc = createDocument();
    const adapter = new LocalImmerSyncAdapter(doc);
    const sheetId = doc.activeSheetId;
    const rootId = doc.sheets[0].rootTopic.id;

    reconcileStreamingTree(adapter, sheetId, rootId, { children: [{ children: [{ title: "细节" }] }] }, "testai");
    expect(adapter.getDocument().sheets[0].rootTopic).toEqual(doc.sheets[0].rootTopic);
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

  it("produces the fixed task fixture only in explicit demo mode", async () => {
    const doc = createDocument();
    const adapter = new LocalImmerSyncAdapter(doc);
    const sheetId = doc.activeSheetId;
    const targetId = doc.sheets[0].rootTopic.children[0].id;

    await runNodeAiAction(adapter, sheetId, targetId, "tasks", "zh", { demo: true });
    const updated = adapter.getDocument().sheets[0].rootTopic.children[0];
    expect(updated.children).toHaveLength(4);
    expect(updated.children.every((c) => c.task?.status === "todo")).toBe(true);
  });

  it("labels the localized expansion fixture as a demo", async () => {
    const doc = createDocument();
    const adapter = new LocalImmerSyncAdapter(doc);
    const sheetId = doc.activeSheetId;
    const targetId = doc.sheets[0].rootTopic.children[0].id;

    const msg = await runNodeAiAction(adapter, sheetId, targetId, "expand", "en", { demo: true });
    expect(msg).toContain("Demo: Expanded 4 subtopics");
    const updated = adapter.getDocument().sheets[0].rootTopic.children[0];
    expect(richTextToPlainText(updated.children[0].title)).toContain("Key Elements");
  });

  it("does not invent content or overwrite the canvas when no provider is available", async () => {
    const doc = createDocument();
    const adapter = new LocalImmerSyncAdapter(doc);
    const sheetId = doc.activeSheetId;
    const before = structuredClone(adapter.getDocument());
    await expect(streamGenerateMindmap({ adapter, sheetId, prompt: "比较两种方案" })).rejects.toMatchObject({ code: "FREE_UNAVAILABLE" });
    await expect(runNodeAiAction(adapter, sheetId, doc.sheets[0].rootTopic.id, "expand", "zh", { tier: "pro" })).rejects.toMatchObject({ code: "PRO_NOT_CONFIGURED" });
    await expect(streamGenerateMindmap({ adapter, sheetId, prompt: " ", demo: true })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(adapter.getDocument()).toEqual(before);
  });

  it("passes the unwrapped question to the direct model and preserves its language and shape", async () => {
    const doc = createDocument();
    const adapter = new LocalImmerSyncAdapter(doc);
    const question = "请用法语画出水的三态";
    const titles = ["Solide", "Liquide", "Gaz"];
    const output = { title: "États de l’eau", root: { title: "États de l’eau", children: titles.map(title => ({ title })) }, summary: "Les trois états de l’eau." };
    const model: LanguageModelV1 = {
      specificationVersion: "v1", provider: "fixture", modelId: "fixture", defaultObjectGenerationMode: "json",
      doGenerate: () => { throw new Error("Expected streaming"); },
      doStream: async ({ prompt }) => {
        expect(prompt.find(entry => entry.role === "system")?.content).toContain("language explicitly requested");
        expect(prompt.find(entry => entry.role === "user")?.content).toEqual([{ type: "text", text: question }]);
        return { rawCall: { rawPrompt: prompt, rawSettings: {} }, stream: new ReadableStream({ start(controller) {
          controller.enqueue({ type: "text-delta", textDelta: JSON.stringify(output) });
          controller.enqueue({ type: "finish", finishReason: "stop", usage: { promptTokens: 10, completionTokens: 30 } });
          controller.close();
        } }) };
      },
    };
    const result = await streamGenerateMindmap({ adapter, sheetId: doc.activeSheetId, prompt: question, locale: "en", model });
    const sheet = adapter.getDocument().sheets[0];
    expect(sheet.rootTopic.children.map(topic => richTextToPlainText(topic.title))).toEqual(titles);
    expect(sheet.structure).toBe(doc.sheets[0].structure);
    expect(adapter.getDocument().theme.paletteId).toBe(doc.theme.paletteId);
    expect(result.summary).toBe(output.summary);
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

    const okTransport = createHttpAiTransport("/api/ai/stream", async (_url, init) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ intent: "expand", prompt: "", context: { activeTopicId: targetId } });
      return sseResponse([
        `event: commands\ndata: ${JSON.stringify({ ops: [{ kind: "addChildren", targetTopicId: targetId, items: [{ title: "Remote Idea A", task: "todo" }, { title: "Remote Idea B" }] }] })}\n\n`,
        `event: message_delta\ndata: ${JSON.stringify({ delta: "Added 2 remote ideas" })}\n\n`,
        `event: done\ndata: ${JSON.stringify({ summary: "Added 2 remote ideas", appliedCount: 2 })}\n\n`,
      ]);
    });

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

  it("streams structured plan, granular execution steps, multi-turn history, and final outcome", async () => {
    const doc = createDocument();
    const adapter = new LocalImmerSyncAdapter(doc);
    const sheetId = doc.activeSheetId;
    const targetId = doc.sheets[0].rootTopic.children[0].id;

    let capturedBody: Record<string, unknown> | null = null;
    const events: AiStreamEvent[] = [];
    const transport = createHttpAiTransport("/api/ai/stream", async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return sseResponse([
        `event: plan\ndata: ${JSON.stringify({ goal: "Break down launch tasks", approach: "Create 2 actionable items under the selected branch", steps: ["Inspect branch", "Add 2 tasks"] })}\n\n`,
        `event: commands\ndata: ${JSON.stringify({ ops: [{ kind: "addChildren", targetTopicId: targetId, items: [{ title: "Write launch checklist", task: "todo" }, { title: "Run smoke test", task: "todo" }] }] })}\n\n`,
        `event: message_delta\ndata: ${JSON.stringify({ delta: "Added 2 launch tasks" })}\n\n`,
        `event: done\ndata: ${JSON.stringify({ summary: "Added 2 launch tasks", appliedCount: 2 })}\n\n`,
      ]);
    });

    const result = await runNodeAiActionDetailed(adapter, sheetId, targetId, "tasks", "en", {
      transport,
      tier: "pro",
      prompt: "Refine branch two with launch tasks",
      history: [
        { role: "user", content: "Create a launch roadmap" },
        { role: "assistant", content: "Generated roadmap", planSummary: "4 launch phases", resultSummary: "Added 12 nodes" },
      ],
      onEvent: (ev) => events.push(ev),
    });

    expect((capturedBody as { history?: unknown[] } | null)?.history).toHaveLength(2);
    expect(result.plan?.goal).toBe("Break down launch tasks");
    expect(result.plan?.steps).toEqual(["Inspect branch", "Add 2 tasks"]);
    expect(result.steps?.some((s) => s.phase === "analyze" && s.status === "done")).toBe(true);
    expect(result.steps?.some((s) => s.phase === "plan" && s.status === "done")).toBe(true);
    expect(result.steps?.some((s) => s.phase === "execute" && s.count === 2)).toBe(true);
    expect(result.steps?.some((s) => s.phase === "verify" && s.status === "done")).toBe(true);
    expect(result.outcome?.stats.addedNodes).toBe(2);
    expect(result.outcome?.highlights).toHaveLength(2);
    expect(events.some((e) => e.event === "plan")).toBe(true);
    expect(events.some((e) => e.event === "step")).toBe(true);

    expect(sanitizeAiPlan({ goal: "  Valid goal  ", steps: [" Step 1 ", "", "Step 2"] })).toEqual({
      goal: "Valid goal",
      steps: ["Step 1", "Step 2"],
    });
  });
});
