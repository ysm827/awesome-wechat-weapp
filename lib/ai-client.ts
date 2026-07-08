import { getAiConfig, type AiConfig } from "@/lib/ai-config";
import type { AiPromptMessage } from "@/lib/ai-prompts";

export interface AiJsonCompletionResult<T> {
  ok: boolean;
  value: T | null;
  model: string | null;
  fallbackUsed: boolean;
  error: string | null;
}

interface ChatCompletionChoice {
  finish_reason?: unknown;
  delta?: {
    content?: unknown;
  };
  message?: {
    content?: unknown;
  };
}

interface ChatCompletionResponse {
  choices?: ChatCompletionChoice[];
  error?: unknown;
}

interface ResponsesApiResponse {
  output_text?: unknown;
  output?: unknown;
  error?: unknown;
}

const DEFAULT_AI_TIMEOUT_MS = 8_000;
const DEFAULT_AI_MAX_TOKENS = 1400;
const OPENROUTER_JSON_RESPONSE_FORMAT_MODELS = new Set([
  "google/gemma-4-26b-a4b-it:free",
  "google/gemma-4-31b-it:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "nvidia/nemotron-nano-9b-v2:free",
  "openai/gpt-oss-20b:free",
  "qwen/qwen3-next-80b-a3b-instruct:free"
]);

function completionUrl(config: AiConfig) {
  return `${config.apiUrl}/chat/completions`;
}

function responsesUrl(config: AiConfig) {
  return `${config.apiUrl}/responses`;
}

function openRouterHeaders(config: AiConfig): Record<string, string> {
  if (config.provider !== "openrouter") return {};

  const siteUrl = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL;
  return {
    ...(siteUrl ? { "HTTP-Referer": siteUrl } : {}),
    "X-Title": "MiniProgram Radar"
  };
}

function responseFormatForModel(config: AiConfig, model: string) {
  if (config.provider === "openrouter" && OPENROUTER_JSON_RESPONSE_FORMAT_MODELS.has(model)) {
    return { response_format: { type: "json_object" } };
  }

  return {};
}

function tokenLimitForModel(config: AiConfig, model: string) {
  if (config.provider === "openai" && /^gpt-5(?:\.|-|$)/i.test(model)) {
    return { max_completion_tokens: DEFAULT_AI_MAX_TOKENS };
  }

  return { max_tokens: DEFAULT_AI_MAX_TOKENS };
}

function shouldStreamChatCompletion(config: AiConfig) {
  return config.provider === "custom";
}

async function fetchTextWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    return { response, text };
  } finally {
    clearTimeout(timeout);
  }
}

function stringifyProviderError(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    const error = value as Record<string, unknown>;
    const parts = [
      typeof error.message === "string" ? error.message : null,
      typeof error.code === "string" || typeof error.code === "number" ? `code=${String(error.code)}` : null
    ];
    const metadata = error.metadata;
    if (typeof metadata === "object" && metadata !== null) {
      const fields = metadata as Record<string, unknown>;
      parts.push(typeof fields.reason === "string" ? fields.reason : null);
      parts.push(typeof fields.raw === "string" ? fields.raw : null);
      parts.push(typeof fields.provider_name === "string" ? `provider=${fields.provider_name}` : null);
    }

    const message = parts.filter(Boolean).join("; ");
    if (message) return message;
  }
  return null;
}

function extractJsonText(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) return fenced[1].trim();

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) return trimmed.slice(firstBrace, lastBrace + 1);
  return trimmed;
}

function parseJsonObject<T>(text: string): T {
  const parsed = JSON.parse(extractJsonText(text)) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("AI response JSON must be an object.");
  }
  return parsed as T;
}

function parseCompletionPayload(text: string) {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as ChatCompletionResponse;
  } catch {
    return null;
  }
}

function contentPartText(part: unknown) {
  if (typeof part === "string") return part;
  if (typeof part !== "object" || part === null) return "";

  const record = part as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;
  if (typeof record.content === "string") return record.content;

  return "";
}

function extractMessageContentText(content: unknown) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(contentPartText).join("");
  if (typeof content === "object" && content !== null) return contentPartText(content);
  return "";
}

