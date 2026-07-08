import { createAiJsonCompletion } from "@/lib/ai-client";
import { createAdvisorAnswer, type AdvisorAnswer, type AdvisorDecisionSummary } from "@/lib/advisor";
import { validateAdvisorAnswer } from "@/lib/ai-output-validation";
import { getAiConfig } from "@/lib/ai-config";
import { recordAiRuntimeStatus } from "@/lib/ai-runtime-status";
import type { AiPromptMessage } from "@/lib/ai-prompts";
import type { RadarResource } from "@/lib/resources";

export interface AdvisorGenerationResult {
  answer: AdvisorAnswer;
  source: "ai" | "rules";
  model: string | null;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  cacheable: boolean;
}

interface AdvisorNarrative {
  recommendation: string;
  decisionSummary: AdvisorDecisionSummary;
  fitConditions: string[];
  reasons: string[];
  risks: string[];
  validationChecklist: string[];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.trim().length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAdvisorDecisionSummary(value: unknown): value is AdvisorDecisionSummary {
  return (
    isRecord(value) &&
    typeof value.recommendedFor === "string" &&
    isStringArray(value.notRecommendedFor) &&
    ["low", "medium", "high", "unknown"].includes(String(value.migrationCost)) &&
    isStringArray(value.nextSteps)
  );
}

function isAdvisorNarrative(value: unknown): value is AdvisorNarrative {
  return (
    isRecord(value) &&
    typeof value.recommendation === "string" &&
    isAdvisorDecisionSummary(value.decisionSummary) &&
    isStringArray(value.fitConditions) &&
    isStringArray(value.reasons) &&
    isStringArray(value.risks) &&
    isStringArray(value.validationChecklist)
  );
}

function cleanItems(items: string[], limit: number) {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean))).slice(0, limit);
}

function cleanTitle(title: string) {
  return title.replace(/\s*★.*$/, "").trim();
}

function selectedResourcesForDraft(draftAnswer: AdvisorAnswer, resources: RadarResource[]) {
  const selectedIds = new Set([...draftAnswer.evidence.map((item) => item.resourceId), ...draftAnswer.alternatives.map((item) => item.resourceId)]);
  return resources.filter((resource) => selectedIds.has(resource.id));
}

function buildAdvisorNarrativeMessages(question: string, draftAnswer: AdvisorAnswer, resources: RadarResource[]): AiPromptMessage[] {
  const selectedResources = selectedResourcesForDraft(draftAnswer, resources).map((resource) => ({
    id: resource.id,
    title: cleanTitle(resource.title),
    type: resource.radar.type,
    status: resource.radar.status,
    riskLevel: resource.radar.riskLevel,
    maintainStatus: resource.radar.maintainStatus,
    summary: resource.radar.summary,
    useCases: resource.radar.useCases,
    notRecommendedFor: resource.radar.notRecommendedFor,
    evidenceUrls: [resource.url, ...resource.radar.evidence.map((evidence) => evidence.url)]
  }));

  return [
    {
      role: "system",
      content: [
        "你是小程序雷达的 AI 选型顾问。",
        "你只能基于输入的 draftAnswer、resources 和 evidenceUrls 改写文本结论。",
        "不要新增资源 ID、URL、下载量、star、维护状态或不存在的事实。",
        "输出必须是严格 JSON object，不能包含 Markdown 代码块。"
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          task: "rewrite_advisor_narrative",
          question,
          draftAnswer: {
            recommendation: draftAnswer.recommendation,
            decisionSummary: draftAnswer.decisionSummary,
            fitConditions: draftAnswer.fitConditions,
            reasons: draftAnswer.reasons,
            risks: draftAnswer.risks,
            validationChecklist: draftAnswer.validationChecklist,
            alternatives: draftAnswer.alternatives,
            evidence: draftAnswer.evidence
          },
          resources: selectedResources,
          outputSchema: {
            type: "object",
            additionalProperties: false,
            required: ["recommendation", "decisionSummary", "fitConditions", "reasons", "risks", "validationChecklist"],
            properties: {
              recommendation: { type: "string" },
              decisionSummary: {
                type: "object",
                additionalProperties: false,
                required: ["recommendedFor", "notRecommendedFor", "migrationCost", "nextSteps"],
                properties: {
                  recommendedFor: { type: "string" },
                  notRecommendedFor: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 },
                  migrationCost: { type: "string", enum: ["low", "medium", "high", "unknown"] },
                  nextSteps: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 }
                }
              },
              fitConditions: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 },
              reasons: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 },
              risks: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 },
              validationChecklist: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 }
            }
          },
          constraints: [
            "recommendation 必须直接回答用户问题。",
            "decisionSummary 必须保留 recommendedFor、notRecommendedFor、migrationCost、nextSteps 四类决策信息。",
            "fitConditions、reasons、risks、validationChecklist 必须只基于 draftAnswer 和 resources。",
            "不要输出 alternatives 或 evidence 字段；这些字段由系统保留原值。",
            "如果证据不足，写入需要人工验证的内容。"
          ]
        },
        null,
        2
      )
    }
  ];
}

