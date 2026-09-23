import { LedgerRecord, salaryDayRange } from "./core";

export interface BalanceCalibration {
  cycleStart: string;
  balanceCents: number;
  calibratedAt: string;
  postAnchorSpentCents: number;
}

export interface BalanceStatus {
  remainingCents: number;
  recordedSpentCents: number;
  unrecordedNetCents: number;
  calibrated: boolean;
  calibratedAt?: string;
}

export function isBalanceCalibration(value: unknown): value is BalanceCalibration {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<BalanceCalibration>;
  return typeof item.cycleStart === "string" && /^\d{4}-\d{2}-15$/.test(item.cycleStart)
    && typeof item.calibratedAt === "string" && Number.isFinite(Date.parse(item.calibratedAt))
    && typeof item.balanceCents === "number" && Number.isSafeInteger(item.balanceCents) && item.balanceCents >= 0
    && typeof item.postAnchorSpentCents === "number" && Number.isSafeInteger(item.postAnchorSpentCents) && item.postAnchorSpentCents >= 0;
}

function afterCalibration(record: LedgerRecord, calibratedAt: string): boolean {
  const date = new Date(calibratedAt);
  const anchorDay = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  if (record.date !== anchorDay) return record.date > anchorDay;
  // "补记" has no transaction time; treating it as pre-calibration avoids deducting an old expense twice.
  if (!/^\d{1,2}:\d{2}$/.test(record.time)) return false;
  const [hour, minute] = record.time.split(":").map(Number);
  // The recorded time has minute precision. The captured baseline prevents an existing
  // transaction in the calibration minute from being counted twice.
  return hour * 60 + minute >= date.getHours() * 60 + date.getMinutes();
}

function postAnchorSpent(records: LedgerRecord[], cycleStart: string, calibratedAt: string, today: string): number {
  return records.reduce((sum, record) => sum + (record.date >= cycleStart && record.date <= today && afterCalibration(record, calibratedAt) ? record.cents : 0), 0);
}

export function createBalanceCalibration(records: LedgerRecord[], now: Date, balanceCents: number): BalanceCalibration {
  const cycle = salaryDayRange(now);
  const calibratedAt = now.toISOString();
  return {
    cycleStart: cycle.start,
    balanceCents,
    calibratedAt,
    postAnchorSpentCents: postAnchorSpent(records, cycle.start, calibratedAt, cycle.end)
  };
}

export function balanceStatus(records: LedgerRecord[], now: Date, salaryCents: number, calibration: unknown): BalanceStatus {
  const cycle = salaryDayRange(now);
  const recordedSpentCents = records.reduce((sum, record) => sum + (record.date >= cycle.start && record.date <= cycle.end ? record.cents : 0), 0);
  const active = isBalanceCalibration(calibration) && calibration.cycleStart === cycle.start && Date.parse(calibration.calibratedAt) <= now.getTime();
  const remainingCents = active
    ? calibration.balanceCents - (postAnchorSpent(records, cycle.start, calibration.calibratedAt, cycle.end) - calibration.postAnchorSpentCents)
    : salaryCents - recordedSpentCents;
  return {
    remainingCents,
    recordedSpentCents,
    unrecordedNetCents: salaryCents - recordedSpentCents - remainingCents,
    calibrated: active,
    ...(active ? { calibratedAt: calibration.calibratedAt } : {})
  };
}
