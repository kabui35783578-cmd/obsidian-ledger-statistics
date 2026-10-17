import { addDays, DateRange, isValidIsoDate, LedgerRecord, TrendPoint, trendPoints } from "./core";

const dayOffset = (start: string, end: string): number => Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
const validRange = (range: DateRange): boolean => isValidIsoDate(range.start) && isValidIsoDate(range.end) && range.start <= range.end;

function shiftMonths(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Monthly cycles use calendar boundaries, not a fixed 30/31-day subtraction. */
export function previousTrendRange(range: DateRange, preset: string): DateRange {
  if (!validRange(range)) return { ...range };
  if (preset === "week") return { start: addDays(range.start, -7), end: addDays(range.end, -7) };
  if (preset === "year") {
    const start = shiftMonths(range.start, -12);
    const fullEnd = `${start.slice(0, 4)}-12-31`;
    const alignedEnd = range.end.endsWith("-12-31") ? fullEnd : addDays(start, dayOffset(range.start, range.end));
    return { start, end: alignedEnd < fullEnd ? alignedEnd : fullEnd };
  }
  const fullMonthlyCycle = addDays(shiftMonths(range.start, 1), -1) === range.end;
  if (["salary", "month", "previous"].includes(preset) || fullMonthlyCycle) {
    const start = shiftMonths(range.start, -1);
    // Align an ongoing cycle by elapsed days, and cap at the previous cycle's end.
    const alignedEnd = fullMonthlyCycle ? addDays(range.start, -1) : addDays(start, dayOffset(range.start, range.end));
    return { start, end: alignedEnd < range.start ? alignedEnd : addDays(range.start, -1) };
  }
  const end = addDays(range.start, -1);
  return { start: addDays(end, -dayOffset(range.start, range.end)), end };
}

/** Ongoing periods compare posted days with the same elapsed part of the previous period. */
export function comparisonRanges(range: DateRange, preset: string, today: string): { current: DateRange; previous: DateRange; description: string } {
  const current = { ...range };
  if (validRange(range) && isValidIsoDate(today) && current.start <= today && current.end > today) current.end = today;
  const previous = previousTrendRange(current, preset);
  const currentDays = validRange(current) ? dayOffset(current.start, current.end) + 1 : 0;
  const previousDays = validRange(previous) ? dayOffset(previous.start, previous.end) + 1 : 0;
  return { current, previous, description: `本期 ${currentDays} 天，上期 ${previousDays} 天；比较实际金额，不按天数折算` };
}

export interface TrendComparison {
  range: DateRange;
  points: Array<TrendPoint | null>;
  missingDays: number;
}

/** A shared timeline keeps zero-spend days from shifting either series sideways. */
export function alignedTrendSeries(records: LedgerRecord[], previousRecords: LedgerRecord[], range: DateRange, previousRange: DateRange,
  unit: "day" | "week" | "month", cumulative: boolean, previousKnownDates: Set<string>): { points: TrendPoint[]; comparison: TrendComparison } {
  const comparison: TrendComparison = { range: previousRange, points: [], missingDays: 0 };
  if (!validRange(range) || !validRange(previousRange)) return { points: [], comparison };
  const selected = records.filter(record => record.date >= range.start && record.date <= range.end);
  const selectedPrevious = previousRecords.filter(record => record.date >= previousRange.start && record.date <= previousRange.end);
  const hasLedger = [...previousKnownDates].some(date => (date >= range.start && date <= range.end) || (date >= previousRange.start && date <= previousRange.end));
  if (!selected.length && !selectedPrevious.length && !hasLedger) return { points: [], comparison };
  const current = new Map(trendPoints(selected, unit).map(point => [point.key, point]));
  const previous = new Map(trendPoints(selectedPrevious, "day").map(point => [point.key, point]));
  const points: TrendPoint[] = [];
  let total = 0;
  let count = 0;
  let previousTotal = 0;
  let previousCount = 0;
  let incomplete = false;
  const mappedPreviousEnd = addDays(range.start, dayOffset(previousRange.start, previousRange.end));
  const timelineEnd = range.end > mappedPreviousEnd ? range.end : mappedPreviousEnd;
  for (let date = range.start; date <= timelineEnd;) {
    const bucket = trendPoints([{ date, cents: 0 } as LedgerRecord], unit)[0];
    const bucketLimit = date <= range.end ? range.end : timelineEnd;
    const end = bucket.end < bucketLimit ? bucket.end : bucketLimit;
    const amount = current.get(bucket.key);
    total = (cumulative ? total : 0) + (amount?.cents ?? 0);
    count = (cumulative ? count : 0) + (amount?.count ?? 0);
    if (date <= range.end) points.push({ ...bucket, start: cumulative ? range.start : date, end, cents: total, count });
    const sourceStart = addDays(previousRange.start, dayOffset(range.start, date));
    const sourceEnd = addDays(previousRange.start, dayOffset(range.start, end));
    const clippedEnd = sourceEnd < previousRange.end ? sourceEnd : previousRange.end;
    let missing = false;
    previousTotal = cumulative ? previousTotal : 0;
    previousCount = cumulative ? previousCount : 0;
    for (let source = sourceStart; source <= clippedEnd; source = addDays(source, 1)) {
      if (!previousKnownDates.has(source)) { missing = true; comparison.missingDays += 1; }
      previousTotal += previous.get(source)?.cents ?? 0;
      previousCount += previous.get(source)?.count ?? 0;
    }
    incomplete = (cumulative && incomplete) || missing;
    comparison.points.push(sourceStart > previousRange.end || incomplete ? null : {
      key: sourceStart, label: sourceStart.slice(5), start: cumulative ? previousRange.start : sourceStart, end: clippedEnd,
      cents: previousTotal, count: previousCount
    });
    date = addDays(end, 1);
  }
  return { points, comparison };
}
