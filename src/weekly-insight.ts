import { addDays, budgetProgress, budgetScopedRecords, categorySummaries, flattenRecords, formatCents, isoFromDate, transactionEvidence } from "./core";
import type { DateRange, FinanceAdvisorSnapshot, LedgerRecord, ParsedLedgerFile } from "./core";
import { insightAsOf } from "./daily-insight";
import type { DailyInsightOptions } from "./daily-insight";

export interface WeeklyCoverage {
  recordedDays: number;
  missingDates: string[];
  problemDates: string[];
  complete: boolean;
}
export interface WeeklyChange {
  kind: "category" | "largest" | "high-day";
  text: string;
  records: LedgerRecord[];
}
export interface WeeklyFinanceBrief {
  range: DateRange;
  previousRange: DateRange;
  coverage: WeeklyCoverage;
  previousCoverage: WeeklyCoverage;
  spentCents: number;
  count: number;
  previousSpentCents: number;
  changeCents: number | null;
  changeRatio: number | null;
  historicalWeeks: number;
  historicalAverageCents: number | null;
  historicalChangeCents: number | null;
  historicalChangeRatio: number | null;
  budgetCents: number;
  budgetSpentCents: number;
  budgetRatio: number | null;
  budgetCategory: string;
  includeStarred: boolean;
  overCents: number;
  undatedCount: number;
  categories: ReturnType<typeof categorySummaries>;
  changes: WeeklyChange[];
  action: string;
}

function coverage(files: ParsedLedgerFile[], range: DateRange, undatedCount: number): WeeklyCoverage {
  const missingDates: string[] = [], problemDates: string[] = [];
  let recordedDays = 0;
  for (let day = range.start; day <= range.end; day = addDays(day, 1)) {
    const entries = files.filter(file => file.date === day);
    if (!entries.length) missingDates.push(day);
    else if (entries.some(file => file.diagnostics.length || (!file.records.length && file.frontmatterTotalCents !== 0))) problemDates.push(day);
    else recordedDays++;
  }
  return { recordedDays, missingDates, problemDates, complete: recordedDays === 7 && undatedCount === 0 };
}

