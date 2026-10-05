import { budgetProgress, budgetScopedRecords, categorySummaries, flattenRecords, formatCents, isoFromDate, transactionEvidence } from "./core";
import type { FinanceAdvisorSnapshot, DailyFinanceBrief, ParsedLedgerFile } from "./core";

export interface DailyInsightOptions {
  dailyBudgetCents: number;
  budgetCategory: string;
  includeStarredInBudget: boolean;
  starredRecordIds: string[];
}

/** Use the previous local calendar day, including across month/year and DST boundaries. */
export function insightAsOf(now: Date): Date {
  const date = new Date(now);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - 1);
  return date;
}

/** Yesterday's recorded spending, independent of historical view filters and cycle zero filling. */
export function withDailyInsight(snapshot: FinanceAdvisorSnapshot, files: ParsedLedgerFile[], now: Date, options: DailyInsightOptions): FinanceAdvisorSnapshot {
  const date = isoFromDate(insightAsOf(now));
  const dated = files.filter(file => file.date === date);
  const records = flattenRecords(dated);
  const spentCents = records.reduce((sum, record) => sum + record.cents, 0);
  const budgetRecords = budgetScopedRecords(records.filter(record => !options.budgetCategory || record.category === options.budgetCategory), options.includeStarredInBudget, options.starredRecordIds);
  const budgetSpentCents = budgetRecords.reduce((sum, record) => sum + record.cents, 0);
  const progress = budgetProgress(budgetSpentCents, options.dailyBudgetCents);
  const incomplete = dated.some(file => file.diagnostics.length > 0 || (!file.records.length && file.frontmatterTotalCents !== 0))
    || files.some(file => !file.date && file.diagnostics.length > 0);
  const status: DailyFinanceBrief["status"] = incomplete ? "incomplete" : !dated.length ? "unrecorded"
    : !records.length ? "zero" : options.dailyBudgetCents <= 0 ? "recorded"
    : progress.overBudgetCents > 0 ? "over-budget" : progress.ratio >= 0.9 ? "near-budget" : "normal";
  const titles: Record<DailyFinanceBrief["status"], string> = {
    incomplete: "昨日账目待核对", unrecorded: "昨天暂未记录消费", zero: "昨天账本记录为零消费",
    recorded: "昨日消费已更新", "over-budget": "昨天已超过日预算", "near-budget": "昨天消费接近日预算", normal: "昨天消费在预算内"
  };
  const scope = `${options.budgetCategory || "全部分类"}${options.includeStarredInBudget ? " · 包含星标" : " · 不含星标"}`;
  const totals = `昨天已记录 ${records.length} 笔，共 ${formatCents(spentCents)}。`;
  const budget = options.dailyBudgetCents > 0
    ? `预算口径（${scope}）已花 ${formatCents(budgetSpentCents)}，日预算 ${formatCents(options.dailyBudgetCents)}，${progress.overBudgetCents > 0 ? `超出 ${formatCents(progress.overBudgetCents)}` : `还剩 ${formatCents(progress.remainingCents)}`}。`
    : "尚未设置日预算，不判断是否超预算。";
  const categories = categorySummaries(records);
  const leader = categories[0];
  const detail = status === "unrecorded" ? "昨天还没有日记账文件，不能据此认定零消费或消费正常。补记后会更新。"
    : status === "incomplete" ? `${totals}账目存在解析、日期或总额核对问题；暂不判断消费是否正常。`
    : `${totals}${budget}${leader ? `昨日主要支出为${leader.category} ${formatCents(leader.cents)}（${(leader.share * 100).toFixed(1)}%）。` : ""}`;
  const action = status === "incomplete" ? "先核对异常账本，再看昨天的预算状态。"
    : status === "unrecorded" ? "有实际支出时补记即可，不必为了生成洞察添加虚构账目。"
    : status === "over-budget" ? "先区分必要支出和偶发消费，再安排今天的非必要支出。"
    : status === "near-budget" ? "安排今天的必要支出时留意预算，预算只是安排参考。"
    : "就已记录的消费继续观察；预算内不代表其他周期异常已经解决。";
  const daily: DailyFinanceBrief = { date, status, spentCents, count: records.length, budgetSpentCents,
    budgetCents: options.dailyBudgetCents, remainingCents: progress.remainingCents, overCents: progress.overBudgetCents,
    budgetCategory: options.budgetCategory, includeStarred: options.includeStarredInBudget, categories, action };
  return { ...snapshot, daily, events: [{ id: `daily:${date}`, type: "daily", priority: 200, title: titles[status], detail,
    impactCents: progress.overBudgetCents, evidence: [detail, ...transactionEvidence(records, 3)] }, ...snapshot.events.filter(event => event.type !== "daily")] };
}
