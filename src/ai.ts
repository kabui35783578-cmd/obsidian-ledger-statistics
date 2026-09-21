import { requestUrl } from "obsidian";
import { FinanceAdvisorSnapshot, formatCents } from "./core";

export const FINANCE_AI_PROFILE = `你是一名克制、可靠的个人财务观察员。

你的职责不是重新计算账目，而是从程序提供的“财务事件候选池”中，判断当前最值得用户知道的变化，并把它表达清楚。

程序已经负责：
- 计算工资周期、支出、余额和预测金额
- 对比前两个完整工资周期
- 扫描全部消费分类
- 识别金额异常、频率变化、笔均金额变化、大额单笔和消费结构变化
- 生成分类参考余量

你必须遵守：
1. 只能使用输入中已经提供的事实、金额和事件。
2. 不得自行计算、修改、补全或推测任何金额。
3. 不得虚构商家、消费原因、用户意图、收入来源或生活状况。
4. 不要固定关注餐饮或购物，应在全部候选分类中判断。
5. 优先选择同时具备以下特征的事件：对工资余额影响较大、与前两个周期相比变化明显、样本数量足够、对用户接下来的消费决策有帮助。
6. 降低以下事件的优先级：只有百分比变化但实际金额很小、只多一笔或样本过少、与更重要事件重复表达、工资周期刚开始且暂时无法形成可靠判断。
7. 如果没有明显且可靠的变化，直接说明“目前没有值得特别提醒的变化”，不要为了显得有用而制造问题。
8. “分类参考余量”只是根据前两个周期平均得出的参考，不是预算，也不代表用户一定可以花完。使用“按过往周期参考，还可安排……”一类表述，不得使用保证性措辞。
9. 不提供投资、借贷、税务或高风险财务建议。
10. 不提及 AI、模型、提示词或内部计算过程。

输出要求：
- 只选择一个最值得关注的主事件。
- 分类建议最多选择三个真正相关的分类。
- 标题不超过 16 个中文字符。
- 总结最多两句话，避免空话和说教。
- 语气直接、克制、具体，不制造焦虑。
- 所有事件和分类必须引用输入中存在的 ID 或名称。

严格输出 JSON，不要使用 Markdown 代码块：
{
  "primary_event_id": "候选事件ID；没有明显变化时填写 stable",
  "headline": "简短标题",
  "summary": "对变化的具体说明，以及用户接下来最值得注意的事情",
  "category_lines": [
    {
      "category": "输入中存在的分类名称",
      "text": "基于过往周期参考的简短说明"
    }
  ],
  "tone": "normal 或 warning"
}`;

export interface FinanceAdviceCategoryLine {
  category: string;
  text: string;
}

export interface FinanceAdvice {
  primaryEventId: string;
  headline: string;
  summary: string;
  categoryLines: FinanceAdviceCategoryLine[];
  tone: "normal" | "warning";
}

export interface FinanceAdviceCache {
  date: string;
  fingerprint: string;
  advice: FinanceAdvice;
  updatedAt: string;
}

export interface FinanceAiConfig {
  endpoint: string;
  apiKey: string;
  model: string;
}

const FINANCE_AI_TIMEOUT_MS = 60_000;

function compactText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || text.length > maxLength) return null;
  return text;
}

function jsonTextFromResponse(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return null;
  const text = value
    .filter((item): item is { type?: string; text?: string } => typeof item === "object" && item !== null)
    .map((item) => typeof item.text === "string" ? item.text : "")
    .join("");
  return text || null;
}

export function parseFinanceAdvice(raw: string, snapshot: FinanceAdvisorSnapshot): FinanceAdvice {
  const unfenced = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced);
  } catch {
    throw new Error("AI 返回的内容不是有效 JSON");
  }
  if (typeof parsed !== "object" || parsed === null) throw new Error("AI 返回格式不正确");
  const value = parsed as Record<string, unknown>;
  const primaryEventId = compactText(value.primary_event_id, 160);
  const headline = compactText(value.headline, 16);
  const summary = compactText(value.summary, 140);
  const tone = value.tone === "warning" ? "warning" : value.tone === "normal" ? "normal" : null;
  const allowedEvents = new Set(snapshot.events.map((event) => event.id));
  if (!primaryEventId || !allowedEvents.has(primaryEventId)) throw new Error("AI 选择了不存在的候选事件");
  if (!headline || !summary || !tone) throw new Error("AI 返回缺少标题、总结或语气");
  const allowedCategories = new Set(snapshot.categories.map((item) => item.category));
  const categoryLines: FinanceAdviceCategoryLine[] = [];
  if (Array.isArray(value.category_lines)) {
    for (const item of value.category_lines.slice(0, 3)) {
      if (typeof item !== "object" || item === null) continue;
      const row = item as Record<string, unknown>;
      const category = compactText(row.category, 80);
      const text = compactText(row.text, 100);
      if (category && text && allowedCategories.has(category) && !categoryLines.some((line) => line.category === category)) {
        categoryLines.push({ category, text });
      }
    }
  }
  return { primaryEventId, headline, summary, categoryLines, tone };
}

