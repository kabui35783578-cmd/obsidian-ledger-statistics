import { App, Modal } from "obsidian";
import { DateRange, FilterState, formatCents, LedgerRecord, ParsedLedgerFile, recordMatches, summarize, SummaryStats } from "./core";
import { styleLedgerModal } from "./ui-surface";

export type OverviewMetric = "spending" | "count" | "average" | "largest";

export interface OverviewGroup {
  label: string;
  cents: number;
  records: LedgerRecord[];
}

export interface OverviewDetails {
  range: DateRange;
  stats: SummaryStats;
  categories: OverviewGroup[];
  days: OverviewGroup[];
  ranked: LedgerRecord[];
  missingDays: number;
  filterDescription: string;
}

const byAmount = (a: LedgerRecord, b: LedgerRecord): number => b.cents - a.cents || b.date.localeCompare(a.date) || b.time.localeCompare(a.time) || a.id.localeCompare(b.id);

/** Reuse the overview's filters and denominator so each card explains its headline exactly. */
export function buildOverviewDetails(files: ParsedLedgerFile[], filter: FilterState): OverviewDetails {
  const records = files.flatMap(file => file.records).filter(record => recordMatches(record, filter));
  const stats = summarize(files, records, filter.range);
  const categories = new Map<string, OverviewGroup>();
  const days = new Map<string, OverviewGroup>();
  for (const file of files) {
    if (file.date && file.date >= filter.range.start && file.date <= filter.range.end) days.set(file.date, { label: file.date, cents: 0, records: [] });
  }
  for (const record of records) {
    for (const [map, key] of [[categories, record.category], [days, record.date]] as const) {
      const group = map.get(key) ?? { label: key, cents: 0, records: [] };
      group.cents += record.cents;
      group.records.push(record);
      map.set(key, group);
    }
  }
  const categoryGroups = [...categories.values()].sort((a, b) => b.cents - a.cents || a.label.localeCompare(b.label, "zh-CN"));
  categoryGroups.forEach(group => group.records.sort(byAmount));
  const dayGroups = [...days.values()].sort((a, b) => b.cents - a.cents || b.label.localeCompare(a.label));
  dayGroups.forEach(group => group.records.sort(byAmount));
  const calendarDays = Math.max(0, Math.round((Date.parse(`${filter.range.end}T00:00:00Z`) - Date.parse(`${filter.range.start}T00:00:00Z`)) / 86400000) + 1);
  return {
    range: { ...filter.range }, stats, categories: categoryGroups, days: dayGroups, ranked: [...records].sort(byAmount),
    missingDays: Math.max(0, calendarDays - stats.recordedDays),
    filterDescription: [filter.scope === "consumption" ? "消费支出" : "全部支出", filter.categories.length ? filter.categories.join("、") : "全部分类", filter.keyword ? `关键词：${filter.keyword}` : ""].filter(Boolean).join(" · ")
  };
}

const TITLES: Record<OverviewMetric, string> = { spending: "所选期间花费", count: "分类笔数排行", average: "日均支出拆解", largest: "单笔消费排行" };

export class OverviewMetricModal extends Modal {
  constructor(app: App, private metric: OverviewMetric, private data: OverviewDetails, private openRecord: (record: LedgerRecord) => void) { super(app); }

