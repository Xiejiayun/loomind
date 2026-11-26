import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createHttpAiTransport,
  type AiConfigResponse,
  type AiStreamMeta,
  type AiTier,
  type EditorAiRuntime,
} from "@mindmap/editor";

const sharedTransport = createHttpAiTransport("/api/ai/stream");

export async function fetchAiConfig(tier: AiTier): Promise<AiConfigResponse | null> {
  try {
    const response = await fetch(`/api/ai/config?tier=${encodeURIComponent(tier)}`, {
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    return (await response.json()) as AiConfigResponse;
  } catch {
    return null;
  }
}

export function useWebAiRuntime(tier: AiTier, onUpgradeToPro?: () => void): EditorAiRuntime {
  const [config, setConfig] = useState<AiConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    void fetchAiConfig(tier).then((next) => {
      if (next) setConfig(next);
      setLoading(false);
    });
  }, [tier]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void fetchAiConfig(tier).then((next) => {
      if (!active) return;
      if (next) setConfig(next);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [tier]);

  const onMeta = useCallback((meta: AiStreamMeta) => {
    setConfig((prev) => ({
      tier: meta.tier,
      available: true,
      isMock: meta.isMock,
      providerLabel: meta.providerLabel,
      modelLabel: meta.modelLabel,
      dailyLimit: meta.dailyLimit,
      remainingToday: meta.remainingToday,
      requiresLogin: prev?.requiresLogin ?? false,
    }));
  }, []);

  return useMemo<EditorAiRuntime>(
    () => ({
      tier,
      transport: sharedTransport,
      config,
      loading,
      onMeta,
      onRefreshConfig: refresh,
      onUpgradeToPro,
    }),
    [tier, config, loading, onMeta, refresh, onUpgradeToPro],
  );
}
