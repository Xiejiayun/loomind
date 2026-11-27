export type WorkerAiTier = "free" | "pro";
export type WorkerAiIntent =
  | "generate_map"
  | "expand"
  | "tasks"
  | "summarize"
  | "cluster"
  | "elaborateNote"
  | "restyle"
  | "chat";

export interface WorkerAiRequest {
  tier: WorkerAiTier;
  intent: WorkerAiIntent;
  prompt: string;
  locale: "zh" | "en";
  targetTopicId: string;
  context?: {
    sheetId?: string;
    structure?: string;
    paletteId?: string;
    activeTopicId?: string | null;
    outline?: unknown;
    truncated?: boolean;
  };
}

export interface ProviderMeta {
  requestId: string;
  tier: WorkerAiTier;
  providerLabel: string;
  modelLabel: string;
  isMock: boolean;
  remainingToday: number;
  dailyLimit: number;
}

export interface StreamEmit {
  (event: string, data: unknown): void;
}

const DEFAULT_FREE_MODEL = "@cf/google/gemma-4-26b-a4b-it" satisfies keyof AiModels;
const DEFAULT_PRO_MODEL = "gpt-6.2-sol";

export function resolveFreeModel(env: Env): string {
  return env.AI_FREE_MODEL?.trim() || DEFAULT_FREE_MODEL;
}

export function resolveProModel(env: Env): string {
  return env.PRO_LLM_MODEL?.trim() || DEFAULT_PRO_MODEL;
}

export function allowMock(env: Env): boolean {
  return env.AI_ALLOW_MOCK !== "false";
}

export function hasRealProConfig(env: Env): boolean {
  return Boolean(env.PRO_LLM_BASE_URL?.trim() && env.PRO_LLM_API_KEY?.trim());
}

export function hasRealFreeConfig(env: Env): boolean {
  return Boolean(env.AI && typeof env.AI.run === "function");
}

function buildSystemPrompt(req: WorkerAiRequest): string {
  const isEn = req.locale === "en";
  const langRule = isEn ? "Respond strictly in English." : "严格使用简体中文输出。";

  if (req.intent === "generate_map") {
    return [
      "You are Loomind AI, an expert mind-mapping architect.",
      langRule,
      "Output ONLY a single valid JSON object (no markdown fences, no commentary) matching this exact shape:",
      '{"title":"string","recommendedStructure":"mindmap|logic|org|brace|timeline|fishbone|treeTable","recommendedPalette":"xmind-rainbow|aurora|warm-paper|midnight-neon|forest-calm","root":{"title":"string","subtitle":"optional string","children":[{"title":"string","labels":["optional short tag"],"children":[{"title":"string","task":"optional todo"}]}]}}',
      "Create 4 to 5 well-organized top-level branches, each with 2 to 4 concrete child nodes. Keep every title concise (<= 40 chars). Never exceed 40 total nodes or depth 4.",
    ].join("\n");
  }

  return [
    "You are Loomind AI, an expert mind-mapping co-creator.",
    langRule,
    `Target topic ID is "${req.targetTopicId}".`,
    "Output ONLY a single valid JSON object (no markdown fences, no commentary) matching this shape:",
    '{"message":"short user-facing explanation","summary":"short mutation summary","ops":[...]}',
    "Allowed op shapes in ops array:",
    '- {"kind":"addChildren","targetTopicId":"<id>","items":[{"title":"...","subtitle":"optional","labels":["optional"],"task":"optional todo"}]}',
    '- {"kind":"setSummary","targetTopicId":"<id>","title":"...","note":"optional markdown"}',
    '- {"kind":"setBoundary","targetTopicId":"<id>","title":"..."}',
    '- {"kind":"setNote","targetTopicId":"<id>","markdown":"### Heading\\n- point 1\\n- point 2"}',
    '- {"kind":"setStyle","structure":"mindmap|logic|org|brace|timeline|fishbone|treeTable|matrix","paletteId":"xmind-rainbow|aurora|warm-paper|midnight-neon|forest-calm|sunset-coral|blueprint"}',
    "Only use the op(s) directly relevant to the requested intent. Keep titles concise and actionable.",
  ].join("\n");
}