function mergeNarrative(draftAnswer: AdvisorAnswer, narrative: AdvisorNarrative): AdvisorAnswer {
  return {
    ...draftAnswer,
    recommendation: narrative.recommendation.trim() || draftAnswer.recommendation,
    decisionSummary: {
      recommendedFor: narrative.decisionSummary.recommendedFor.trim() || draftAnswer.decisionSummary.recommendedFor,
      notRecommendedFor: cleanItems(narrative.decisionSummary.notRecommendedFor, 4),
      migrationCost: narrative.decisionSummary.migrationCost,
      nextSteps: cleanItems(narrative.decisionSummary.nextSteps, 4)
    },
    fitConditions: cleanItems(narrative.fitConditions, 5),
    reasons: cleanItems(narrative.reasons, 5),
    risks: cleanItems(narrative.risks, 5),
    validationChecklist: cleanItems(narrative.validationChecklist, 6)
  };
}

function rulesResult(answer: AdvisorAnswer, cacheable: boolean, fallbackReason: string | null = null): AdvisorGenerationResult {
  return {
    answer,
    source: "rules",
    model: null,
    fallbackUsed: false,
    fallbackReason,
    cacheable
  };
}

export async function createAdvisorAnswerWithAi(question: string, resources: RadarResource[]): Promise<AdvisorGenerationResult> {
  const draftAnswer = createAdvisorAnswer(question, resources);
  const config = getAiConfig();

  if (!config.configured) {
    recordAiRuntimeStatus({ source: "not_configured" });
    return rulesResult(draftAnswer, true);
  }

  const completion = await createAiJsonCompletion<AdvisorNarrative>({
    messages: buildAdvisorNarrativeMessages(question, draftAnswer, resources)
  });

  if (!completion.ok) {
    console.warn("[ai-advisor] Falling back to rules after AI provider failure.", {
      provider: config.provider,
      primaryModel: config.model,
      fallbackModel: config.fallbackModel,
      error: completion.error
    });
    recordAiRuntimeStatus({
      source: "rules",
      fallbackUsed: completion.fallbackUsed,
      fallbackReason: "provider_error",
      error: completion.error
    });
    return rulesResult(draftAnswer, false, "provider_error");
  }

  if (!isAdvisorNarrative(completion.value)) {
    console.warn("[ai-advisor] Falling back to rules because AI output did not match the Advisor narrative schema.", {
      provider: config.provider,
      model: completion.model,
      fallbackUsed: completion.fallbackUsed
    });
    recordAiRuntimeStatus({
      source: "rules",
      model: completion.model,
      fallbackUsed: completion.fallbackUsed,
      fallbackReason: "invalid_model_output",
      error: "AI output did not match the Advisor narrative schema."
    });
    return rulesResult(draftAnswer, false, "invalid_model_output");
  }

  const answer = mergeNarrative(draftAnswer, completion.value);
  const validation = validateAdvisorAnswer(answer, resources);
  if (!validation.ok) {
    console.warn("[ai-advisor] Falling back to rules because merged AI Advisor answer failed validation.", {
      provider: config.provider,
      model: completion.model,
      fallbackUsed: completion.fallbackUsed,
      errors: validation.errors
    });
    recordAiRuntimeStatus({
      source: "rules",
      model: completion.model,
      fallbackUsed: completion.fallbackUsed,
      fallbackReason: "validation_failed",
      error: validation.errors.join(" | ")
    });
    return rulesResult(draftAnswer, false, "validation_failed");
  }

  recordAiRuntimeStatus({
    source: "ai",
    model: completion.model,
    fallbackUsed: completion.fallbackUsed
  });

  return {
    answer,
    source: "ai",
    model: completion.model,
    fallbackUsed: completion.fallbackUsed,
    fallbackReason: null,
    cacheable: true
  };
}
