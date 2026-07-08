import assert from "node:assert/strict";
import { POST as advisorRoute } from "@/app/api/advisor/route";
import { createAdvisorAnswer } from "@/lib/advisor";
import { validateAdvisorAnswer } from "@/lib/ai-output-validation";
import { getResources } from "@/lib/resources";

const originalEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_API_URL: process.env.OPENAI_API_URL,
  OPENAI_API_STYLE: process.env.OPENAI_API_STYLE,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  OPENAI_FALLBACK_MODEL: process.env.OPENAI_FALLBACK_MODEL,
  KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
  KV_REST_API_URL: process.env.KV_REST_API_URL,
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL
};

function setEnv(name: keyof typeof originalEnv, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name as string] = value;
  }
}

const questions = [
  {
    question: "React 团队做电商小程序，后续可能上 H5，应该选 Taro 还是原生？",
    expectedEvidence: /taro|uni-app|mpx/i
  },
  {
    question: "现在还建议新项目继续使用 WePY 吗？",
    expectedRecommendation: /不建议/,
    expectedEvidence: /wepy/i
  },
  {
    question: "企业项目要选小程序 UI 组件库，Vant Weapp、TDesign、WeUI 怎么看？",
    expectedEvidence: /vant|tdesign|weui/i
  },
  {
    question: "Vue 团队要做多端小程序和 H5，uni-app 是否合适？",
    expectedEvidence: /uni-app|taro/i
  },
  {
    question: "需要云开发、serverless 或后端服务，小程序生态里有哪些方向？",
    expectedEvidence: /cloud|云|serverless|开发/i
  },
  {
    question: "要找支付、登录、地图相关 SDK，应该先看哪些资源？",
    expectedEvidence: /sdk|支付|登录|地图|map/i
  }
];

const originalFetch = globalThis.fetch;