  onOpen(): void {
    styleLedgerModal(this);
    this.modalEl.addClass("ledger-overview-modal");
    this.setTitle(TITLES[this.metric]);
    const root = this.contentEl;
    root.empty();
    const data = this.data;
    root.createDiv({ cls: "ledger-note", text: `${data.range.start} — ${data.range.end} · ${data.filterDescription}` });
    const hero = root.createDiv({ cls: "ledger-overview-detail-hero" });
    const noValue = (this.metric === "average" && !data.stats.recordedDays) || (this.metric === "largest" && !data.ranked.length);
    hero.createEl("strong", { text: noValue ? "—" : this.metric === "count" ? `${data.stats.count} 笔` : formatCents(this.metric === "average" ? data.stats.averagePerRecordedDayCents : this.metric === "largest" ? data.ranked[0]?.cents ?? 0 : data.stats.cents) });
    hero.createDiv({ cls: "ledger-note", text: this.metric === "count" ? `共 ${data.categories.length} 个分类 · 按笔数从多到少`
      : this.metric === "average" ? data.stats.recordedDays ? `${formatCents(data.stats.cents)} ÷ ${data.stats.recordedDays} 个有账本的日期 = ${formatCents(data.stats.averagePerRecordedDayCents)}` : "所选期间没有日记账文件，暂不计算日均"
      : this.metric === "largest" ? `共 ${data.ranked.length} 笔 · 按单笔金额从高到低` : `${data.stats.count} 笔 · 每个分类展示金额最高的 5 笔` });
    if (this.metric === "average") {
      root.createDiv({ cls: "ledger-overview-detail-explanation", text: `按每天花费从高到低排列，可展开查看当天的大额消费。有账本但没有匹配消费的日期计为 0 元。${data.missingDays ? `所选期间另有 ${data.missingDays} 天没有账本，未计入日均分母。` : ""}` });
    }
    if (!data.ranked.length && this.metric !== "average") {
      root.createDiv({ cls: "ledger-empty", text: "当前期间和筛选条件下没有消费记录。" });
      return;
    }
    if (this.metric === "spending") {
      for (const group of data.categories) {
        const section = root.createDiv({ cls: "ledger-overview-detail-category" });
        const heading = section.createDiv({ cls: "ledger-overview-detail-heading" });
        heading.createEl("h3", { text: group.label });
        heading.createSpan({ text: `${formatCents(group.cents)} · ${group.records.length} 笔` });
        this.recordList(section, group.records.slice(0, 5));
      }
    } else if (this.metric === "count") {
      const groups = [...data.categories].sort((a, b) => b.records.length - a.records.length || b.cents - a.cents || a.label.localeCompare(b.label, "zh-CN"));
      groups.forEach((group, index) => {
        const row = root.createDiv({ cls: "ledger-overview-detail-count-row" });
        row.createSpan({ cls: "ledger-overview-detail-rank", text: String(index + 1).padStart(2, "0") });
        const copy = row.createDiv({ cls: "ledger-overview-detail-copy" });
        copy.createEl("strong", { text: group.label });
        copy.createEl("small", { text: `${formatCents(group.cents)} · 占总笔数 ${(group.records.length / data.stats.count * 100).toFixed(1)}%` });
        const track = copy.createDiv({ cls: "ledger-overview-detail-track" });
        track.createDiv({ attr: { style: `width:${group.records.length / groups[0].records.length * 100}%` } });
        row.createEl("strong", { text: `${group.records.length} 笔` });
      });
    } else if (this.metric === "average") {
      if (!data.days.length) root.createDiv({ cls: "ledger-empty", text: "所选期间没有日记账文件，暂无日均拆解。" });
      data.days.forEach((day, index) => {
        const details = root.createEl("details", { cls: "ledger-overview-detail-day" });
        const row = details.createEl("summary", { cls: "ledger-overview-detail-day-summary" });
        row.createSpan({ cls: "ledger-overview-detail-rank", text: String(index + 1).padStart(2, "0") });
        const copy = row.createDiv({ cls: "ledger-overview-detail-copy" });
        copy.createEl("strong", { text: day.label });
        copy.createEl("small", { text: `${day.records.length} 笔${day.cents > data.stats.averagePerRecordedDayCents ? ` · 比日均高 ${formatCents(day.cents - data.stats.averagePerRecordedDayCents)}` : day.cents === 0 ? " · 无匹配消费" : " · 不高于日均"}` });
        row.createEl("strong", { text: formatCents(day.cents) });
        let loaded = false;
        details.addEventListener("toggle", () => {
          if (!details.open || loaded) return;
          loaded = true;
          if (day.records.length) {
            details.createDiv({ cls: "ledger-note", text: `当天金额最高的 ${Math.min(5, day.records.length)} 笔 · 点击打开原始账目` });
            this.recordList(details, day.records.slice(0, 5));
          } else details.createDiv({ cls: "ledger-note", text: "当天有账本，当前筛选下没有消费记录。" });
        });
      });
    } else {
      const list = root.createDiv();
      const more = root.createEl("button", { cls: "ledger-button ledger-overview-detail-more", attr: { type: "button" } });
      let shown = 0;
      const loadMore = (): void => {
        const end = Math.min(shown + 20, data.ranked.length);
        this.recordList(list, data.ranked.slice(shown, end), shown);
        shown = end;
        more.hidden = shown >= data.ranked.length;
        more.textContent = `继续查看 · 还剩 ${data.ranked.length - shown} 笔`;
      };
      more.addEventListener("click", loadMore);
      loadMore();
    }
  }

  private recordList(parent: HTMLElement, records: LedgerRecord[], offset = 0): void {
    for (const [index, record] of records.entries()) {
      const row = parent.createEl("button", { cls: "ledger-overview-detail-record", attr: { type: "button", "aria-label": `${record.note || record.category}，${formatCents(record.cents)}，${record.date}，打开原始账目` } });
      row.dataset.ledgerRecordId = record.id;
      row.createSpan({ cls: "ledger-overview-detail-rank", text: String(offset + index + 1).padStart(2, "0") });
      const copy = row.createDiv({ cls: "ledger-overview-detail-copy" });
      copy.createEl("strong", { text: record.note || "无备注" });
      copy.createEl("small", { text: `${record.date} · ${record.time} · ${record.category}` });
      row.createEl("strong", { cls: "ledger-overview-detail-amount", text: formatCents(record.cents) });
      row.addEventListener("click", () => { this.close(); this.openRecord(record); });
    }
  }

  onClose(): void { this.contentEl.empty(); }
}
