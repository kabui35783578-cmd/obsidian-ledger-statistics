export type DiagnosticKind = "parse" | "date" | "total";

export interface LedgerDiagnostic {
  kind: DiagnosticKind;
  path: string;
  line?: number;
  reason: string;
  source?: string;
}

export interface LedgerRecord {
  id: string;
  path: string;
  date: string;
  time: string;
  category: string;
  cents: number;
  note: string;
  line: number;
  raw: string;
}

export interface ParsedLedgerFile {
  path: string;
  date: string | null;
  frontmatterTotalCents: number | null;
  records: LedgerRecord[];
  diagnostics: LedgerDiagnostic[];
}

export interface DateRange {
  start: string;
  end: string;
}

export type AccountingScope = "consumption" | "all";

export interface FilterState {
  range: DateRange;
  scope: AccountingScope;
  excludedCategories: string[];
  categories: string[];
  keyword: string;
}

export interface CategorySummary {
  category: string;
  cents: number;
  count: number;
  share: number;
}

export interface SummaryStats {
  cents: number;
  count: number;
  recordedDays: number;
  averagePerRecordedDayCents: number;
  maxRecord: LedgerRecord | null;
}

export interface BudgetProgress {
  ratio: number;
  percent: number;
  remainingCents: number;
  overBudgetCents: number;
}

export interface TrendPoint {
  key: string;
  label: string;
  start: string;
  end: string;
  cents: number;
  count: number;
}

export interface ComparisonValue {
  currentCents: number;
  previousCents: number;
  differenceCents: number;
  ratio: number | "new" | "none";
}

export type FinanceInsightType =
  | "salary-pressure"
  | "salary-pace"
  | "spending-spike"
  | "frequency-spike"
  | "ticket-spike"
  | "large-expense"
  | "mix-shift"
  | "stable";

export interface FinanceCategorySnapshot {
  category: string;
  currentCents: number;
  currentCount: number;
  baselineProgressCents: number;
  baselineProgressCount: number;
  baselineCycleCents: number;
  remainingReferenceCents: number;
  currentShare: number;
  baselineShare: number;
}

export interface FinanceInsightEvent {
  id: string;
  type: FinanceInsightType;
  priority: number;
  category?: string;
  title: string;
  detail: string;
}

export interface FinanceAdvisorSnapshot {
  currentRange: DateRange;
  fullCurrentRange: DateRange;
  previousRanges: [DateRange, DateRange];
  elapsedDays: number;
  totalDays: number;
  salaryCents: number;
  currentSpentCents: number;
  remainingSalaryCents: number;
  historicalAverageSpentCents: number;
  forecastCents: number;
  historyCycleCount: number;
  forecastAvailable: boolean;
  forecastConfidence: "low" | "normal";
  categories: FinanceCategorySnapshot[];
  events: FinanceInsightEvent[];
}

const FULL_WIDTH_MAP: Record<string, string> = {
  "０": "0", "１": "1", "２": "2", "３": "3", "４": "4",
  "５": "5", "６": "6", "７": "7", "８": "8", "９": "9",
  "：": ":", "｜": "|", "￥": "¥", "（": "(", "）": ")",
  "，": ",", "．": ".", "　": " "
};

export function normalizeLedgerText(value: string): string {
  return value.replace(/[０-９：｜￥（），．　]/g, (char) => FULL_WIDTH_MAP[char] ?? char);
}

