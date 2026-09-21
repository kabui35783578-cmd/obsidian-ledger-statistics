import { ParsedLedgerFile, barkPushUrl, budgetScopedRecords, filteredRecords, formatCents, isoFromDate } from "./core";
import type { LedgerSettings } from "./settings";
import { RequestGate } from "./request-gate";

export function barkSucceeded(response: { status: number; json: unknown }): boolean {
  const body = response.json as { code?: unknown; message?: unknown } | null;
  return response.status >= 200 && response.status < 300 && body?.code === 200 && body?.message === "success";
}

export class BudgetMonitor {
  private inFlight = false;
  private stopped = false;
  private retryAfter = 0;

  constructor(
    private settings: () => LedgerSettings,
    private send: (url: string) => Promise<{ status: number; json: unknown }>,
    private save: () => Promise<void>,
    private notify: (message: string) => void,
    private gate: RequestGate,
    private timeoutMs = 30_000
  ) {}

  stop(): void { this.stopped = true; }

  async check(files: ParsedLedgerFile[], now = new Date()): Promise<void> {
    const settings = this.settings();
    const today = isoFromDate(now);
    if (this.stopped || this.inFlight || this.gate.busy || now.getTime() < this.retryAfter
      || !settings.barkUrl || settings.dailyBudgetCents <= 0 || settings.lastBudgetNotificationDate === today) return;
    const records = budgetScopedRecords(filteredRecords(files, {
      range: { start: today, end: today }, scope: "all", excludedCategories: [],
      categories: settings.budgetCategory ? [settings.budgetCategory] : [], keyword: ""
    }), settings.includeStarredInBudget, settings.starredRecordIds);
    const spent = records.reduce((sum, record) => sum + record.cents, 0);
    if (spent < settings.dailyBudgetCents) return;
    const over = spent - settings.dailyBudgetCents;
    const title = over > 0 ? "今日预算已超支" : "今日预算已用尽";
    const scope = `${settings.budgetCategory || "全部分类"}（${settings.includeStarredInBudget ? "含星标" : "不含星标"}）`;
    const body = `今日${scope}支出 ${formatCents(spent)}，每日预算 ${formatCents(settings.dailyBudgetCents)}${over > 0 ? `，超支 ${formatCents(over)}` : "，已达到每日预算"}`;
    const url = barkPushUrl(settings.barkUrl, title, body);
    if (!url) return;
    this.inFlight = true;
    try {
      await this.gate.run(async () => {
        const response = await this.send(url);
        if (!barkSucceeded(response)) throw new Error("Bark 未确认发送成功");
        if (this.stopped) return;
        this.settings().lastBudgetNotificationDate = today;
        // Even a late native response must mark success to avoid duplicate delivery.
        await this.save();
      }, undefined, this.timeoutMs);
    } catch {
      this.retryAfter = now.getTime() + 5 * 60_000;
      if (!this.stopped) this.notify("预算提醒发送或保存失败，稍后自动重试；请检查 Bark 地址与网络。");
    } finally {
      this.inFlight = false;
    }
  }
}
