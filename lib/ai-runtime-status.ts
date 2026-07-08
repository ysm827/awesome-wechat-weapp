import { getAiConfig, type AiProvider } from "@/lib/ai-config";

export type AiRuntimeSource = "ai" | "rules" | "not_configured";

export interface AiRuntimeStatus {
  configured: boolean;
  provider: AiProvider;
  apiUrl: string;
  primaryModel: string;
  fallbackModel: string;
  lastUpdatedAt: string | null;
  lastSource: AiRuntimeSource;
  lastModel: string | null;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  lastError: string | null;
}

let runtimeState: Omit<AiRuntimeStatus, "configured" | "provider" | "apiUrl" | "primaryModel" | "fallbackModel"> = {
  lastUpdatedAt: null,
  lastSource: "not_configured",
  lastModel: null,
  fallbackUsed: false,
  fallbackReason: null,
  lastError: null
};

function sanitizeStatusText(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\s+/g, " ").slice(0, 240);
}

export function getAiRuntimeStatus(): AiRuntimeStatus {
  const config = getAiConfig();

  return {
    configured: config.configured,
    provider: config.provider,
    apiUrl: config.apiUrl,
    primaryModel: config.model,
    fallbackModel: config.fallbackModel,
    ...runtimeState
  };
}

export function recordAiRuntimeStatus(update: {
  source: AiRuntimeSource;
  model?: string | null;
  fallbackUsed?: boolean;
  fallbackReason?: string | null;
  error?: string | null;
}) {
  runtimeState = {
    lastUpdatedAt: new Date().toISOString(),
    lastSource: update.source,
    lastModel: update.model ?? null,
    fallbackUsed: update.fallbackUsed ?? false,
    fallbackReason: sanitizeStatusText(update.fallbackReason),
    lastError: sanitizeStatusText(update.error)
  };
}
