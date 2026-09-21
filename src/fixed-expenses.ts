import type { DateRange, LedgerRecord } from "./core";

export interface FixedExpense {
  id: string;
  name: string;
  amountCents: number;
  // Cycle start -> ledger record ID, "unpaid", or "none"; absent means unconfirmed.
  payments: Record<string, string>;
}

export interface FixedExpenseStatus {
  id: string;
  name: string;
  amountCents: number;
  paidCents: number;
  status: "unconfirmed" | "unpaid" | "paid" | "none";
  issues: string[];
}

export interface FixedExpenseAssessment {
  items: FixedExpenseStatus[];
  available: boolean;
  historicalDeductionCents: number;
  unpaidCents: number;
}

/** Only explicitly linked transactions are removed from the historical forecast. */
export function assessFixedExpenses(
  expenses: FixedExpense[], records: LedgerRecord[], current: DateRange,
  previousRemaining: Array<{ full: DateRange; remainingStart: string }>
): FixedExpenseAssessment {
  const active = expenses.filter((item) => item.name.trim() && Number.isSafeInteger(item.amountCents) && item.amountCents > 0);
  const byId = new Map(records.map((record) => [record.id, record]));
  const claimed = new Map<string, number>();
  for (const item of active) for (const range of [current, ...previousRemaining.map((p) => p.full)]) {
    const id = item.payments[range.start];
    if (id?.startsWith("ledger-v2:")) claimed.set(id, (claimed.get(id) ?? 0) + 1);
  }
  const deductions = previousRemaining.map(() => 0);
  let unpaidCents = 0;
  const items: FixedExpenseStatus[] = active.map((item) => {
    const issues: string[] = [];
    const resolve = (range: DateRange, label: string, historical: boolean) => {
      const id = item.payments[range.start];
      if (id === "none") return { status: "none" as const };
      if (id === "unpaid" && !historical) return { status: "unpaid" as const };
      const record = id ? byId.get(id) : undefined;
      if (!record || record.date < range.start || record.date > range.end || (claimed.get(id) ?? 0) > 1) {
        issues.push(`${label}：${id && id !== "unpaid" ? "关联记录已失效、超出周期或被重复使用" : "支付状态待确认"}`);
        return { status: "unconfirmed" as const };
      }
      return { status: "paid" as const, record };
    };
    const payment = resolve(current, "本周期", false);
    if (payment.status === "unpaid") unpaidCents += item.amountCents;
    previousRemaining.forEach((range, index) => {
      const historical = resolve(range.full, range.full.start, true);
      if (historical.record && historical.record.date >= range.remainingStart) deductions[index] += historical.record.cents;
    });
    return { id: item.id, name: item.name, amountCents: item.amountCents, paidCents: payment.record?.cents ?? 0, status: payment.status, issues };
  });
  return {
    items, available: items.every((item) => item.issues.length === 0), unpaidCents,
    historicalDeductionCents: deductions.length ? Math.round(deductions.reduce((sum, n) => sum + n, 0) / deductions.length) : 0
  };
}
