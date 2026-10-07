import { addDays, DateRange, isoFromDate, LedgerRecord, monthRange, normalizeLedgerText, ParsedLedgerFile, salaryCycleFullRange } from "./core";
import { DEFAULT_REPORT_OBJECT_RULES, ParsedObjectRules, parseObjectRules, ReportThresholds } from "./report-config";
import { analyzeReport } from "./report-analysis";
export { trimTrailingGap } from "./report-analysis";
import { findingKeyNumbers } from "./report-presentation";
export { REPORT_THRESHOLDS, DEFAULT_REPORT_OBJECT_RULES, parseObjectRules } from "./report-config";

export const REPORT_RULE_VERSION = "3";
export interface ReportPreferences {
  mode: "salary" | "month" | "custom";
  offset: number;
  /** Keep an explicitly selected historical cycle fixed across salary/month boundaries. */
  anchorDate?: string;
  customRange: DateRange;
  scope: "consumption" | "all";
  category: string;
  keyword: string;
  includeStarred: boolean;
}
export interface ReportFact { label: string; value: number; unit: "元" | "笔" | "天" | "周" | "期" | "对" | "%" | "倍" }
export interface ReportEvidence {
  id: string; label: string; ranges: Array<{ label: string; range: DateRange }>;
  facts: Record<string, ReportFact>; recordIds: string[]; limits: string[];
  scope?: { kind: "all" | "category" | "object" | "brand" | "mixed" | "note" | "multiple"; label: string; accounting: "consumption" | "all" };
  readings?: { supporting: ReportReading[]; counter: ReportReading[] };
  sections?: Array<{ label: string; keys: string[]; expanded?: boolean }>;
  categories?: Array<{ label: string; current: number; previous: number; previousScaled: number; difference?: number; status: "new" | "ceased" | "existing" | "unknown" }>;
}
export interface ReportReading { text: string; factKeys: string[] }
export interface ReportFinding {
  id: string; subject: string; type: string; title: string; observation: string;
  score: number; evidenceIds: string[]; limits: string[];
  signals?: Array<{ type: string; title: string }>;
}
export interface ReportCoverage { range: DateRange; complete: boolean; missingDates: string[]; problems: Array<{ path: string; date: string; reason: string }> }
export interface ReportSnapshot {
  ruleVersion: string; fingerprint: string; label: string; range: DateRange; fullRange: DateRange;
  previousRange: DateRange; historicalRanges: DateRange[]; coverage: ReportCoverage[];
  undatedPaths: string[]; comparable: boolean; findings: ReportFinding[]; evidence: ReportEvidence[];
  records: LedgerRecord[]; preferences: ReportPreferences; excludedCategories: string[];
  effectiveRange: DateRange; trimmedDates: string[]; degraded: boolean;
  observedDays: [number, number]; temporalRange?: DateRange; temporalLagDays?: number;
  overview?: ReportEvidence;
}
export interface ReportAnalysisOptions { thresholds?: Partial<ReportThresholds>; objectRules?: string }
export interface ReportParagraph { heading: string; text: string; findingIds: string[]; evidenceIds: string[] }
export interface SpendingReport { title: string; summary: string; paragraphs: ReportParagraph[] }
export interface ReportCache {
  fingerprint: string; configuration: string; generatedAt: string; report: SpendingReport;
  /** Evidence and records as they were at manual generation time. Older caches lack this. */
  snapshot?: ReportSnapshot;
}