export function parseMoneyToCents(value: string): number | null {
  const normalized = normalizeLedgerText(value).trim().replace(/,/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const cents = Number.parseInt(whole, 10) * 100 + Number.parseInt(fraction.padEnd(2, "0") || "0", 10);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}¥${Math.floor(absolute / 100).toLocaleString("zh-CN")}.${String(absolute % 100).padStart(2, "0")}`;
}

export function barkPushUrl(baseUrl: string, title: string, body: string): string | null {
  try {
    const parsed = new URL(baseUrl.trim());
    if (parsed.protocol !== "https:") return null;
    const key = parsed.pathname.split("/").filter(Boolean)[0];
    if (!key) return null;
    return `${parsed.origin}/${encodeURIComponent(key)}/${encodeURIComponent(title)}/${encodeURIComponent(body)}`;
  } catch {
    return null;
  }
}

export function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function frontmatterCalendarDate(value: string): string | null {
  const trimmed = value.trim();
  const unquoted = ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))
    ? trimmed.slice(1, -1).trim()
    : trimmed;
  const match = /^(\d{4}-\d{2}-\d{2})(?:[Tt ](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)?)?$/.exec(unquoted);
  if (!match || !isValidIsoDate(match[1])) return null;
  return match[1];
}

function filenameDate(path: string): string | null {
  const name = path.split("/").pop() ?? path;
  const match = /^(\d{4})(\d{2})(\d{2})日记账\.md$/.exec(name);
  if (!match) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  return isValidIsoDate(date) ? date : null;
}

function parseFrontmatter(raw: string): { date: string | null; total: string | null; endLine: number } {
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { date: null, total: null, endLine: 0 };
  let date: string | null = null;
  let total: string | null = null;
  let endLine = 0;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "---") {
      endLine = index + 1;
      break;
    }
    const dateMatch = /^date:\s*(.*?)\s*$/.exec(lines[index]);
    const totalMatch = /^total:\s*(.*?)\s*$/.exec(lines[index]);
    if (dateMatch) date = dateMatch[1];
    if (totalMatch) total = totalMatch[1];
  }
  return { date, total, endLine };
}

export function parseLedgerFile(path: string, raw: string): ParsedLedgerFile {
  const diagnostics: LedgerDiagnostic[] = [];
  const records: LedgerRecord[] = [];
  const frontmatter = parseFrontmatter(raw);
  const fallbackDate = filenameDate(path);
  const normalizedFrontmatterDate = frontmatter.date ? frontmatterCalendarDate(frontmatter.date) : null;
  let date: string | null = null;

  if (normalizedFrontmatterDate) {
    date = normalizedFrontmatterDate;
    if (fallbackDate && fallbackDate !== date) {
      diagnostics.push({ kind: "date", path, reason: `frontmatter 日期 ${date} 与文件名日期 ${fallbackDate} 不一致` });
    }
  } else if (fallbackDate) {
    date = fallbackDate;
    diagnostics.push({
      kind: "date",
      path,
      reason: frontmatter.date ? `frontmatter 日期无效，已使用文件名日期 ${fallbackDate}` : `缺少 frontmatter date，已使用文件名日期 ${fallbackDate}`
    });
  } else {
    diagnostics.push({ kind: "date", path, reason: "无法从 frontmatter 或文件名取得有效日期" });
  }

  let frontmatterTotalCents: number | null = null;
  if (frontmatter.total !== null) {
    frontmatterTotalCents = parseMoneyToCents(frontmatter.total);
    if (frontmatterTotalCents === null) {
      diagnostics.push({ kind: "total", path, reason: `frontmatter total 无法解析：${frontmatter.total}` });
    }
  } else {
    diagnostics.push({ kind: "total", path, reason: "缺少 frontmatter total，无法核对正文合计" });
  }

  const lines = raw.split(/\r?\n/);
  let inRecords = false;
  for (let index = Math.max(0, frontmatter.endLine); index < lines.length; index += 1) {
    const source = lines[index];
    if (/^#\s+今日消费记录\s*$/.test(source.trim())) {
      inRecords = true;
      continue;
    }
    if (inRecords && /^#{1,6}\s+/.test(source.trim())) break;
    if (!inRecords) continue;
    const bullet = /^\s*[-*+]\s*(.*)$/.exec(source);
    if (!bullet) continue;
    const body = bullet[1].trim();
    if (!body) continue;
    const normalized = normalizeLedgerText(body);
    const match = /^(补记|(?:[01]?\d|2[0-3]):[0-5]\d)\s*\|\s*([^|]+?)\s*\|\s*[¥Y]\s*([0-9,]+(?:\.[0-9]{1,2})?)(?:\s*(.*))?$/.exec(normalized);
    if (!match || !date) {
      diagnostics.push({ kind: "parse", path, line: index + 1, reason: date ? "记录格式无法解析" : "文件日期无效，记录无法归入统计", source });
      continue;
    }
    const cents = parseMoneyToCents(match[3]);
    if (cents === null) {
      diagnostics.push({ kind: "parse", path, line: index + 1, reason: "金额无法解析", source });
      continue;
    }
    const note = (match[4] ?? "").trim().replace(/^\((.*)\)$/, "$1").trim();
    records.push({
      id: `${path}:${index + 1}`,
      path,
      date,
      time: match[1],
      category: match[2].trim(),
      cents,
      note,
      line: index + 1,
      raw: source
    });
  }

  if (!inRecords) diagnostics.push({ kind: "parse", path, reason: "未找到“今日消费记录”标题" });
  if (frontmatterTotalCents !== null) {
    const parsedTotal = records.reduce((sum, record) => sum + record.cents, 0);
    if (parsedTotal !== frontmatterTotalCents) {
      diagnostics.push({
        kind: "total",
        path,
        reason: `正文合计 ${formatCents(parsedTotal)}，frontmatter total ${formatCents(frontmatterTotalCents)}，相差 ${formatCents(parsedTotal - frontmatterTotalCents)}`
      });
    }
  }

  return { path, date, frontmatterTotalCents, records, diagnostics };
}

export function flattenRecords(files: Iterable<ParsedLedgerFile>): LedgerRecord[] {
  const records: LedgerRecord[] = [];
  for (const file of files) records.push(...file.records);
  return records.sort((a, b) => b.date.localeCompare(a.date) || b.line - a.line);
}

export function recordMatches(record: LedgerRecord, filter: FilterState): boolean {
  if (record.date < filter.range.start || record.date > filter.range.end) return false;
  if (filter.scope === "consumption" && filter.excludedCategories.includes(record.category)) return false;
  if (filter.categories.length > 0 && !filter.categories.includes(record.category)) return false;
  const keyword = filter.keyword.trim().toLocaleLowerCase("zh-CN");
  if (keyword && !`${record.date} ${record.time} ${record.category} ${record.note}`.toLocaleLowerCase("zh-CN").includes(keyword)) return false;
  return true;
}

export function filteredRecords(files: Iterable<ParsedLedgerFile>, filter: FilterState): LedgerRecord[] {
  return flattenRecords(files).filter((record) => recordMatches(record, filter));
}

export function budgetScopedRecords(records: Iterable<LedgerRecord>, includeStarred: boolean, starredRecordIds: Iterable<string>): LedgerRecord[] {
  const copy = [...records];
  if (includeStarred) return copy;
  const starred = new Set(starredRecordIds);
  return copy.filter((record) => !starred.has(record.id));
}

export function summarize(files: Iterable<ParsedLedgerFile>, records: LedgerRecord[], range: DateRange): SummaryStats {
  const recordedDates = new Set<string>();
  for (const file of files) {
    if (file.date && file.date >= range.start && file.date <= range.end) recordedDates.add(file.date);
  }
  const cents = records.reduce((sum, record) => sum + record.cents, 0);
  const recordedDays = recordedDates.size;
  let maxRecord: LedgerRecord | null = null;
  for (const record of records) if (!maxRecord || record.cents > maxRecord.cents) maxRecord = record;
  return {
    cents,
    count: records.length,
    recordedDays,
    averagePerRecordedDayCents: recordedDays === 0 ? 0 : Math.round(cents / recordedDays),
    maxRecord
  };
}

export function budgetProgress(spentCents: number, budgetCents: number): BudgetProgress {
  const spent = Math.max(0, spentCents);
  const budget = Math.max(0, budgetCents);
  if (budget === 0) return { ratio: 0, percent: 0, remainingCents: 0, overBudgetCents: 0 };
  const ratio = spent / budget;
  return {
    ratio,
    percent: Math.min(100, ratio * 100),
    remainingCents: Math.max(0, budget - spent),
    overBudgetCents: Math.max(0, spent - budget)
  };
}

export function categorySummaries(records: LedgerRecord[], sortBy: "amount" | "count" = "amount"): CategorySummary[] {
  const map = new Map<string, { cents: number; count: number }>();
  const total = records.reduce((sum, record) => sum + record.cents, 0);
  for (const record of records) {
    const current = map.get(record.category) ?? { cents: 0, count: 0 };
    current.cents += record.cents;
    current.count += 1;
    map.set(record.category, current);
  }
  return [...map.entries()].map(([category, value]) => ({
    category,
    cents: value.cents,
    count: value.count,
    share: total === 0 ? 0 : value.cents / total
  })).sort((a, b) => sortBy === "amount" ? b.cents - a.cents || b.count - a.count : b.count - a.count || b.cents - a.cents);
}

function dateFromIso(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

export function isoFromDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function addDays(iso: string, days: number): string {
  const date = dateFromIso(iso);
  date.setDate(date.getDate() + days);
  return isoFromDate(date);
}

export function monthRange(year: number, monthIndex: number): DateRange {
  return {
    start: isoFromDate(new Date(year, monthIndex, 1, 12)),
    end: isoFromDate(new Date(year, monthIndex + 1, 0, 12))
  };
}

export function weekRange(date = new Date(), weekOffset = 0): DateRange {
  const current = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  const daysSinceMonday = (current.getDay() + 6) % 7;
  const start = new Date(current);
  start.setDate(current.getDate() - daysSinceMonday - weekOffset * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return {
    start: isoFromDate(start),
    end: weekOffset === 0 ? isoFromDate(current) : isoFromDate(end)
  };
}

export function salaryDayRange(date = new Date(), cycleOffset = 0): DateRange {
  const today = isoFromDate(date);
  const currentStartMonth = date.getDate() <= 14 ? date.getMonth() - 1 : date.getMonth();
  const startMonth = currentStartMonth - cycleOffset;
  return {
    start: isoFromDate(new Date(date.getFullYear(), startMonth, 15, 12)),
    end: cycleOffset === 0 ? today : isoFromDate(new Date(date.getFullYear(), startMonth + 1, 14, 12))
  };
}

export function salaryCycleFullRange(date = new Date(), cycleOffset = 0): DateRange {
  const currentStartMonth = date.getDate() <= 14 ? date.getMonth() - 1 : date.getMonth();
  const startMonth = currentStartMonth - cycleOffset;
  return {
    start: isoFromDate(new Date(date.getFullYear(), startMonth, 15, 12)),
    end: isoFromDate(new Date(date.getFullYear(), startMonth + 1, 14, 12))
  };
}

function daysInclusive(range: DateRange): number {
  const start = dateFromIso(range.start).getTime();
  const end = dateFromIso(range.end).getTime();
  return Math.max(0, Math.round((end - start) / 86_400_000) + 1);
}

function recordsInRange(records: LedgerRecord[], range: DateRange): LedgerRecord[] {
  return records.filter((record) => record.date >= range.start && record.date <= range.end);
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function categoryTotals(records: LedgerRecord[]): Map<string, { cents: number; count: number }> {
  const totals = new Map<string, { cents: number; count: number }>();
  for (const record of records) {
    const value = totals.get(record.category) ?? { cents: 0, count: 0 };
    value.cents += record.cents;
    value.count += 1;
    totals.set(record.category, value);
  }
  return totals;
}

export function financeCompleteDates(files: ParsedLedgerFile[]): string[] {
  const valid = new Set<string>();
  const invalid = new Set<string>();
  for (const file of files) {
    if (!file.date) continue;
    if (file.diagnostics.length > 0 || (file.records.length === 0 && file.frontmatterTotalCents !== 0)) invalid.add(file.date);
    else valid.add(file.date);
  }
  return [...valid].filter((date) => !invalid.has(date));
}

export function buildFinanceAdvisorSnapshot(
  records: LedgerRecord[],
  date: Date,
  salaryCents: number,
  excludedCategories: string[],
  completeDates: string[] = [...new Set(records.map((record) => record.date))]
): FinanceAdvisorSnapshot {
  const currentRange = salaryDayRange(date);
  const fullCurrentRange = salaryCycleFullRange(date);
  const previousRanges: [DateRange, DateRange] = [salaryCycleFullRange(date, 1), salaryCycleFullRange(date, 2)];
  const elapsedDays = daysInclusive(currentRange);
  const totalDays = daysInclusive(fullCurrentRange);
  const currentAll = recordsInRange(records, currentRange);
  const currentSpentCents = currentAll.reduce((sum, record) => sum + record.cents, 0);
  const remainingSalaryCents = salaryCents - currentSpentCents;
  const recordedDates = new Set(completeDates);
  const usableRanges = previousRanges.filter((range) => {
    for (let day = range.start; day <= range.end; day = addDays(day, 1)) {
      if (!recordedDates.has(day)) return false;
    }
    return true;
  });
  const historyCycleCount = usableRanges.length;
  const previousFull = usableRanges.map((range) => recordsInRange(records, range));
  const historicalAverageSpentCents = average(previousFull.map((items) => items.reduce((sum, record) => sum + record.cents, 0)));
  const currentCoverage = Array.from({ length: elapsedDays }, (_, index) => addDays(currentRange.start, index))
    .every((day) => recordedDates.has(day));
  const forecastAvailable = historyCycleCount > 0 && currentCoverage;
  const forecastCents = currentSpentCents + (elapsedDays >= totalDays ? 0 : average(usableRanges.map((range) =>
    recordsInRange(records, { start: addDays(range.start, elapsedDays), end: range.end })
      .reduce((sum, record) => sum + record.cents, 0))));
  const forecastConfidence = historyCycleCount < 2 || elapsedDays < 7 ? "low" : "normal";
  const excluded = new Set(excludedCategories);
  const consumption = (items: LedgerRecord[]): LedgerRecord[] => items.filter((record) => !excluded.has(record.category));
  const currentConsumption = consumption(currentAll);
  const previousProgress = usableRanges.map((range) => consumption(recordsInRange(records, {
    start: range.start,
    end: addDays(range.start, Math.min(elapsedDays, daysInclusive(range)) - 1)
  })));
  const currentTotals = categoryTotals(currentConsumption);
  const previousProgressTotals = previousProgress.map(categoryTotals);
  const previousFullTotals = previousFull.map((items) => categoryTotals(consumption(items)));
  const categories = new Set<string>([
    ...currentTotals.keys(),
    ...previousProgressTotals.flatMap((totals) => [...totals.keys()]),
    ...previousFullTotals.flatMap((totals) => [...totals.keys()])
  ]);
  const currentConsumptionTotal = currentConsumption.reduce((sum, record) => sum + record.cents, 0);
  const baselineProgressTotal = average(previousProgress.map((items) => items.reduce((sum, record) => sum + record.cents, 0)));
  const snapshots: FinanceCategorySnapshot[] = [...categories].map((category) => {
    const current = currentTotals.get(category) ?? { cents: 0, count: 0 };
    const baselineProgressCents = average(previousProgressTotals.map((totals) => totals.get(category)?.cents ?? 0));
    const baselineProgressCount = average(previousProgressTotals.map((totals) => totals.get(category)?.count ?? 0));
    const baselineCycleCents = average(previousFullTotals.map((totals) => totals.get(category)?.cents ?? 0));
    return {
      category,
      currentCents: current.cents,
      currentCount: current.count,
      baselineProgressCents,
      baselineProgressCount,
      baselineCycleCents,
      remainingReferenceCents: Math.max(0, baselineCycleCents - current.cents),
      currentShare: currentConsumptionTotal === 0 ? 0 : current.cents / currentConsumptionTotal,
      baselineShare: baselineProgressTotal === 0 ? 0 : baselineProgressCents / baselineProgressTotal
    };
  }).sort((a, b) => b.baselineCycleCents - a.baselineCycleCents || b.currentCents - a.currentCents);

  const events: FinanceInsightEvent[] = [];
  if (forecastAvailable && salaryCents > 0 && forecastCents > salaryCents) {
    const excess = forecastCents - salaryCents;
    events.push({
      id: "salary-pressure",
      type: "salary-pressure",
      priority: forecastConfidence === "low" ? 35 : 100 + Math.min(40, Math.round(excess / Math.max(1, salaryCents) * 100)),
      title: forecastConfidence === "low" ? "周期末支出需继续观察" : "周期末支出可能超过工资",
      detail: `按已花金额加历史剩余阶段支出参考，周期末可能比工资多 ${formatCents(excess)}。${forecastConfidence === "low" ? "目前置信度较低，仅供参考。" : ""}`
    });
  } else if (forecastAvailable && salaryCents > 0) {
    events.push({
      id: "salary-pace",
      type: "salary-pace",
      priority: 30,
      title: "周期末支出参考",
      detail: `按已花金额加历史剩余阶段支出，周期末参考 ${formatCents(forecastCents)}。${forecastConfidence === "low" ? "目前置信度较低。" : ""}`
    });
  }

  for (const item of snapshots) {
    if (historyCycleCount < 2 || !currentCoverage) continue;
    const amountDifference = item.currentCents - item.baselineProgressCents;
    const amountThreshold = Math.max(5_000, Math.round(item.baselineProgressCents * 0.25));
    if (amountDifference >= amountThreshold && (item.currentCount >= 2 || amountDifference >= 10_000)) {
      events.push({
        id: `spending-spike:${item.category}`,
        type: "spending-spike",
        priority: 70 + Math.min(25, Math.round(amountDifference / 5_000)),
        category: item.category,
        title: `${item.category}支出明显增加`,
        detail: `比前两个周期同期平均多 ${formatCents(amountDifference)}。`
      });
    }
    const countDifference = item.currentCount - item.baselineProgressCount;
    const countThreshold = Math.max(2, Math.ceil(item.baselineProgressCount * 0.35));
    if (countDifference >= countThreshold && amountDifference >= 5_000) {
      events.push({
        id: `frequency-spike:${item.category}`,
        type: "frequency-spike",
        priority: 66 + Math.min(20, countDifference * 3),
        category: item.category,
        title: `${item.category}消费更频繁`,
        detail: `当前已有 ${item.currentCount} 笔，比同期平均多约 ${countDifference} 笔。`
      });
    }
    const currentTicket = item.currentCount === 0 ? 0 : Math.round(item.currentCents / item.currentCount);
    const baselineTicket = item.baselineProgressCount === 0 ? 0 : Math.round(item.baselineProgressCents / item.baselineProgressCount);
    if (item.currentCount >= 2 && item.baselineProgressCount >= 2 && currentTicket - baselineTicket >= 2_000 && currentTicket >= baselineTicket * 1.3) {
      events.push({
        id: `ticket-spike:${item.category}`,
        type: "ticket-spike",
        priority: 62 + Math.min(18, Math.round((currentTicket - baselineTicket) / 2_000)),
        category: item.category,
        title: `${item.category}单次花费变高`,
        detail: `当前笔均 ${formatCents(currentTicket)}，同期平均约 ${formatCents(baselineTicket)}。`
      });
    }
    if (item.currentCents >= 5_000 && item.currentShare - item.baselineShare >= 0.12) {
      events.push({
        id: `mix-shift:${item.category}`,
        type: "mix-shift",
        priority: 58 + Math.min(18, Math.round((item.currentShare - item.baselineShare) * 100)),
        category: item.category,
        title: `支出重心转向${item.category}`,
        detail: `当前占消费支出的 ${Math.round(item.currentShare * 100)}%，同期平均约 ${Math.round(item.baselineShare * 100)}%。`
      });
    }
  }

  const historicalByCategory = new Map<string, number[]>();
  for (const items of previousFull) {
    for (const record of consumption(items)) {
      const amounts = historicalByCategory.get(record.category) ?? [];
      amounts.push(record.cents);
      historicalByCategory.set(record.category, amounts);
    }
  }
  let largeExpenseIndex = 0;
  for (const record of currentConsumption) {
    if (historyCycleCount < 2 || !currentCoverage || (historicalByCategory.get(record.category)?.length ?? 0) < 3) continue;
    const historicalMedian = median(historicalByCategory.get(record.category) ?? []);
    const threshold = Math.max(10_000, Math.round(salaryCents * 0.05), historicalMedian * 3);
    if (record.cents >= threshold) {
      events.push({
        id: `large-expense:${largeExpenseIndex}`,
        type: "large-expense",
        priority: 78 + Math.min(20, Math.round(record.cents / Math.max(1, threshold) * 5)),
        category: record.category,
        title: `出现一笔较大的${record.category}支出`,
        detail: `单笔 ${formatCents(record.cents)}，明显高于该分类过往单笔水平。`
      });
      largeExpenseIndex += 1;
    }
  }

  events.push({ id: "stable", type: "stable", priority: 10,
    title: historyCycleCount < 2 || !currentCoverage ? "参考数据不足" : "暂未发现明显变化",
    detail: historyCycleCount < 2 || !currentCoverage
      ? `可用完整历史周期 ${historyCycleCount}/2；缺失或存在核对问题的账本不按零消费处理，暂不判断消费异常。`
      : "暂未触发可靠的异常提醒。" });
  events.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id, "zh-CN"));

  return {
    currentRange,
    fullCurrentRange,
    previousRanges,
    elapsedDays,
    totalDays,
    salaryCents,
    currentSpentCents,
    remainingSalaryCents,
    historicalAverageSpentCents,
    forecastCents,
    historyCycleCount,
    forecastAvailable,
    forecastConfidence,
    categories: snapshots,
    events
  };
}

function trendBucket(dateIso: string, granularity: "day" | "week" | "month"): { key: string; start: string; end: string; label: string } {
  if (granularity === "day") return { key: dateIso, start: dateIso, end: dateIso, label: dateIso.slice(5) };
  if (granularity === "month") {
    const date = dateFromIso(dateIso);
    const range = monthRange(date.getFullYear(), date.getMonth());
    return { key: dateIso.slice(0, 7), start: range.start, end: range.end, label: dateIso.slice(0, 7) };
  }
  const date = dateFromIso(dateIso);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  const start = isoFromDate(date);
  return { key: start, start, end: addDays(start, 6), label: `${start.slice(5)}周` };
}

export function trendPoints(records: LedgerRecord[], granularity: "day" | "week" | "month"): TrendPoint[] {
  const map = new Map<string, TrendPoint>();
  for (const record of records) {
    const bucket = trendBucket(record.date, granularity);
    const point = map.get(bucket.key) ?? { ...bucket, cents: 0, count: 0 };
    point.cents += record.cents;
    point.count += 1;
    map.set(bucket.key, point);
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function compareValue(currentCents: number, previousCents: number): ComparisonValue {
  let ratio: number | "new" | "none";
  if (previousCents === 0) ratio = currentCents === 0 ? "none" : "new";
  else ratio = (currentCents - previousCents) / previousCents;
  return { currentCents, previousCents, differenceCents: currentCents - previousCents, ratio };
}

export function diagnosticsFor(files: Iterable<ParsedLedgerFile>): LedgerDiagnostic[] {
  const diagnostics: LedgerDiagnostic[] = [];
  for (const file of files) diagnostics.push(...file.diagnostics);
  return diagnostics.sort((a, b) => a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0));
}
