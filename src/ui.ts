import { setIcon } from "obsidian";
import { BudgetProgress, CategorySummary, FinanceAdvisorSnapshot, FinanceCoverageReport, LedgerRecord, TrendPoint, budgetProgress, cumulativeAverageProgress, formatCents } from "./core";
import type { FinanceAdvice } from "./ai";
import { compactFinanceAdvice } from "./ai";
import { eventAdvice } from "./insights";
import { prepareDonut } from "./donut";
import type { DonutSegment } from "./donut";
import type { BoxReference, WaterfallStep } from "./chart-data";
import type { BalanceStatus } from "./balance";
import type { DateRange } from "./core";
import type { TrendComparison } from "./trend-comparison";
import { deferChartAnimation } from "./chart-animation";
import { CategoryMeasure, categoryTree, mountCategoryTree, treeValue } from "./treemap";

export interface FinanceAdviceViewState {
  status: "local" | "loading" | "ready" | "error" | "unconfigured";
  advice: FinanceAdvice | null;
  message: string;
  canRefresh: boolean;
  analysisRange?: DateRange;
  updateAvailable?: boolean;
  todayBudget?: { date: string; spentCents: number; budgetCents: number; category: string; includeStarred: boolean };
}

const SVG_NS = "http://www.w3.org/2000/svg";
// Lieflat Charts "Wire": grayscale carries the data; orange marks one focal point.
const INK = "#1F1E1C";
const PAPER = "#F0F0EE";
const MUTED = "#8F8E86";
const FAINT = "#C0BFB7";
const GRID = "#DBDAD3";
const HERO = "#F5572F";
const MONTH_ESTIMATE_DAYS = 31;

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  return element;
}

function deterministic(index: number, salt: number): number {
  return Math.abs(((index * 73856093) ^ (salt * 19349663)) % 1000) / 1000;
}

function monoCard(parent: HTMLElement, badge: string, title: string, subtitle: string, renderControls?: (parent: HTMLElement) => void): { shell: HTMLElement; chart: HTMLElement } {
  const shell = parent.createDiv({ cls: "ledger-mono-card ledger-reveal" });
  deferChartAnimation(shell);
  const header = renderControls ? shell.createDiv({ cls: "ledger-mono-card-header" }) : shell;
  const copy = renderControls ? header.createDiv({ cls: "ledger-mono-card-heading" }) : shell;
  const labels: Record<string, string> = { F1: "阶梯柱状", F2: "支出走势", F4: "分类占比", F5: "分类金额", F6: "分组柱", F9: "工资周期", F12: "期间对比", F13: "矩形树图", F15: "单笔分布" };
  const template = badge.match(/F\d+\b/)?.[0] ?? "";
  copy.createDiv({ cls: "ledger-mono-badge", text: labels[template] ?? badge });
  copy.createEl("h3", { text: title });
  copy.createDiv({ cls: "ledger-mono-sub", text: subtitle });
  if (renderControls) renderControls(header.createDiv({ cls: "ledger-salary-cycle-controls" }));
  const chart = shell.createDiv({ cls: "ledger-mono-chart" });
  return { shell, chart };
}

function sourceLine(parent: HTMLElement, text: string): void {
  const source = text.includes("COMPARISON") ? "数据来源 · 当前与对比期间账目"
    : text.includes("TWO PREVIOUS") ? "参考数据 · 前两个完整工资周期"
    : text.includes("LOCAL LEDGER") ? "数据来源 · 本地记账" : text;
  parent.createDiv({ cls: "ledger-mono-source", text: source });
}

function niceCurrencyUnit(maxCents: number, targetTicks = 32): number {
  if (maxCents <= 0) return 100;
  const raw = maxCents / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return Math.max(1, Math.round(step * magnitude));
}

function accessibleTarget(element: SVGElement | HTMLElement, label: string, activate: () => void): void {
  element.setAttribute("tabindex", "0");
  element.setAttribute("role", "button");
  element.setAttribute("aria-label", label);
  element.classList.add("ledger-chart-target");
  element.addEventListener("click", activate);
  element.addEventListener("keydown", (event) => {
    const key = (event as KeyboardEvent).key;
    if (key === "Enter" || key === " ") {
      event.preventDefault();
      activate();
    }
  });
}

function trendTooltip(x: number, y: number, chartWidth: number, value: string, mobile = false, note?: string): SVGGElement {
  if (note?.trim()) return trendNoteTooltip(x, y, chartWidth, value, note, mobile);
  const width = Math.max(mobile ? 72 : 64, value.length * (mobile ? 7.2 : 6.4) + 20);
  const centerX = Math.max(width / 2 + 4, Math.min(chartWidth - width / 2 - 4, x));
  const textY = Math.max(18, y - 14);
  const tooltip = svgEl("g", { class: "ledger-trend-tooltip", "aria-hidden": "true" });
  tooltip.append(
    svgEl("rect", {
      x: centerX - width / 2,
      y: textY - (mobile ? 16 : 14),
      width,
      height: mobile ? 22 : 20,
      rx: mobile ? 11 : 10,
      class: "ledger-trend-tooltip-bg"
    })
  );
  const label = svgEl("text", {
    x: centerX,
    y: textY,
    "text-anchor": "middle",
    class: mobile ? "ledger-trend-tooltip-text is-mobile" : "ledger-trend-tooltip-text"
  });
  label.textContent = value;
  tooltip.append(label);
  return tooltip;
}

function trendNoteTooltip(x: number, y: number, chartWidth: number, value: string, note: string, mobile: boolean): SVGGElement {
  const fontSize = mobile ? 12 : 11;
  const measure = (text: string): number => Array.from(text).reduce((size, char) => size + fontSize * (/^[\x00-\x7f]$/.test(char) ? 0.62 : 1), 0);
  const maxWidth = Math.min(260, chartWidth - 8);
  const lines: string[] = [];
  for (const paragraph of note.split(/\r\n|\r|\n/)) {
    let line = "";
    for (const char of Array.from(paragraph)) {
      if (line && measure(line + char) > maxWidth - 24) { lines.push(line); line = ""; }
      line += char;
    }
    lines.push(line);
  }
  const limit = mobile ? 6 : 8;
  const preview = lines.slice(0, limit);
  if (lines.length > limit) preview.push("…点击查看完整备注");
  const width = Math.min(maxWidth, Math.max(100, measure(value) + 24, ...preview.map(line => measure(line) + 24)));
  const height = 36 + preview.length * 16;
  const left = Math.max(4, Math.min(chartWidth - width - 4, x - width / 2));
  const top = y - height - 12 >= 4 ? y - height - 12 : Math.min(y + 14, (mobile ? 252 : 330) - height - 4);
  const tooltip = svgEl("g", { class: "ledger-trend-tooltip ledger-trend-note-tooltip", "aria-hidden": "true" });
  tooltip.append(svgEl("rect", { x: left, y: top, width, height, rx: 10, class: "ledger-trend-tooltip-bg" }));
  const amount = svgEl("text", { x: left + 12, y: top + 18, class: mobile ? "ledger-trend-tooltip-text is-mobile" : "ledger-trend-tooltip-text" });
  amount.textContent = value;
  tooltip.append(amount);
  const text = svgEl("text", { class: "ledger-trend-tooltip-note" });
  preview.forEach((line, index) => {
    const span = svgEl("tspan", { x: left + 12, y: top + 36 + index * 16 });
    span.textContent = line;
    text.append(span);
  });
  tooltip.append(text);
  return tooltip;
}

function interactiveTrendTarget(
  svg: SVGSVGElement,
  group: SVGGElement,
  target: SVGElement,
  label: string,
  activate: () => void,
  previewOnFirstActivation = false
): void {
  target.setAttribute("tabindex", "0");
  target.setAttribute("role", "button");
  target.setAttribute("aria-label", label);
  target.classList.add("ledger-chart-target", "ledger-trend-hit-target");
  // Raise the hovered/focused point so later data points cannot cover its preview.
  const raise = (): void => { if (svg.lastElementChild !== group) svg.append(group); };
  group.addEventListener("pointerenter", raise);
  group.addEventListener("focusin", raise);
  target.addEventListener("click", (event) => {
    if (previewOnFirstActivation) {
      event.preventDefault();
      event.stopPropagation();
      const wasActive = group.classList.contains("is-active");
      svg.querySelectorAll(".ledger-trend-point.is-active").forEach((point) => point.classList.remove("is-active"));
      if (!wasActive) {
        group.classList.add("is-active");
        raise();
        return;
      }
    }
    activate();
  });
  target.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      svg.querySelectorAll(".ledger-trend-point.is-active").forEach((point) => point.classList.remove("is-active"));
      activate();
    }
  });
}

function pctText(cents: number, total: number): string {
  return total === 0 ? "占比 0.0%" : `占比 ${(cents / total * 100).toFixed(1)}%`;
}

function renderMobileTickRows(parent: HTMLElement, data: CategorySummary[], unit: number, onClick: (category: string) => void, details?: Record<string, string>): void {
  const list = parent.createDiv({ cls: "ledger-mobile-tick-rows" });
  data.forEach((item, index) => {
    const row = list.createEl("button", { cls: "ledger-mobile-tick-row" });
    row.type = "button";
    row.setAttribute("aria-label", `${item.category} ${formatCents(item.cents)}，${item.count} 笔`);
    const head = row.createDiv({ cls: "ledger-mobile-chart-head" });
    head.createEl("strong", { text: item.category });
    const values = head.createSpan();
    values.createEl("strong", { text: formatCents(item.cents) });
    values.createSpan({ text: ` · ${item.count}笔` });
    if (details?.[item.category]) row.createDiv({ cls: "ledger-mobile-chart-detail", text: details[item.category] });
    const track = row.createDiv({ cls: "ledger-mobile-tick-track", attr: { "aria-hidden": "true" } });
    const tickCount = Math.ceil(item.cents / unit);
    for (let tick = 0; tick < tickCount; tick += 1) {
      const mark = track.createSpan({ cls: `ledger-mobile-tick${index === 0 ? " is-leading" : ""}` });
      mark.style.height = `${(10 + deterministic(tick + 1, index + 2) * 13) * Math.min(1, item.cents / unit - tick)}px`;
      mark.style.animationDelay = `${index * 0.05 + tick * 0.012}s`;
    }
    row.addEventListener("click", () => onClick(item.category));
  });
}

export interface TickRowsOptions { title?: string; subtitle?: string; details?: Record<string, string> }

