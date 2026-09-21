import type { FinanceAdvisorSnapshot, FinanceInsightEvent, LedgerRecord } from "./core";

export interface SeenInsight { cycle: string; id: string; date: string; impact: number; metric?: number }

function signalMetric(snapshot: FinanceAdvisorSnapshot, event: FinanceInsightEvent): number | undefined {
  const category = snapshot.categories.find((item) => item.category === event.category);
  if (!category) return undefined;
  if (event.type === "frequency-spike") return category.currentCount;
  if (event.type === "ticket-spike") return category.currentCents / Math.max(1, category.currentCount);
  if (event.type === "mix-shift") return category.currentShare;
  return undefined;
}

export function prioritizeFreshInsights(snapshot: FinanceAdvisorSnapshot, history: SeenInsight[]): FinanceAdvisorSnapshot {
  const repeated: FinanceInsightEvent[] = [];
  const events = snapshot.events.filter((event) => {
    if (event.type === "stable") return true;
    const previous = history.find((seen) => seen.cycle === snapshot.currentRange.start && seen.id === event.id);
    const worsened = previous && (event.impactCents ?? 0) - previous.impact >= Math.max(5000, Math.abs(previous.impact) * 0.2);
    const metric = signalMetric(snapshot, event);
    const minimum = event.type === "frequency-spike" ? 3 : event.type === "mix-shift" ? 0.1 : 1000;
    const metricWorsened = metric !== undefined && previous?.metric !== undefined && metric - previous.metric >= Math.max(minimum, previous.metric * 0.2);
    // Keep urgent budget pressure visible even when it has already been reported.
    if (!previous || previous.date === snapshot.currentRange.end || worsened || metricWorsened || event.type === "salary-pressure") return true;
    repeated.push(event);
    return false;
  });
  if (repeated.length && !events.some((event) => event.type !== "stable")) {
    return { ...snapshot, repeatedEvents: repeated, events: events.map((event) => event.title === "暂未发现明显变化"
      ? { ...event, title: "暂无新的明显变化", detail: "之前提醒过的事项仍可在下方查看；暂未发现值得重复提醒的新变化。" } : event) };
  }
  return { ...snapshot, events, repeatedEvents: repeated };
}

export function markInsightSeen(history: SeenInsight[], snapshot: FinanceAdvisorSnapshot, id: string): SeenInsight[] {
  const event = snapshot.events.find((item) => item.id === id);
  if (!event || event.type === "stable") return history;
  const old = history.find((item) => item.cycle === snapshot.currentRange.start && item.id === id);
  const metric = signalMetric(snapshot, event);
  if (old?.date === snapshot.currentRange.end && old.impact >= (event.impactCents ?? 0) && (metric === undefined || (old.metric ?? -Infinity) >= metric)) return history;
  return [...history.filter((item) => !(item.cycle === snapshot.currentRange.start && item.id === id)),
    { cycle: snapshot.currentRange.start, id, date: snapshot.currentRange.end,
      impact: Math.max(event.impactCents ?? 0, old?.date === snapshot.currentRange.end ? old.impact : 0),
      metric: metric === undefined ? undefined : Math.max(metric, old?.date === snapshot.currentRange.end ? old.metric ?? metric : metric) }].slice(-200);
}

export function eventAdvice(event: FinanceInsightEvent, action = "observe"): string {
  const advice: Record<string, string[]> = {
    "frequency-spike": ["留意接下来是否仍频繁购买，而不只看每笔金额。", "核对是否为分单或补记，再判断购买次数是否真的增加。", "可先检查重复购买的安排，减少不必要的额外次数。"],
    "ticket-spike": ["留意是单价上涨还是一次购买更多。", "对比相近商品或服务的单价与数量，避免把囤货误判成涨价。", "安排下一次购买前，先确认本次增加的是数量还是单价。"],
    "spending-spike": ["继续区分一次性支出和持续增加的日常支出。", "核对这一分类的大额记录，确认是否属于一次性事项。", "先列出该分类剩余的必要支出，再安排可延后的消费。"],
    "mix-shift": ["占比变化不一定是超支，也可能是其他分类减少。", "同时核对该分类的金额和总消费，避免只看占比。", "先确认支出结构变化是否符合本周期的实际安排。"],
    "large-expense": ["留意这笔支出是否会在本周期再次发生。", "核对金额及是否重复记账，再确认是一次性还是固定支出。", "若属于固定支出，可在固定支出中关联这笔记录，避免预测重复计入。"],
    "salary-pressure": ["这只是参考；请优先核对尚未支付的必要支出。", "先检查固定支出是否已付，以及历史付款日期是否偏移。", "先预留尚未支付的必要支出，再判断哪些非必要消费可以推迟。"],
    "salary-pace": ["参考值不是消费额度，仍需考虑尚未发生的必要支出。", "核对本周期与历史周期的固定支出支付时间是否一致。", "把未付固定支出确认后，再评估剩余安排。"],
    "stable": ["可展开判断依据和数据完整性继续核对。", "优先核对缺失日期、账目差异与待确认固定支出。", "数据齐全后再决定是否需要调整消费安排。"]
  };
  return (advice[event.type] ?? advice.stable)[action === "review" ? 1 : action === "plan" ? 2 : 0];
}

export function unmatchedStarIds(ids: string[], records: LedgerRecord[]): string[] {
  const known = new Set(records.map((record) => record.id));
  return [...new Set(ids.filter((id) => !known.has(id)))];
}

export function relinkStar(ids: string[], oldId: string, newId: string, records: LedgerRecord[]): string[] {
  if (!ids.includes(oldId) || !records.some((record) => record.id === newId)) throw new Error("记录已变化，请重新核对");
  return [...new Set(ids.map((id) => id === oldId ? newId : id))];
}
