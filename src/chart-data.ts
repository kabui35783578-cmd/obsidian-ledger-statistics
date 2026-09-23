import { DateRange, LedgerRecord, salaryCycleFullRange } from "./core";

export interface WaterfallStep {
  label: string;
  deltaCents: number;
  fromCents: number;
  toCents: number;
  categories: string[];
  kind: "salary" | "expense" | "remaining";
}

export function salaryWaterfall(records: LedgerRecord[], range: DateRange, salaryCents: number): WaterfallStep[] {
  if (salaryCents <= 0) return [];
  const amounts = new Map<string, number>();
  for (const record of records) {
    if (record.date < range.start || record.date > range.end) continue;
    amounts.set(record.category, (amounts.get(record.category) ?? 0) + record.cents);
  }
  const ranked = [...amounts].filter(([, cents]) => cents > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"));
  const groups = ranked.length <= 4
    ? ranked.map(([label, cents]) => ({ label, cents, categories: [label] }))
    : [
      ...ranked.slice(0, 3).map(([label, cents]) => ({ label, cents, categories: [label] })),
      { label: `其余 ${ranked.length - 3} 类`, cents: ranked.slice(3).reduce((sum, [, cents]) => sum + cents, 0), categories: ranked.slice(3).map(([name]) => name) }
    ];
  const steps: WaterfallStep[] = [{ label: "周期工资", deltaCents: salaryCents, fromCents: 0, toCents: salaryCents, categories: [], kind: "salary" }];
  let balance = salaryCents;
  for (const group of groups) {
    steps.push({ label: group.label, deltaCents: -group.cents, fromCents: balance, toCents: balance - group.cents, categories: group.categories, kind: "expense" });
    balance -= group.cents;
  }
  steps.push({ label: "当前剩余", deltaCents: balance, fromCents: 0, toCents: balance, categories: [], kind: "remaining" });
  return steps;
}

export interface BoxReference {
  category: string;
  sampleCount: number;
  minCents: number;
  q1Cents: number;
  medianCents: number;
  q3Cents: number;
  maxCents: number;
  lowerFenceCents: number;
  upperFenceCents: number;
  outlierCents: number[];
  largestCurrent: LedgerRecord;
  historyRanges: [DateRange, DateRange];
}

function median(sorted: number[]): number {
  const center = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[center] : Math.round((sorted[center - 1] + sorted[center]) / 2);
}

export function categoryBoxReference(allRecords: LedgerRecord[], selectedRecords: LedgerRecord[], category: string, selectedStart: string): BoxReference | null {
  const anchor = new Date(`${selectedStart}T12:00:00`);
  if (!Number.isFinite(anchor.getTime())) return null;
  const historyRanges: [DateRange, DateRange] = [salaryCycleFullRange(anchor, 1), salaryCycleFullRange(anchor, 2)];
  const history = allRecords.filter((record) => record.category === category && record.cents > 0
    && historyRanges.some((range) => record.date >= range.start && record.date <= range.end))
    .map((record) => record.cents).sort((a, b) => a - b);
  const current = selectedRecords.filter((record) => record.category === category && record.cents > 0)
    .sort((a, b) => b.cents - a.cents || b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  if (history.length < 8 || current.length === 0) return null;
  const mid = Math.floor(history.length / 2);
  const q1Cents = median(history.slice(0, mid));
  const medianCents = median(history);
  const q3Cents = median(history.slice(history.length % 2 ? mid + 1 : mid));
  const iqr = q3Cents - q1Cents;
  const lowerFenceCents = Math.max(0, q1Cents - Math.round(iqr * 1.5));
  const upperFenceCents = q3Cents + Math.round(iqr * 1.5);
  const regular = history.filter((value) => value >= lowerFenceCents && value <= upperFenceCents);
  return {
    category,
    sampleCount: history.length,
    minCents: regular[0] ?? history[0],
    q1Cents,
    medianCents,
    q3Cents,
    maxCents: regular[regular.length - 1] ?? history[history.length - 1],
    lowerFenceCents,
    upperFenceCents,
    outlierCents: history.filter((value) => value < lowerFenceCents || value > upperFenceCents),
    largestCurrent: current[0],
    historyRanges
  };
}