export function renderCategoryTreemap(parent: HTMLElement, data: CategorySummary[], onClick: (category: string) => void, measure: CategoryMeasure = "amount"): void {
  const tree = categoryTree(data, measure);
  const { shell, chart } = monoCard(parent, "LUPI BASICS · F13 NESTED TREEMAP",
    tree.leader ? `${tree.leader.category}占比最高` : "本期分类支出",
    `矩形面积 = ${measure === "count" ? "记账笔数" : "支出金额"} · 橙色为最大分类 · 灰阶区分分类`);
  shell.classList.add("ledger-category-treemap-card");
  if (tree.total > 0) {
    const host = chart.createDiv({ cls: "ledger-category-treemap", attr: { role: "group", "aria-label": "分类矩形树图" } });
    mountCategoryTree(host, tree, onClick);
  } else renderEmpty(chart, data.length ? "当前没有正数面积，可在分类明细中查看。" : "当前筛选条件下没有可绘制的数据");
  if (data.length) {
    const details = chart.createEl("details", { cls: "ledger-treemap-details" });
    details.createEl("summary", { text: `查看分类${measure === "count" ? "笔数" : "金额"}与明细 · ${data.length} 类` });
    const list = details.createDiv({ cls: "ledger-treemap-list" });
    for (const item of data) {
      const button = list.createEl("button", { cls: "ledger-button ledger-treemap-row", attr: { type: "button" } });
      button.createSpan({ text: item.category });
      button.createSpan({ text: `${treeValue(measure === "count" ? item.count : item.cents, measure)} · ${tree.omitted.includes(item) ? "不参与面积" : tree.total > 0 ? `${((measure === "count" ? item.count : item.cents) / tree.total * 100).toFixed(1)}%` : "—"}` });
      button.addEventListener("click", () => onClick(item.category));
    }
    if (tree.omitted.length) chart.createDiv({ cls: "ledger-note", text: "非正数分类保留在明细中，不绘制为矩形。" });
  }
  sourceLine(shell, "C9 / F13 NESTED TREEMAP · LOCAL LEDGER");
}

export function renderHorizontalBars(parent: HTMLElement, data: CategorySummary[], onClick: (category: string) => void, options: TickRowsOptions = {}): void {
  const total = data.reduce((sum, item) => sum + item.cents, 0);
  const leader = data[0];
  const { shell, chart } = monoCard(
    parent,
    "LUPI BASICS · F5 TICK ROWS",
    options.title ?? (leader ? `${leader.category}是本期最重的一行` : "本期还没有形成分类队列"),
    options.subtitle ?? (leader ? `每根刻线代表同一金额单位 · 行尾保留精确金额 · ${pctText(leader.cents, total)}` : "分类金额 · 当前筛选范围")
  );
  if (data.length === 0) return renderEmpty(chart, "当前筛选条件下没有可绘制的数据");
  const width = 820;
  const height = data.length * (options.details ? 62 : 44) + 58;
  const rowHeight = (height - 58) / data.length;
  const x0 = 126;
  const plotWidth = 520;
  const max = Math.max(...data.map((item) => item.cents), 1);
  const unit = niceCurrencyUnit(max);
  const maxUnits = max / unit;
  const px = plotWidth / Math.max(maxUnits, 1);
  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "分类支出刻线队列图" });
  svg.classList.add("ledger-svg", "ledger-tick-rows", "ledger-desktop-chart");
  data.forEach((item, index) => {
    const y = 28 + index * rowHeight;
    const group = svgEl("g");
    group.dataset.cents = String(item.cents);
    accessibleTarget(group, `${item.category} ${formatCents(item.cents)}，${item.count} 笔`, () => onClick(item.category));
    const label = svgEl("text", { x: x0 - 12, y: y + 3, "text-anchor": "end", class: "ledger-axis-label" });
    const name = Array.from(item.category);
    label.textContent = options.details && name.length > 10 ? `${name.slice(0, 10).join("")}…` : item.category;
    const baseline = svgEl("line", { x1: x0, y1: y + 9, x2: x0 + plotWidth, y2: y + 9, stroke: GRID, "stroke-width": 0.8 });
    group.append(label, baseline);
    if (options.details?.[item.category]) {
      const detail = svgEl("text", { x: x0, y: y + 29, class: "ledger-foot-label" });
      detail.textContent = options.details[item.category];
      group.append(detail);
      const title = svgEl("title");
      title.textContent = `${item.category} · ${options.details[item.category]} · ${formatCents(item.cents)}`;
      group.append(title);
    }
    const full = Math.floor(item.cents / unit);
    const remainder = item.cents % unit;
    for (let tick = 0; tick < full; tick += 1) {
      const x = x0 + (tick + 0.5) * px;
      group.append(svgEl("line", {
        x1: x, y1: y + 9, x2: x, y2: y - 2 - deterministic(tick + 1, index + 2) * 7,
        stroke: index === 0 ? HERO : INK, "stroke-width": 1.7,
        class: "ledger-fade", style: `animation-delay:${index * 0.08 + tick * 0.012}s`
      }));
      if (tick % 5 === 4) group.append(svgEl("circle", { cx: x, cy: y + 14, r: 1, fill: FAINT }));
    }
    if (remainder > 0) {
      const x = x0 + (full + 0.5) * px;
      group.append(svgEl("line", {
        x1: x, y1: y + 9, x2: x, y2: y + 9 - 13 * remainder / unit,
        stroke: index === 0 ? HERO : INK, "stroke-width": 1.7, "stroke-dasharray": "2 2",
        class: "ledger-fade", style: `animation-delay:${index * 0.08 + full * 0.012}s`
      }));
    }
    const value = svgEl("text", { x: x0 + Math.min(plotWidth, item.cents / max * plotWidth) + 12, y: y + 3, class: "ledger-value-label" });
    value.textContent = formatCents(item.cents);
    const count = svgEl("text", { x: 780, y: y + 3, "text-anchor": "end", class: "ledger-count-label" });
    count.textContent = `${item.count}笔`;
    group.append(value, count);
    svg.append(group);
  });
  const unitText = svgEl("text", { x: width / 2, y: height - 12, "text-anchor": "middle", class: "ledger-foot-label" });
  unitText.textContent = `每根刻线 ${formatCents(unit)} · 末根不足一单位按比例绘制`;
  svg.append(unitText);
  chart.append(svg);
  renderMobileTickRows(chart, data, unit, onClick, options.details);
  sourceLine(shell, "TICK ROWS · MONO-BASIC · LOCAL LEDGER");
}

function polar(cx: number, cy: number, radius: number, angle: number): { x: number; y: number } {
  const radians = angle * Math.PI / 180;
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
}

export function renderDonut(parent: HTMLElement, data: CategorySummary[], onClick: (category: string) => void): void {
  const segments = prepareDonut(data);
  const total = segments.reduce((sum, item) => sum + item.cents, 0);
  const { shell, chart } = monoCard(
    parent,
    "LUPI BASICS · F4 TICK DONUT",
    segments.length ? `${segments[0].category}占据最大的表盘区段` : "表盘等待第一笔支出",
    "一根刻线 ≈ 1 个百分点 · 橙色为最大分类 · 精确占比见图例"
  );
  if (segments.length === 0 || total === 0) return renderEmpty(chart, "合计为零，无法计算占比");
  const wrap = chart.createDiv({ cls: "ledger-donut-wrap" });
  const createDial = (mobile: boolean): SVGSVGElement => {
    const cx = mobile ? 200 : 280;
    const cy = 184;
    const radius = mobile ? 82 : 103;
    const svg = svgEl("svg", { viewBox: `0 0 ${mobile ? 400 : 560} 380`, role: "img", "aria-label": "分类支出百分比刻线环" });
    svg.classList.add("ledger-svg", "ledger-tick-donut", mobile ? "is-mobile" : "is-desktop");
    let cursor = 0;
    const labels: Array<{ group: SVGGElement; item: DonutSegment; angle: number; side: "left" | "right"; idealY: number; y: number }> = [];
    segments.forEach((item, index) => {
      const group = svgEl("g", { class: `ledger-donut-segment ledger-donut-tone-${index}` });
      if (item.members.length === 1) {
        accessibleTarget(group, `${item.category} ${(item.share * 100).toFixed(1)}%，${formatCents(item.cents)}`, () => onClick(item.category));
      } else {
        const title = svgEl("title");
        title.textContent = `${item.category} ${(item.share * 100).toFixed(1)}%，详见图例`;
        group.append(title);
      }
      for (let local = 0; local < item.ticks; local += 1) {
        const tick = cursor + local;
        const angle = tick * 3.6 - 90;
        const inner = polar(cx, cy, radius, angle);
        const length = (mobile ? 12 : 15) + deterministic(tick + 1, index + 2) * (mobile ? 6 : 8);
        const outer = polar(cx, cy, radius + length, angle);
        group.append(svgEl("line", {
          x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y,
          "stroke-width": 1.8, class: "ledger-donut-tick ledger-fade", style: `animation-delay:${tick * 0.012}s`
        }));
        if (tick % 10 === 0) {
          const dot = polar(cx, cy, radius - 7, angle);
          group.append(svgEl("circle", { cx: dot.x, cy: dot.y, r: 1, fill: FAINT }));
        }
      }
      {
        const angle = (cursor + item.ticks / 2) * 3.6 - 90;
        const side = Math.cos(angle * Math.PI / 180) < 0 ? "left" : "right";
        labels.push({ group, item, angle, side, idealY: polar(cx, cy, radius + 40, angle).y, y: 0 });
      }
      cursor += item.ticks;
      svg.append(group);
    });
    {
      for (const side of ["left", "right"] as const) {
        const column = labels.filter((label) => label.side === side).sort((a, b) => a.idealY - b.idealY);
        column.forEach((label, index) => {
          label.y = Math.max(label.idealY, 28 + index * 26, index === 0 ? 28 : column[index - 1].y + 26);
        });
        const overflow = column.length ? Math.max(0, column[column.length - 1].y - 352) : 0;
        column.forEach((label) => {
          const y = label.y - overflow;
          const from = polar(cx, cy, radius + 31, label.angle);
          const endX = side === "left" ? (mobile ? 80 : 122) : (mobile ? 320 : 438);
          const elbowX = side === "left" ? endX + 10 : endX - 10;
          label.group.append(svgEl("path", {
            d: `M ${from.x} ${from.y} L ${elbowX} ${y} L ${endX} ${y}`,
            class: "ledger-donut-leader"
          }));
          const marker = svgEl("circle", { cx: side === "left" ? endX - 3 : endX + 3, cy: y, r: 2.2, class: "ledger-donut-label-dot" });
          const text = svgEl("text", { x: side === "left" ? endX - 8 : endX + 8, y: y + 3.5, "text-anchor": side === "left" ? "end" : "start", class: "ledger-donut-label" });
          const name = Array.from(label.item.category);
          const nameLimit = mobile ? 3 : 5;
          const displayName = label.item.members.length > 1 ? `其余${label.item.members.length}类` : name.length > nameLimit ? `${name.slice(0, nameLimit).join("")}…` : label.item.category;
          text.textContent = `${displayName} · ${(label.item.share * 100).toFixed(1)}%`;
          label.group.append(marker, text);
        });
      }
    }
    const center = svgEl("text", { x: cx, y: cy - 5, "text-anchor": "middle", class: "ledger-donut-total" });
    center.textContent = formatCents(total);
    const centerSub = svgEl("text", { x: cx, y: cy + 15, "text-anchor": "middle", class: "ledger-foot-label" });
    centerSub.textContent = "100 TICKS · LOCAL TOTAL";
    svg.append(center, centerSub);
    return svg;
  };
  wrap.append(createDial(false), createDial(true));
  const leftLegend = wrap.createDiv({ cls: "ledger-legend ledger-legend-left" });
  const rightLegend = wrap.createDiv({ cls: "ledger-legend ledger-legend-right" });
  const leftCount = Math.ceil(segments.length / 2);
  segments.forEach((item, index) => {
    const legend = index < leftCount ? leftLegend : rightLegend;
    const row = item.members.length === 1
      ? legend.createEl("button", { cls: `ledger-legend-item ledger-donut-tone-${index}` })
      : legend.createEl("details", { cls: `ledger-donut-other ledger-donut-tone-${index}` }).createEl("summary", { cls: "ledger-legend-item" });
    row.createSpan({ cls: "ledger-swatch" });
    row.createSpan({ text: `${item.category} · ${(item.share * 100).toFixed(1)}%` });
    if (item.members.length === 1) {
      row.addEventListener("click", () => onClick(item.category));
    } else {
      const details = row.parentElement as HTMLDetailsElement;
      for (const member of item.members) {
        const button = details.createEl("button", { cls: "ledger-donut-other-item", text: `${member.category} · ${(member.cents / total * 100).toFixed(1)}%` });
        button.addEventListener("click", () => onClick(member.category));
      }
    }
  });
  sourceLine(shell, "TICK DONUT · MONO-BASIC · LOCAL LEDGER");
}

