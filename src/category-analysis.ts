import { addDays, DateRange, filteredRecords, FilterState, LedgerRecord, ParsedLedgerFile, summarize } from "./core";
import { previousTrendRange } from "./trend-comparison";
import { identifyReportObjects, reportCoverage, reportDays, reportMedian, symmetricDecomposition } from "./report";
import { parseObjectRules } from "./report-config";

export function categoryPreviousRange(range: DateRange, preset: string): DateRange {
  return previousTrendRange(range, preset);
}

export interface CategoryGroup { label: string; records: LedgerRecord[]; cents: number; days: number }

const total = (records: LedgerRecord[]) => records.reduce((sum, record) => sum + record.cents, 0);
const ranked = (records: LedgerRecord[]) => [...records].sort((a, b) => b.cents - a.cents || b.date.localeCompare(a.date) || b.time.localeCompare(a.time) || a.id.localeCompare(b.id));

export function categoryNoteLabel(record: LedgerRecord): string {
  const note = record.note.trim().replace(/[，,。!！；;]+/g, " ").replace(/\s+/g, " ").trim();
  return ({ "午饭": "午餐", "晚饭": "晚餐", "早饭": "早餐" } as Record<string, string>)[note] ?? (note || "无备注");
}

export function categoryBoxStats(records: LedgerRecord[]) {
  const amounts = records.map(r => r.cents).sort((a, b) => a - b);
  if (amounts.length < 4) return null;
  const q = (p: number) => { const pos = (amounts.length - 1) * p, low = Math.floor(pos); return amounts[low] + (amounts[Math.ceil(pos)] - amounts[low]) * (pos - low); };
  const q1 = q(.25), median = q(.5), q3 = q(.75), iqr = q3 - q1;
  const regular = amounts.filter(v => v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr);
  return { q1, median, q3, min: regular[0], max: regular[regular.length - 1], outliers: records.filter(r => r.cents < q1 - 1.5 * iqr || r.cents > q3 + 1.5 * iqr) };
}

function groupRecords(records: LedgerRecord[], label: (record: LedgerRecord) => string): CategoryGroup[] {
  const groups = new Map<string, LedgerRecord[]>();
  for (const record of records) {
    const name = label(record), entries = groups.get(name) ?? [];
    entries.push(record);
    groups.set(name, entries);
  }
  return [...groups].map(([label, records]) => ({ label, records, cents: total(records), days: new Set(records.map(r => r.date)).size }))
    .sort((a, b) => b.cents - a.cents || b.records.length - a.records.length || a.label.localeCompare(b.label, "zh-CN"));
}

export function buildCategoryAnalysis(files: ParsedLedgerFile[], filter: FilterState, previousRange: DateRange, objectRules?: string, acrossCategories = false) {
  const records = filteredRecords(files, filter), previous = filteredRecords(files, { ...filter, range: previousRange });
  const summary = summarize(files, records, filter.range), previousSummary = summarize(files, previous, previousRange);
  const coverage = reportCoverage(files, filter.range), previousCoverage = reportCoverage(files, previousRange);
  const comparable = coverage.complete && previousCoverage.complete && files.every(file => file.date !== null);
  const currentDays = reportDays(filter.range), previousDays = reportDays(previousRange);
  const comparisonBasis = `本期 ${currentDays} 天，上期 ${previousDays} 天 · 比较实际金额，不按天数折算`;
  const amounts = records.map(r => r.cents).sort((a, b) => a - b);
  const quantile = (p: number) => {
    if (!amounts.length) return null;
    const pos = (amounts.length - 1) * p, low = Math.floor(pos);
    return amounts[low] + (amounts[Math.ceil(pos)] - amounts[low]) * (pos - low);
  };
  const activeDays = new Set(records.map(r => r.date)).size;
  const topTen = ranked(records).slice(0, 10), topThree = topTen.slice(0, 3);
  const rules = parseObjectRules(objectRules);
  const purposes = groupRecords(records, record => {
    const objects = identifyReportObjects(record.note, rules).filter(o => o.kind === "object" || o.kind === "mixed");
    return objects.length === 1 ? objects[0].label : objects.length > 1 ? "多用途（未拆分）" : "未识别用途";
  });
  const repeatLabel = (record: LedgerRecord): string => acrossCategories ? `${record.category} · ${categoryNoteLabel(record)}` : categoryNoteLabel(record);
  const repeats = groupRecords(records, repeatLabel).filter(group => categoryNoteLabel(group.records[0]) !== "无备注" && group.records.length >= 2);
  const previousGroups = groupRecords(previous, repeatLabel);
  const bins = amounts.length ? [...new Set([0, quantile(.25)!, quantile(.5)!, quantile(.75)!])].map((low, i, edges) => {
    const high = edges[i + 1] ?? Infinity;
    return { low, high, records: records.filter(r => r.cents >= low && r.cents < high) };
  }).filter(bin => bin.records.length) : [];
  const weekdays = Array.from({ length: 7 }, (_, day) => {
    const entries = records.filter(r => (new Date(`${r.date}T12:00:00`).getDay() + 6) % 7 === day);
    let observed = 0;
    for (let date = filter.range.start; date <= filter.range.end; date = addDays(date, 1)) {
      if ((new Date(`${date}T12:00:00`).getDay() + 6) % 7 === day && !coverage.missingDates.includes(date)) observed++;
    }
    return { label: ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][day], records: entries, mean: observed ? total(entries) / observed : 0, observed };
  });
  return { records, previous, summary, previousSummary, previousRange, coverage, previousCoverage, comparable, currentDays, previousDays, comparisonBasis,
    currentDailyCents: comparable && currentDays ? summary.cents / currentDays : null,
    previousDailyCents: comparable && previousDays ? previousSummary.cents / previousDays : null,
    mean: records.length ? summary.cents / records.length : null, median: amounts.length ? reportMedian(amounts) : null,
    previousMean: previous.length ? previousSummary.cents / previous.length : null, activeDays,
    activeDayMean: activeDays ? summary.cents / activeDays : null, q1: quantile(.25), q3: quantile(.75),
    topTen, topThreeCents: total(topThree), purposes, repeats, previousGroups, bins, weekdays,
    decomposition: comparable && records.length && previous.length ? symmetricDecomposition(previous.length, previousSummary.cents, records.length, summary.cents) : null };
}

export type CategoryAnalysis = ReturnType<typeof buildCategoryAnalysis>;
