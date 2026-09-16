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

export function salaryDayRange(date = new Date(), cycleOffset = 0): DateRange {
  const today = isoFromDate(date);
  const currentStartMonth = date.getDate() <= 14 ? date.getMonth() - 1 : date.getMonth();
  const startMonth = currentStartMonth - cycleOffset;
  return {
    start: isoFromDate(new Date(date.getFullYear(), startMonth, 15, 12)),
    end: cycleOffset === 0 ? today : isoFromDate(new Date(date.getFullYear(), startMonth + 1, 14, 12))
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