function buildUserPrompt(req: WorkerAiRequest): string {
  const parts = [
    `Intent: ${req.intent}`,
    `User request: ${req.prompt}`,
  ];
  if (req.context?.outline) {
    const serialized = JSON.stringify(req.context.outline).slice(0, 10_000);
    parts.push(`Current mind map outline JSON: ${serialized}`);
  }
  return parts.join("\n\n");
}

function extractBalancedJsonObjects(text: string): string[] {
  const candidates: string[] = [];
  let inString = false;
  let escape = false;
  let depth = 0;
  let start = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === "{") {
        if (depth === 0) start = i;
        depth += 1;
      } else if (ch === "}" && depth > 0) {
        depth -= 1;
        if (depth === 0 && start !== -1) {
          candidates.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  return candidates;
}

export function parsePartialJsonLoose(rawText: string): unknown | null {
  let text = rawText.trim();
  if (!text) return null;

  const fenceStart = text.indexOf("```");
  if (fenceStart !== -1) {
    const afterFence = text.slice(fenceStart + 3);
    const newline = afterFence.indexOf("\n");
    const fencedBody = newline !== -1 ? afterFence.slice(newline + 1) : afterFence;
    const fenceEnd = fencedBody.indexOf("```");
    const inner = (fenceEnd !== -1 ? fencedBody.slice(0, fenceEnd) : fencedBody).trim();
    if (inner.includes("{")) text = inner;
  }

  // First try complete balanced JSON objects (prefer the last valid one to skip any leading/trailing prose)
  const balanced = extractBalancedJsonObjects(text);
  for (let i = balanced.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(balanced[i]);
    } catch {
      // try earlier candidate
    }
  }

  const objStart = text.lastIndexOf("{");
  const firstObjStart = text.indexOf("{");
  const startIdx = firstObjStart !== -1 ? firstObjStart : objStart;
  if (startIdx === -1) return null;
  text = text.slice(startIdx);

  try {
    return JSON.parse(text);
  } catch {
    // Best-effort streaming JSON repair
  }

  let inString = false;
  let escape = false;
  const stack: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === "{") stack.push("}");
      else if (ch === "[") stack.push("]");
      else if ((ch === "}" || ch === "]") && stack[stack.length - 1] === ch) stack.pop();
    }
  }

  let repaired = text;
  if (escape) repaired = repaired.slice(0, -1);
  if (inString) repaired += '"';
  repaired = repaired
    .replace(/,\s*$/, "")
    .replace(/:\s*$/, ": null")
    .replace(/,\s*"[^"]*"\s*$/, "");
  while (stack.length > 0) {
    repaired = repaired.replace(/,\s*$/, "");
    repaired += stack.pop();
  }
  try {
    return JSON.parse(repaired);
  } catch {
    return null;
  }
}