export function withWeeklyInsight(snapshot: FinanceAdvisorSnapshot, files: ParsedLedgerFile[], now: Date, options: DailyInsightOptions): FinanceAdvisorSnapshot {
  const end = isoFromDate(insightAsOf(now));
  const range = { start: addDays(end, -6), end };
  const previousRange = { start: addDays(end, -13), end: addDays(end, -7) };
  const undatedCount = files.filter(file => !file.date).length;
  const currentCoverage = coverage(files, range, undatedCount), previousCoverage = coverage(files, previousRange, undatedCount);
  const all = flattenRecords(files);
  const inRange = (r: DateRange) => all.filter(record => record.date >= r.start && record.date <= r.end);
  const total = (records: LedgerRecord[]) => records.reduce((sum, record) => sum + record.cents, 0);
  const records = inRange(range), previous = inRange(previousRange);
  const spentCents = total(records), previousSpentCents = total(previous);
  const comparable = currentCoverage.complete && previousCoverage.complete;
  const changeCents = comparable ? spentCents - previousSpentCents : null;
  const history: number[] = [];
  for (let offset = 0; offset < 4; offset++) {
    const historyEnd = addDays(previousRange.end, -7 * offset);
    const historyRange = { start: addDays(historyEnd, -6), end: historyEnd };
    if (coverage(files, historyRange, undatedCount).complete) history.push(total(inRange(historyRange)));
  }
  const historicalAverageCents = history.length ? Math.round(history.reduce((sum, amount) => sum + amount, 0) / history.length) : null;
  const historicalChangeCents = currentCoverage.complete && historicalAverageCents !== null ? spentCents - historicalAverageCents : null;
  const budgetCents = options.dailyBudgetCents * 7;
  const budgetSpentCents = total(budgetScopedRecords(records.filter(record => !options.budgetCategory || record.category === options.budgetCategory), options.includeStarredInBudget, options.starredRecordIds));
  const progress = budgetProgress(budgetSpentCents, budgetCents);
  const categories = categorySummaries(records), previousCategories = categorySummaries(previous);
  const changes: WeeklyChange[] = [];
  if (comparable) {
    const names = new Set([...categories, ...previousCategories].map(item => item.category));
    const deltas = [...names].map(category => ({ category, cents: (categories.find(item => item.category === category)?.cents ?? 0) - (previousCategories.find(item => item.category === category)?.cents ?? 0) }))
      .filter(item => item.cents !== 0).sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents) || a.category.localeCompare(b.category));
    if (deltas[0]) {
      const delta = deltas[0];
      changes.push({ kind: "category", text: `${delta.category}变化最大：比前 7 天${delta.cents > 0 ? "增加" : "减少"} ${formatCents(Math.abs(delta.cents))}。`, records: [...records, ...previous].filter(record => record.category === delta.category) });
    }
  }
  const largest = [...records].sort((a, b) => b.cents - a.cents || a.date.localeCompare(b.date) || a.id.localeCompare(b.id))[0];
  if (largest) changes.push({ kind: "largest", text: `最大单笔：${largest.date.slice(5).replace("-", "/")} · ${largest.category} ${formatCents(largest.cents)}${largest.note ? `（${largest.note}）` : ""}。`, records: [largest] });
  const days = [...new Set(records.map(record => record.date))].map(date => ({ date, records: records.filter(record => record.date === date) }));
  const high = days.sort((a, b) => total(b.records) - total(a.records) || a.date.localeCompare(b.date))[0];
  const mean = currentCoverage.complete ? spentCents / 7 : null;
  if (high && mean !== null && total(high.records) > mean * 1.5 && total(high.records) > 0) changes.push({ kind: "high-day", text: `支出集中在 ${high.date.slice(5).replace("-", "/")}：${formatCents(total(high.records))}，占近 7 天 ${(total(high.records) / spentCents * 100).toFixed(1)}%；超过这 7 天日均的 1.5 倍。`, records: high.records });
  const title = !currentCoverage.complete ? `近 7 天已记录 ${currentCoverage.recordedDays}/7 天，结论需谨慎`
    : budgetCents > 0 ? `近 7 天${budgetSpentCents > budgetCents ? "超出周预算" : "在周预算内"}${options.budgetCategory ? ` · ${options.budgetCategory}` : ""}` : "近 7 天消费概览";
  const detail = `近 7 天已记录 ${records.length} 笔，共 ${formatCents(spentCents)}。有效记账 ${currentCoverage.recordedDays}/7 天。${!currentCoverage.complete ? "存在缺失或待核对记录，已记录金额不是完整总额，不判断整体消费趋势或预算正常。" : ""}`;
  const action = currentCoverage.complete ? "结合这周的主要支出，留意接下来几天是否重复发生，再调整消费安排。" : "先补齐缺失日期或核对异常账本，再判断这一周的消费趋势。";
  const weekly: WeeklyFinanceBrief = { range, previousRange, coverage: currentCoverage, previousCoverage, spentCents, count: records.length, previousSpentCents, changeCents,
    changeRatio: comparable && previousSpentCents > 0 ? (spentCents - previousSpentCents) / previousSpentCents : null,
    historicalWeeks: history.length, historicalAverageCents, historicalChangeCents,
    historicalChangeRatio: historicalChangeCents !== null && historicalAverageCents! > 0 ? historicalChangeCents / historicalAverageCents! : null,
    budgetCents, budgetSpentCents, budgetRatio: budgetCents > 0 ? budgetSpentCents / budgetCents : null,
    budgetCategory: options.budgetCategory, includeStarred: options.includeStarredInBudget, overCents: progress.overBudgetCents,
    undatedCount, categories, changes: changes.slice(0, 3), action };
  const evidence = [detail, ...weekly.changes.map(change => change.text), ...transactionEvidence(records, 5)];
  return { ...snapshot, weekly, events: [{ id: `weekly:${range.start}:${range.end}`, type: "weekly", priority: 200, title, detail, impactCents: progress.overBudgetCents, evidence }, ...snapshot.events.filter(event => event.type !== "daily" && event.type !== "weekly")] };
}