function extractResponsesOutputText(payload: ResponsesApiResponse | null) {
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.output_text === "string") return payload.output_text;
  if (!Array.isArray(payload.output)) return "";

  return payload.output
    .flatMap((item) => {
      if (typeof item === "string") return [item];
      if (typeof item !== "object" || item === null) return [];

      const record = item as Record<string, unknown>;
      if (typeof record.text === "string") return [record.text];
      if (typeof record.content === "string") return [record.content];
      if (Array.isArray(record.content)) return record.content.map(contentPartText);

      return [];
    })
    .join("");
}

function parseSseDataRecords(text: string) {
  const records: unknown[] = [];

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;

    const data = trimmed.slice("data:".length).trim();
    if (!data || data === "[DONE]") continue;

    try {
      records.push(JSON.parse(data) as unknown);
    } catch {
      // Ignore non-JSON keep-alive or provider-specific SSE data lines.
    }
  }

  return records;
}

function stringField(record: Record<string, unknown>, name: string) {
  const value = record[name];
  return typeof value === "string" ? value : "";
}

function responsesInputForMessages(messages: AiPromptMessage[]) {
  const instructions = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join("\n\n");
  const input = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role,
      content: [
        {
          type: "input_text",
          text: message.content
        }
      ]
    }));

  return {
    ...(instructions ? { instructions } : {}),
    input: input.length > 0 ? input : messages.map((message) => ({ role: message.role, content: message.content }))
  };
}

function extractResponsesPayloadText(text: string) {
  const payload = parseCompletionPayload(text) as ResponsesApiResponse | null;
  const jsonContent = extractResponsesOutputText(payload);
  if (jsonContent.trim().length > 0) return { content: jsonContent, payload };

  const sseRecords = parseSseDataRecords(text);
  const completedContent = sseRecords
    .map((item) => {
      if (typeof item !== "object" || item === null) return "";
      const record = item as Record<string, unknown>;
      const response = record.response;
      return extractResponsesOutputText((response && typeof response === "object" ? response : record) as ResponsesApiResponse);
    })
    .filter((value) => value.trim().length > 0);
  if (completedContent.length > 0) return { content: completedContent.at(-1) ?? "", payload };

  const deltaContent = sseRecords
    .map((item) => {
      if (typeof item !== "object" || item === null) return "";
      const record = item as Record<string, unknown>;
      return stringField(record, "delta") || stringField(record, "text") || stringField(record, "output_text");
    })
    .join("");

  return { content: deltaContent, payload };
}

function extractChatChoiceText(choice: ChatCompletionChoice | undefined) {
  const messageContent = extractMessageContentText(choice?.message?.content);
  if (messageContent.trim().length > 0) return messageContent;
  return extractMessageContentText(choice?.delta?.content);
}

function extractChatPayloadText(text: string) {
  const payload = parseCompletionPayload(text);
  const jsonContent = extractChatChoiceText(payload?.choices?.[0]);
  if (jsonContent.trim().length > 0) return { content: jsonContent, payload };

  const sseRecords = parseSseDataRecords(text);
  const sseContent = sseRecords
    .flatMap((item) => {
      if (typeof item !== "object" || item === null) return [];
      const record = item as ChatCompletionResponse;
      if (!Array.isArray(record.choices)) return [];
      return record.choices.map(extractChatChoiceText);
    })
    .join("");

  return { content: sseContent, payload };
}

function describeEmptyChoice(choice: ChatCompletionChoice | undefined) {
  const content = choice?.message?.content;
  const contentType = Array.isArray(content) ? "array" : content === null ? "null" : typeof content;
  const messageKeys = choice?.message && typeof choice.message === "object" ? Object.keys(choice.message).sort().join(",") || "none" : "none";
  const finishReason = typeof choice?.finish_reason === "string" ? choice.finish_reason : "unknown";
  return `contentType=${contentType}; messageKeys=${messageKeys}; finishReason=${finishReason}`;
}

function describeCompletionPayload(payload: ChatCompletionResponse | null) {
  if (!payload || typeof payload !== "object") return "payloadKeys=none; choices=none";
  const payloadKeys = Object.keys(payload).sort().join(",") || "none";
  const choiceCount = Array.isArray(payload.choices) ? payload.choices.length : "none";
  return `payloadKeys=${payloadKeys}; choices=${choiceCount}`;
}