async function consumeTextTokenStream(
  tokens: AsyncIterable<string>,
  req: WorkerAiRequest,
  emit: StreamEmit,
): Promise<void> {
  let accumulated = "";
  let lastPatchAt = 0;
  let lastPatchJson = "";
  let emittedPatches = 0;

  emit("status", { stage: "streaming" });

  for await (const delta of tokens) {
    if (!delta) continue;
    accumulated += delta;

    if (req.intent === "generate_map") {
      const now = Date.now();
      if (now - lastPatchAt >= 60) {
        const partial = parsePartialJsonLoose(accumulated) as Record<string, unknown> | null;
        if (partial && typeof partial === "object" && partial.root) {
          const serialized = JSON.stringify(partial);
          if (serialized !== lastPatchJson) {
            lastPatchJson = serialized;
            lastPatchAt = now;
            emittedPatches += 1;
            emit("map_patch", { partial });
          }
        }
      }
    }
  }

  const finalObj = parsePartialJsonLoose(accumulated) as Record<string, unknown> | null;
  if (!finalObj || typeof finalObj !== "object") {
    throw new Error(req.locale === "en" ? "Model returned invalid structured JSON." : "模型未返回有效的导图 JSON 结构。");
  }

  if (req.intent === "generate_map") {
    if (!finalObj.root || typeof finalObj.root !== "object") {
      throw new Error(req.locale === "en" ? "Generated map is missing a root topic." : "生成结果缺少中心主题结构。");
    }
    const serialized = JSON.stringify(finalObj);
    if (serialized !== lastPatchJson) {
      emittedPatches += 1;
      emit("map_patch", { partial: finalObj });
    }
    const title = typeof finalObj.title === "string" && finalObj.title.trim() ? finalObj.title.trim() : req.prompt;
    const summary =
      req.locale === "en"
        ? `Generated mind map for "${title}"`
        : `已流式生成「${title}」思维导图`;
    emit("message_delta", { delta: summary });
    emit("done", { summary, appliedCount: Math.max(1, emittedPatches) });
    return;
  }

  const ops = Array.isArray(finalObj.ops) ? finalObj.ops : [];
  if (ops.length > 0) {
    emit("commands", { ops });
  }
  const message =
    typeof finalObj.message === "string" && finalObj.message.trim()
      ? finalObj.message.trim()
      : req.locale === "en"
        ? "Updated the selected topic."
        : "已更新当前节点内容。";
  const summary =
    typeof finalObj.summary === "string" && finalObj.summary.trim()
      ? finalObj.summary.trim()
      : message;
  emit("message_delta", { delta: message });
  emit("done", { summary, appliedCount: ops.length });
}