function trendConclusion(points: TrendPoint[]): string {
  if (points.length === 0) return "这段时间还没有形成趋势";
  const peak = points.reduce((best, point) => point.cents > best.cents ? point : best, points[0]);
  return `${peak.label}是这段时间的支出峰值`;
}

export interface TrendChartOptions {
  dailyAverage?: { cents: number; days: number } | null;
  dateNotes?: Record<string, string>;
  comparison?: TrendComparison;
}

function appendDailyAverage(svg: SVGSVGElement, average: { cents: number; days: number } | null | undefined, left: number, right: number, y: number, mobile = false): void {
  if (!average) return;
  const group = svgEl("g", { class: "ledger-trend-average", "aria-label": `日均支出 ${formatCents(average.cents)}，按 ${average.days} 个自然日计算` });
  group.append(svgEl("line", { x1: left, x2: right, y1: y, y2: y, stroke: MUTED, "stroke-opacity": 0.6, "stroke-width": 1.1, "stroke-dasharray": "6 5" }));
  const label = svgEl("text", { x: left + 5, y: Math.max(16, y - 8), class: mobile ? "ledger-mobile-axis-value ledger-trend-average-label" : "ledger-foot-label ledger-trend-average-label" });
  label.textContent = `日均 ${formatCents(average.cents)}`;
  group.append(label);
  svg.append(group);
}

function appendCumulativeAverage(svg: SVGSVGElement, progress: ReturnType<typeof cumulativeAverageProgress>, left: number, slot: number, base: number, plotHeight: number, max: number, mobile = false): void {
  if (!progress) return;
  const coords = progress.amounts.map((amount, index) => ({ x: left + slot * (index + 0.5), y: base - amount / max * plotHeight }));
  const group = svgEl("g", { class: "ledger-trend-average ledger-trend-average-progress", "aria-label": `平均进度：按 ${progress.days} 个自然日均匀分摊，日均 ${formatCents(progress.dailyCents)}` });
  group.append(svgEl("path", {
    d: `M${coords.map(point => `${point.x} ${point.y}`).join(" L ")}`,
    fill: "none", stroke: MUTED, "stroke-opacity": 0.6, "stroke-width": 1.1, "stroke-dasharray": "6 5"
  }));
  const label = svgEl("text", {
    x: coords[0].x + 5, y: Math.max(16, coords[0].y - 8),
    class: mobile ? "ledger-mobile-axis-value ledger-trend-average-label" : "ledger-foot-label ledger-trend-average-label"
  });
  label.textContent = "平均进度";
  group.append(label);
  svg.append(group);
}

function appendTrendNoteMarker(group: SVGGElement, x: number, y: number, note: string | undefined): void {
  if (!note) return;
  group.classList.add("has-note");
  group.append(svgEl("circle", { cx: x, cy: y, r: 7, fill: "none", stroke: HERO, "stroke-width": 1.5, class: "ledger-trend-note-marker", "pointer-events": "none" }));
}

