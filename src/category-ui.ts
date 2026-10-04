import { App, Modal } from "obsidian";
import { formatCents, LedgerRecord, trendPoints } from "./core";
import type { CategoryAnalysis, CategoryGroup } from "./category-analysis";
import { createButton, renderDonut, renderDumbbell, renderHorizontalBars, renderTrendChart } from "./ui";
import { renderSelectedBox, renderWeekdayRungs } from "./category-charts";

const money = (value: number | null) => value === null ? "—" : formatCents(Math.round(value));
const signedMoney = (value: number) => `${value > 0 ? "+" : ""}${money(value)}`;

function card(parent: HTMLElement, title: string, subtitle: string, cls = ""): HTMLElement {
  const shell = parent.createDiv({ cls: `ledger-mono-card ledger-category-card ${cls}` });
  const badges: Record<string, string> = { "同期变化": "CATEGORY · PERIOD COMPARISON", "单笔金额分布": "LUPI BASICS · F15 TICK BOX", "重复项目": "REPEATED ITEMS · LOCAL RECORDS", "星期分布": "LUPI BASICS · F1 RUNG BARS" };
  shell.createDiv({ cls: "ledger-mono-badge", text: badges[title] ?? "CATEGORY DETAIL" });
  shell.createEl("h3", { text: title });
  shell.createDiv({ cls: "ledger-mono-sub", text: subtitle });
  return shell;
}

function metric(parent: HTMLElement, title: string, value: string, detail: string, click?: () => void): void {
  const el = parent.createEl(click ? "button" : "div", { cls: "ledger-metric" });
  if (click) { el.setAttribute("type", "button"); el.addEventListener("click", click); }
  el.createDiv({ cls: "ledger-metric-label", text: title });
  el.createDiv({ cls: "ledger-metric-value", text: value });
  el.createDiv({ cls: "ledger-metric-detail", text: detail });
}

function recordList(parent: HTMLElement, records: LedgerRecord[], open: (record: LedgerRecord) => void): void {
  const max = Math.max(1, ...records.map(record => record.cents));
  records.forEach((record, index) => {
    const row = parent.createEl("button", { cls: `ledger-category-ranked-row${index === 0 ? " is-leading" : ""}`, attr: { type: "button" } });
    row.dataset.ledgerRecordId = record.id;
    row.dataset.cents = String(record.cents);
    row.createSpan({ cls: "ledger-category-rank", text: String(index + 1).padStart(2, "0") });
    const copy = row.createDiv({ cls: "ledger-category-row-copy" });
    copy.createEl("strong", { text: record.note || "无备注" });
    copy.createEl("small", { text: `${record.date} · ${record.time} · ${record.category}` });
    const bar = copy.createDiv({ cls: "ledger-category-row-track" });
    bar.createDiv({ cls: "ledger-category-row-fill", attr: { style: `width:${record.cents / max * 100}%` } });
    row.createEl("strong", { cls: "ledger-category-row-amount", text: money(record.cents) });
    row.addEventListener("click", () => open(record));
  });
}

export function showCategoryRecords(app: App, label: string, records: LedgerRecord[], open: (record: LedgerRecord) => void): void {
  const modal = new Modal(app);
  modal.contentEl.addClass("ledger-category-evidence");
  modal.contentEl.createEl("h2", { text: label });
  modal.contentEl.createDiv({ cls: "ledger-note", text: `${records.length} 笔 · 点击打开原始账目` });
  if (!records.length) modal.contentEl.createDiv({ cls: "ledger-empty", text: "没有匹配记录" });
  recordList(modal.contentEl, [...records].sort((a, b) => b.cents - a.cents || b.date.localeCompare(a.date) || a.id.localeCompare(b.id)), record => { modal.close(); open(record); });
  modal.open();
}

function groupList(parent: HTMLElement, groups: CategoryGroup[], total: number, show: (label: string, records: LedgerRecord[]) => void): void {
  for (const group of groups) {
    const row = parent.createEl("button", { cls: "ledger-category-group-row", attr: { type: "button" } });
    const copy = row.createDiv({ cls: "ledger-category-row-copy" });
    copy.createEl("strong", { text: group.label });
    copy.createEl("small", { text: `${group.records.length} 笔 · 出现 ${group.days} 天${total ? ` · 占分类金额 ${(group.cents / total * 100).toFixed(1)}%` : ""}` });
    row.createEl("strong", { cls: "ledger-category-row-amount", text: money(group.cents) });
    row.addEventListener("click", () => show(group.label, group.records));
  }
}