function describeResponsesPayload(payload: ResponsesApiResponse | null) {
  if (!payload || typeof payload !== "object") return "payloadKeys=none; output=none";
  const payloadKeys = Object.keys(payload).sort().join(",") || "none";
  const outputCount = Array.isArray(payload.output) ? payload.output.length : "none";
  const outputTextType = payload.output_text === null ? "null" : typeof payload.output_text;
  return `payloadKeys=${payloadKeys}; output=${outputCount}; outputTextType=${outputTextType}`;
}

async function requestChatCompletion<T>({
  config,
  model,
  messages,
  timeoutMs
}: {
  config: AiConfig;
  model: string;
  messages: AiPromptMessage[];
  timeoutMs: number;
}) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  const stream = shouldStreamChatCompletion(config);

  const { response, text } = await fetchTextWithTimeout(
    completionUrl(config),
    {
      method: "POST",
      headers: {
        ...(stream ? { accept: "text/event-stream" } : {}),
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        ...openRouterHeaders(config)
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2,
        stream,
        ...tokenLimitForModel(config, model),
        ...responseFormatForModel(config, model)
      })
    },
    timeoutMs
  );

  const { content, payload } = extractChatPayloadText(text);
  if (!response.ok) {
    const providerError = stringifyProviderError(payload?.error);
    throw new Error(providerError ? `AI provider rejected ${model}: ${providerError}` : `AI provider rejected ${model} with HTTP ${response.status}.`);
  }

  if (content.trim().length === 0) {
    throw new Error(`AI provider returned an empty response for ${model}. ${describeEmptyChoice(payload?.choices?.[0])}; ${describeCompletionPayload(payload)}`);
  }

  return parseJsonObject<T>(content);
}

async function requestResponsesCompletion<T>({
  config,
  model,
  messages,
  timeoutMs
}: {
  config: AiConfig;
  model: string;
  messages: AiPromptMessage[];
  timeoutMs: number;
}) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");

  const { response, text } = await fetchTextWithTimeout(
    responsesUrl(config),
    {
      method: "POST",
      headers: {
        accept: "text/event-stream",
        "content-type": "application/json",
        "openai-beta": "responses=v1",
        authorization: `Bearer ${apiKey}`,
        ...openRouterHeaders(config)
      },
      body: JSON.stringify({
        model,
        ...responsesInputForMessages(messages),
        max_output_tokens: DEFAULT_AI_MAX_TOKENS,
        store: false,
        stream: true
      })
    },
    timeoutMs
  );

  const { content, payload } = extractResponsesPayloadText(text);
  if (!response.ok) {
    const providerError = stringifyProviderError(payload?.error);
    throw new Error(providerError ? `AI provider rejected ${model}: ${providerError}` : `AI provider rejected ${model} with HTTP ${response.status}.`);
  }

  if (content.trim().length === 0) {
    throw new Error(`AI provider returned an empty response for ${model}. ${describeResponsesPayload(payload)}`);
  }

  return parseJsonObject<T>(content);
}

export async function createAiJsonCompletion<T>({
  messages,
  timeoutMs = DEFAULT_AI_TIMEOUT_MS
}: {
  messages: AiPromptMessage[];
  timeoutMs?: number;
}): Promise<AiJsonCompletionResult<T>> {
  const config = getAiConfig();
  if (!config.configured) {
    return {
      ok: false,
      value: null,
      model: null,
      fallbackUsed: false,
      error: "AI is not configured."
    };
  }

  const models = Array.from(new Set([config.model, config.fallbackModel].filter(Boolean)));
  const errors: string[] = [];

  for (const model of models) {
    try {
      const value = await (config.apiStyle === "responses" ? requestResponsesCompletion<T> : requestChatCompletion<T>)({
        config,
        model,
        messages,
        timeoutMs
      });
      return {
        ok: true,
        value,
        model,
        fallbackUsed: model !== config.model,
        error: null
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    ok: false,
    value: null,
    model: null,
    fallbackUsed: models.length > 1,
    error: errors.join(" | ") || "AI provider did not return a usable JSON response."
  };
}
