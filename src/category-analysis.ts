import { addDays, DateRange, filteredRecords, FilterState, LedgerRecord, monthRange, ParsedLedgerFile, salaryCycleFullRange, summarize } from "./core";
import { identifyReportObjects, reportCoverage, reportDays, reportMedian, symmetricDecomposition } from "./report";
import { parseObjectRules } from "./report-config";

export function categoryPreviousRange(range: DateRange, preset: string): DateRange {
  const anchor = new Date(`${range.start}T12:00:00`);
  const days = reportDays(range);
  let full: DateRange;
  if (preset === "salary") full = salaryCycleFullRange(anchor, 1);
  else if (preset === "month" || preset === "previous") full = monthRange(anchor.getFullYear(), anchor.getMonth() - 1);
  else if (preset === "week") full = { start: addDays(range.start, -7), end: addDays(range.start, -1) };
  else if (preset === "year") full = { start: `${anchor.getFullYear() - 1}-01-01`, end: `${anchor.getFullYear() - 1}-12-31` };
  else return { start: addDays(range.start, -days), end: addDays(range.start, -1) };
  return { start: full.start, end: [addDays(full.start, days - 1), full.end].sort()[0] };
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

export function buildCategoryAnalysis(files: ParsedLedgerFile[], filter: FilterState, previousRange: DateRange, objectRules?: string) {
  const records = filteredRecords(files, filter), previous = filteredRecords(files, { ...filter, range: previousRange });
  const summary = summarize(files, records, filter.range), previousSummary = summarize(files, previous, previousRange);
  const coverage = reportCoverage(files, filter.range), previousCoverage = reportCoverage(files, previousRange);
  const comparable = coverage.complete && previousCoverage.complete && files.every(file => file.date !== null);
  const scale = reportDays(filter.range) / Math.max(1, reportDays(previousRange));
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
  const repeats = groupRecords(records, categoryNoteLabel).filter(group => group.label !== "无备注" && group.records.length >= 2);
  const previousGroups = groupRecords(previous, categoryNoteLabel);
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
  return { records, previous, summary, previousSummary, previousRange, coverage, previousCoverage, comparable, scale,
    mean: records.length ? summary.cents / records.length : null, median: amounts.length ? reportMedian(amounts) : null,
    previousMean: previous.length ? previousSummary.cents / previous.length : null, activeDays,
    activeDayMean: activeDays ? summary.cents / activeDays : null, q1: quantile(.25), q3: quantile(.75),
    topTen, topThreeCents: total(topThree), purposes, repeats, previousGroups, bins, weekdays,
    decomposition: comparable && records.length && previous.length ? symmetricDecomposition(previous.length * scale, previousSummary.cents * scale, records.length, summary.cents) : null };
}

export type CategoryAnalysis = ReturnType<typeof buildCategoryAnalysis>;
