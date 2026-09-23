import { financeAiEvidence, financeSnapshotFingerprint } from "./ai";
import type { FinanceAdvice, FinanceAdviceCache } from "./ai";
import { stableTextHash } from "./core";
import type { FinanceAdvisorSnapshot, FinanceCategorySnapshot, FinanceInsightEvent } from "./core";

interface InsightSignal {
  id: string;
  group: string;
  type: FinanceInsightEvent["type"];
  priority: number;
  impact: number;
  metric?: number;
  notes: string[];
}

export interface FinanceAdviceBasis {
  version: 1;
  cycle: string;
  context: string;
  events: InsightSignal[];
  categories: FinanceCategorySnapshot[];
  supportingNotes?: string[];
}

export interface FinanceAdviceAssessment {
  advice: FinanceAdvice | null;
  needsRefresh: boolean;
  reason: string;
  refreshKey: string;
}

function signal(snapshot: FinanceAdvisorSnapshot, event: FinanceInsightEvent): InsightSignal {
  const category = snapshot.categories.find((item) => item.category === event.category);
  let impact = event.impactCents ?? 0;
  if (event.type === "stable") impact = 0;
  if (event.type === "salary-pace") impact = snapshot.forecastCents;
  let metric: number | undefined;
  if (category) {
    if (event.type === "spending-spike") impact = category.currentCents - category.baselineProgressCents;
    if (event.type === "frequency-spike") metric = category.currentCount - category.baselineProgressCount;
    if (event.type === "ticket-spike") metric = category.currentCents / Math.max(1, category.currentCount)
      - category.baselineProgressCents / Math.max(1, category.baselineProgressCount);
    if (event.type === "mix-shift") metric = category.currentShare - category.baselineShare;
  }
  return {
    id: event.id, type: event.type, priority: event.priority, impact, metric,
    group: event.category ? `category:${event.category}` : event.type.startsWith("salary-") ? "salary-cycle" : "status",
    // Keep only hashes of the bounded transaction samples, not extra copies of private notes.
    notes: [...new Set((event.evidence ?? []).filter((text) => text.startsWith("交易样本（")).map(stableTextHash))].sort()
  };
}

export function financeAdviceBasis(snapshot: FinanceAdvisorSnapshot): FinanceAdviceBasis {
  return {
    version: 1,
    cycle: snapshot.currentRange.start,
    context: stableTextHash(JSON.stringify({
      salary: snapshot.salaryCents,
      history: snapshot.historyCycleCount,
      historicalAverage: snapshot.historicalAverageSpentCents,
      available: snapshot.forecastAvailable,
      confidence: snapshot.forecastConfidence,
      month: snapshot.currentRange.end.slice(0, 7),
      fixed: snapshot.fixedExpenses,
      status: snapshot.events.find((event) => event.type === "stable")?.detail
    })),
    events: snapshot.events.map((event) => signal(snapshot, event)),
    categories: snapshot.categories.map((category) => ({ ...category }))
  };
}

function changedAmount(current: number, previous: number, minimum = 5000): boolean {
  return Math.abs(current - previous) >= Math.max(minimum, Math.abs(previous) * 0.2);
}

function materiallyChanged(current: InsightSignal, previous: InsightSignal): boolean {
  const minimum = current.type === "frequency-spike" ? 3 : current.type === "mix-shift" ? 0.1 : 1000;
  return changedAmount(current.impact, previous.impact)
    || (current.metric !== undefined && previous.metric !== undefined && changedAmount(current.metric, previous.metric, minimum));
}

function categoryChanged(current: FinanceCategorySnapshot | undefined, previous: FinanceCategorySnapshot | undefined): boolean {
  if (!current || !previous) return true;
  return changedAmount(current.currentCents, previous.currentCents)
    || changedAmount(current.currentCount, previous.currentCount, 3)
    || changedAmount(current.currentCents / Math.max(1, current.currentCount), previous.currentCents / Math.max(1, previous.currentCount), 1000)
    || changedAmount(current.currentShare, previous.currentShare, 0.1);
}

