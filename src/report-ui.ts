import { Modal, Notice } from "obsidian";
import type LedgerStatisticsPlugin from "./main";
import { addDays, formatCents, isValidIsoDate, isoFromDate, LedgerRecord } from "./core";
import { buildReportSnapshot, localSpendingReport, normalizeReportPreferences, reportDays, reportPeriods, ReportPreferences, ReportSnapshot, SpendingReport } from "./report";
import { appendReportCache, findReportCache, reportConfiguration, requestSpendingReport } from "./report-ai";
import { sharedRequestGate } from "./request-gate";
import { createButton } from "./ui";

export class ReportEvidenceModal extends Modal {
  constructor(plugin: LedgerStatisticsPlugin, private snapshot: ReportSnapshot, private evidenceIds: string[], private openRecord: (r: LedgerRecord) => Promise<void>) { super(plugin.app); }
  onOpen(): void {
    this.setTitle("报告证据");
    this.contentEl.empty(); this.contentEl.addClass("ledger-report-evidence");
    const entries = this.snapshot.evidence.filter(e => this.evidenceIds.includes(e.id));
    for (const e of entries) {
      const section = this.contentEl.createDiv({ cls: "ledger-report-evidence-section" });
      section.createEl("h3", { text: e.label });
      e.ranges.forEach(r => section.createEl("p", { cls: "ledger-report-muted", text: `${r.label}：${r.range.start} 至 ${r.range.end}` }));
      const list = section.createEl("dl", { cls: "ledger-report-facts" });
      for (const f of Object.values(e.facts)) {
        list.createEl("dt", { text: f.label });
        list.createEl("dd", { text: f.unit === "元" ? formatCents(Math.round(f.value * 100)) : `${f.value}${f.unit}` });
      }
      e.limits.forEach(t => section.createEl("p", { cls: "ledger-report-limit", text: t }));
    }
    const ids = new Set(entries.flatMap(e => e.recordIds));
    const records = this.snapshot.records.filter(r => ids.has(r.id)).sort((a, b) => b.date.localeCompare(a.date) || b.cents - a.cents);
    this.contentEl.createEl("h3", { text: `相关流水（${records.length} 笔）` });
    const list = this.contentEl.createDiv({ cls: "ledger-report-records" });
    // Paginate large evidence sets without hiding which records contributed.
    let shown = 0;
    const more = createButton(this.contentEl, "显示更多流水");
    const show = () => {
      records.slice(shown, shown + 40).forEach(r => {
        const button = createButton(list, `${r.date} · ${r.category} · ${formatCents(r.cents)} · ${r.note || "无备注"}`);
        button.addClass("ledger-report-record");
        button.addEventListener("click", () => { this.close(); void this.openRecord(r); });
      });
      shown += 40; more.hidden = shown >= records.length;
    };
    more.addEventListener("click", show); show();
  }
  onClose(): void { this.contentEl.empty(); }
}

