import { DateRange, isValidIsoDate, salaryDayRange } from "./core";
import { BalanceCalibration, BalanceStatus, balanceStatus, isBalanceCalibration } from "./balance";
import type { LedgerRecord } from "./core";

export interface SalaryCycleRecord {
  cycleStart: string;
  salaryCents: number;
  salarySource: "saved" | "legacy";
  calibration: BalanceCalibration | null;
  note: string;
}

export interface SalaryCycleState {
  salaryCents: number;
  balanceCalibration: BalanceCalibration | null;
  balanceCalibrationNote: string;
  salaryCycleStart: string;
  salaryCycles: SalaryCycleRecord[];
}

function validStart(value: unknown): value is string {
  return typeof value === "string" && isValidIsoDate(value) && value.endsWith("-15");
}

export function salaryCycleRange(start: string, now = new Date()): DateRange {
  const anchor = new Date(`${start}T12:00:00`);
  const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 14, 12);
  const fullEnd = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-14`;
  return { start, end: start === salaryDayRange(now).start ? salaryDayRange(now).end : fullEnd };
}

export function shiftSalaryCycle(start: string, offset: number): string {
  return salaryDayRange(new Date(`${start}T12:00:00`), offset).start;
}

export function normalizeSalaryCycles(value: unknown): SalaryCycleRecord[] {
  const cycles = new Map<string, SalaryCycleRecord>();
  if (Array.isArray(value)) for (const item of value) {
    if (!item || !validStart(item.cycleStart) || !Number.isSafeInteger(item.salaryCents) || item.salaryCents < 0) continue;
    const calibration = isBalanceCalibration(item.calibration) && item.calibration.cycleStart === item.cycleStart
      && salaryDayRange(new Date(item.calibration.calibratedAt)).start === item.cycleStart ? { ...item.calibration } : null;
    cycles.set(item.cycleStart, {
      cycleStart: item.cycleStart, salaryCents: item.salaryCents,
      salarySource: item.salarySource === "legacy" ? "legacy" : "saved",
      calibration, note: typeof item.note === "string" ? item.note : ""
    });
  }
  return [...cycles.values()].sort((a, b) => a.cycleStart.localeCompare(b.cycleStart));
}

/** Pure migration/rollover: the caller persists this together with other settings. */
export function reconcileSalaryCycles(state: SalaryCycleState, now = new Date()): SalaryCycleState {
  const currentStart = salaryDayRange(now).start;
  const cycles = new Map(normalizeSalaryCycles(state.salaryCycles).map(c => [c.cycleStart, c]));
  const calibration = isBalanceCalibration(state.balanceCalibration) && validStart(state.balanceCalibration.cycleStart)
    && salaryDayRange(new Date(state.balanceCalibration.calibratedAt)).start === state.balanceCalibration.cycleStart ? state.balanceCalibration : null;
  const note = typeof state.balanceCalibrationNote === "string" ? state.balanceCalibrationNote : "";
  const observed = validStart(state.salaryCycleStart);
  const activeStart = observed ? state.salaryCycleStart : calibration?.cycleStart ?? currentStart;
  const salaryCents = Number.isSafeInteger(state.salaryCents) && state.salaryCents >= 0 ? state.salaryCents : 0;
  if (observed || !cycles.has(activeStart)) cycles.set(activeStart, {
    cycleStart: activeStart, salaryCents,
    salarySource: !observed && activeStart !== currentStart ? "legacy" : "saved",
    calibration: calibration?.cycleStart === activeStart ? { ...calibration } : null, note
  });
  const current = activeStart === currentStart ? cycles.get(activeStart)! : cycles.get(currentStart) ?? {
    cycleStart: currentStart, salaryCents, salarySource: "saved" as const, calibration: null, note: ""
  };
  cycles.set(currentStart, current);
  return {
    salaryCycleStart: currentStart, salaryCents: current.salaryCents,
    balanceCalibration: current.calibration, balanceCalibrationNote: current.note,
    salaryCycles: [...cycles.values()].sort((a, b) => a.cycleStart.localeCompare(b.cycleStart))
  };
}

export function salaryCycleDetails(state: SalaryCycleState, start: string, records: LedgerRecord[], now = new Date()): {
  range: DateRange; cycle: SalaryCycleRecord; balance: BalanceStatus; historical: boolean; salaryRecorded: boolean;
} {
  const reconciled = reconcileSalaryCycles(state, now);
  const historical = start !== reconciled.salaryCycleStart;
  const saved = reconciled.salaryCycles.find(c => c.cycleStart === start);
  const cycle = saved ?? { cycleStart: start, salaryCents: reconciled.salaryCents, salarySource: "legacy" as const, calibration: null, note: "" };
  const range = salaryCycleRange(start, now);
  const asOf = historical ? new Date(`${range.end}T23:59:59.999`) : now;
  return { range, cycle, historical, salaryRecorded: !!saved && cycle.salarySource === "saved",
    balance: balanceStatus(records, asOf, cycle.salaryCents, cycle.calibration) };
}
