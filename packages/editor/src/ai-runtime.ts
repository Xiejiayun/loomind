import type {
  AiConfigResponse,
  AiExecutionOutcome,
  AiExecutionPlan,
  AiExecutionStep,
  AiStreamMeta,
  AiTier,
  AiTransport,
} from "@mindmap/ai";

export interface AiChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  contextLabel?: string;
  upgradePrompt?: boolean;
  plan?: AiExecutionPlan;
  steps?: AiExecutionStep[];
  outcome?: AiExecutionOutcome;
  mutation?: {
    summary: string;
    targetTopicId?: string;
  };
  status?: "running" | "done" | "stopped" | "error";
  pending?: boolean;
  createdAt?: string;
  actor?: string;
}

export interface AiChatPersistence {
  loadCached?: () => AiChatMessage[];
  loadRemote?: () => Promise<AiChatMessage[] | null>;
  saveMessages: (messages: AiChatMessage[]) => Promise<void> | void;
  clearMessages: () => Promise<void> | void;
  flushPending?: () => Promise<void> | void;
}

export interface EditorAiRuntime {
  tier: AiTier;
  transport: AiTransport;
  config: AiConfigResponse | null;
  loading?: boolean;
  onMeta?: (meta: AiStreamMeta) => void;
  onRefreshConfig?: () => void;
  onUpgradeToPro?: () => void;
}

export {
  AiClientError,
  createHttpAiTransport,
  type AiConfigResponse,
  type AiExecutionHighlight,
  type AiExecutionOutcome,
  type AiExecutionPlan,
  type AiExecutionStats,
  type AiExecutionStep,
  type AiStreamMeta,
  type AiTier,
  type AiTransport,
} from "@mindmap/ai";