export function renderCategoryAnalysis(parent: HTMLElement, category: string, analysis: CategoryAnalysis,
  trendUnit: "day" | "week" | "month", open: (record: LedgerRecord) => void,
  show: (label: string, records: LedgerRecord[]) => void, details: () => void): void {
  const a = analysis;
  const section = parent.createDiv({ cls: "ledger-category-analysis" });
  const header = section.createDiv({ cls: "ledger-category-heading" });
  header.createDiv({ cls: "ledger-mono-badge", text: "CATEGORY DETAIL" });
  header.createEl("h3", { text: `${category} · 分类分析` });
  header.createDiv({ cls: "ledger-note", text: `${a.coverage.range.start} 至 ${a.coverage.range.end} · 仅统计当前分类与筛选口径` });
  const metrics = section.createDiv({ cls: "ledger-metrics ledger-category-metrics" });
  metric(metrics, "分类支出", money(a.summary.cents), `${a.summary.count} 笔已记录交易`, details);
  metric(metrics, "笔数", String(a.summary.count), "账目笔数，不代表商品数量", details);
  metric(metrics, "平均每笔", money(a.mean), "分类总额 ÷ 笔数", details);
  metric(metrics, "单笔中位数", money(a.median), "一半记录不高于此金额", details);
  metric(metrics, "出现天数", String(a.activeDays), `消费日均 ${money(a.activeDayMean)}`, details);
  metric(metrics, "已记录日期日均", a.summary.recordedDays ? money(a.summary.averagePerRecordedDayCents) : "—",
    `分母：${a.summary.recordedDays} 个有账本日期`, details);
  if (!a.coverage.complete) section.createDiv({ cls: "ledger-category-warning", text: `本期缺少 ${a.coverage.missingDates.length} 天账本，${a.coverage.problems.length} 项账本需核对；当前仅展示已解析记录，不将未知日期当作零消费。` });

  const comparison = card(section, "同期变化", `上期 ${a.previousRange.start} 至 ${a.previousRange.end} · 同一分类与筛选口径`, "ledger-category-comparison");
  const comparisonMetrics = comparison.createDiv({ cls: "ledger-category-comparison-metrics" });
  metric(comparisonMetrics, "本期金额", money(a.summary.cents), `${a.records.length} 笔 · 平均每笔 ${money(a.mean)}`);
  metric(comparisonMetrics, "上期已记录金额", money(a.previousSummary.cents), `${a.previous.length} 笔 · 平均每笔 ${money(a.previousMean)}`);
  if (a.comparable) {
    const delta = a.summary.cents - a.previousSummary.cents * a.scale;
    const ratio = a.previousSummary.cents ? `${(delta > 0 ? "+" : "")}${(delta / (a.previousSummary.cents * a.scale) * 100).toFixed(1)}%` : a.summary.cents ? "上期为零，不计算涨幅" : "两期均为零";
    metric(comparisonMetrics, "金额变化", signedMoney(delta), ratio);
    const countDelta = a.records.length - a.previous.length * a.scale;
    metric(comparisonMetrics, "笔数变化", `${countDelta > 0 ? "+" : ""}${Number(countDelta.toFixed(1))}`, a.scale === 1 ? "本期减上期" : "上期按本期天数折算");
    if (a.scale !== 1) comparison.createDiv({ cls: "ledger-note", text: `两期天数不同，上期按 ${a.scale.toFixed(3)} 倍折算；上方仍保留实际已记录金额。` });
    if (a.decomposition) comparison.createDiv({ cls: "ledger-note", text: `金额差额拆解：笔数变化对应 ${signedMoney(a.decomposition.frequency)}，平均每笔变化对应 ${signedMoney(a.decomposition.ticket)}。这是计算关系，不代表商品涨价。` });
  } else comparison.createDiv({ cls: "ledger-category-warning", text: `可比数据不足，暂不判断涨跌。上期缺少 ${a.previousCoverage.missingDates.length} 天账本，${a.previousCoverage.problems.length} 项账本需核对；本期或未归期账本也可能影响比较。` });
  if (!a.records.length) {
    section.createDiv({ cls: "ledger-empty", text: "当前分类与期间没有匹配记录。" });
    return;
  }

  renderTrendChart(section, trendPoints(a.records, trendUnit), "line", point => show(`${point.start} 至 ${point.end}`, a.records.filter(r => r.date >= point.start && r.date <= point.end)));
  const grid = section.createDiv({ cls: "ledger-category-grid" });
  const distribution = card(grid, "单笔金额分布", "箱体是中间一半 · 空心点是统计离群值 · 点击查看账目");
  if (a.median !== null) distribution.querySelector("h3")!.textContent = `一半单笔不高于 ${money(a.median)}`;
  const distributionFacts = distribution.createDiv({ cls: "ledger-category-distribution-facts" });
  const middle = distributionFacts.createDiv();
  middle.createEl("small", { text: "中间 50% 的记录" });
  middle.createEl("strong", { text: a.records.length >= 4 ? `${money(a.q1)}～${money(a.q3)}` : "样本不足" });
  const concentration = distributionFacts.createDiv();
  concentration.createEl("small", { text: `最贵 ${Math.min(3, a.records.length)} 笔占比` });
  concentration.createEl("strong", { cls: "is-accent", text: a.summary.cents ? `${(a.topThreeCents / a.summary.cents * 100).toFixed(1)}%` : "—" });
  distribution.createDiv({ cls: "ledger-note", text: `最贵几笔合计 ${money(a.topThreeCents)} · 离群只描述统计位置，不判断是否合理` });
  renderSelectedBox(distribution, a.records, a.comparable ? a.previous : [], open, show);
  distribution.createDiv({ cls: "ledger-mono-source", text: "TICK BOX · WIRE · FILTERED LOCAL LEDGER" });
  const purposesWrap = grid.createDiv({ cls: "ledger-category-chart-cell" });
  renderDonut(purposesWrap, a.purposes.map(group => ({ category: group.label, cents: group.cents, count: group.records.length, share: a.summary.cents ? group.cents / a.summary.cents : 0 })),
    label => { const group = a.purposes.find(group => group.label === label); if (group) show(label, group.records); });
  const purposeCard = purposesWrap.querySelector<HTMLElement>(".ledger-mono-card")!;
  purposeCard.querySelector("h3")!.textContent = a.purposes[0]?.label === "未识别用途" ? "用途尚未明确的支出占比最高" : `${a.purposes[0]?.label ?? "用途"}占分类支出最多`;
  purposeCard.querySelector(".ledger-mono-sub")!.textContent = "一根刻线约为 1 个百分点 · 仅按明确备注识别 · 混合付款不拆分";
  const repeatGroups = a.repeats.slice(0, 6), repeatsWrap = grid.createDiv({ cls: "ledger-category-chart-cell" });
  if (repeatGroups.length && a.comparable) {
    renderDumbbell(repeatsWrap, repeatGroups.map(group => ({ category: group.label, currentCents: group.cents, previousCents: Math.round((a.previousGroups.find(previous => previous.label === group.label)?.cents ?? 0) * a.scale) })), "本期", a.scale === 1 ? "上期" : "上期折算", label => {
      show(`重复项目 · ${label}`, [...(repeatGroups.find(group => group.label === label)?.records ?? []), ...(a.previousGroups.find(group => group.label === label)?.records ?? [])]);
    });
    repeatsWrap.querySelector("h3")!.textContent = `${repeatGroups[0].label}是花费最多的重复项目`;
    repeatsWrap.querySelector(".ledger-mono-sub")!.textContent = "本期至少出现两笔的备注项目 · 最多六组 · 仅合并明确餐次同义词";
  } else {
    const repeats = card(repeatsWrap, "重复项目", "按备注累计金额排列 · 点击查看流水");
    if (repeatGroups.length) groupList(repeats, repeatGroups, a.summary.cents, show);
    else repeats.createDiv({ cls: "ledger-note", text: "当前期间没有重复备注项目。" });
    repeats.createDiv({ cls: "ledger-mono-source", text: "REPEATED NOTES · FILTERED LOCAL LEDGER" });
  }
  if (a.coverage.complete && a.records.length >= 10 && a.summary.recordedDays >= 14) {
    const rhythm = card(grid, "星期分布", "按各星期实际出现的账本日期计算日均，描述当前期间，不认定长期习惯。");
    const peak = [...a.weekdays].sort((x, y) => y.mean - x.mean)[0];
    rhythm.querySelector("h3")!.textContent = `${peak.label}的日均支出最高`;
    renderWeekdayRungs(rhythm, a.weekdays, show);
    rhythm.createDiv({ cls: "ledger-mono-source", text: "RUNG BARS · WIRE · OBSERVED WEEKDAYS · LOCAL LEDGER" });
  }
  const top = section.createDiv({ cls: "ledger-category-top-ten" });
  const topRows = a.topTen.map((record, index) => ({ category: `${String(index + 1).padStart(2, "0")} ${record.note || "无备注"}`, cents: record.cents, count: 1, share: a.summary.cents ? record.cents / a.summary.cents : 0 }));
  renderHorizontalBars(top, topRows, label => { const index = topRows.findIndex(row => row.category === label); if (index >= 0) open(a.topTen[index]); },
    { title: "最高支出前十笔", subtitle: "所选分类与期间 · 按单笔金额从高到低 · 点击打开原始账目", details: Object.fromEntries(topRows.map((row, index) => [row.category, `${a.topTen[index].date} · ${a.topTen[index].time}`])) });
  if (a.topTen.length < 10) top.createDiv({ cls: "ledger-note", text: `当前仅 ${a.topTen.length} 笔，全部展示。` });
  const footer = section.createDiv({ cls: "ledger-category-footer" });
  createButton(footer, `查看全部 ${a.records.length} 笔明细`).addEventListener("click", details);
}
