import type { Company } from "@/lib/mock-data";

export type GeneratedQuickNote = {
  headline: string;
  summary: string;
  financials: string[];
  segments: string[];
  aiDynamics: string[];
  watchItems: string[];
  copyText: string;
};

type ResponsesApiResponse = {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      text?: string;
      type?: string;
    }>;
  }>;
  error?: {
    message?: string;
  };
};

function getEnv(name: string, fallback?: string) {
  const value = process.env[name]?.trim();
  return value || fallback;
}

function getOpenAiConfig() {
  const apiKey = getEnv("OPENAI_API_KEY") ?? getEnv("ONEAPI_API_KEY");
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  return {
    apiKey,
    baseUrl: getEnv("OPENAI_BASE_URL", "https://oneapi-comate.baidu-int.com/v1")?.replace(/\/$/, ""),
    model: getEnv("OPENAI_MODEL", "gpt-5.5-coding-plan"),
    reasoningEffort: getEnv("OPENAI_REASONING_EFFORT", "xhigh"),
    disableResponseStorage: getEnv("OPENAI_DISABLE_RESPONSE_STORAGE", "true") !== "false",
  };
}

function buildModelInput(company: Company) {
  return {
    company: {
      id: company.id,
      name: company.name,
      ticker: company.ticker,
      industry: company.industry,
      fiscalPeriod: company.fiscalPeriod,
      reportDate: company.reportDate,
      sourceUrl: company.sourceUrl,
      sourceLabel: company.sourceLabel,
      dataQuality: company.dataQuality,
    },
    currentSummary: {
      quickNote: company.quickNote,
      highlights: company.highlights,
      risks: company.risks,
      marketReaction: company.shareReaction,
    },
    metrics: company.metrics.map((metric) => ({
      label: metric.label,
      displayValue: metric.displayValue,
      yoy: metric.yoy,
      qoq: metric.qoq,
      source: metric.source,
    })),
    segments: company.segments.map((segment) => ({
      name: segment.name,
      displayRevenue: segment.displayRevenue,
      share: segment.share,
      yoy: segment.yoy,
      qoq: segment.qoq,
      driver: segment.driver,
    })),
    aiDevelopments: company.aiDevelopments.map((item) => ({
      title: item.title,
      category: item.category,
      date: item.date,
      status: item.status,
      summary: item.summary,
      source: item.source,
    })),
  };
}

function extractOutputText(payload: ResponsesApiResponse) {
  if (payload.output_text) return payload.output_text;

  const text = payload.output
    ?.flatMap((item) => item.content ?? [])
    .map((content) => content.text)
    .filter(Boolean)
    .join("\n");

  return text ?? "";
}

function parseJsonOutput(text: string): GeneratedQuickNote {
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const jsonText = start >= 0 && end >= start ? cleaned.slice(start, end + 1) : cleaned;
  const parsed = JSON.parse(jsonText) as GeneratedQuickNote;

  if (!parsed.copyText || !parsed.headline) {
    throw new Error("LLM response did not match the Quick Note schema");
  }

  return parsed;
}

export async function generateQuickNoteWithLlm(company: Company): Promise<GeneratedQuickNote> {
  const config = getOpenAiConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  try {
    const response = await fetch(`${config.baseUrl}/responses`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        store: !config.disableResponseStorage,
        reasoning: {
          effort: config.reasoningEffort,
        },
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text:
                  "你是严谨的中文买方财报分析助手。你只能基于用户提供的结构化财报数据写作，不得新增、猜测或改写任何财务数字。未披露的信息必须写“未披露”或“仍需观察”。输出必须是合法 JSON。",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify({
                  task:
                    "按照 Quick Notes 模板生成中文财报摘要。要求：1）财务数字必须来自 metrics/segments 字段，面向用户展示时优先使用 displayValue/displayRevenue；2）突出超预期/弱项/业务分部/AI 动态；3）copyText 可直接复制到投研笔记；4）不要写投资建议或目标价。",
                  data: buildModelInput(company),
                  outputSchema: {
                    headline: "一句话整体结论",
                    summary: "2-3 句总览",
                    financials: ["核心财务数据 bullet"],
                    segments: ["业务分部 bullet"],
                    aiDynamics: ["AI 相关动态 bullet"],
                    watchItems: ["后续观察 bullet"],
                    copyText: "完整可复制中文 Quick Notes 文本",
                  },
                }),
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "earnings_quick_note",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: [
                "headline",
                "summary",
                "financials",
                "segments",
                "aiDynamics",
                "watchItems",
                "copyText",
              ],
              properties: {
                headline: { type: "string" },
                summary: { type: "string" },
                financials: { type: "array", items: { type: "string" } },
                segments: { type: "array", items: { type: "string" } },
                aiDynamics: { type: "array", items: { type: "string" } },
                watchItems: { type: "array", items: { type: "string" } },
                copyText: { type: "string" },
              },
            },
          },
        },
      }),
    });

    const payload = (await response.json()) as ResponsesApiResponse;

    if (!response.ok) {
      throw new Error(payload.error?.message ?? `LLM request failed: ${response.status}`);
    }

    return parseJsonOutput(extractOutputText(payload));
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("LLM request timed out after 120 seconds");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