async function* iterateSseTextDeltas(
  body: ReadableStream<Uint8Array>,
  extractor: (eventName: string, payload: unknown) => string | null,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        let eventName = "";
        const dataLines: string[] = [];
        for (const line of block.split("\n")) {
          if (!line || line.startsWith(":")) continue;
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
        }
        const raw = dataLines.join("\n").trim();
        if (!raw || raw === "[DONE]") continue;
        try {
          const parsed = JSON.parse(raw);
          const text = extractor(eventName, parsed);
          if (text) yield text;
        } catch {
          // ignore malformed non-JSON SSE keepalive frames
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function runWorkersAiStream(
  env: Env,
  req: WorkerAiRequest,
  emit: StreamEmit,
): Promise<void> {
  if (!env.AI) throw new Error("Workers AI binding unavailable");
  const model = resolveFreeModel(env);
  const messages = [
    { role: "system", content: buildSystemPrompt(req) },
    { role: "user", content: buildUserPrompt(req) },
  ];

  emit("status", { stage: "thinking" });
  const result = await (env.AI.run as (m: string, input: Record<string, unknown>) => Promise<unknown>)(model, {
    messages,
    stream: true,
    max_tokens: 1800,
    temperature: 0.4,
  });

  if (result instanceof ReadableStream) {
    const tokens = iterateSseTextDeltas(result, (_event, payload) => {
      if (payload && typeof payload === "object") {
        const obj = payload as Record<string, unknown>;
        if (typeof obj.response === "string") return obj.response;
        const choices = obj.choices as Array<{ delta?: { content?: string } }> | undefined;
        if (typeof choices?.[0]?.delta?.content === "string") return choices[0].delta.content;
      }
      return null;
    });
    await consumeTextTokenStream(tokens, req, emit);
    return;
  }

  // Non-streaming fallback if runtime returns an object
  let text = "";
  if (result && typeof result === "object") {
    const obj = result as { response?: unknown; choices?: Array<{ message?: { content?: unknown } }> };
    if (typeof obj.response === "string") text = obj.response;
    else if (typeof obj.choices?.[0]?.message?.content === "string") text = obj.choices[0].message.content;
  }
  async function* singleChunk() {
    if (text) yield text;
  }
  await consumeTextTokenStream(singleChunk(), req, emit);
}

export async function runProOpenAiStream(
  env: Env,
  req: WorkerAiRequest,
  emit: StreamEmit,
  signal: AbortSignal,
): Promise<void> {
  const baseUrl = env.PRO_LLM_BASE_URL!.trim().replace(/\/+$/, "");
  const apiKey = env.PRO_LLM_API_KEY!.trim();
  const model = resolveProModel(env);
  const mode = (env.PRO_LLM_API_MODE?.trim().toLowerCase() || "auto") as "auto" | "responses" | "chat";

  const systemPrompt = buildSystemPrompt(req);
  const userPrompt = buildUserPrompt(req);
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    Accept: "text/event-stream",
  };

  emit("status", { stage: "thinking" });

  const callResponses = () =>
    fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify({
        model,
        instructions: systemPrompt,
        input: userPrompt,
        stream: true,
      }),
    });

  const callChat = () =>
    fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        stream: true,
        temperature: 0.4,
      }),
    });

  let useResponses = mode !== "chat";
  let upstream = useResponses ? await callResponses() : await callChat();

  if (mode === "auto" && !upstream.ok && (upstream.status === 400 || upstream.status === 404)) {
    const errPreview = await upstream.text().catch(() => "");
    if (
      upstream.status === 404 ||
      /unsupported_api_for_model|not accessible via|unknown url|responses/i.test(errPreview)
    ) {
      useResponses = false;
      upstream = await callChat();
    } else {
      throw new Error(`Pro LLM HTTP ${upstream.status}: ${errPreview.slice(0, 180)}`);
    }
  }

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => "");
    throw new Error(`Pro LLM HTTP ${upstream.status}${errText ? `: ${errText.slice(0, 180)}` : ""}`);
  }

  const contentType = upstream.headers.get("Content-Type") || "";
  if (upstream.body && contentType.includes("text/event-stream")) {
    const tokens = iterateSseTextDeltas(upstream.body, (eventName, payload) => {
      if (!payload || typeof payload !== "object") return null;
      const obj = payload as Record<string, unknown>;
      if (useResponses) {
        if (eventName === "response.output_text.delta" || obj.type === "response.output_text.delta") {
          return typeof obj.delta === "string" ? obj.delta : null;
        }
        return null;
      }
      const choices = obj.choices as Array<{ delta?: { content?: string } }> | undefined;
      return typeof choices?.[0]?.delta?.content === "string" ? choices[0].delta.content : null;
    });
    await consumeTextTokenStream(tokens, req, emit);
    return;
  }

  // Fallback for non-SSE JSON response
  const data = (await upstream.json().catch(() => null)) as Record<string, unknown> | null;
  let fullText = "";
  if (data) {
    if (typeof data.output_text === "string") {
      fullText = data.output_text;
    } else if (Array.isArray(data.output)) {
      for (const item of data.output as Array<{ content?: Array<{ text?: string }> }>) {
        for (const c of item.content ?? []) {
          if (typeof c.text === "string") fullText += c.text;
        }
      }
    } else if (Array.isArray(data.choices)) {
      const msg = (data.choices[0] as { message?: { content?: string } })?.message?.content;
      if (typeof msg === "string") fullText = msg;
    }
  }
  async function* singleChunk() {
    if (fullText) yield fullText;
  }
  await consumeTextTokenStream(singleChunk(), req, emit);
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runMockAiStream(
  req: WorkerAiRequest,
  emit: StreamEmit,
  signal: AbortSignal,
): Promise<void> {
  const isEn = req.locale === "en";
  const isPro = req.tier === "pro";
  const topic = req.prompt.trim().slice(0, 60) || (isEn ? "Structured Mind Map" : "结构化思维导图");

  emit("status", { stage: "streaming" });

  if (req.intent === "generate_map") {
    const branches = isEn
      ? [
          {
            title: "Strategic Context & Goals",
            labels: ["Core"],
            children: [
              { title: `Clarify primary problem for ${topic}`, task: "todo" as const },
              { title: "Define measurable north-star outcomes" },
              ...(isPro ? [{ title: "Align stakeholder constraints & scope" }] : []),
            ],
          },
          {
            title: "Architecture & Key Pillars",
            labels: ["Design"],
            children: [
              { title: "Core user workflow & experience" },
              { title: "Data model & reliability guardrails" },
              ...(isPro ? [{ title: "Observability, security & fallbacks" }] : []),
            ],
          },
          {
            title: "Execution Roadmap",
            labels: ["Plan"],
            children: [
              { title: "Phase 1: Validate minimal closed loop", task: "todo" as const },
              { title: "Phase 2: Iterate with real usage feedback", task: "todo" as const },
            ],
          },
          {
            title: "Risks & Success Metrics",
            children: [
              { title: "Retention, latency & quality benchmarks" },
              { title: "Fallback & rollback mitigation plan" },
            ],
          },
        ]
      : [
          {
            title: "核心目标与问题定义",
            labels: ["战略"],
            children: [
              { title: `明确「${topic}」的核心痛点`, task: "todo" as const },
              { title: "设定可量化的北极星成果" },
              ...(isPro ? [{ title: "界定关键干系人与范围边界" }] : []),
            ],
          },
          {
            title: "关键模块与能力拆解",
            labels: ["方案"],
            children: [
              { title: "主流程体验与交互闭环" },
              { title: "核心数据模型与稳定性护栏" },
              ...(isPro ? [{ title: "可观测性、安全与降级预案" }] : []),
            ],
          },
          {
            title: "分阶段执行路线",
            labels: ["落地"],
            children: [
              { title: "阶段一：验证最小可行闭环 (MVP)", task: "todo" as const },
              { title: "阶段二：收集真实反馈并迭代", task: "todo" as const },
            ],
          },
          {
            title: "风险控制与验收指标",
            children: [
              { title: "留存率、响应时延与质量基线" },
              { title: "异常降级与快速回滚机制" },
            ],
          },
        ];

    const progressive: {
      title: string;
      recommendedStructure: string;
      recommendedPalette: string;
      root: { title: string; subtitle: string; children: Array<{ title: string; labels?: string[]; children: unknown[] }> };
    } = {
      title: topic,
      recommendedStructure: "mindmap",
      recommendedPalette: isPro ? "aurora" : "xmind-rainbow",
      root: {
        title: topic,
        subtitle: isPro
          ? isEn
            ? "Pro LLM (Mock Preview)"
            : "Pro 付费模型（Mock 预览）"
          : isEn
            ? "Workers AI Free (Mock Preview)"
            : "Workers AI 免费体验（Mock 预览）",
        children: [],
      },
    };

    for (const branch of branches) {
      if (signal.aborted) return;
      const bNode = { title: branch.title, labels: branch.labels, children: [] as unknown[] };
      progressive.root.children.push(bNode);
      emit("map_patch", { partial: structuredClone(progressive) });
      await delay(55);
      for (const leaf of branch.children) {
        if (signal.aborted) return;
        bNode.children.push(leaf);
        emit("map_patch", { partial: structuredClone(progressive) });
        await delay(40);
      }
    }

    const summary = isEn
      ? `Generated structured mind map for "${topic}" (Mock preview)`
      : `已围绕「${topic}」生成结构化导图（Mock 预览）`;
    emit("message_delta", { delta: summary });
    emit("done", { summary, appliedCount: branches.length });
    return;
  }

  const targetId = req.targetTopicId;
  let ops: unknown[] = [];
  let message = "";

  switch (req.intent) {
    case "tasks": {
      ops = [
        {
          kind: "addChildren",
          targetTopicId: targetId,
          items: isEn
            ? [
                { title: `Clarify scope for ${topic}`, task: "todo" },
                { title: "Design technical & UX blueprint", task: "todo" },
                { title: "Implement & verify key edge cases", task: "todo" },
                { title: "Ship, monitor metrics & review", task: "todo" },
              ]
            : [
                { title: `明确「${topic}」需求边界与验收标准`, task: "todo" },
                { title: "输出核心架构与交互方案", task: "todo" },
                { title: "完成开发实现与边界测试", task: "todo" },
                { title: "灰度上线并跟踪核心指标", task: "todo" },
              ],
        },
      ];
      message = isEn ? "Broke down 4 actionable tasks (Mock preview)" : "已拆解 4 项可执行任务（Mock 预览）";
      break;
    }
    case "summarize": {
      ops = [
        {
          kind: "setSummary",
          targetTopicId: targetId,
          title: isEn ? `Core Takeaway: ${topic}` : `核心结论：聚焦${topic}`,
          note: isEn
            ? "Synthesizes the child branches into clear priorities and next steps."
            : "提炼当前分支的关键要点与优先推进方向。",
        },
      ];
      message = isEn ? "Added branch summary (Mock preview)" : "已生成分支概要（Mock 预览）";
      break;
    }
    case "cluster": {
      ops = [
        {
          kind: "setBoundary",
          targetTopicId: targetId,
          title: isEn ? `${topic} Cluster` : `${topic} 语义聚类`,
        },
      ];
      message = isEn ? "Added semantic cluster boundary (Mock preview)" : "已添加语义聚类外框（Mock 预览）";
      break;
    }
    case "elaborateNote": {
      ops = [
        {
          kind: "setNote",
          targetTopicId: targetId,
          markdown: isEn
            ? `### ${topic}\n\n- **Objective**: Define clear outcomes and boundaries.\n- **Approach**: Break work into verifiable milestones.\n- **Risks**: Monitor dependencies and scope drift.`
            : `### ${topic}\n\n- **目标背景**：明确核心业务价值与关键约束。\n- **推进策略**：按可验证里程碑拆解实施。\n- **风险防范**：关注上下游依赖与范围蔓延。`,
        },
      ];
      message = isEn ? "Generated structured Markdown note (Mock preview)" : "已生成结构化长备注（Mock 预览）";
      break;
    }
    case "restyle": {
      const lower = topic.toLowerCase();
      const structure = /timeline|roadmap|时间|路线|阶段/.test(lower)
        ? "timeline"
        : /fishbone|root|复盘|根因|故障/.test(lower)
          ? "fishbone"
          : /arch|system|架构|系统/.test(lower)
            ? "brace"
            : "mindmap";
      const paletteId = structure === "brace" ? "blueprint" : structure === "fishbone" ? "sunset-coral" : "aurora";
      ops = [{ kind: "setStyle", structure, paletteId }];
      message = isEn
        ? `Switched layout to ${structure} + ${paletteId} (Mock preview)`
        : `已切换为 ${structure} + ${paletteId}（Mock 预览）`;
      break;
    }
    default: {
      ops = [
        {
          kind: "addChildren",
          targetTopicId: targetId,
          items: isEn
            ? [
                { title: `${topic} · Key Drivers`, labels: ["Insight"] },
                { title: `${topic} · Core Scenarios` },
                { title: `${topic} · Best Practices` },
                { title: `${topic} · Trade-offs & Risks` },
              ]
            : [
                { title: `${topic} · 核心驱动要素`, labels: ["关键"] },
                { title: `${topic} · 典型应用场景` },
                { title: `${topic} · 最佳实践方法` },
                { title: `${topic} · 权衡与潜在风险` },
              ],
        },
      ];
      message = isEn ? `Expanded 4 subtopics for "${topic}" (Mock preview)` : `已为「${topic}」扩展 4 个子主题（Mock 预览）`;
      break;
    }
  }

  await delay(80);
  if (signal.aborted) return;
  emit("commands", { ops });
  emit("message_delta", { delta: message });
  emit("done", { summary: message, appliedCount: ops.length });
}