try {
  setEnv("DATABASE_URL", undefined);
  setEnv("OPENAI_API_KEY", undefined);
  setEnv("OPENAI_API_URL", undefined);
  setEnv("OPENAI_API_STYLE", undefined);
  setEnv("OPENAI_MODEL", undefined);
  setEnv("OPENAI_FALLBACK_MODEL", undefined);
  setEnv("UPSTASH_REDIS_REST_TOKEN", undefined);
  setEnv("UPSTASH_REDIS_REST_URL", undefined);
  setEnv("KV_REST_API_TOKEN", undefined);
  setEnv("KV_REST_API_URL", undefined);

  const resources = await getResources();
  const resourceIds = new Set(resources.map((resource) => resource.id));
  const results = questions.map((item) => {
    const answer = createAdvisorAnswer(item.question, resources);
    const validation = validateAdvisorAnswer(answer, resources);
    const evidenceText = answer.evidence.map((evidence) => `${evidence.title} ${evidence.label} ${evidence.type} ${evidence.url}`).join("\n");

    assert.equal(validation.ok, true, validation.errors.join("\n"));
    assert.ok(answer.recommendation.length > 0, `${item.question} should include a recommendation`);
    assert.ok(answer.fitConditions.length > 0, `${item.question} should include fit conditions`);
    assert.ok(answer.reasons.length > 0, `${item.question} should include reasons`);
    assert.ok(answer.risks.length > 0, `${item.question} should include risks`);
    assert.ok(answer.alternatives.length > 0, `${item.question} should include alternatives`);
    assert.ok(
      answer.alternatives.every(
        (alternative) => alternative.resourceId && resourceIds.has(alternative.resourceId) && alternative.title && alternative.url && alternative.reason && alternative.status && alternative.riskLevel
      ),
      `${item.question} alternatives should include a known resource id, title, url, reason, status and risk level`
    );
    assert.ok(answer.validationChecklist.length > 0, `${item.question} should include a validation checklist`);
    assert.ok(answer.evidence.length > 0, `${item.question} should include evidence`);
    assert.ok(
      answer.evidence.every((evidence) => evidence.resourceId && resourceIds.has(evidence.resourceId) && evidence.title && evidence.url && evidence.type && evidence.label),
      `${item.question} evidence should include a known resource id, title, url, type and label`
    );
    assert.match(evidenceText, item.expectedEvidence, `${item.question} evidence should match expected topic`);

    if (item.expectedRecommendation) {
      assert.match(answer.recommendation, item.expectedRecommendation, `${item.question} recommendation should match expected stance`);
    }

    return {
      question: item.question,
      recommendation: answer.recommendation,
      evidence: answer.evidence.map((evidence) => evidence.title)
    };
  });

  const routeResponse = await advisorRoute(
    new Request("https://example.com/api/advisor", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.50"
      },
      body: JSON.stringify({ question: questions[0].question })
    })
  );
  assert.equal(routeResponse.status, 200, "advisor route should return a validated answer");
  const routeAnswer = (await routeResponse.json()) as ReturnType<typeof createAdvisorAnswer> & { cached?: boolean; persisted?: boolean; source?: string };
  const routeValidation = validateAdvisorAnswer(routeAnswer, resources);
  assert.equal(routeValidation.ok, true, routeValidation.errors.join("\n"));
  assert.ok(routeAnswer.fitConditions.length > 0, "advisor route should return fit conditions");
  assert.ok(routeAnswer.alternatives.length > 0, "advisor route should return alternatives");
  assert.ok(routeAnswer.validationChecklist.length > 0, "advisor route should return a validation checklist");
  assert.equal(routeAnswer.source, "rules", "advisor route should use rules when AI is not configured");

  setEnv("OPENAI_API_KEY", "test-openrouter-key");
  setEnv("OPENAI_API_URL", "https://openrouter.ai/api/v1");
  setEnv("OPENAI_MODEL", "test-primary-model");
  setEnv("OPENAI_FALLBACK_MODEL", "test-fallback-model");

  const draftAiAnswer = createAdvisorAnswer(questions[0].question, resources);
  const modelAnswer = {
    ...draftAiAnswer,
    recommendation: `AI 增强建议：${draftAiAnswer.recommendation}`
  };
  let aiRequestCount = 0;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    aiRequestCount += 1;
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(init?.method, "POST");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer test-openrouter-key");
    const body = JSON.parse(String(init?.body)) as { model?: string; messages?: unknown[]; stream?: boolean; response_format?: unknown };
    assert.equal(body.model, "test-primary-model");
    assert.equal(body.stream, false);
    assert.equal(body.response_format, undefined);
    assert.ok(Array.isArray(body.messages) && body.messages.length === 2, "AI request should include prompt contract messages");
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify(modelAnswer)
            }
          }
        ]
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    );
  };

  const aiRouteResponse = await advisorRoute(
    new Request("https://example.com/api/advisor", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.51"
      },
      body: JSON.stringify({ question: questions[0].question })
    })
  );
  assert.equal(aiRouteResponse.status, 200, "advisor route should return a model-backed answer when AI is configured");
  assert.equal(aiRouteResponse.headers.get("x-advisor-source"), "ai");
  assert.equal(aiRouteResponse.headers.get("x-advisor-model"), "test-primary-model");
  const aiRouteAnswer = (await aiRouteResponse.json()) as ReturnType<typeof createAdvisorAnswer> & { source?: string; model?: string | null; fallbackUsed?: boolean; fallbackReason?: string | null };
  const aiRouteValidation = validateAdvisorAnswer(aiRouteAnswer, resources);
  assert.equal(aiRouteValidation.ok, true, aiRouteValidation.errors.join("\n"));
  assert.equal(aiRouteAnswer.source, "ai");
  assert.equal(aiRouteAnswer.model, "test-primary-model");
  assert.equal(aiRouteAnswer.fallbackUsed, false);
  assert.equal(aiRouteAnswer.fallbackReason, null);
  assert.match(aiRouteAnswer.recommendation, /^AI 增强建议：/);
  assert.equal(aiRequestCount, 1, "advisor route should call the AI provider once for a valid primary response");
  globalThis.fetch = originalFetch;

  setEnv("OPENAI_FALLBACK_MODEL", "qwen/qwen3-next-80b-a3b-instruct:free");

  const fallbackModelAnswer = {
    ...draftAiAnswer,
    recommendation: `Fallback AI 建议：${draftAiAnswer.recommendation}`
  };
  const requestedModels: string[] = [];
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(String(init?.body)) as { model?: string; response_format?: { type?: string } };
    requestedModels.push(body.model ?? "");

    if (body.model === "test-primary-model") {
      assert.equal(body.response_format, undefined);
      return new Response(JSON.stringify({ error: { message: "primary unavailable" } }), {
        status: 503,
        headers: { "content-type": "application/json" }
      });
    }

    assert.equal(body.model, "qwen/qwen3-next-80b-a3b-instruct:free");
    assert.equal(body.response_format?.type, "json_object");

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify(fallbackModelAnswer)
            }
          }
        ]
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    );
  };

  const fallbackRouteResponse = await advisorRoute(
    new Request("https://example.com/api/advisor", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.52"
      },
      body: JSON.stringify({ question: questions[0].question })
    })
  );
  assert.equal(fallbackRouteResponse.status, 200, "advisor route should return a fallback model answer when primary fails");
  assert.equal(fallbackRouteResponse.headers.get("x-advisor-source"), "ai");
  assert.equal(fallbackRouteResponse.headers.get("x-advisor-model"), "qwen/qwen3-next-80b-a3b-instruct:free");
  assert.equal(fallbackRouteResponse.headers.get("x-advisor-fallback"), "true");
  const fallbackRouteAnswer = (await fallbackRouteResponse.json()) as ReturnType<typeof createAdvisorAnswer> & { source?: string; model?: string | null; fallbackUsed?: boolean; fallbackReason?: string | null };
  const fallbackRouteValidation = validateAdvisorAnswer(fallbackRouteAnswer, resources);
  assert.equal(fallbackRouteValidation.ok, true, fallbackRouteValidation.errors.join("\n"));
  assert.equal(fallbackRouteAnswer.source, "ai");
  assert.equal(fallbackRouteAnswer.model, "qwen/qwen3-next-80b-a3b-instruct:free");
  assert.equal(fallbackRouteAnswer.fallbackUsed, true);
  assert.equal(fallbackRouteAnswer.fallbackReason, null);
  assert.match(fallbackRouteAnswer.recommendation, /^Fallback AI 建议：/);
  assert.deepEqual(requestedModels, ["test-primary-model", "qwen/qwen3-next-80b-a3b-instruct:free"], "advisor route should try primary then fallback model");
  globalThis.fetch = originalFetch;

  setEnv("OPENAI_API_URL", "https://agentrouter.org/v1");
  setEnv("OPENAI_MODEL", "gpt-5.5");
  setEnv("OPENAI_FALLBACK_MODEL", "gpt-5.5");

  const agentRouterAnswer = {
    ...draftAiAnswer,
    recommendation: `AgentRouter 建议：${draftAiAnswer.recommendation}`
  };
  let agentRouterRequestCount = 0;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    agentRouterRequestCount += 1;
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    assert.equal(url, "https://agentrouter.org/v1/chat/completions");
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body)) as { model?: string; max_completion_tokens?: number; max_tokens?: number; response_format?: unknown; stream?: boolean };
    assert.equal(headers.get("accept"), "text/event-stream");
    assert.equal(body.model, "gpt-5.5");
    assert.equal(body.max_completion_tokens, undefined);
    assert.equal(body.max_tokens, 1400);
    assert.equal(body.response_format, undefined);
    assert.equal(body.stream, true);

    return new Response(
      [
        `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(agentRouterAnswer) } }] })}`,
        "",
        "data: [DONE]",
        ""
      ].join("\n"),
      {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      }
    );
  };

  const agentRouterRouteResponse = await advisorRoute(
    new Request("https://example.com/api/advisor", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.53"
      },
      body: JSON.stringify({ question: questions[0].question })
    })
  );
  assert.equal(agentRouterRouteResponse.status, 200, "advisor route should accept streaming chat content from AgentRouter-compatible endpoints");
  assert.equal(agentRouterRouteResponse.headers.get("x-advisor-source"), "ai");
  assert.equal(agentRouterRouteResponse.headers.get("x-advisor-model"), "gpt-5.5");
  const agentRouterRouteAnswer = (await agentRouterRouteResponse.json()) as ReturnType<typeof createAdvisorAnswer> & { source?: string; model?: string | null };
  const agentRouterRouteValidation = validateAdvisorAnswer(agentRouterRouteAnswer, resources);
  assert.equal(agentRouterRouteValidation.ok, true, agentRouterRouteValidation.errors.join("\n"));
  assert.equal(agentRouterRouteAnswer.source, "ai");
  assert.equal(agentRouterRouteAnswer.model, "gpt-5.5");
  assert.match(agentRouterRouteAnswer.recommendation, /^AgentRouter 建议：/);
  assert.equal(agentRouterRequestCount, 1, "advisor route should deduplicate identical primary and fallback models");
  globalThis.fetch = originalFetch;

  setEnv("OPENAI_API_STYLE", "responses");

  const agentRouterResponsesAnswer = {
    ...draftAiAnswer,
    recommendation: `AgentRouter Responses 建议：${draftAiAnswer.recommendation}`
  };
  let agentRouterResponsesRequestCount = 0;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    agentRouterResponsesRequestCount += 1;
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    assert.equal(url, "https://agentrouter.org/v1/responses");
    const body = JSON.parse(String(init?.body)) as {
      model?: string;
      instructions?: string;
      input?: Array<{ role?: string; content?: Array<{ type?: string; text?: string }> }>;
      max_output_tokens?: number;
      max_tokens?: number;
      store?: boolean;
      stream?: boolean;
    };
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("accept"), "text/event-stream");
    assert.equal(headers.get("openai-beta"), "responses=v1");
    assert.equal(body.model, "gpt-5.5");
    assert.ok(body.instructions && body.instructions.length > 0, "Responses API request should include system instructions");
    assert.equal(body.input?.length, 1, "Responses API request should include user input message");
    assert.equal(body.input?.[0]?.role, "user");
    assert.equal(body.input?.[0]?.content?.[0]?.type, "input_text");
    assert.equal(body.max_output_tokens, 1400);
    assert.equal(body.max_tokens, undefined);
    assert.equal(body.store, false);
    assert.equal(body.stream, true);

    return new Response(
      [
        `event: response.output_text.delta`,
        `data: ${JSON.stringify({ type: "response.output_text.delta", delta: JSON.stringify(agentRouterResponsesAnswer) })}`,
        "",
        `event: response.completed`,
        `data: ${JSON.stringify({ type: "response.completed" })}`,
        ""
      ].join("\n"),
      {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      }
    );
  };

  const agentRouterResponsesRouteResponse = await advisorRoute(
    new Request("https://example.com/api/advisor", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.54"
      },
      body: JSON.stringify({ question: questions[0].question })
    })
  );
  assert.equal(agentRouterResponsesRouteResponse.status, 200, "advisor route should accept Responses API output from Codex-compatible endpoints");
  assert.equal(agentRouterResponsesRouteResponse.headers.get("x-advisor-source"), "ai");
  assert.equal(agentRouterResponsesRouteResponse.headers.get("x-advisor-model"), "gpt-5.5");
  const agentRouterResponsesRouteAnswer = (await agentRouterResponsesRouteResponse.json()) as ReturnType<typeof createAdvisorAnswer> & { source?: string; model?: string | null };
  const agentRouterResponsesRouteValidation = validateAdvisorAnswer(agentRouterResponsesRouteAnswer, resources);
  assert.equal(agentRouterResponsesRouteValidation.ok, true, agentRouterResponsesRouteValidation.errors.join("\n"));
  assert.equal(agentRouterResponsesRouteAnswer.source, "ai");
  assert.equal(agentRouterResponsesRouteAnswer.model, "gpt-5.5");
  assert.match(agentRouterResponsesRouteAnswer.recommendation, /^AgentRouter Responses 建议：/);
  assert.equal(agentRouterResponsesRequestCount, 1, "advisor route should call Responses API once when primary and fallback models match");
  globalThis.fetch = originalFetch;

  console.log(
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        cases: results.length + 5,
        assertions: [
          "advisor generation",
          "advisor decision structure",
          "advisor internal resource links",
          "advisor evidence validation",
          "advisor route validation",
          "advisor AI route validation",
          "advisor AI fallback model",
          "advisor streaming chat AI content",
          "advisor responses API content"
        ],
        results
      },
      null,
      2
    )
  );
} finally {
  if (typeof originalFetch !== "undefined") globalThis.fetch = originalFetch;
  setEnv("DATABASE_URL", originalEnv.DATABASE_URL);
  setEnv("OPENAI_API_KEY", originalEnv.OPENAI_API_KEY);
  setEnv("OPENAI_API_URL", originalEnv.OPENAI_API_URL);
  setEnv("OPENAI_API_STYLE", originalEnv.OPENAI_API_STYLE);
  setEnv("OPENAI_MODEL", originalEnv.OPENAI_MODEL);
  setEnv("OPENAI_FALLBACK_MODEL", originalEnv.OPENAI_FALLBACK_MODEL);
  setEnv("KV_REST_API_TOKEN", originalEnv.KV_REST_API_TOKEN);
  setEnv("KV_REST_API_URL", originalEnv.KV_REST_API_URL);
  setEnv("UPSTASH_REDIS_REST_TOKEN", originalEnv.UPSTASH_REDIS_REST_TOKEN);
  setEnv("UPSTASH_REDIS_REST_URL", originalEnv.UPSTASH_REDIS_REST_URL);
}