export function defaultReportPreferences(now = new Date()): ReportPreferences {
  return { mode: "salary", offset: 0, customRange: { start: isoFromDate(now), end: isoFromDate(now) }, scope: "consumption", category: "", keyword: "", includeStarred: true };
}
export function normalizeReportPreferences(value: Partial<ReportPreferences> | null | undefined, now = new Date()): ReportPreferences {
  const base = defaultReportPreferences(now);
  if (!value || typeof value !== "object") return base;
  return { ...base, mode: ["salary", "month", "custom"].includes(value.mode ?? "") ? value.mode! : base.mode,
    offset: Number.isInteger(value.offset) && value.offset! >= 0 ? Math.min(120, value.offset!) : 0,
    anchorDate: value.anchorDate && validRange({ start: value.anchorDate, end: value.anchorDate }) && value.anchorDate <= isoFromDate(now) ? value.anchorDate : undefined,
    customRange: value.customRange && validRange(value.customRange) && value.customRange.start <= isoFromDate(now) && reportDays(value.customRange) <= 366 ? { ...value.customRange } : base.customRange,
    scope: value.scope === "all" ? "all" : "consumption", category: typeof value.category === "string" ? value.category : "",
    keyword: typeof value.keyword === "string" ? value.keyword : "", includeStarred: value.includeStarred !== false };
}
function validRange(r: DateRange): boolean {
  return !!r && /^\d{4}-\d{2}-\d{2}$/.test(r.start) && /^\d{4}-\d{2}-\d{2}$/.test(r.end) && r.start <= r.end &&
    isoFromDate(new Date(`${r.start}T12:00:00`)) === r.start && isoFromDate(new Date(`${r.end}T12:00:00`)) === r.end;
}
export function reportDays(r: DateRange): number { return Math.max(0, Math.round((new Date(`${r.end}T12:00:00`).getTime() - new Date(`${r.start}T12:00:00`).getTime()) / 86400000) + 1); }
export function reportPeriods(p: ReportPreferences, now: Date): { range: DateRange; fullRange: DateRange; previous: DateRange; history: DateRange[] } {
  const today = isoFromDate(now);
  if (p.mode === "custom") {
    const fullRange = { ...p.customRange };
    const range = { ...fullRange, end: fullRange.end > today ? today : fullRange.end };
    const n = reportDays(fullRange);
    const previousStart = addDays(fullRange.start, -n);
    return { range, fullRange, previous: { start: previousStart, end: addDays(previousStart, reportDays(range) - 1) },
      history: Array.from({ length: 6 }, (_, i) => ({ start: addDays(fullRange.start, -n * (i + 1)), end: addDays(fullRange.start, -n * i - 1) })) };
  }
  const baseDate = p.offset > 0 && p.anchorDate ? new Date(`${p.anchorDate}T12:00:00`) : now;
  const selectedOffset = p.offset > 0 && p.anchorDate ? 0 : p.offset;
  const full = (offset: number) => p.mode === "salary" ? salaryCycleFullRange(baseDate, offset) : monthRange(baseDate.getFullYear(), baseDate.getMonth() - offset);
  const fullRange = full(selectedOffset);
  const range = { ...fullRange, end: fullRange.end > today ? today : fullRange.end };
  const history = Array.from({ length: 6 }, (_, i) => full(selectedOffset + i + 1));
  const elapsed = reportDays(range);
  const previous = p.offset === 0 ? { start: history[0].start, end: addDays(history[0].start, Math.min(elapsed, reportDays(history[0])) - 1) } : history[0];
  return { range, fullRange, previous, history };
}
export function reportCoverage(files: ParsedLedgerFile[], range: DateRange): ReportCoverage {
  const byDate = new Map<string, ParsedLedgerFile[]>();
  files.forEach(f => { if (f.date) { const entries = byDate.get(f.date) ?? []; entries.push(f); byDate.set(f.date, entries); } });
  return reportCoverageIndexed(byDate, range);
}
export function reportCoverageIndexed(byDate: ReadonlyMap<string, ParsedLedgerFile[]>, range: DateRange): ReportCoverage {
  const missingDates: string[] = [], problems: ReportCoverage["problems"] = [];
  for (let day = range.start; day <= range.end; day = addDays(day, 1)) {
    const entries = byDate.get(day);
    if (!entries) { missingDates.push(day); continue; }
    for (const f of entries) {
      const reasons = f.diagnostics.map(d => d.reason);
      if (!f.records.length && f.frontmatterTotalCents !== 0) reasons.push("空账本没有明确记录零消费");
      if (reasons.length) problems.push({ path: f.path, date: day, reason: reasons.join("；") });
    }
  }
  return { range, complete: reportDays(range) > 0 && !missingDates.length && !problems.length, missingDates, problems };
}

