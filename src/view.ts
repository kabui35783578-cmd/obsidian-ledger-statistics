import { ItemView, MarkdownView, Notice, Platform, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type LedgerStatisticsPlugin from "./main";
import {
  AccountingScope,
  CategorySummary,
  DateRange,
  FilterState,
  LedgerRecord,
  addDays,
  categorySummaries,
  compareValue,
  diagnosticsFor,
  filteredRecords,
  formatCents,
  isValidIsoDate,
  monthRange,
  salaryDayRange,
  summarize,
  trendPoints
} from "./core";
import { LedgerViewId } from "./settings";
import { createButton, renderDonut, renderDumbbell, renderEmpty, renderHorizontalBars, renderTrendChart } from "./ui";

export const LEDGER_VIEW_TYPE = "ledger-statistics-view";

const VIEW_NAMES: Array<[LedgerViewId, string]> = [
  ["overview", "总览"], ["category", "分类"], ["trend", "趋势"],
  ["calendar", "日历"], ["details", "明细"], ["compare", "对比"]
];

const AUTO_ADVANCE_SWIPE_DISTANCE = 100;

type DatePreset = "today" | "month" | "previous" | "salary" | "year" | "custom";

type DrillContext = {
  filter: FilterState;
  preset: DatePreset;
  periodOffset: number;
  view: LedgerViewId;
};

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function initialRange(): DateRange {
  const now = new Date();
  return { start: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`, end: todayIso() };
}

function daysInclusive(range: DateRange): number {
  const start = new Date(`${range.start}T12:00:00`);
  const end = new Date(`${range.end}T12:00:00`);
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
}

function cloneFilter(filter: FilterState): FilterState {
  return {
    range: { ...filter.range },
    scope: filter.scope,
    excludedCategories: [...filter.excludedCategories],
    categories: [...filter.categories],
    keyword: filter.keyword
  };
}

function rangeLabel(range: DateRange): string {
  return range.start === range.end ? range.start : `${range.start}–${range.end}`;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function ratioLabel(value: number | "new" | "none"): string {
  if (value === "new") return "新增（基期为零）";
  if (value === "none") return "—（两期均为零）";
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)}%`;
}

function addSelect(parent: HTMLElement, label: string, value: string, options: Array<[string, string]>, onChange: (value: string) => void): HTMLLabelElement {
  const wrapper = parent.createEl("label", { cls: "ledger-field" });
  wrapper.createSpan({ text: label });
  const select = wrapper.createEl("select");
  for (const [optionValue, optionLabel] of options) select.createEl("option", { value: optionValue, text: optionLabel });
  select.value = value;
  select.addEventListener("change", () => onChange(select.value));
  return wrapper;
}

function addDateInput(parent: HTMLElement, label: string, value: string, onChange: (value: string) => void): HTMLLabelElement {
  const wrapper = parent.createEl("label", { cls: "ledger-field" });
  wrapper.createSpan({ text: label });
  const input = wrapper.createEl("input", { type: "date", value });
  input.addEventListener("change", () => onChange(input.value));
  return wrapper;
}

export class LedgerStatisticsView extends ItemView {
  private activeView: LedgerViewId;
  private preset: DatePreset = "month";
  private periodOffset = 0;
  private filter: FilterState;
  private categoryChart: "bar" | "donut" | "table" = "bar";
  private categorySort: "amount" | "count" = "amount";
  private trendChart: "line" | "bar" = "line";
  private trendUnit: "day" | "week" | "month" = "day";
  private detailSort: "newest" | "amount-desc" | "amount-asc" = "newest";
  private compareMode: "auto" | "custom" = "auto";
  private customCurrent: DateRange;
  private customPrevious: DateRange;
  private showDiagnostics = false;
  private filtersExpanded = !Platform.isMobile;
  private drillContext: DrillContext | null = null;
  private pullEligible = false;
  private pullDistance = 0;
  private touchStartY = 0;
  private touchStartX = 0;
  private pullPeakDistance = 0;
  private pullHint: HTMLElement | null = null;
  private settleTimer: number | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: LedgerStatisticsPlugin) {
    super(leaf);
    this.activeView = plugin.settings.defaultView;
    const range = initialRange();
    this.filter = {
      range,
      scope: "consumption",
      excludedCategories: [...plugin.settings.excludedCategories],
      categories: [],
      keyword: ""
    };
    this.customCurrent = { ...range };
    const previousEnd = addDays(range.start, -1);
    this.customPrevious = { start: addDays(previousEnd, -daysInclusive(range) + 1), end: previousEnd };
  }

  getViewType(): string { return LEDGER_VIEW_TYPE; }
  getDisplayText(): string { return "记账统计"; }
  getIcon(): string { return "chart-pie"; }

  async onOpen(): Promise<void> {
    this.containerEl.addClass("ledger-statistics-view");
    this.registerDomEvent(this.contentEl, "touchstart", (event) => this.handleAutoAdvanceTouchStart(event), { passive: true });
    this.registerDomEvent(this.contentEl, "touchmove", (event) => this.handleAutoAdvanceTouchMove(event), { passive: false });
    this.registerDomEvent(this.contentEl, "touchend", () => this.finishPull(false));
    this.registerDomEvent(this.contentEl, "touchcancel", () => this.finishPull(true));
    this.render();
  }

  requestRender(): void {
    this.filter.excludedCategories = [...this.plugin.settings.excludedCategories];
    this.render();
  }

  async onClose(): Promise<void> {
    this.resetAutoAdvanceArm();
  }

  refreshSettings(): void {
    this.filter.excludedCategories = [...this.plugin.settings.excludedCategories];
    this.render();
  }

  render(): void {
    const root = this.contentEl;
    this.resetAutoAdvanceArm();
    this.pullHint = null;
    root.empty();
    if (!this.plugin.repository.loaded) {
      root.createDiv({ cls: "ledger-loading", text: "正在读取记账文件…" });
      return;
    }
    this.renderHeader(root);
    this.renderToolbar(root);
    this.renderTabs(root);
    this.renderDrillBack(root);
    const content = root.createDiv({ cls: "ledger-content" });
    const files = [...this.plugin.repository.files.values()];
    if (files.length === 0) {
      renderEmpty(content, `“${this.plugin.settings.ledgerFolder}”中没有找到 Markdown 记账文件`);
    } else {
      if (this.activeView === "overview") this.renderOverview(content);
      if (this.activeView === "category") this.renderCategory(content);
      if (this.activeView === "trend") this.renderTrend(content);
      if (this.activeView === "calendar") this.renderCalendar(content);
      if (this.activeView === "details") this.renderDetails(content);
      if (this.activeView === "compare") this.renderCompare(content);
    }
    this.renderDiagnostics(root);
    const next = VIEW_NAMES[VIEW_NAMES.findIndex(([id]) => id === this.activeView) + 1];
    if (Platform.isMobile && next) {
      this.pullHint = root.createDiv({ cls: "ledger-pull-hint" });
      this.pullHint.setText(`继续上拉，查看${next[1]}`);
    }
  }

  private renderHeader(root: HTMLElement): void {
    const header = root.createDiv({ cls: "ledger-header" });
    const title = header.createDiv();
    title.createEl("h2", { text: "记账统计" });
    title.createDiv({ cls: "ledger-subtitle", text: "本地只读 · 正文逐笔记录为统计来源" });
    const scope = header.createDiv({ cls: `ledger-scope-badge is-${this.filter.scope}` });
    scope.setText(this.filter.scope === "consumption" ? "当前口径：消费支出" : "当前口径：全部支出");
  }

  private renderToolbar(root: HTMLElement): void {
    const panel = root.createEl("details", { cls: "ledger-filter-panel" });
    panel.open = this.filtersExpanded;
    const summary = panel.createEl("summary", { cls: "ledger-filter-summary" });
    const summaryIcon = summary.createSpan({ cls: "ledger-filter-summary-icon" });
    setIcon(summaryIcon, "sliders-horizontal");
    const summaryCopy = summary.createSpan({ cls: "ledger-filter-summary-copy" });
    summaryCopy.createEl("strong", { text: "筛选条件" });
    const categoryLabel = this.filter.categories[0] ?? "全部分类";
    const scopeLabel = this.filter.scope === "consumption" ? "消费支出" : "全部支出";
    const dateLabel = this.filter.range.start === this.filter.range.end ? this.filter.range.start.slice(5).replace("-", ".") : `${this.filter.range.start.slice(5).replace("-", ".")}–${this.filter.range.end.slice(5).replace("-", ".")}`;
    summaryCopy.createSpan({ text: `${dateLabel} · ${scopeLabel} · ${categoryLabel}` });
    const summaryChevron = summary.createSpan({ cls: "ledger-filter-summary-chevron" });
    setIcon(summaryChevron, "chevron-down");
    panel.addEventListener("toggle", () => { this.filtersExpanded = panel.open; });

    const toolbar = panel.createDiv({ cls: "ledger-toolbar" });
    const timeControls = toolbar.createDiv({ cls: "ledger-time-controls" });
    addSelect(timeControls, "时间", this.preset, [["today", "今天"], ["month", "本月"], ["previous", "上月"], ["salary", "工资日"], ["year", "今年"], ["custom", "自定义"]], (value) => {
      this.applyPreset(value as DatePreset);
      this.render();
    });
    const periodName = this.preset === "today" ? "天" : this.preset === "year" ? "年" : this.preset === "salary" ? "工资周期" : "月";
    const previousPeriod = timeControls.createEl("button", {
      cls: "ledger-button ledger-period-button",
      attr: { type: "button", title: `切换到上一个${periodName}`, "aria-label": `切换到上一个${periodName}` }
    });
    const previousPeriodIcon = previousPeriod.createSpan({ cls: "ledger-period-icon" });
    setIcon(previousPeriodIcon, "chevron-left");
    previousPeriod.disabled = this.preset === "custom";
    previousPeriod.addEventListener("click", () => this.shiftPeriod(1));
    const nextPeriod = timeControls.createEl("button", {
      cls: "ledger-button ledger-period-button",
      attr: { type: "button", title: `返回下一个${periodName}`, "aria-label": `返回下一个${periodName}` }
    });
    const nextPeriodIcon = nextPeriod.createSpan({ cls: "ledger-period-icon" });
    setIcon(nextPeriodIcon, "chevron-right");
    nextPeriod.disabled = this.preset === "custom";
    nextPeriod.addEventListener("click", () => this.shiftPeriod(-1));
    const dates = toolbar.createDiv({ cls: "ledger-date-range", attr: { "aria-label": "日期范围" } });
    addDateInput(dates, "开始", this.filter.range.start, (value) => {
      if (isValidIsoDate(value) && value <= this.filter.range.end) {
        this.clearDrillContext();
        this.preset = "custom";
        this.periodOffset = 0;
        this.filter.range.start = value;
        this.render();
      }
    });
    addDateInput(dates, "结束", this.filter.range.end, (value) => {
      if (isValidIsoDate(value) && value >= this.filter.range.start) {
        this.clearDrillContext();
        this.preset = "custom";
        this.periodOffset = 0;
        this.filter.range.end = value;
        this.render();
      }
    });
    addSelect(toolbar, "口径", this.filter.scope, [["consumption", "消费支出"], ["all", "全部支出"]], (value) => {
      this.clearDrillContext();
      this.filter.scope = value as AccountingScope;
      this.render();
    });
    const categories = this.allCategories();
    addSelect(toolbar, "分类", this.filter.categories[0] ?? "", [["", "全部分类"], ...categories.map((category) => [category, category] as [string, string])], (value) => {
      this.clearDrillContext();
      this.filter.categories = value ? [value] : [];
      this.render();
    });
    const refresh = toolbar.createEl("button", { cls: "ledger-button ledger-refresh-button" });
    const refreshIcon = refresh.createSpan({ cls: "ledger-refresh-icon" });
    setIcon(refreshIcon, "refresh-cw");
    refresh.createSpan({ cls: "ledger-refresh-text", text: "刷新数据" });
    refresh.addEventListener("click", async () => {
      refresh.disabled = true;
      refresh.addClass("is-refreshing");
      try {
        await this.plugin.repository.rescan();
        new Notice("记账统计已刷新");
      } finally {
        refresh.disabled = false;
        refresh.removeClass("is-refreshing");
      }
    });
  }

  private renderTabs(root: HTMLElement): void {
    const nav = root.createDiv({ cls: "ledger-tabs", attr: { role: "tablist", "aria-label": "统计视图" } });
    for (const [id, name] of VIEW_NAMES) {
      const button = createButton(nav, name, id === this.activeView);
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(id === this.activeView));
      button.addEventListener("click", () => {
        if (this.activeView === id) return;
        this.activeView = id;
        this.resetAutoAdvanceArm();
        this.render();
        this.contentEl.scrollTop = 0;
      });
    }
  }

  private renderDrillBack(root: HTMLElement): void {
    if (!this.drillContext) return;
    const banner = root.createDiv({ cls: "ledger-drill-back" });
    const copy = banner.createDiv({ cls: "ledger-drill-back-copy" });
    copy.createDiv({ cls: "ledger-drill-back-label", text: "正在查看下钻明细" });
    copy.createDiv({ cls: "ledger-drill-back-range", text: `原筛选：${rangeLabel(this.drillContext.filter.range)}` });
    const back = createButton(banner, "返回上一级");
    back.addClass("ledger-drill-back-button");
    setIcon(back.createSpan({ cls: "ledger-drill-back-icon" }), "arrow-left");
    back.addEventListener("click", () => this.restoreDrillContext());
  }

  private renderOverview(parent: HTMLElement): void {
    const files = [...this.plugin.repository.files.values()];
    const records = filteredRecords(files, this.filter);
    const stats = summarize(files, records, this.filter.range);
    const metrics = parent.createDiv({ cls: "ledger-metrics" });
    this.metric(metrics, "所选期间总额", formatCents(stats.cents), `${stats.count} 笔`, () => this.goDetails());
    this.metric(metrics, "笔数", String(stats.count), "点击查看全部明细", () => this.goDetails());
    this.metric(metrics, "日均", formatCents(stats.averagePerRecordedDayCents), `分母：${stats.recordedDays} 个有日记账文件的日期`, () => this.goDetails());
    this.metric(metrics, "最大单笔", stats.maxRecord ? formatCents(stats.maxRecord.cents) : "—", stats.maxRecord ? `${stats.maxRecord.category} · ${stats.maxRecord.date}` : "暂无记录", () => this.goDetails());
    if (records.length === 0) {
      renderEmpty(parent, "当前筛选条件下没有记录。缺少文件的日期不会按零消费处理。");
      return;
    }
    const grid = parent.createDiv({ cls: "ledger-overview-grid" });
    renderHorizontalBars(grid, categorySummaries(records).slice(0, 8), (category) => this.drillCategory(category));
    renderTrendChart(grid, trendPoints(records, this.rangeTrendUnit()), "line", (point) => this.drillRange({ start: point.start, end: point.end }));
  }

  private renderCategory(parent: HTMLElement): void {
    const controls = parent.createDiv({ cls: "ledger-section-controls" });
    addSelect(controls, "显示", this.categoryChart, [["bar", "横向条形图"], ["donut", "环形图"], ["table", "汇总表"]], (value) => {
      this.categoryChart = value as "bar" | "donut" | "table";
      this.render();
    });
    addSelect(controls, "排序", this.categorySort, [["amount", "按金额"], ["count", "按笔数"]], (value) => {
      this.categorySort = value as "amount" | "count";
      this.render();
    });
    const records = filteredRecords(this.plugin.repository.files.values(), this.filter);
    const summaries = categorySummaries(records, this.categorySort);
    if (this.categoryChart === "bar") renderHorizontalBars(parent, summaries, (category) => this.drillCategory(category));
    if (this.categoryChart === "donut") renderDonut(parent, summaries, (category) => this.drillCategory(category));
    if (this.categoryChart === "table") this.renderCategoryTable(parent, summaries);
  }

  private renderCategoryTable(parent: HTMLElement, summaries: CategorySummary[]): void {
    if (summaries.length === 0) return renderEmpty(parent, "当前筛选条件下没有分类数据");
    const wrap = parent.createDiv({ cls: "ledger-table-wrap" });
    const table = wrap.createEl("table", { cls: "ledger-table" });
    const head = table.createTHead().insertRow();
    ["分类", "金额", "占比", "笔数"].forEach((text) => head.createEl("th", { text }));
    const body = table.createTBody();
    for (const item of summaries) {
      const row = body.insertRow();
      row.addEventListener("click", () => this.drillCategory(item.category));
      row.createEl("td", { text: item.category });
      row.createEl("td", { text: formatCents(item.cents) });
      row.createEl("td", { text: pct(item.share) });
      row.createEl("td", { text: String(item.count) });
    }
  }

  private renderTrend(parent: HTMLElement): void {
    const controls = parent.createDiv({ cls: "ledger-section-controls" });
    addSelect(controls, "图形", this.trendChart, [["line", "折线图"], ["bar", "柱状图"]], (value) => {
      this.trendChart = value as "line" | "bar";
      this.render();
    });
    addSelect(controls, "汇总", this.trendUnit, [["day", "按日"], ["week", "按周"], ["month", "按月"]], (value) => {
      this.trendUnit = value as "day" | "week" | "month";
      this.render();
    });
    const records = filteredRecords(this.plugin.repository.files.values(), this.filter);
    renderTrendChart(parent, trendPoints(records, this.trendUnit), this.trendChart, (point) => this.drillRange({ start: point.start, end: point.end }));
    parent.createDiv({ cls: "ledger-note", text: this.filter.categories.length ? `当前只显示分类：${this.filter.categories[0]}` : "当前显示全部分类；可在顶部选择指定分类。" });
  }

  private renderCalendar(parent: HTMLElement): void {
    const endDate = new Date(`${this.filter.range.end}T12:00:00`);
    const year = endDate.getFullYear();
    const month = endDate.getMonth();
    const range = monthRange(year, month);
    const header = parent.createDiv({ cls: "ledger-calendar-header" });
    const previous = createButton(header, "‹");
    previous.setAttribute("aria-label", "上个月");
    header.createEl("h3", { text: `${year} 年 ${month + 1} 月` });
    const next = createButton(header, "›");
    next.setAttribute("aria-label", "下个月");
    previous.addEventListener("click", () => this.setCalendarMonth(year, month - 1));
    next.addEventListener("click", () => this.setCalendarMonth(year, month + 1));

    const allFiles = [...this.plugin.repository.files.values()];
    const fileDates = new Set(allFiles.map((file) => file.date).filter((date): date is string => date !== null));
    const monthFilter: FilterState = { ...this.filter, range };
    const records = filteredRecords(allFiles, monthFilter);
    const amounts = new Map<string, number>();
    for (const record of records) amounts.set(record.date, (amounts.get(record.date) ?? 0) + record.cents);
    const max = Math.max(...amounts.values(), 1);
    const calendar = parent.createDiv({ cls: "ledger-calendar", attr: { role: "grid" } });
    ["一", "二", "三", "四", "五", "六", "日"].forEach((day) => calendar.createDiv({ cls: "ledger-calendar-weekday", text: day }));
    const first = new Date(year, month, 1, 12);
    const lead = (first.getDay() + 6) % 7;
    for (let index = 0; index < lead; index += 1) calendar.createDiv({ cls: "ledger-calendar-spacer" });
    const days = new Date(year, month + 1, 0, 12).getDate();
    for (let day = 1; day <= days; day += 1) {
      const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const hasFile = fileDates.has(iso);
      const amount = amounts.get(iso) ?? 0;
      const level = hasFile ? Math.min(6, Math.ceil(amount / max * 6)) : 0;
      const cell = calendar.createEl("button", { cls: `ledger-calendar-day ${hasFile ? `has-record is-level-${level}` : "is-missing"}` });
      cell.type = "button";
      cell.createSpan({ cls: "ledger-calendar-number", text: String(day) });
      cell.createSpan({ cls: "ledger-calendar-amount", text: hasFile ? formatCents(amount) : "无记录" });
      cell.setAttribute("aria-label", `${iso}，${hasFile ? amount === 0 ? "有记录文件，金额为零" : formatCents(amount) : "没有记录文件"}`);
      cell.addEventListener("click", () => this.drillRange({ start: iso, end: iso }));
    }
    parent.createDiv({ cls: "ledger-calendar-legend", text: "浅色到深色表示当月支出由低到高；斜纹为没有日记账文件，“¥0.00”为有文件但当前口径金额为零。" });
  }

  private renderDetails(parent: HTMLElement): void {
    const controls = parent.createDiv({ cls: "ledger-section-controls ledger-detail-controls" });
    const searchLabel = controls.createEl("label", { cls: "ledger-field ledger-search" });
    searchLabel.createSpan({ text: "搜索" });
    const search = searchLabel.createEl("input", { type: "search", placeholder: "日期、分类或备注", value: this.filter.keyword });
    let timer: number | null = null;
    search.addEventListener("input", () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => { this.filter.keyword = search.value; this.render(); }, 180);
    });
    addSelect(controls, "排序", this.detailSort, [["newest", "日期最新"], ["amount-desc", "金额从高到低"], ["amount-asc", "金额从低到高"]], (value) => {
      this.detailSort = value as "newest" | "amount-desc" | "amount-asc";
      this.render();
    });
    let records = filteredRecords(this.plugin.repository.files.values(), this.filter);
    records = this.sortDetails(records);
    parent.createDiv({ cls: "ledger-results-count", text: `共 ${records.length} 笔` });
    if (records.length === 0) return renderEmpty(parent, this.filter.keyword || this.filter.categories.length ? "筛选后没有匹配记录" : "所选期间没有可解析记录");
    const tableWrap = parent.createDiv({ cls: "ledger-table-wrap ledger-details-table" });
    const table = tableWrap.createEl("table", { cls: "ledger-table" });
    const head = table.createTHead().insertRow();
    ["日期", "时间", "分类", "金额", "备注", "来源"].forEach((text) => head.createEl("th", { text }));
    const body = table.createTBody();
    for (const record of records) {
      const row = body.insertRow();
      row.createEl("td", { text: record.date });
      row.createEl("td", { text: record.time });
      row.createEl("td", { text: record.category });
      row.createEl("td", { text: formatCents(record.cents) });
      row.createEl("td", { text: record.note || "—" });
      const source = row.createEl("td").createEl("button", { cls: "ledger-link-button", text: `第 ${record.line} 行` });
      source.addEventListener("click", () => void this.openRecord(record));
    }
    const cards = parent.createDiv({ cls: "ledger-detail-cards" });
    for (const record of records) {
      const card = cards.createDiv({ cls: "ledger-detail-card" });
      const top = card.createDiv({ cls: "ledger-detail-card-top" });
      top.createSpan({ text: `${record.date} · ${record.time}` });
      top.createEl("strong", { text: formatCents(record.cents) });
      card.createDiv({ cls: "ledger-detail-category", text: record.category });
      if (record.note) card.createDiv({ text: record.note });
      const footer = card.createDiv({ cls: "ledger-detail-card-footer" });
      const source = footer.createEl("button", { cls: "ledger-link-button ledger-source-button", text: `打开来源 · 第 ${record.line} 行` });
      source.addEventListener("click", () => void this.openRecord(record));
    }
  }

  private renderCompare(parent: HTMLElement): void {
    const controls = parent.createDiv({ cls: "ledger-section-controls" });
    addSelect(controls, "比较方式", this.compareMode, [["auto", "按所选期间自动比较"], ["custom", "两个自定义期间"]], (value) => {
      this.compareMode = value as "auto" | "custom";
      this.render();
    });
    let current: DateRange;
    let previous: DateRange;
    let description: string;
    if (this.compareMode === "custom") {
      const dates = controls.createDiv({ cls: "ledger-compare-dates" });
      addDateInput(dates, "本期开始", this.customCurrent.start, (value) => { if (isValidIsoDate(value)) { this.customCurrent.start = value; this.render(); } });
      addDateInput(dates, "本期结束", this.customCurrent.end, (value) => { if (isValidIsoDate(value)) { this.customCurrent.end = value; this.render(); } });
      addDateInput(dates, "基期开始", this.customPrevious.start, (value) => { if (isValidIsoDate(value)) { this.customPrevious.start = value; this.render(); } });
      addDateInput(dates, "基期结束", this.customPrevious.end, (value) => { if (isValidIsoDate(value)) { this.customPrevious.end = value; this.render(); } });
      current = this.customCurrent;
      previous = this.customPrevious;
      description = "自定义期间比较";
    } else {
      ({ current, previous, description } = this.autoComparisonRanges());
    }
    if (current.start > current.end || previous.start > previous.end) return renderEmpty(parent, "比较日期范围无效：开始日期不能晚于结束日期");
    parent.createDiv({ cls: "ledger-note", text: `${description}：本期 ${current.start} 至 ${current.end}；基期 ${previous.start} 至 ${previous.end}` });
    const files = [...this.plugin.repository.files.values()];
    const currentRecords = filteredRecords(files, { ...this.filter, range: current, keyword: "" });
    const previousRecords = filteredRecords(files, { ...this.filter, range: previous, keyword: "" });
    const total = compareValue(currentRecords.reduce((sum, record) => sum + record.cents, 0), previousRecords.reduce((sum, record) => sum + record.cents, 0));
    const cards = parent.createDiv({ cls: "ledger-compare-summary" });
    this.metric(cards, "本期", formatCents(total.currentCents), `${currentRecords.length} 笔`);
    this.metric(cards, "基期", formatCents(total.previousCents), `${previousRecords.length} 笔`);
    this.metric(cards, "金额差额", formatCents(total.differenceCents), "本期减基期");
    this.metric(cards, "变化比例", ratioLabel(total.ratio), total.ratio === "new" ? "基期为零，不计算百分比" : "以基期为分母");
    const currentMap = new Map(categorySummaries(currentRecords).map((item) => [item.category, item]));
    const previousMap = new Map(categorySummaries(previousRecords).map((item) => [item.category, item]));
    const categories = [...new Set([...currentMap.keys(), ...previousMap.keys()])].sort((a, b) => (currentMap.get(b)?.cents ?? 0) - (currentMap.get(a)?.cents ?? 0));
    if (categories.length === 0) return renderEmpty(parent, "两个期间都没有匹配记录");
    renderDumbbell(parent, categories.map((category) => ({
      category,
      currentCents: currentMap.get(category)?.cents ?? 0,
      previousCents: previousMap.get(category)?.cents ?? 0
    })), "本期", "基期", (category) => this.drillCategory(category));
    const wrap = parent.createDiv({ cls: "ledger-table-wrap" });
    const table = wrap.createEl("table", { cls: "ledger-table" });
    const head = table.createTHead().insertRow();
    ["分类", "本期", "基期", "差额", "变化"].forEach((text) => head.createEl("th", { text }));
    const body = table.createTBody();
    for (const category of categories) {
      const currentCents = currentMap.get(category)?.cents ?? 0;
      const previousCents = previousMap.get(category)?.cents ?? 0;
      const value = compareValue(currentCents, previousCents);
      const row = body.insertRow();
      row.addEventListener("click", () => this.drillCategory(category));
      row.createEl("td", { text: category });
      row.createEl("td", { text: formatCents(currentCents) });
      row.createEl("td", { text: formatCents(previousCents) });
      row.createEl("td", { text: formatCents(value.differenceCents) });
      row.createEl("td", { text: ratioLabel(value.ratio) });
    }
  }

  private renderDiagnostics(root: HTMLElement): void {
    const diagnostics = diagnosticsFor(this.plugin.repository.files.values());
    const section = root.createDiv({ cls: "ledger-diagnostics" });
    const toggle = createButton(section, diagnostics.length ? `数据核验：${diagnostics.length} 项需注意` : "数据核验：未发现异常", this.showDiagnostics);
    toggle.addEventListener("click", () => { this.showDiagnostics = !this.showDiagnostics; this.render(); });
    if (!this.showDiagnostics) return;
    const panel = section.createDiv({ cls: "ledger-diagnostics-panel" });
    if (diagnostics.length === 0) return renderEmpty(panel, "所有正文合计均与可解析的 frontmatter total 一致，且未发现解析异常。" );
    for (const item of diagnostics) {
      const row = panel.createDiv({ cls: `ledger-diagnostic is-${item.kind}` });
      row.createDiv({ cls: "ledger-diagnostic-title", text: `${item.path}${item.line ? `:${item.line}` : ""}` });
      row.createDiv({ text: item.reason });
      if (item.source) row.createEl("code", { text: item.source });
      const button = row.createEl("button", { cls: "ledger-link-button", text: "打开来源" });
      button.addEventListener("click", () => void this.openPath(item.path, item.line));
    }
  }

  private metric(parent: HTMLElement, label: string, value: string, detail: string, onClick?: () => void): void {
    const card = parent.createEl(onClick ? "button" : "div", { cls: "ledger-metric" });
    card.createDiv({ cls: "ledger-metric-label", text: label });
    card.createDiv({ cls: "ledger-metric-value", text: value });
    card.createDiv({ cls: "ledger-metric-detail", text: detail });
    if (onClick) card.addEventListener("click", onClick);
  }

  private applyPreset(preset: DatePreset): void {
    this.clearDrillContext();
    this.preset = preset;
    this.periodOffset = 0;
    const now = new Date();
    this.filter.range = this.rangeForPreset(preset, now, this.periodOffset);
  }

  private shiftPeriod(direction: 1 | -1): void {
    if (this.preset === "custom") return;
    this.clearDrillContext();
    this.periodOffset += direction;
    this.filter.range = this.rangeForPreset(this.preset, new Date(), this.periodOffset);
    this.render();
  }

  private rangeForPreset(preset: DatePreset, now: Date, offset: number): DateRange {
    if (preset === "today") {
      const date = addDays(todayIso(), -offset);
      return { start: date, end: date };
    }
    if (preset === "month") return monthRange(now.getFullYear(), now.getMonth() - offset);
    if (preset === "previous") return monthRange(now.getFullYear(), now.getMonth() - 1 - offset);
    if (preset === "salary") return salaryDayRange(now, offset);
    if (preset === "year") {
      const year = now.getFullYear() - offset;
      return { start: `${year}-01-01`, end: offset === 0 ? todayIso() : `${year}-12-31` };
    }
    return { ...this.filter.range };
  }

  private allCategories(): string[] {
    return [...new Set([...this.plugin.repository.files.values()].flatMap((file) => file.records.map((record) => record.category)))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  }

  private goDetails(): void {
    this.activeView = "details";
    this.render();
  }

  private drillCategory(category: string): void {
    this.captureDrillContext();
    this.filter.categories = [category];
    this.activeView = "details";
    this.render();
  }

  private drillRange(range: DateRange): void {
    this.captureDrillContext();
    this.filter.range = range;
    this.preset = "custom";
    this.periodOffset = 0;
    this.activeView = "details";
    this.render();
  }

  private rangeTrendUnit(): "day" | "week" | "month" {
    const days = daysInclusive(this.filter.range);
    return days <= 45 ? "day" : days <= 240 ? "week" : "month";
  }

  private setCalendarMonth(year: number, month: number): void {
    this.clearDrillContext();
    this.filter.range = monthRange(year, month);
    this.preset = "custom";
    this.periodOffset = 0;
    this.render();
  }

  private captureDrillContext(): void {
    if (this.drillContext) return;
    this.drillContext = {
      filter: cloneFilter(this.filter),
      preset: this.preset,
      periodOffset: this.periodOffset,
      view: this.activeView
    };
  }

  private restoreDrillContext(): void {
    if (!this.drillContext) return;
    const context = this.drillContext;
    this.filter = cloneFilter(context.filter);
    this.preset = context.preset;
    this.periodOffset = context.periodOffset;
    this.activeView = context.view;
    this.drillContext = null;
    this.render();
  }

  private clearDrillContext(): void {
    this.drillContext = null;
  }

  private handleAutoAdvanceTouchStart(event: TouchEvent): void {
    // A new touch cancels even a previously confirmed, delayed page switch.
    this.resetAutoAdvanceArm();
    if (!Platform.isMobile || event.touches.length !== 1 || !this.pullHint) return;
    const target = event.target;
    if (target instanceof Element && target.closest("button, input, select, textarea, a, svg, .ledger-mobile-trend-scroll, .ledger-tabs, .ledger-header, .ledger-toolbar, .ledger-filter-panel")) {
      this.pullEligible = false;
      return;
    }
    this.touchStartY = event.touches[0].clientY;
    this.touchStartX = event.touches[0].clientX;
    // Only a new gesture that STARTS at the bottom may switch views.
    const maxScroll = this.contentEl.scrollHeight - this.contentEl.clientHeight;
    if (maxScroll > 6) {
      this.pullEligible = maxScroll - this.contentEl.scrollTop <= 6;
    } else {
      const rect = this.contentEl.getBoundingClientRect();
      const relativeY = event.touches[0].clientY - rect.top;
      this.pullEligible = relativeY > rect.height * 0.6;
    }
  }

  private handleAutoAdvanceTouchMove(event: TouchEvent): void {
    if (!this.pullEligible) return;
    if (event.touches.length !== 1) { this.resetAutoAdvanceArm(); return; }
    const dy = this.touchStartY - event.touches[0].clientY;
    const dx = Math.abs(this.touchStartX - event.touches[0].clientX);
    this.pullPeakDistance = Math.max(this.pullPeakDistance, dy);
    if (dy < -8 || this.pullPeakDistance - dy > 8 || dx > Math.max(18, Math.abs(dy))) {
      this.resetAutoAdvanceArm();
      return;
    }
    this.pullDistance = Math.max(0, dy);
    if (this.pullDistance > 8 && event.cancelable) event.preventDefault();
    const next = VIEW_NAMES[VIEW_NAMES.findIndex(([id]) => id === this.activeView) + 1];
    if (!next || !this.pullHint) return;
    this.contentEl.addClass("ledger-is-pulling");
    this.contentEl.style.setProperty("--ledger-pull", `${-Math.min(48, this.pullDistance * 0.32)}px`);
    this.pullHint.style.setProperty("--pull-progress", String(Math.min(1, this.pullDistance / AUTO_ADVANCE_SWIPE_DISTANCE)));
    this.pullHint.setText(this.pullDistance >= AUTO_ADVANCE_SWIPE_DISTANCE
      ? `松手切换到${next[1]}` : `继续上拉，查看${next[1]}`);
  }

  private finishPull(cancelled: boolean): void {
    if (this.settleTimer !== null) return;
    const next = VIEW_NAMES[VIEW_NAMES.findIndex(([id]) => id === this.activeView) + 1];
    const advance = !cancelled && this.pullEligible && this.pullDistance >= AUTO_ADVANCE_SWIPE_DISTANCE;
    this.resetAutoAdvanceArm();
    if (advance && next) {
      this.pullHint?.setText(`回弹后进入${next[1]}`);
      // Keep the current content mounted for its 320ms return transition.
      this.settleTimer = window.setTimeout(() => {
        this.settleTimer = null;
        this.activeView = next[0];
        this.render();
        this.contentEl.scrollTop = 0;
      }, 360);
    }
  }

  private resetAutoAdvanceArm(): void {
    if (this.settleTimer !== null) {
      window.clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
    this.pullEligible = false;
    this.pullDistance = 0;
    this.pullPeakDistance = 0;
    this.contentEl.removeClass("ledger-is-pulling");
    this.contentEl.style.setProperty("--ledger-pull", "0px");
    if (this.pullHint) {
      const next = VIEW_NAMES[VIEW_NAMES.findIndex(([id]) => id === this.activeView) + 1];
      this.pullHint.style.setProperty("--pull-progress", "0");
      if (next) this.pullHint.setText(`继续上拉，查看${next[1]}`);
    }
  }

  private sortDetails(records: LedgerRecord[]): LedgerRecord[] {
    const copy = [...records];
    if (this.detailSort === "amount-desc") return copy.sort((a, b) => b.cents - a.cents || b.date.localeCompare(a.date));
    if (this.detailSort === "amount-asc") return copy.sort((a, b) => a.cents - b.cents || b.date.localeCompare(a.date));
    return copy.sort((a, b) => b.date.localeCompare(a.date) || b.line - a.line);
  }

  private autoComparisonRanges(): { current: DateRange; previous: DateRange; description: string } {
    const current = { ...this.filter.range };
    const today = todayIso();
    const currentMonthStart = `${today.slice(0, 7)}-01`;
    if (current.start === currentMonthStart && current.end === today) {
      const date = new Date(`${current.start}T12:00:00`);
      const previousFull = monthRange(date.getFullYear(), date.getMonth() - 1);
      const sameDay = Math.min(Number(today.slice(8, 10)), Number(previousFull.end.slice(8, 10)));
      return {
        current,
        previous: { start: previousFull.start, end: `${previousFull.start.slice(0, 8)}${String(sameDay).padStart(2, "0")}` },
        description: "进行中月份默认同期比较"
      };
    }
    const previousEnd = addDays(current.start, -1);
    return {
      current,
      previous: { start: addDays(previousEnd, -daysInclusive(current) + 1), end: previousEnd },
      description: "按相同天数的紧邻上一期间比较"
    };
  }

  private async openRecord(record: LedgerRecord): Promise<void> {
    await this.openPath(record.path, record.line);
  }

  private async openPath(path: string, line?: number): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(`找不到来源文件：${path}`);
      return;
    }
    await this.app.workspace.getLeaf("tab").openFile(file);
    if (line) {
      window.requestAnimationFrame(() => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view) {
          view.editor.setCursor({ line: Math.max(0, line - 1), ch: 0 });
          view.editor.scrollIntoView({ from: { line: Math.max(0, line - 2), ch: 0 }, to: { line, ch: 0 } }, true);
        }
      });
    }
  }
}