export function createFinanceAdviceCache(snapshot: FinanceAdvisorSnapshot, advice: FinanceAdvice, updatedAt = new Date().toISOString()): FinanceAdviceCache {
  const basis = financeAdviceBasis(snapshot);
  basis.supportingNotes = financeAiEvidence(snapshot)
    .filter((evidence) => evidence.untrustedNote && advice.evidenceIds.includes(evidence.id)).map((evidence) => stableTextHash(evidence.text));
  return { date: snapshot.currentRange.end, fingerprint: financeSnapshotFingerprint(snapshot), advice, updatedAt, basis };
}

export function assessFinanceAdvice(snapshot: FinanceAdvisorSnapshot, cache: FinanceAdviceCache | null | undefined): FinanceAdviceAssessment {
  const current = financeAdviceBasis(snapshot);
  const refreshKey = stableTextHash(JSON.stringify(current));
  const result = (advice: FinanceAdvice | null, needsRefresh: boolean, reason: string): FinanceAdviceAssessment => ({ advice, needsRefresh, reason, refreshKey });
  if (!cache) return result(null, true, "尚未生成洞察");
  const selected = current.events.find((event) => event.id === cache.advice.primaryEventId);
  if (!selected) return result(null, true, "原判断对应的事件已不再成立");

  const previous = cache.basis;
  if (!previous || previous.version !== 1) {
    return cache.date === snapshot.currentRange.end && cache.fingerprint === financeSnapshotFingerprint(snapshot)
      ? result(cache.advice, false, "当前判断仍有效")
      : result(null, true, "旧版判断需要按新的保留规则重新核对");
  }
  if (previous.cycle !== current.cycle) return result(null, true, "已进入新的工资周期");
  if (cache.date > snapshot.currentRange.end || previous.context !== current.context) {
    return result(null, true, "统计依据或时间背景已变化");
  }
  const original = previous.events.find((event) => event.id === selected.id);
  if (!original) return result(null, true, "原判断缺少可核对的依据");

  const currentNotes = new Set(current.events.flatMap((event) => event.notes));
  if ([...original.notes, ...(previous.supportingNotes ?? [])].some((note) => !currentNotes.has(note))) {
    return result(null, true, "原判断所依据的交易样本已变化");
  }
  // Also recheck categories mentioned in the saved AI narrative, not just the headline event.
  for (const line of cache.advice.categoryLines) {
    const before = previous.categories.find((category) => category.category === line.category);
    const after = current.categories.find((category) => category.category === line.category);
    if (!before || !after || (before.remainingReferenceCents > 0) !== (after.remainingReferenceCents > 0)
      || changedAmount(after.currentCents, before.currentCents) || changedAmount(after.baselineCycleCents, before.baselineCycleCents)) {
      return result(null, true, "分类意见所依据的数据已明显变化");
    }
  }
  if (materiallyChanged(selected, original)) return result(cache.advice, true, "原事项已出现明显变化，需重新评估");

  const challenger = current.events.find((event) => {
    if (event.id === selected.id || event.type === "stable") return false;
    const before = previous.events.find((item) => item.id === event.id);
    if (before && !materiallyChanged(event, before)) return false;
    // Another signal in the same category is not automatically a new matter.
    // A new large transaction or a materially changed known signal can still take priority.
    if (!before && event.group === selected.group && event.type !== "large-expense" && event.type !== "salary-pressure") {
      const name = event.group.slice("category:".length);
      if (!categoryChanged(current.categories.find((category) => category.category === name), previous.categories.find((category) => category.category === name))) return false;
    }
    return event.priority > selected.priority
      || (event.priority === selected.priority && event.impact > selected.impact && changedAmount(event.impact, selected.impact));
  });
  return challenger
    ? result(cache.advice, true, "出现更值得关注的变化，需重新评估")
    : result(cache.advice, false, "当前判断仍有效，持续关注中");
}
