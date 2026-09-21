import { requestUrl } from "obsidian";
import { RequestGate, sharedRequestGate } from "./request-gate";
import { FinanceAdvisorSnapshot, formatCents } from "./core";

export const FINANCE_AI_PROFILE = `你是一名克制、可靠的个人财务观察员。
从程序给出的候选事件中，选择最值得用户关注的一项，并选择最多三个相关分类。
优先考虑金额影响、样本可靠性、变化程度和下一步决策价值；不要固定关注餐饮或购物。
历史不足、周期初期或低置信度时，降低预测事件优先级。没有可靠变化时选择 stable。
金额、标题和事实说明全部由程序根据所选事件生成；不要输出任何自由文本或数字。
action_id 只能是 observe（继续观察）、review（核对相关记录）、plan（检查后续支出安排）。
不提供投资、借贷或税务建议。分类参考余量不是预算或消费许可。
只输出 JSON：
{"primary_event_id":"输入中存在的事件ID","action_id":"observe","category_names":["输入中存在的分类名称"]}`;

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
  const event = snapshot.events.find((item) => item.id === primaryEventId);
  if (!event) throw new Error("AI 选择了不存在的候选事件");
  const actions: Record<string, string> = {
    observe: "建议继续观察后续记录。",
    review: "可以核对相关记录，确认是否存在补记或重复记账。",
    plan: "可以结合后续已知支出，检查本周期的安排。"
  };
  const action = typeof value.action_id === "string" && Object.prototype.hasOwnProperty.call(actions, value.action_id) ? actions[value.action_id] : undefined;
  if (!action || !Array.isArray(value.category_names)) throw new Error("AI 返回的选择格式不正确");
  const categoryLines: FinanceAdviceCategoryLine[] = [];
  for (const name of value.category_names.slice(0, 3)) {
    if (typeof name !== "string") throw new Error("AI 返回的分类无效");
    const category = snapshot.categories.find((item) => item.category === name);
    if (!category) throw new Error("AI 选择了不存在的分类");
    if (snapshot.historyCycleCount > 0 && !categoryLines.some((line) => line.category === name)) {
      categoryLines.push({ category: name, text: `按过往周期参考，参考余量 ${formatCents(category.remainingReferenceCents)}；不等同于预算。` });
    }
  }
  // Never render model-supplied prose, even if unexpected fields are present.
  return {
    primaryEventId: event.id, headline: event.title, summary: `${event.detail}${action}`,
    categoryLines, tone: event.type === "salary-pressure" && snapshot.forecastConfidence === "normal" ? "warning" : "normal"
  };
}

export function financeSnapshotFingerprint(snapshot: FinanceAdvisorSnapshot): string {
  const source = JSON.stringify({
    schema: 3,
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

export async function requestFinanceAdvice(config: FinanceAiConfig, snapshot: FinanceAdvisorSnapshot, signal?: AbortSignal, gate: RequestGate = sharedRequestGate("ai")): Promise<FinanceAdvice> {
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
  const response = await gate.run(() => requestUrl({
    url: endpoint, method: "POST", headers, contentType: "application/json",
    body: JSON.stringify(requestBody), throw: true
  }), signal, FINANCE_AI_TIMEOUT_MS);
  const responseBody = response.json as { choices?: Array<{ message?: { content?: unknown } }> } | null;
  const content = jsonTextFromResponse(responseBody?.choices?.[0]?.message?.content);
  if (!content) throw new Error("AI 接口没有返回可用内容");
  return parseFinanceAdvice(content, snapshot);
}