export class ReportPanel {
  private controller: AbortController | null = null;
  private loading = false;
  private error = "";
  private requestFingerprint = "";
  private disposed = false;
  private lastFingerprint = "";
  private stale = false;
  constructor(private plugin: LedgerStatisticsPlugin, private redraw: () => void, private openRecord: (r: LedgerRecord) => Promise<void>) {}
  get preferences(): ReportPreferences { return normalizeReportPreferences(this.plugin.settings.reportPreferences); }
  private config() { return { endpoint: this.plugin.settings.financeAiEndpoint, model: this.plugin.settings.financeAiModel, apiKey: this.plugin.settings.financeAiApiKey }; }
  snapshot(now = new Date()): ReportSnapshot { return buildReportSnapshot([...this.plugin.repository.files.values()], this.preferences, now, this.plugin.settings.excludedCategories, this.plugin.settings.starredRecordIds); }
  cancel(): void { this.controller?.abort(); this.controller = null; this.loading = false; }
  dispose(): void { this.disposed = true; this.cancel(); }
  private change(patch: Partial<ReportPreferences>): void {
    this.cancel(); this.error = "";
    this.plugin.settings.reportPreferences = { ...this.preferences, ...patch };
    void this.plugin.saveSettings(false, false).catch(() => new Notice("报告筛选保存失败"));
    this.redraw();
  }
  private shift(delta: number): void {
    const p = this.preferences;
    if (p.mode === "custom") {
      const n = reportDays(p.customRange);
      const range = { start: addDays(p.customRange.start, n * delta), end: addDays(p.customRange.end, n * delta) };
      if (range.start <= isoFromDate(new Date())) this.change({ customRange: range });
    } else {
      const now = new Date(), current = reportPeriods(p, now).fullRange;
      const boundary = delta < 0 ? addDays(current.start, -1) : addDays(current.end, 1);
      const target = reportPeriods({ ...p, offset: 0, anchorDate: undefined }, new Date(`${boundary}T12:00:00`)).fullRange;
      if (target.start > isoFromDate(now)) return;
      const historical = target.end < isoFromDate(now);
      this.change({ offset: historical ? 1 : 0, anchorDate: historical ? target.start : undefined });
    }
  }
  render(parent: HTMLElement): void {
    const snapshot = this.snapshot(), p = this.preferences;
    const configuration = reportConfiguration(this.config());
    if (this.loading && this.requestFingerprint !== `${snapshot.fingerprint}:${configuration}`) this.cancel();
    const cache = findReportCache(this.plugin.settings.reportCaches ?? [], snapshot, this.config());
    if (this.lastFingerprint && this.lastFingerprint !== snapshot.fingerprint) { this.stale = true; this.error = ""; }
    this.lastFingerprint = snapshot.fingerprint;
    const shell = parent.createDiv({ cls: "ledger-report" });
    const toolbar = shell.createDiv({ cls: "ledger-report-toolbar" });
    const select = (label: string, value: string, options: Array<[string, string]>, changed: (value: string) => void) => {
      const field = toolbar.createEl("label", { cls: "ledger-field" }); field.createSpan({ text: label });
      const el = field.createEl("select"); options.forEach(([v, text]) => el.createEl("option", { value: v, text })); el.value = value;
      el.addEventListener("change", () => changed(el.value)); return el;
    };
    select("报告期间", p.mode, [["salary", "工资周期"], ["month", "自然月"], ["custom", "自定义"]], mode => this.change({ mode: mode as ReportPreferences["mode"], offset: 0, anchorDate: undefined, ...(mode === "custom" ? { customRange: { ...snapshot.range } } : {}) }));
    const nav = toolbar.createDiv({ cls: "ledger-report-period-nav" });
    createButton(nav, "上一期").addEventListener("click", () => this.shift(-1));
    const next = createButton(nav, "下一期"); next.disabled = p.mode === "custom" ? addDays(p.customRange.start, reportDays(p.customRange)) > isoFromDate(new Date()) : p.offset === 0;
    next.addEventListener("click", () => this.shift(1));
    if (p.mode === "custom") for (const [key, label] of [["start", "开始"], ["end", "结束"]] as const) {
      const field = toolbar.createEl("label", { cls: "ledger-field" }); field.createSpan({ text: label });
      const input = field.createEl("input", { type: "date", value: p.customRange[key] });
      input.addEventListener("change", () => {
        const range = { ...p.customRange, [key]: input.value };
        if (!isValidIsoDate(range.start) || !isValidIsoDate(range.end) || range.start > range.end || new Date(`${range.start}T12:00:00`) > new Date() || reportDays(range) > 366) { new Notice("请选择有效日期，开始日期不晚于今天，范围不超过一年"); input.value = p.customRange[key]; return; }
        this.change({ customRange: range });
      });
    }
    select("口径", p.scope, [["consumption", "消费支出"], ["all", "全部支出"]], scope => this.change({ scope: scope as ReportPreferences["scope"] }));
    const categories = [...new Set([...this.plugin.repository.files.values()].flatMap(f => f.records.map(r => r.category)))].sort();
    select("分类", p.category, [["", "全部分类"], ...categories.map(c => [c, c] as [string, string])], category => this.change({ category }));
    const keyword = toolbar.createEl("label", { cls: "ledger-field" }); keyword.createSpan({ text: "关键词" });
    const input = keyword.createEl("input", { type: "search", value: p.keyword, placeholder: "分类或备注" });
    input.addEventListener("change", () => this.change({ keyword: input.value }));
    select("星标记录", p.includeStarred ? "include" : "exclude", [["include", "包含星标"], ["exclude", "排除星标"]], value => this.change({ includeStarred: value === "include" }));
    shell.createEl("p", { cls: "ledger-report-period", text: `${snapshot.label} · ${snapshot.range.start} 至 ${snapshot.range.end}${snapshot.range.end !== snapshot.fullRange.end ? "（进行中）" : ""}` });
    shell.createEl("p", { cls: "ledger-report-muted", text: `对比 ${snapshot.previousRange.start} 至 ${snapshot.previousRange.end} · 可用完整历史 ${snapshot.historicalRanges.length} 期${p.category || p.keyword || !p.includeStarred ? " · 局部报告" : ""}` });
    const actions = shell.createDiv({ cls: "ledger-report-actions" });
    const configured = this.plugin.settings.financeAiEnabled && !!this.config().endpoint.trim() && !!this.config().model.trim();
    const generate = createButton(actions, this.loading ? "正在生成…" : cache ? "重新生成报告" : "生成报告");
    generate.disabled = this.loading || !configured;
    generate.addEventListener("click", () => void this.generate(snapshot));
    actions.createSpan({ cls: "ledger-report-muted", text: cache ? `AI 报告 · ${new Date(cache.generatedAt).toLocaleString("zh-CN")}` : configured ? "本地分析 · 点击生成 AI 报告" : "本地分析 · 配置并启用 AI 后可生成完整报告" });
    if (!cache && (this.stale || (this.plugin.settings.reportCaches ?? []).length)) shell.createEl("p", { cls: "ledger-report-status", text: "当前依据没有有效 AI 报告，生成后将使用本次数据。" });
    if (this.error) shell.createEl("p", { cls: "ledger-report-status", text: `${this.error}。当前仍可查看本地分析。` });
    renderReportArticle(shell, cache?.report ?? localSpendingReport(snapshot), snapshot, ids => new ReportEvidenceModal(this.plugin, snapshot, ids, this.openRecord).open());
    const details = shell.createEl("details", { cls: "ledger-report-quality" }); details.createEl("summary", { text: "数据范围与分析口径" });
    details.createEl("p", { text: "缺失日期视为未知；明确零消费账本视为零。笔数是记账记录，不代表杯数、人数或商品单价。按日期分析，不推断小时级购买顺序。" });
    for (const [i, c] of snapshot.coverage.entries()) {
      if (i >= 2 && c.complete) continue;
      details.createEl("p", { text: `${i === 0 ? "本期" : i === 1 ? "基期" : `历史第${i - 1}期`} ${c.range.start} 至 ${c.range.end}：${c.complete ? "账本核验通过" : `缺少 ${c.missingDates.length} 天账本，${c.problems.length} 个异常账本`}` });
      if (c.missingDates.length) details.createEl("p", { cls: "ledger-report-muted", text: c.missingDates.join("、") });
      for (const problem of c.problems) {
        const b = createButton(details, `${problem.date}：${problem.reason}`);
        b.addEventListener("click", () => void this.plugin.app.workspace.openLinkText(problem.path, "", true));
      }
    }
    for (const path of snapshot.undatedPaths) {
      const b = createButton(details, `日期无法识别：${path}`); b.addEventListener("click", () => void this.plugin.app.workspace.openLinkText(path, "", true));
    }
  }
  private async generate(snapshot: ReportSnapshot): Promise<void> {
    if (this.loading || this.disposed) return;
    const config = this.config(), configuration = reportConfiguration(config), controller = new AbortController();
    this.controller = controller; this.loading = true; this.error = ""; this.requestFingerprint = `${snapshot.fingerprint}:${configuration}`; this.redraw();
    try {
      const report = await requestSpendingReport(config, snapshot, controller.signal, sharedRequestGate(`ai:${this.plugin.app.vault.getName()}`));
      if (this.disposed || controller.signal.aborted || this.snapshot().fingerprint !== snapshot.fingerprint || reportConfiguration(this.config()) !== configuration || !this.plugin.settings.financeAiEnabled) return;
      this.plugin.settings.reportCaches = appendReportCache(this.plugin.settings.reportCaches ?? [], { fingerprint: snapshot.fingerprint, configuration, generatedAt: new Date().toISOString(), report });
      await this.plugin.saveSettings(false, false); this.stale = false;
    } catch (error) {
      if (!controller.signal.aborted && !this.disposed) this.error = error instanceof Error ? error.message : "报告生成失败";
    } finally {
      if (this.controller === controller) { this.controller = null; this.loading = false; }
      if (!this.disposed && !controller.signal.aborted) this.redraw();
    }
  }
}

