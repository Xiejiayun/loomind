import type { AiConfigResponse, AiStreamMeta, AiTier, AiTransport } from "@mindmap/ai";

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
  type AiStreamMeta,
  type AiTier,
  type AiTransport,
} from "@mindmap/ai";