function trendWeekend(point: TrendPoint, cumulative: boolean): boolean {
  if (!cumulative && point.start !== point.end) return false;
  const day = new Date(`${point.end}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

function trendAxis(max: number): { max: number; step: number } {
  const raw = Math.max(max, 1) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  const step = Math.max(1, Math.ceil(factor * magnitude));
  return { max: Math.ceil(Math.max(max, 1) / step) * step, step };
}

function trendDateLabels(count: number, width: number, mobile: boolean): Set<number> {
  const labels = !mobile && count <= 31 ? 3 : Math.max(3, Math.floor(width / 220) + 1);
  return new Set(Array.from({ length: Math.min(count, labels) }, (_, index) =>
    Math.round(index * (count - 1) / Math.max(1, Math.min(count, labels) - 1))));
}

/** F1 Rung Bars: each horizontal rung encodes the same currency unit. */
function appendRungColumn(group: SVGGElement, x: number, base: number, amount: number, max: number, plotHeight: number, halfWidth: number, unit: number, primary: boolean, index: number): void {
  if (amount <= 0) return;
  const full = Math.floor(amount / unit);
  const remainder = amount % unit;
  for (let rung = 0; rung < full + (remainder > 0 ? 1 : 0); rung += 1) {
    const fraction = rung < full ? 1 : remainder / unit;
    const value = rung < full ? (rung + 1) * unit : amount;
    const y = base - value / max * plotHeight;
    group.append(svgEl("line", {
      x1: x - halfWidth * fraction, x2: x + halfWidth * fraction, y1: y, y2: y,
      stroke: primary ? HERO : INK, "stroke-width": 1.8, "stroke-linecap": "round",
      "stroke-dasharray": fraction < 1 ? "2 2" : "none",
      class: "ledger-fade ledger-trend-rung", "data-unit-cents": unit, "data-fraction": fraction,
      style: `animation-delay:${index * 0.025 + rung * 0.008}s`
    }));
  }
}

function renderTrendPlot(parent: HTMLElement, points: TrendPoint[], type: "line" | "bar" | "cumulative", onClick: (point: TrendPoint) => void, options: TrendChartOptions, mobile: boolean): void {
  const cumulative = type === "cumulative";
  const isLine = type !== "bar";
  const average = cumulative ? null : options.dailyAverage;
  const comparison = options.comparison;
  const pointCount = Math.max(points.length, comparison?.points.length ?? 0);
  const axis = trendAxis(Math.max(...points.map(point => point.cents), ...(comparison?.points.map(point => point?.cents ?? 0) ?? []), average?.cents ?? 0, 1));
  const width = mobile ? (pointCount > 10 ? pointCount * 34 + 74 : 360)
    : cumulative ? Math.max(820, pointCount * 34 + 80)
    : isLine ? 820 : Math.max(820, pointCount * 24 + 80);
  const height = mobile ? 252 : 330;
  const left = mobile ? Math.max(44, formatCents(axis.max).replace(".00", "").length * 6.5 + 14) : 64;
  const right = width - (mobile ? 14 : 30);
  const top = mobile ? 38 : 34;
  const base = mobile ? 194 : 254;
  const plotWidth = right - left;
  const plotHeight = base - top;
  const slot = plotWidth / pointCount;
  const peakIndex = cumulative ? points.length - 1 : points.reduce((best, point, index) => point.cents > points[best].cents ? index : best, 0);
  const unit = niceCurrencyUnit(axis.max, 64);
  const svg = svgEl("svg", {
    viewBox: `0 0 ${width} ${height}`, role: "img", "data-axis-max": axis.max,
    "aria-label": `${mobile ? "移动端" : ""}${cumulative ? "累计支出折线图" : isLine ? "支出发丝折线图" : "支出柱状图"}`
  });
  svg.classList.add("ledger-svg", isLine ? "ledger-hairline-chart" : "ledger-rung-chart", mobile ? "ledger-mobile-trend" : "ledger-desktop-chart");
  if (mobile) svg.style.width = `${width}px`;
  else if (width > 840) svg.style.minWidth = `${width}px`;
  for (let amount = 0; amount <= axis.max; amount += axis.step) {
    const y = base - amount / axis.max * plotHeight;
    svg.append(svgEl("line", { x1: left, y1: y, x2: right, y2: y, stroke: GRID, "stroke-width": 0.6, "stroke-opacity": amount === 0 ? 1 : 0.55 }));
    const label = svgEl("text", { x: left - 8, y: y + 3, "text-anchor": "end", class: mobile ? "ledger-mobile-axis-value" : "ledger-foot-label" });
    label.textContent = formatCents(amount).replace(".00", "");
    svg.append(label);
  }
  if (cumulative) appendCumulativeAverage(svg, cumulativeAverageProgress(points), left, slot, base, plotHeight, axis.max, mobile);
  else appendDailyAverage(svg, average, left, right, base - (average?.cents ?? 0) / axis.max * plotHeight, mobile);
  if (comparison) {
    const segments: string[] = [];
    let connected = false;
    const group = svgEl("g", { class: "ledger-trend-previous", "pointer-events": "none", "aria-label": `上期 ${comparison.range.start} 至 ${comparison.range.end}` });
    comparison.points.forEach((point, index) => {
      if (!point) { connected = false; return; }
      const x = left + slot * (index + 0.5);
      const y = base - point.cents / axis.max * plotHeight;
      segments.push(`${connected ? "L" : "M"}${x} ${y}`);
      connected = true;
      group.append(svgEl("circle", { cx: x, cy: y, r: 2.5, fill: PAPER, stroke: "#66838B", "stroke-width": 1.3, "data-cents": point.cents }));
    });
    if (segments.length) {
      group.insertBefore(svgEl("path", { d: segments.join(" "), fill: "none", stroke: "#66838B", "stroke-width": 1.8, "stroke-dasharray": "8 4", class: "ledger-trend-previous-line" }), group.firstChild);
      svg.append(group);
    }
  }
  const coords: Array<{ x: number; y: number }> = [];
  const dateLabels = trendDateLabels(pointCount, width, mobile);
  dateLabels.add(points.length - 1);
  points.forEach((point, index) => {
    const x = left + slot * (index + 0.5);
    const y = base - point.cents / axis.max * plotHeight;
    coords.push({ x, y });
    const primary = index === peakIndex;
    const weekend = trendWeekend(point, cumulative);
    const group = svgEl("g", { class: "ledger-trend-point", "data-cents": point.cents });
    svg.append(svgEl("line", { x1: x, y1: base, x2: x, y2: base - 7, stroke: FAINT, "stroke-width": 0.6 }));
    if (isLine) {
      group.append(svgEl("circle", {
        cx: x, cy: y, r: primary ? (mobile ? 4.8 : 4.2) : (mobile ? 3 : 2.2),
        fill: weekend ? PAPER : primary ? HERO : INK, stroke: primary ? HERO : INK,
        "stroke-width": weekend ? 1.2 : 0.8, class: "ledger-pop ledger-trend-dot",
        style: `animation-delay:${0.15 + index * 0.012}s`
      }));
      appendTrendNoteMarker(group, x, y, cumulative ? options.dateNotes?.[point.end] : undefined);
    } else {
      appendRungColumn(group, x, base, point.cents, axis.max, plotHeight, Math.min(11, slot * 0.28), unit, primary, index);
    }
    if (primary) {
      const peak = svgEl("text", {
        x, y: Math.max(18, y - 12), "text-anchor": cumulative ? "end" : "middle",
        class: `${mobile ? "ledger-mobile-value-label" : "ledger-value-label"} ledger-peak-label ledger-persistent-peak`
      });
      peak.textContent = formatCents(point.cents);
      group.append(peak);
    }
    const note = cumulative ? options.dateNotes?.[point.end] : undefined;
    const prior = comparison?.points[index];
    const priorDescription = comparison ? (prior ? `上期 ${prior.start === prior.end ? prior.start : `${prior.start} 至 ${prior.end}`}：${formatCents(prior.cents)}` : "上期此位置无完整数据") : "";
    const tooltipNote = [priorDescription, note].filter(Boolean).join("\n");
    group.append(trendTooltip(x, y, width, `${cumulative ? "累计 " : ""}${formatCents(point.cents)}`, mobile, tooltipNote));
    const hit = isLine ? svgEl("circle", { cx: x, cy: y, r: mobile ? 22 : 14, fill: "transparent" })
      : svgEl("rect", { x: x - slot / 2, y: top, width: slot, height: plotHeight + 28, fill: "transparent" });
    interactiveTrendTarget(svg, group, hit,
      `${point.label} ${cumulative ? "累计 " : ""}${formatCents(point.cents)}，${point.count} 笔${weekend ? "，周末" : ""}${priorDescription ? `，${priorDescription}` : ""}${cumulative ? `，${note ? `备注：${note}` : "添加备注"}` : ""}`,
      () => onClick(point), mobile && isLine);
    group.append(hit);
    svg.append(group);
    if (dateLabels.has(index)) {
      const label = svgEl("text", { x, y: base + 23, "text-anchor": "middle", class: mobile ? "ledger-mobile-axis-label" : "ledger-axis-label" });
      label.textContent = mobile && point.label.length > 5 ? point.label.slice(-5) : point.label;
      svg.append(label);
    }
  });
  if (comparison && comparison.points.length > points.length) {
    const lastIndex = comparison.points.length - 1;
    const last = comparison.points[lastIndex];
    const label = svgEl("text", { x: left + slot * (lastIndex + 0.5), y: base + 40, "text-anchor": "end", class: mobile ? "ledger-mobile-axis-label" : "ledger-axis-label" });
    label.textContent = `上期 ${last?.end.slice(5) ?? comparison.range.end.slice(5)}`;
    svg.append(label);
  }
  if (isLine) {
    const outline = svgEl("path", { d: `M${coords.map(point => `${point.x} ${point.y}`).join(" L ")}`, fill: "none", stroke: INK, "stroke-width": 1.8, pathLength: 1, class: "ledger-draw" });
    svg.insertBefore(outline, svg.firstChild);
  }
  const foot = svgEl("text", { x: width / 2, y: height - 10, "text-anchor": "middle", class: mobile ? "ledger-mobile-foot-label" : "ledger-foot-label" });
  foot.textContent = cumulative ? (mobile ? "轻点圆点查看金额与备注 · 再点编辑备注" : "悬停查看备注 · 点击打开卡片")
    : isLine ? (mobile ? "轻点圆点查看金额 · 再点查看明细" : "空心圆点为周末 · 悬停查看金额")
    : `每档 ${formatCents(unit)} · 虚线末档按比例计入`;
  svg.append(foot);
  parent.createDiv({ cls: mobile ? "ledger-mobile-trend-scroll" : "ledger-desktop-chart ledger-trend-desktop-scroll" }).append(svg);
}

export function renderTrendChart(parent: HTMLElement, points: TrendPoint[], type: "line" | "bar" | "cumulative", onClick: (point: TrendPoint) => void, options: TrendChartOptions = {}): void {
  const cumulative = type === "cumulative";
  const isLine = type !== "bar";
  const average = cumulative ? null : options.dailyAverage;
  const progress = cumulative ? cumulativeAverageProgress(points) : null;
  const meanDescription = average ? ` · 日均 ${formatCents(average.cents)}（含零支出日）` : "";
  const { shell, chart } = monoCard(parent,
    cumulative ? "累计支出" : isLine ? "LUPI BASICS · F2 HAIRLINE LINE" : "LUPI BASICS · F1 RUNG BARS",
    cumulative ? `累计支出${points.length ? ` · ${formatCents(points.at(-1)!.cents)}` : ""}` : trendConclusion(points),
    cumulative ? `带外圈的日期已有备注${progress ? ` · 灰色虚线为平均进度（日均 ${formatCents(progress.dailyCents)}）` : ""}`
      : `${isLine ? "逐日读数 · 空心圆点为周末" : "阶梯柱按同一金额单位逐档累计"}${meanDescription}`);
  if (options.comparison) {
    const comparison = options.comparison;
    const legend = chart.createDiv({ cls: "ledger-trend-comparison-legend" });
    legend.createDiv({ cls: "ledger-trend-current-key", text: "本期" });
    legend.createDiv({ cls: "ledger-trend-previous-key", text: `上期 ${comparison.range.start} — ${comparison.range.end}` });
    if (!comparison.points.some(Boolean)) legend.createDiv({ cls: "ledger-note", text: "上期暂无完整数据，暂不绘制对比线" });
    else if (comparison.missingDays) legend.createDiv({ cls: "ledger-note", text: `上期缺少 ${comparison.missingDays} 天账本，${cumulative ? "累计线只画到首个缺失日前" : "对应位置断线"}。` });
  }
  if (!points.length) return renderEmpty(chart, "当前筛选条件下没有可绘制的数据");
  renderTrendPlot(chart, points, type, onClick, options, false);
  renderTrendPlot(chart, points, type, onClick, options, true);
  sourceLine(shell, "LOCAL LEDGER");
}

export function renderSalaryWaterfall(parent: HTMLElement, steps: WaterfallStep[], range: { start: string; end: string }, onCategory: (category: string) => void, onCalibrationNote?: () => void, options?: { historical: boolean; salaryRecorded: boolean; renderControls?: (parent: HTMLElement) => void }): void {
  const spent = -steps.filter((step) => step.kind === "expense").reduce((sum, step) => sum + step.deltaCents, 0);
  const remaining = steps.at(-1)?.toCents ?? 0;
  const calibrated = steps.at(-1)?.label === "实际余额";
  const remainingLabel = options?.historical && calibrated ? "期末余额（校准推算）" : calibrated ? "实际余额" : "账面剩余";
  const stepLabel = (step: WaterfallStep): string => step.kind === "remaining" ? remainingLabel : step.label;
  const signedAdjustment = (cents: number): string => `${cents < 0 ? "−" : "+"}${formatCents(Math.abs(cents))}`;
  const { shell, chart } = monoCard(
    parent,
    "LUPI BASICS · F9 RUNG WATERFALL",
    !calibrated && remaining < 0 ? `所选工资周期支出超出工资 ${formatCents(-remaining)}` : `所选工资周期已支出 ${formatCents(spent)}`,
    `${range.start} — ${range.end} · ${options?.historical && options.salaryRecorded ? "工资为该期保存值" : options?.historical ? "工资为参考值" : "工资为本周期设置值"} · 分类只计已入账支出${calibrated ? " · 末段按该期余额校准" : ""}`,
    options?.renderControls
  );
  if (!steps.length) {
    renderEmpty(chart, options?.historical ? "该期未保存有效工资，支出仍可在期间概览和明细中查看。" : "请先在设置中填写每个工资周期到账工资");
    return;
  }
  const width = 840;
  const height = 348;
  const top = 34;
  const bottom = 263;
  const values = steps.flatMap((step) => [step.fromCents, step.toCents]);
  const low = Math.min(0, ...values);
  const high = Math.max(1, ...values);
  const scale = (value: number): number => bottom - (value - low) / (high - low) * (bottom - top);
  const xAt = (index: number): number => 74 + index * (width - 148) / Math.max(1, steps.length - 1);
  const unit = niceCurrencyUnit(Math.max(...steps.map((step) => Math.abs(step.deltaCents))), 25);
  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": `工资周期瀑布图，已记账支出 ${formatCents(spent)}，${remainingLabel} ${formatCents(remaining)}` });
  svg.classList.add("ledger-svg", "ledger-waterfall-svg", "ledger-waterfall-desktop");
  svg.append(svgEl("line", { x1: 32, y1: scale(0), x2: width - 30, y2: scale(0), stroke: GRID, "stroke-width": 1, class: "ledger-fade" }));
  steps.forEach((step, index) => {
    const x = xAt(index);
    const a = step.kind === "expense" || step.kind === "calibration" ? Math.min(step.fromCents, step.toCents) : 0;
    const b = step.kind === "expense" || step.kind === "calibration" ? Math.max(step.fromCents, step.toCents) : step.toCents;
    const count = step.deltaCents === 0 ? 1 : Math.min(34, Math.max(1, Math.ceil(Math.abs(b - a) / unit)));
    const group = svgEl("g", { class: "ledger-waterfall-step" });
    const title = svgEl("title");
    title.textContent = `${step.label}：${step.kind === "expense" ? "已记账支出 " + formatCents(-step.deltaCents) : step.kind === "calibration" ? `${signedAdjustment(step.deltaCents)}，不计入已记账支出` : formatCents(step.toCents)}`;
    group.append(title);
    for (let rung = 0; rung < count; rung += 1) {
      const value = a + (rung + 0.5) / count * (b - a);
      group.append(svgEl("line", {
        x1: x - 12, y1: scale(value), x2: x + 12, y2: scale(value),
        stroke: step.kind === "expense" || step.kind === "calibration" ? MUTED : step.kind === "remaining" ? HERO : INK,
        "stroke-width": 1.3, ...(step.kind === "expense" || step.kind === "calibration" ? { "stroke-dasharray": step.kind === "calibration" ? "1 3" : "3 3" } : {}),
        class: "ledger-fade", style: `animation-delay:${index * 0.08 + rung * 0.008}s`
      }));
    }
    if (index < steps.length - 1) {
      group.append(svgEl("line", { x1: x + 15, y1: scale(step.toCents), x2: xAt(index + 1) - 15, y2: scale(step.toCents), stroke: FAINT, "stroke-width": 1, "stroke-dasharray": "2 4" }));
    }
    const value = svgEl("text", { x, y: Math.max(19, scale(Math.max(a, b)) - 11), "text-anchor": "middle", class: "ledger-waterfall-value" });
    value.textContent = step.kind === "expense" ? `−${formatCents(-step.deltaCents)}` : step.kind === "calibration" ? signedAdjustment(step.deltaCents) : formatCents(step.toCents);
    const label = svgEl("text", { x, y: 298, "text-anchor": "middle", class: "ledger-waterfall-label" });
    label.textContent = stepLabel(step);
    group.append(value, label);
    if (step.categories.length === 1) accessibleTarget(group, `${step.label}支出 ${formatCents(-step.deltaCents)}，打开分类明细`, () => onCategory(step.categories[0]));
    if (step.kind === "calibration" && onCalibrationNote) {
      // Include the empty space between rungs in the pointer target.
      group.prepend(svgEl("rect", { x: x - 42, y: 8, width: 84, height: 302, fill: "transparent" }));
      accessibleTarget(group, "余额校准差额，查看备注", onCalibrationNote);
    }
    svg.append(group);
  });
  const foot = svgEl("text", { x: width / 2, y: height - 9, "text-anchor": "middle", class: "ledger-foot-label" });
  foot.textContent = `SOLID = SALARY / REMAINING · DASHED = POSTED SPENDING${calibrated ? " / BALANCE RECONCILIATION" : ""} · ONE RUNG ≈ ${formatCents(unit)}`;
  svg.append(foot);
  chart.append(svg);
  const mobile = chart.createDiv({ cls: "ledger-waterfall-mobile" });
  steps.forEach((step) => {
    const row = mobile.createDiv({ cls: `ledger-waterfall-mobile-step is-${step.kind}` });
    const head = row.createDiv({ cls: "ledger-waterfall-mobile-head" });
    head.createSpan({ text: stepLabel(step) });
    head.createEl("strong", { text: step.kind === "expense" ? `−${formatCents(-step.deltaCents)}` : step.kind === "calibration" ? signedAdjustment(step.deltaCents) : formatCents(step.toCents) });
    if (step.kind === "expense") row.createDiv({ cls: "ledger-waterfall-mobile-balance", text: `扣除后剩余 ${formatCents(step.toCents)}` });
    if (step.kind === "calibration") {
      row.createDiv({ cls: "ledger-waterfall-mobile-balance", text: "对账差额，不计入上方已支出" });
      if (onCalibrationNote) {
        row.createDiv({ cls: "ledger-waterfall-mobile-balance", text: "点击查看备注" });
        accessibleTarget(row, "余额校准差额，查看备注", onCalibrationNote);
      }
    }
    if (step.categories.length === 1) {
      row.setAttribute("role", "button");
      row.setAttribute("tabindex", "0");
      row.addEventListener("click", () => onCategory(step.categories[0]));
      row.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onCategory(step.categories[0]); } });
    }
  });
  shell.createDiv({ cls: "ledger-waterfall-note", text: calibrated
    ? "已支出与分类金额只来自账本；余额校准差额单独桥接到实际余额，不当作新消费，也不影响洞察判断。"
    : "只扣除已记录的交易；固定支出如已入账，不会再次扣除。未校准时的账面剩余只是推算值。" });
  sourceLine(shell, "RUNG WATERFALL · WIRE · SELECTED SALARY CYCLE · LOCAL LEDGER");
}

export function renderCategoryBox(parent: HTMLElement, data: BoxReference, onOpenRecord: (record: LedgerRecord) => void): void {
  const high = data.largestCurrent.cents > data.upperFenceCents;
  const { shell, chart } = monoCard(
    parent,
    "LUPI BASICS · F15 TICK BOX",
    high ? `${data.category}本期最大单笔高于历史统计上界` : `${data.category}单笔支出与历史分布对照`,
    `此前两个已结束工资周期 · ${data.sampleCount} 笔历史交易 · 箱体表示中间一半，橙点为所选期间最大单笔`
  );
  const makeSvg = (width: number, mobile: boolean): SVGSVGElement => {
    const height = mobile ? 268 : 300;
    const plotTop = 32;
    const plotBottom = mobile ? 210 : 238;
    const maxValue = Math.max(data.maxCents, ...data.outlierCents, data.largestCurrent.cents, 100) * 1.12;
    const y = (cents: number): number => plotBottom - cents / maxValue * (plotBottom - plotTop);
    const boxX = mobile ? 132 : 210;
    const currentX = mobile ? 244 : 375;
    const boxWidth = mobile ? 35 : 42;
    const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": `${data.category}历史单笔中位数 ${formatCents(data.medianCents)}，本期最大单笔 ${formatCents(data.largestCurrent.cents)}` });
    svg.classList.add("ledger-svg", "ledger-box-svg", mobile ? "is-mobile" : "is-desktop");
    for (let index = 0; index <= 4; index += 1) {
      const value = maxValue * index / 4;
      svg.append(svgEl("line", { x1: mobile ? 55 : 70, y1: y(value), x2: width - 28, y2: y(value), stroke: GRID, "stroke-width": 0.8 }));
      const tick = svgEl("text", { x: mobile ? 50 : 64, y: y(value) + 3, "text-anchor": "end", class: "ledger-box-axis" });
      tick.textContent = formatCents(Math.round(value));
      svg.append(tick);
    }
    svg.append(svgEl("line", { x1: boxX, y1: y(data.minCents), x2: boxX, y2: y(data.maxCents), stroke: MUTED, "stroke-width": 1.2, class: "ledger-draw" }));
    for (const cents of [data.minCents, data.maxCents]) svg.append(svgEl("line", { x1: boxX - 10, y1: y(cents), x2: boxX + 10, y2: y(cents), stroke: MUTED, "stroke-width": 1.2 }));
    const box = svgEl("rect", { x: boxX - boxWidth / 2, y: y(data.q3Cents), width: boxWidth, height: Math.max(2, y(data.q1Cents) - y(data.q3Cents)), rx: 9, fill: INK, class: "ledger-pop" });
    svg.append(box);
    svg.append(svgEl("line", { x1: boxX - boxWidth / 2 + 4, y1: y(data.medianCents), x2: boxX + boxWidth / 2 - 4, y2: y(data.medianCents), stroke: PAPER, "stroke-width": 2.4 }));
    data.outlierCents.forEach((cents, index) => svg.append(svgEl("circle", { cx: boxX + (deterministic(index + 1, 11) - 0.5) * 13, cy: y(cents), r: 3, fill: PAPER, stroke: MUTED, "stroke-width": 1.2, class: "ledger-pop" })));
    const current = svgEl("g", { role: "button", tabindex: 0, "aria-label": `打开本期最大单笔，${data.largestCurrent.date}，${formatCents(data.largestCurrent.cents)}` });
    current.append(svgEl("line", { x1: currentX, y1: y(0), x2: currentX, y2: y(data.largestCurrent.cents), stroke: FAINT, "stroke-width": 1, "stroke-dasharray": "2 4" }));
    current.append(svgEl("circle", { cx: currentX, cy: y(data.largestCurrent.cents), r: 6, fill: HERO, class: "ledger-pop" }));
    current.addEventListener("click", () => onOpenRecord(data.largestCurrent));
    current.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpenRecord(data.largestCurrent); } });
    svg.append(current);
    for (const [x, label] of [[boxX, "历史单笔"], [currentX, "本期最大"]] as Array<[number, string]>) {
      const text = svgEl("text", { x, y: plotBottom + 20, "text-anchor": "middle", class: "ledger-box-label" });
      text.textContent = label;
      svg.append(text);
    }
    return svg;
  };
  chart.append(makeSvg(540, false), makeSvg(340, true));
  const stats = shell.createDiv({ cls: "ledger-box-stats" });
  stats.createSpan({ text: `历史中位数 ${formatCents(data.medianCents)}` });
  stats.createSpan({ text: `中间一半 ${formatCents(data.q1Cents)}–${formatCents(data.q3Cents)}` });
  const current = stats.createEl("button", { text: `本期最大 ${formatCents(data.largestCurrent.cents)} · 打开账目` });
  current.type = "button";
  current.addEventListener("click", () => onOpenRecord(data.largestCurrent));
  shell.createDiv({ cls: "ledger-box-note", text: "仅按分类比较单笔金额；分类内用途可能不同，位置偏高不等于已查明原因。空心点为历史统计离群值。" });
  sourceLine(shell, "TICK BOX · WIRE · TWO PREVIOUS FULL SALARY CYCLES · LOCAL LEDGER");
}

export interface DumbbellDatum {
  category: string;
  currentCents: number;
  previousCents: number;
}

export function renderDumbbell(parent: HTMLElement, data: DumbbellDatum[], currentLabel: string, previousLabel: string, onClick: (category: string) => void): void {
  const changed = [...data].filter((item) => item.currentCents !== item.previousCents);
  const biggest = changed.sort((a, b) => Math.abs(b.currentCents - b.previousCents) - Math.abs(a.currentCents - a.previousCents))[0];
  const { shell, chart } = monoCard(
    parent,
    "LUPI BASICS · F12 DUMBBELL QUEUE",
    biggest ? `${biggest.category}贡献了最大的期间变化` : "两个期间的分类金额没有变化",
    `空心点 = ${previousLabel} · 实心点 = ${currentLabel} · 所有分类共用金额轴`
  );
  if (data.length === 0) return renderEmpty(chart, "两个期间都没有匹配记录");
  // Half-width category cards need their own readable coordinate system.
  // The old 820-wide canvas also shrank every label when fitted into the grid.
  const width = 540;
  const rowHeight = 64;
  const height = data.length * rowHeight + 72;
  const left = 100;
  const right = 452;
  const max = Math.max(...data.flatMap((item) => [item.currentCents, item.previousCents]), 1);
  const unit = niceCurrencyUnit(max, 24);
  const scale = (value: number): number => left + value / max * (right - left);
  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "分类支出两期哑铃对比图" });
  svg.classList.add("ledger-svg", "ledger-dumbbell-chart", "ledger-desktop-chart");
  data.forEach((item, index) => {
    const y = 42 + index * rowHeight;
    const previousX = scale(item.previousCents);
    const currentX = scale(item.currentCents);
    const group = svgEl("g");
    accessibleTarget(group, `${item.category}，本期 ${formatCents(item.currentCents)}，基期 ${formatCents(item.previousCents)}`, () => onClick(item.category));
    const label = svgEl("text", { x: left - 12, y: y + 4, "text-anchor": "end", class: "ledger-axis-label ledger-dumbbell-category" });
    label.textContent = item.category;
    group.append(label, svgEl("line", { x1: left, y1: y, x2: right, y2: y, stroke: GRID, "stroke-width": 0.7 }));
    const diff = Math.abs(item.currentCents - item.previousCents);
    const beadCount = Math.min(28, Math.floor(diff / unit));
    for (let bead = 0; bead < beadCount; bead += 1) {
      const t = (bead + 0.5) / Math.max(beadCount, 1);
      const x = previousX + (currentX - previousX) * t;
      group.append(svgEl("circle", { cx: x, cy: y + (deterministic(bead + 1, index + 3) - 0.5) * 5, r: 1.8, fill: MUTED, class: "ledger-pop", style: `animation-delay:${index * 0.06 + bead * 0.018}s` }));
    }
    group.append(
      svgEl("circle", { cx: previousX, cy: y, r: 4.8, fill: PAPER, stroke: INK, "stroke-width": 1.2, class: "ledger-pop" }),
      svgEl("circle", { cx: currentX, cy: y, r: 4.8, fill: INK, class: "ledger-pop" })
    );
    const value = svgEl("text", { x: Math.max(previousX, currentX) + 10, y: y + 4, class: "ledger-value-label ledger-dumbbell-value" });
    value.textContent = formatCents(item.currentCents - item.previousCents);
    group.append(value);
    svg.append(group);
  });
  const foot = svgEl("text", { x: width / 2, y: height - 12, "text-anchor": "middle", class: "ledger-foot-label" });
  foot.textContent = `每珠约 ${formatCents(unit)} 差额 · 空心 ${previousLabel} · 实心 ${currentLabel}`;
  svg.append(foot);
  chart.append(svg);
  const mobile = chart.createDiv({ cls: "ledger-mobile-dumbbells" });
  data.forEach((item) => {
    const row = mobile.createEl("button", { cls: "ledger-mobile-dumbbell" });
    row.type = "button";
    row.setAttribute("aria-label", `${item.category}，本期 ${formatCents(item.currentCents)}，基期 ${formatCents(item.previousCents)}`);
    const head = row.createDiv({ cls: "ledger-mobile-chart-head" });
    head.createEl("strong", { text: item.category });
    const delta = item.currentCents - item.previousCents;
    head.createSpan({ cls: "ledger-mobile-delta", text: `${delta > 0 ? "+" : ""}${formatCents(delta)}` });
    const scales = row.createDiv({ cls: "ledger-mobile-dumbbell-scales", attr: { "aria-hidden": "true" } });
    for (const [label, value, kind] of [[previousLabel, item.previousCents, "is-base"], [currentLabel, item.currentCents, "is-current"]] as Array<[string, number, string]>) {
      const scaleRow = scales.createDiv({ cls: "ledger-mobile-scale-row" });
      scaleRow.createSpan({ text: label });
      const track = scaleRow.createDiv({ cls: "ledger-mobile-scale-track" });
      const line = track.createSpan({ cls: `ledger-mobile-scale-fill ${kind}` });
      line.style.width = `${Math.max(value > 0 ? 2 : 0, value / max * 100)}%`;
      const valueEl = scaleRow.createEl("strong", { text: formatCents(value) });
      valueEl.setAttribute("aria-hidden", "true");
    }
    row.addEventListener("click", () => onClick(item.category));
  });
  sourceLine(shell, "DUMBBELL QUEUE · MONO-BASIC · LOCAL LEDGER COMPARISON");
}

/** F6 / official C2 Paired Rungs: two ladders per category, one shared unit. */
export function renderPairedRungs(parent: HTMLElement, data: DumbbellDatum[], currentLabel: string, previousLabel: string, onClick: (category: string) => void): void {
  const biggest = [...data].sort((a, b) => Math.abs(b.currentCents - b.previousCents) - Math.abs(a.currentCents - a.previousCents))[0];
  const { shell, chart } = monoCard(parent, "LUPI BASICS · F6 PAIRED RUNGS",
    biggest && biggest.currentCents !== biggest.previousCents ? `${biggest.category}贡献了最大的期间变化` : "两个期间的分类金额没有变化",
    `每类两列 · 浅灰 ${previousLabel} · 深灰 ${currentLabel} · 橙色标注本期金额`);
  if (!data.length) return renderEmpty(chart, "两个期间都没有匹配记录");
  shell.classList.add("ledger-paired-card");
  // Preserve the template's two adjacent ladders without shrinking labels for
  // extra categories. The chart alone scrolls; the overview keeps two columns.
  const width = Math.max(460, data.length * 116 + 32), height = 344;
  const base = 302, plotHeight = 250;
  const max = Math.max(1, ...data.flatMap(item => [item.currentCents, item.previousCents]));
  const unit = niceCurrencyUnit(max, 38);
  const scroll = chart.createDiv({ cls: "ledger-paired-scroll", attr: { tabindex: "0", role: "region", "aria-label": "分类两期分组柱，左右滚动查看全部分类" } });
  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "分类支出两期分组阶梯柱状图" });
  svg.classList.add("ledger-svg", "ledger-paired-rungs");
  svg.style.width = `${width}px`;
  svg.append(svgEl("line", { x1: 12, y1: base + 4, x2: width - 12, y2: base + 4, stroke: GRID, "stroke-width": .8 }));
  data.forEach((item, index) => {
    const center = 16 + (index + .5) * (width - 32) / data.length;
    const group = svgEl("g", { class: "ledger-paired-group" });
    const description = `${item.category}，${currentLabel} ${formatCents(item.currentCents)}，${previousLabel} ${formatCents(item.previousCents)}，差额 ${formatCents(item.currentCents - item.previousCents)}`;
    accessibleTarget(group, description, () => onClick(item.category));
    const title = svgEl("title"); title.textContent = description; group.append(title);
    group.append(svgEl("rect", { x: center - 56, y: 8, width: 112, height: height - 12, fill: "transparent" }));
    for (const [cents, current] of [[item.previousCents, false], [item.currentCents, true]] as const) {
      const x = center + (current ? 25 : -25), value = Math.max(0, cents);
      const full = Math.floor(value / unit), remainder = value % unit;
      for (let k = 0; k < full + (remainder > 0 ? 1 : 0); k++) {
        const fraction = k < full ? 1 : remainder / unit;
        const y = base - Math.min(value, (k + 1) * unit) / max * plotHeight;
        const half = (11 - 1.2 + deterministic(k + 1, index + (current ? 7 : 2)) * 2.4) * fraction;
        group.append(svgEl("line", { x1: x - half, x2: x + half, y1: y, y2: y,
          stroke: current ? INK : FAINT, "stroke-width": 1.8, "stroke-dasharray": fraction < 1 ? "2 2" : "none",
          class: "ledger-fade ledger-paired-rung", "data-current": String(current), "data-unit-cents": unit, "data-fraction": fraction,
          style: `animation-delay:${index * .06 + k * .01 + (current ? .15 : 0)}s` }));
      }
      const label = svgEl("text", { x, y: base - value / max * plotHeight - 12, "text-anchor": "middle", class: current ? "ledger-paired-value is-current" : "ledger-paired-value is-base" });
      label.textContent = formatCents(cents); group.append(label);
    }
    const name = svgEl("text", { x: center, y: base + 24, "text-anchor": "middle", class: "ledger-paired-category" });
    name.textContent = item.category.length > 10 ? `${item.category.slice(0, 9)}…` : item.category;
    group.append(name); svg.append(group);
  });
  scroll.append(svg);
  chart.createDiv({ cls: "ledger-paired-key", text: `每档 = ${formatCents(unit)} · 虚线档表示不足一档的余数 · 左右滑动查看全部 ${data.length} 类` });
  sourceLine(shell, "PAIRED RUNGS · WIRE · LOCAL LEDGER COMPARISON");
}

export function renderEmpty(parent: HTMLElement, message: string): void {
  parent.createDiv({ cls: "ledger-empty", text: message });
}

export function renderFinanceAdvisor(parent: HTMLElement, snapshot: FinanceAdvisorSnapshot, state: FinanceAdviceViewState, onRefresh: () => void, animate = true, coverage?: FinanceCoverageReport, onOpenFile?: (path: string) => void, onManageFixed?: () => void, detailsExpanded = false, onDetailsExpandedChange?: (expanded: boolean) => void, balance?: BalanceStatus): void {
  const card = parent.createDiv({ cls: `ledger-advisor-card${animate ? " ledger-reveal" : ""}` });
  deferChartAnimation(card);
  card.setAttribute("aria-busy", String(state.status === "loading"));
  if (state.todayBudget) renderInlineBudget(card, state.todayBudget);
  const heading = card.createDiv({ cls: "ledger-advisor-heading" });
  const copy = heading.createDiv({ cls: "ledger-advisor-heading-copy" });
  copy.createEl("h3", { text: "近期洞察" });
  const analysisRange = state.analysisRange ?? snapshot.weekly?.range;
  heading.createDiv({ cls: "ledger-advisor-period", text: analysisRange ? `近 7 天 · ${analysisRange.start.replace(/-/g, ".")} — ${analysisRange.end.replace(/-/g, ".")} · 手动刷新` : snapshot.daily ? `截至 ${snapshot.daily.date.replace(/-/g, ".")} · 昨日记录 · 不受下方筛选影响` : `${snapshot.currentRange.start.replace(/-/g, ".")} — ${snapshot.currentRange.end.replace(/-/g, ".")}` });

  if (snapshot.salaryCents <= 0 && !snapshot.daily) {
    card.addClass("is-empty");
    const empty = card.createDiv({ cls: "ledger-advisor-empty" });
    empty.createEl("strong", { text: state.canRefresh ? "AI 已配置，还差工资金额" : "填写工资后启用洞察" });
    empty.createSpan({ text: "请在插件设置的“余额校准”中填写每个工资周期到账工资。周期预测和 AI 判断依赖此项。" });
    if (state.message) empty.createDiv({ cls: `ledger-advisor-ai-status is-${state.status}`, text: state.message });
    card.createDiv({ cls: "ledger-advisor-source", text: "SALARY CYCLE · TWO-CYCLE BASELINE · LOCAL LEDGER" });
    return;
  }

  const remainingCents = balance?.remainingCents ?? snapshot.remainingSalaryCents;
  const remaining = heading.createDiv({ cls: `ledger-advisor-remaining${remainingCents < 0 ? " is-negative" : ""}` });
  remaining.createSpan({ text: snapshot.salaryCents <= 0 ? "工资尚未设置" : balance?.calibrated ? remainingCents < 0 ? "当前负债 · 已校准" : "目前还剩 · 已校准" : "目前还剩" });
  remaining.createEl("strong", { text: snapshot.salaryCents > 0 ? formatCents(remainingCents) : "昨日简报可用" });

  const event = snapshot.events.find((item) => item.id === state.advice?.primaryEventId) ?? snapshot.events[0];
  const observation = card.createDiv({ cls: `ledger-advisor-observation is-${event.type}${state.advice?.tone === "warning" ? " is-warning" : ""}` });
  const controls = observation.createDiv({ cls: "ledger-advisor-actions" });
  const refresh = controls.createEl("button", { cls: "ledger-advisor-refresh ledger-advisor-icon-refresh", attr: { type: "button", "aria-label": state.status === "loading" ? "正在生成财务判断" : "刷新判断", title: "刷新判断" } });
  setIcon(refresh, state.status === "loading" ? "loader-circle" : "refresh-cw");
  refresh.disabled = state.status === "loading" || !state.canRefresh;
  refresh.addEventListener("click", onRefresh);
  const infoToggle = controls.createEl("button", {
    cls: "ledger-advisor-info-toggle",
    attr: { type: "button", "aria-label": "查看洞察说明", "aria-expanded": "false" }
  });
  setIcon(infoToggle, "circle-alert");
  const label = observation.createDiv({ cls: "ledger-advisor-observation-label", text: state.advice ? "AI 洞察" : snapshot.weekly ? "近 7 天洞察" : "昨日消费简报" });
  if (state.updateAvailable && state.canRefresh && state.status !== "loading") {
    const update = label.createEl("button", { cls: "ledger-advisor-update-hint", text: "可更新", attr: { type: "button", title: "新一天的数据已可分析，点击更新洞察", "aria-label": "旧洞察可更新，点击刷新" } });
    update.addEventListener("click", onRefresh);
  }
  const advice = state.advice ? compactFinanceAdvice(state.advice) : null;
  observation.createEl("h4", { text: advice?.headline ?? (snapshot.weekly ? "洞察待生成" : event.title) });
  if (advice?.judgment || !advice) observation.createEl("p", { cls: "ledger-advisor-judgment", text: advice?.judgment ?? (snapshot.weekly ? "手动刷新后显示截至昨天的近 7 天分析。" : `${event.detail}${snapshot.daily?.action ?? eventAdvice(event)}`) });
  if (advice?.action) {
    const action = observation.createDiv({ cls: "ledger-advisor-action" });
    action.createSpan({ text: "建议" });
    action.createEl("p", { text: advice.action });
  }
  if (state.message) observation.createDiv({ cls: `ledger-advisor-ai-status is-${state.status}`, text: state.message });

  const infoPanel = observation.createDiv({ cls: "ledger-advisor-info-panel", attr: { role: "region", "aria-label": "洞察说明" } });
  infoPanel.hidden = true;
  infoToggle.addEventListener("click", () => {
    infoPanel.hidden = !infoPanel.hidden;
    infoToggle.setAttribute("aria-expanded", String(!infoPanel.hidden));
    observation.toggleClass("has-open-info", !infoPanel.hidden);
  });
  observation.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !infoPanel.hidden) {
      infoPanel.hidden = true;
      infoToggle.setAttribute("aria-expanded", "false");
      observation.removeClass("has-open-info");
      infoToggle.focus();
    }
  });

  const evidence = infoPanel.createDiv({ cls: "ledger-advisor-info-section" });
  evidence.createEl("h5", { text: analysisRange && snapshot.weekly && analysisRange.end !== snapshot.weekly.range.end ? "当前账本参考 · 上次 AI 分析期间见卡片日期" : "判断依据" });
  evidence.createEl("strong", { text: event.title });
  const evidenceList = evidence.createEl("ul");
  for (const line of event.evidence ?? [event.detail]) evidenceList.createEl("li", { text: line });

  if (snapshot.repeatedEvents?.length) {
    const repeated = infoPanel.createDiv({ cls: "ledger-advisor-info-section" });
    repeated.createEl("h5", { text: `已关注且仍有效 · ${snapshot.repeatedEvents.length}` });
    repeated.createEl("p", { text: "AI 分析仅手动刷新，数据截止到生成时的昨天；已经看过不代表周期异常已解决。仍有效的异常单独保留。" });
    for (const item of snapshot.repeatedEvents) {
      repeated.createEl("strong", { text: item.title });
      repeated.createEl("p", { text: item.detail });
    }
  }
  if (onManageFixed) {
    const fixed = infoPanel.createDiv({ cls: "ledger-advisor-info-section" });
    fixed.createEl("h5", { text: `固定支出 · ${snapshot.fixedExpenses?.items.length ?? 0} 项${snapshot.fixedExpenses?.available === false ? "待核对" : ""}` });
    fixed.createEl("p", { text: "工资日：每月 15 日。手动确认实际支付记录，不修改账目；未配置时继续按历史支出参考。" });
    const statuses = { paid: "已付", unpaid: "未付", none: "无需支付", unconfirmed: "待确认" };
    for (const item of snapshot.fixedExpenses?.items ?? []) {
      fixed.createEl("p", { text: `${item.name} · ${statuses[item.status]} · ${formatCents(item.status === "paid" ? item.paidCents : item.amountCents)}` });
      for (const issue of item.issues) fixed.createEl("small", { text: issue });
    }
    createButton(fixed, "管理固定支出").addEventListener("click", onManageFixed);
  }

  if (coverage) {
    const issueCount = coverage.undated.length + coverage.cycles.reduce((sum, cycle) => sum + cycle.missingDates.length + cycle.problems.length, 0);
    const details = infoPanel.createDiv({ cls: "ledger-advisor-info-section" });
    const zeroDays = coverage.cycles.reduce((sum, cycle) => sum + cycle.assumedZeroDates.length, 0);
    details.createEl("h5", { text: issueCount ? `统计口径 · ${issueCount} 项待核对` : zeroDays ? `统计口径 · ${zeroDays} 天未记账按零消费` : "统计口径 · 记录齐全" });
    details.createEl("p", { text: snapshot.weekly ? "近 7 天和前 7 天缺失日期不按零消费，完整的明确零消费日计入覆盖。历史周均只取此前 4 个七天窗口中完整的窗口。以下工资周期背景仍沿用原有未记账日按零的统计口径，不能据此认定周趋势完整。" : "未记账日期按 ¥0 参与洞察；若有漏记，补记后会重新计算。解析或金额核对异常仍需处理，不会当成零消费。" });
    const problemLink = (path: string, reason: string) => {
      const row = details.createDiv({ cls: "ledger-advisor-data-issue" });
      const button = row.createEl("button", { text: path, attr: { type: "button" } });
      button.addEventListener("click", () => onOpenFile?.(path));
      row.createSpan({ text: reason });
    };
    for (const cycle of coverage.cycles) {
      details.createEl("h4", { text: `${cycle.label}：${cycle.range.start} — ${cycle.range.end}` });
      if (!cycle.missingDates.length && !cycle.problems.length && !cycle.assumedZeroDates.length) details.createEl("p", { text: "每天均有可用账本，包含明确记录的零消费日。" });
      if (cycle.assumedZeroDates.length) details.createEl("p", { text: `未记账，按零消费：${cycle.assumedZeroDates.join("、")}` });
      if (cycle.missingDates.length) details.createEl("p", { text: `记账起始之前，未纳入历史参考：${cycle.missingDates.join("、")}` });
      for (const problem of cycle.problems) problemLink(problem.path, `${problem.date}：${problem.reason}`);
    }
    if (coverage.undated.length) {
      details.createEl("h4", { text: "无法归入日期的账本" });
      for (const problem of coverage.undated) problemLink(problem.path, problem.reason);
    }
  }

  const referencesPanel = card.createDiv({ cls: "ledger-advisor-references" });
  const summary = referencesPanel.createDiv({ cls: `ledger-advisor-summary${detailsExpanded ? " is-open" : ""}` });
  const spent = summary.createDiv({ cls: "ledger-advisor-summary-item" });
  spent.createSpan({ text: "本次自工资日支出" });
  spent.createEl("strong", { text: formatCents(snapshot.currentSpentCents) });
  const average = summary.createDiv({ cls: "ledger-advisor-summary-item" });
  average.createSpan({ text: snapshot.historyCycleCount === 2 ? "前两个完整周期平均" : `可用历史周期 ${snapshot.historyCycleCount}/2` });
  average.createEl("strong", { text: snapshot.historyCycleCount > 0 ? formatCents(snapshot.historicalAverageSpentCents) : "参考数据不足" });
  const forecast = summary.createDiv({ cls: "ledger-advisor-summary-item ledger-advisor-forecast" });
  forecast.createSpan({ text: `周期末支出参考${snapshot.forecastAvailable && snapshot.forecastConfidence === "low" ? " · 低置信度" : ""}` });
  forecast.createEl("strong", { text: snapshot.forecastAvailable ? formatCents(snapshot.forecastCents) : snapshot.fixedExpenses?.available === false ? "固定支出待确认" : "数据不足，暂不预测" });
  forecast.createEl("small", { text: snapshot.fixedExpenses?.items.length ? "已花＋历史剩余支出（剔除已确认固定项）＋本期未付固定项" : "已花金额＋历史剩余阶段平均支出" });

  const references = snapshot.categories
      .filter((item) => item.baselineCycleCents > 0 || item.currentCents > 0)
      .sort((a, b) => b.remainingReferenceCents - a.remainingReferenceCents || b.baselineCycleCents - a.baselineCycleCents)
      .slice(0, 3);
  if (references.length > 0 && snapshot.historyCycleCount > 0) {
    const section = summary.createDiv({ cls: "ledger-advisor-categories" });
    const sectionHeading = section.createDiv({ cls: "ledger-advisor-section-heading" });
    sectionHeading.createSpan({ text: snapshot.historyCycleCount === 2 ? "分类参考余量" : "分类参考余量 · 仅一个历史周期" });
    sectionHeading.createEl("small", { text: `已扫描 ${snapshot.categories.length} 个分类` });
    const list = section.createDiv({ cls: "ledger-advisor-category-list" });
    const renderReference = (parent: HTMLElement, item: typeof references[number]) => {
      const row = parent.createDiv({ cls: "ledger-advisor-category" });
      row.createSpan({ text: item.category });
      const value = row.createDiv();
      value.createEl("strong", { text: formatCents(item.remainingReferenceCents) });
      value.createEl("small", { text: `过往周期均值 ${formatCents(item.baselineCycleCents)}` });
    };
    renderReference(list, references[0]);
    if (references.length > 1) {
      const more = section.createEl("details", { cls: "ledger-advisor-category-more" });
      more.open = detailsExpanded;
      more.createEl("summary", { text: `其他 ${references.length - 1} 个分类` });
      const hiddenList = more.createDiv({ cls: "ledger-advisor-category-list" });
      references.slice(1).forEach(item => renderReference(hiddenList, item));
      more.addEventListener("toggle", () => onDetailsExpandedChange?.(more.open));
    }
  }
}

function renderInlineBudget(card: HTMLElement, budget: NonNullable<FinanceAdviceViewState["todayBudget"]>): void {
  const progress = budgetProgress(budget.spentCents, budget.budgetCents);
  const strip = card.createDiv({ cls: `ledger-advisor-budget${progress.overBudgetCents > 0 ? " is-over" : ""}` });
  const labels = strip.createDiv({ cls: "ledger-advisor-budget-labels" });
  const title = labels.createDiv();
  title.createEl("strong", { text: "今日预算" });
  title.createSpan({ cls: "ledger-advisor-budget-scope", text: `${budget.date.replace(/-/g, ".")} · ${budget.category || "全部分类"} · ${budget.includeStarred ? "含星标" : "不含星标"}` });
  labels.createSpan({ cls: "ledger-advisor-budget-value", text: budget.budgetCents > 0
    ? `已花 ${formatCents(budget.spentCents)} / ${formatCents(budget.budgetCents)}`
    : `已花 ${formatCents(budget.spentCents)} · 请在设置中填写每日预算` });
  if (budget.budgetCents > 0) {
    const status = labels.createDiv({ cls: "ledger-advisor-budget-status" });
    status.createSpan({ text: progress.overBudgetCents ? "超出 " + formatCents(progress.overBudgetCents) : "剩余 " + formatCents(progress.remainingCents) });
    status.createSpan({ cls: "ledger-advisor-budget-percent", text: `${Math.round(progress.ratio * 100)}%`, attr: { "aria-label": `已使用 ${Math.round(progress.ratio * 100)}%` } });
    const track = strip.createDiv({ cls: "ledger-advisor-budget-track", attr: { role: "progressbar", "aria-label": "今日预算使用情况", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(progress.percent), "aria-valuetext": `已使用 ${Math.round(progress.ratio * 100)}%${progress.overBudgetCents ? "，超出 " + formatCents(progress.overBudgetCents) : "，剩余 " + formatCents(progress.remainingCents)}` } });
    track.createDiv({ cls: `ledger-advisor-budget-fill${progress.percent === 0 ? " is-zero" : ""}`, attr: { style: `width: ${progress.percent}%` } });
  }
}

export function renderLiquidBudget(parent: HTMLElement, spentCents: number, budgetCents: number, dateLabel: string, currentCycleCents: number, budgetCategory: string, includeStarred: boolean): void {
  const card = parent.createDiv({ cls: "ledger-budget-card ledger-reveal" });
  deferChartAnimation(card);
  const heading = card.createDiv({ cls: "ledger-budget-heading" });
  const title = heading.createDiv();
  const starredScope = includeStarred ? "含星标" : "不含星标";
  title.createDiv({ cls: "ledger-budget-badge", text: `TODAY · ${budgetCategory || "ALL SPENDING"} · ${starredScope}` });
  title.createEl("h3", { text: "今日预算" });
  title.createDiv({ cls: "ledger-budget-date", text: dateLabel });

  const progress: BudgetProgress = budgetProgress(spentCents, budgetCents);
  if (budgetCents > 0) {
    const status = heading.createDiv({ cls: `ledger-budget-status${progress.overBudgetCents > 0 ? " is-over" : ""}` });
    status.createEl("strong", { text: `${Math.round(progress.ratio * 100)}%` });
    status.createSpan({ text: progress.overBudgetCents > 0 ? "已超支" : "已使用" });
  }

  const values = card.createDiv({ cls: "ledger-budget-values" });
  const spent = values.createDiv({ cls: "ledger-budget-spent" });
  spent.createSpan({ cls: "ledger-budget-label", text: "今日已花" });
  spent.createEl("strong", { text: formatCents(spentCents) });
  if (budgetCents > 0) {
    values.createSpan({ cls: "ledger-budget-divider", attr: { "aria-hidden": "true" } });
    const target = values.createDiv({ cls: "ledger-budget-target" });
    target.createSpan({ cls: "ledger-budget-label", text: "每日预算" });
    target.createEl("strong", { text: formatCents(budgetCents) });
    target.createDiv({ cls: "ledger-budget-monthly", text: `按每天 ${formatCents(budgetCents)} 估算，月支出约 ${formatCents(budgetCents * MONTH_ESTIMATE_DAYS)}` });
    target.createDiv({ cls: "ledger-budget-current", text: `当前支出 ${formatCents(currentCycleCents)}` });
  }

  if (budgetCents <= 0) {
    card.createDiv({ cls: "ledger-budget-empty", text: "请在设置中填写每日预算" });
    return;
  }

  const track = card.createDiv({
      cls: "ledger-budget-track",
      attr: {
        role: "progressbar",
        "aria-label": `${budgetCategory || "全部分类"}今日预算（${starredScope}），已花 ${formatCents(spentCents)}，预算 ${formatCents(budgetCents)}`,
        "aria-valuemin": "0",
        "aria-valuemax": "100",
        "aria-valuenow": String(Math.round(progress.percent))
      }
  });
  const fill = track.createDiv({ cls: `ledger-budget-fill${progress.overBudgetCents > 0 ? " is-over" : ""}` });
  fill.style.setProperty("--budget-progress", `${progress.percent}%`);

  const detail = card.createDiv({ cls: `ledger-budget-detail${progress.overBudgetCents > 0 ? " is-over" : ""}` });
  if (progress.overBudgetCents > 0) {
    detail.createSpan({ text: `已超支 ${formatCents(progress.overBudgetCents)}` });
    detail.createSpan({ cls: "ledger-budget-ratio", text: `${Math.round(progress.ratio * 100)}%` });
  } else {
    detail.createSpan({ text: `剩余 ${formatCents(progress.remainingCents)}` });
    detail.createSpan({ cls: "ledger-budget-ratio", text: `${Math.round(progress.ratio * 100)}%` });
  }
  card.createDiv({ cls: "ledger-budget-source", text: `TODAY · ${budgetCategory || "ALL CATEGORIES"} · ${includeStarred ? "WITH STARRED" : "EXCLUDING STARRED"} · LOCAL LEDGER` });
}

export function renderStarredExpenses(parent: HTMLElement, records: LedgerRecord[], onClick: (record: LedgerRecord) => void): void {
  const card = parent.createDiv({ cls: "ledger-starred-card ledger-reveal" });
  deferChartAnimation(card);
  const heading = card.createDiv({ cls: "ledger-starred-heading" });
  const headingCopy = heading.createDiv({ cls: "ledger-starred-heading-copy" });
  headingCopy.createDiv({ cls: "ledger-mono-badge", text: "STARRED EXPENSES · MANUAL CURATION" });
  headingCopy.createEl("h3", { text: "星标支出" });
  headingCopy.createDiv({ cls: "ledger-mono-sub", text: "当前筛选下的手动星标记录，不按金额自动判断。" });
  const totalCents = records.reduce((sum, record) => sum + record.cents, 0);
  const summary = heading.createDiv({ cls: "ledger-starred-summary" });
  summary.createEl("strong", { text: formatCents(totalCents) });
  summary.createSpan({ text: `${records.length} 笔星标` });
  if (records.length === 0) {
    card.createDiv({ cls: "ledger-starred-empty", text: "暂无星标支出 · 在明细中右键或长按一笔记录即可标记" });
  } else {
    const list = card.createDiv({ cls: "ledger-starred-list" });
    for (const record of records) {
      const item = list.createEl("button", {
        cls: "ledger-starred-item",
        attr: { type: "button", "aria-label": `${record.category} ${formatCents(record.cents)}，${record.date}` }
      });
      const icon = item.createSpan({ cls: "ledger-starred-item-icon" });
      setIcon(icon, "star");
      const copy = item.createDiv({ cls: "ledger-starred-copy" });
      const top = copy.createDiv({ cls: "ledger-starred-item-top" });
      top.createEl("strong", { text: record.category });
      top.createSpan({ text: `${record.date} · ${record.time}` });
      copy.createDiv({ cls: "ledger-starred-note", text: record.note || "无备注" });
      item.createEl("strong", { cls: "ledger-starred-amount", text: formatCents(record.cents) });
      item.addEventListener("click", () => onClick(record));
    }
  }
  card.createDiv({ cls: "ledger-mono-source", text: "STARRED RECORDS · LOCAL LEDGER · MANUAL ONLY" });
}

export function createButton(parent: HTMLElement, text: string, active = false): HTMLButtonElement {
  const button = parent.createEl("button", { cls: `ledger-button${active ? " is-active" : ""}`, text });
  button.type = "button";
  return button;
}