export interface ReportObject { key: string; label: string; kind: "object" | "brand" | "mixed" | "note" }
const DEFAULT_OBJECT_RULES = parseObjectRules(DEFAULT_REPORT_OBJECT_RULES);
export function identifyReportObjects(note: string, rules: ParsedObjectRules = DEFAULT_OBJECT_RULES): ReportObject[] {
  const text = normalizeLedgerText(note).trim().toLocaleLowerCase("zh-CN").replace(/\s+/g, " ");
  if (!text) return [];
  const matches = rules.objects.filter(([, re]) => re.test(text));
  const mixed = matches.length > 1 && (/超市|购物|[+、]/.test(text) || matches.some(([label]) => ["水果", "生活用品", "零食"].includes(label)));
  const result: ReportObject[] = mixed ? [{ key: "mixed:购物", label: "混合购物", kind: "mixed" }] : matches.map(([label]) => ({ key: `object:${label}`, label, kind: "object" }));
  for (const [brand, re] of rules.brands) {
    if (re.test(text)) result.push({ key: `brand:${brand}`, label: `${brand}（品牌）`, kind: "brand" });
  }
  // Preserve model numbers and product meaning; unknown prefixes are not automatically synonyms.
  const normalized = text.replace(/\d+(?:\.\d+)?\s*(份|杯|个|次)(?=$|[\s，,。])/g, "").replace(/[，,。!！；;]+/g, " ").replace(/\s+/g, " ").trim();
  if (!result.length && normalized) result.push({ key: `note:${normalized}`, label: normalized, kind: "note" });
  return result;
}
export function reportHash(value: string): string {
  let a = 2166136261, b = 5381;
  for (let i = 0; i < value.length; i++) { a = Math.imul(a ^ value.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ value.charCodeAt(i); }
  return `${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`;
}
export function reportMedian(a: number[]): number { const b = [...a].sort((x, y) => x - y); return b.length ? (b[Math.floor((b.length - 1) / 2)] + b[Math.floor(b.length / 2)]) / 2 : 0; }
export function cosine(a: number[], b: number[]): number { const norm = Math.sqrt(a.reduce((s, v) => s + v * v, 0) * b.reduce((s, v) => s + v * v, 0)); return norm ? a.reduce((s, v, i) => s + v * b[i], 0) / norm : 0; }
export function theilSen(values: number[]): number { const slopes: number[] = []; values.forEach((v, i) => { for (let j = i + 1; j < values.length; j++) slopes.push((values[j] - v) / (j - i)); }); return reportMedian(slopes); }
export function symmetricDecomposition(n0: number, a0: number, n1: number, a1: number): { frequency: number; ticket: number } {
  const p0 = n0 ? a0 / n0 : 0, p1 = n1 ? a1 / n1 : 0;
  return { frequency: (n1 - n0) * (p0 + p1) / 2, ticket: (p1 - p0) * (n0 + n1) / 2 };
}

export function buildReportSnapshot(files: ParsedLedgerFile[], preferences: ReportPreferences, now: Date, excludedCategories: string[], starredIds: string[], options: ReportAnalysisOptions = {}): ReportSnapshot {
  return analyzeReport(files, preferences, now, excludedCategories, starredIds, options);
}

export function localSpendingReport(snapshot: ReportSnapshot): SpendingReport {
  const overview = snapshot.overview;
  const amount = overview?.facts.current_amount.value ?? 0, count = overview?.facts.current_count.value ?? 0;
  const baseline = overview?.facts.previous_amount_scaled?.value ?? overview?.facts.previous_amount.value ?? 0;
  const difference = amount - baseline;
  const comparison = snapshot.comparable ? (baseline ? `较上期${overview?.facts.previous_amount_scaled ? '按观察日折算后' : '同期'}${difference < 0 ? '−' : '+'}¥${Math.abs(difference).toFixed(2)}（${difference < 0 ? '−' : '+'}${Math.abs(difference / baseline * 100).toFixed(1)}%）。` : count ? '上期没有消费记录，本期新增。' : '') : '';
  const summary = '本期已记录支出 ¥' + amount.toFixed(2) + '，共' + count + '笔。' + comparison + (snapshot.findings.length ? '以下发现聚焦消费变化和重复模式，详细数据可查看依据。' : snapshot.comparable ? '未发现证据充分的明显变化。' : '可比数据不足，请核对缺失日期和异常账本。');
  const paragraphs = snapshot.findings.map(f => ({ heading: f.title, text: findingKeyNumbers(f, snapshot.evidence.filter(e => f.evidenceIds.includes(e.id))) + '\n\n' + f.observation + (f.signals?.length ? '\n\n相关线索：' + f.signals.map(s => s.title).join('；') + '。' : ''), findingIds:[f.id], evidenceIds:f.evidenceIds }));
  return { title:snapshot.label, summary, paragraphs };
}