export function renderReportArticle(parent: HTMLElement, report: SpendingReport, snapshot: ReportSnapshot, evidence: (ids: string[]) => void): void {
  const article = parent.createEl("article", { cls: "ledger-report-article" });
  article.createEl("h2", { text: report.title });
  if (report.summary) article.createEl("p", { cls: "ledger-report-summary", text: report.summary });
  report.paragraphs.forEach((p, i) => {
    const section = article.createEl("section");
    if (p.heading) section.createEl("h3", { text: p.heading });
    section.createEl("p", { text: p.text });
    const ids = p.evidenceIds.filter(id => snapshot.evidence.some(e => e.id === id));
    if (!ids.length) return;
    const b = createButton(section, `证据${["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧"][i] ?? i + 1}`); b.addClass("ledger-report-citation");
    b.addEventListener("click", () => evidence(ids));
  });
  if ((!report.paragraphs.length || report.paragraphs.some(p => !p.evidenceIds.some(id => snapshot.evidence.some(e => e.id === id)))) && snapshot.findings.length) {
    const local = article.createEl("details", { cls: "ledger-report-quality" });
    local.createEl("summary", { text: "查看本地分析与证据" });
    snapshot.findings.forEach(f => {
      const b = createButton(local, f.title); b.addClass("ledger-report-citation");
      b.addEventListener("click", () => evidence(f.evidenceIds));
    });
  }
}