export function financeSnapshotFingerprint(snapshot: FinanceAdvisorSnapshot): string {
  const source = JSON.stringify({
    schema: 2,
    snapshot,
    date: snapshot.currentRange.end,
    salary: snapshot.salaryCents,
    spent: snapshot.currentSpentCents,
    remaining: snapshot.remainingSalaryCents,
    events: snapshot.events.map((event) => [event.id, event.priority, event.detail]),
    categories: snapshot.categories.map((item) => [item.category, item.currentCents, item.baselineCycleCents, item.remainingReferenceCents])
  });
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function financeAiInput(snapshot: FinanceAdvisorSnapshot): string {
  return JSON.stringify({
    period: {
      start: snapshot.currentRange.start,
      end: snapshot.currentRange.end,
      elapsed_days: snapshot.elapsedDays,
      total_days: snapshot.totalDays
    },
    salary_summary: {
      salary: formatCents(snapshot.salaryCents),
      current_spent: formatCents(snapshot.currentSpentCents),
      remaining_salary: formatCents(snapshot.remainingSalaryCents),
      available_complete_cycles: snapshot.historyCycleCount,
      historical_average: snapshot.historyCycleCount > 0 ? formatCents(snapshot.historicalAverageSpentCents) : null,
      forecast: snapshot.forecastAvailable ? formatCents(snapshot.forecastCents) : null,
      forecast_method: "当前已花加历史周期同阶段之后的平均支出；不按日均放大固定支出",
      forecast_confidence: snapshot.forecastAvailable ? snapshot.forecastConfidence : "unavailable",
      data_guidance: "历史少于两个完整周期时不得宣称相较两周期异常；低置信度预测仅作参考，不能当成确定超支。"
    },
    candidate_events: snapshot.events.map((event) => ({
      id: event.id,
      type: event.type,
      priority: event.priority,
      category: event.category ?? null,
      title: event.title,
      detail: event.detail
    })),
    category_references: snapshot.categories.map((item) => ({
      category: item.category,
      current_spent: formatCents(item.currentCents),
      historical_average: snapshot.historyCycleCount > 0 ? formatCents(item.baselineCycleCents) : null,
      reference_remaining: snapshot.historyCycleCount > 0 ? formatCents(item.remainingReferenceCents) : null
    }))
  });
}

function validateEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("AI 接口地址无效");
  }
  const localHttp = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1");
  if (url.protocol !== "https:" && !localHttp) throw new Error("AI 接口必须使用 HTTPS，本机接口可使用 HTTP");
  const trimmedPath = url.pathname.replace(/\/+$/, "");
  if (trimmedPath === "/v1") url.pathname = `${trimmedPath}/chat/completions`;
  return url.toString();
}

export async function requestFinanceAdvice(config: FinanceAiConfig, snapshot: FinanceAdvisorSnapshot): Promise<FinanceAdvice> {
  const endpoint = validateEndpoint(config.endpoint);
  const model = config.model.trim();
  if (!model) throw new Error("请先填写 AI 模型名称");
  const endpointHost = new URL(endpoint).hostname;
  if (/^mimo-/i.test(model) && endpointHost === "api.openai.com") {
    throw new Error("MiMo 模型不能使用 OpenAI 官方接口，请改为 MiMo 服务地址");
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey.trim()) headers.Authorization = `Bearer ${config.apiKey.trim()}`;
  const requestBody: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: FINANCE_AI_PROFILE },
      { role: "user", content: financeAiInput(snapshot) }
    ],
    max_completion_tokens: 1_200
  };
  if (/^mimo-/i.test(model) && endpointHost.endsWith("xiaomimimo.com")) {
    requestBody.thinking = { type: "disabled" };
  }
  let timeoutId = 0;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error("AI 请求超过 60 秒，已停止等待")), FINANCE_AI_TIMEOUT_MS);
  });
  let response;
  try {
    response = await Promise.race([requestUrl({
      url: endpoint,
      method: "POST",
      headers,
      contentType: "application/json",
      body: JSON.stringify(requestBody),
      throw: true
    }), timeout]);
  } finally {
    window.clearTimeout(timeoutId);
  }
  const responseBody = response.json as { choices?: Array<{ message?: { content?: unknown } }> } | null;
  const content = jsonTextFromResponse(responseBody?.choices?.[0]?.message?.content);
  if (!content) throw new Error("AI 接口没有返回可用内容");
  return parseFinanceAdvice(content, snapshot);
}
