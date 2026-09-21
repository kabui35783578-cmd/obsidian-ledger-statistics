import { setIcon } from "obsidian";
import { BudgetProgress, CategorySummary, FinanceAdvisorSnapshot, LedgerRecord, TrendPoint, budgetProgress, formatCents } from "./core";
import type { FinanceAdvice } from "./ai";

export interface FinanceAdviceViewState {
  status: "local" | "loading" | "ready" | "error" | "unconfigured";
  advice: FinanceAdvice | null;
  message: string;
  canRefresh: boolean;
}

const SVG_NS = "http://www.w3.org/2000/svg";
// Lieflat Charts "Wire": grayscale carries the data; orange marks one focal point.
const INK = "#1F1E1C";
const PAPER = "#F0F0EE";
const MUTED = "#8F8E86";
const FAINT = "#C0BFB7";
const GRID = "#DBDAD3";
const HERO = "#F5572F";
const LADDER = ["#22211F", "#4A4945", "#6E6D66", "#8F8E86", "#AAA9A2", "#C0BFB7", "#DBDAD3"];
const MONTH_ESTIMATE_DAYS = 31;

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  return element;
}

function deterministic(index: number, salt: number): number {
  return Math.abs(((index * 73856093) ^ (salt * 19349663)) % 1000) / 1000;
}

function monoCard(parent: HTMLElement, badge: string, title: string, subtitle: string): { shell: HTMLElement; chart: HTMLElement } {
  const shell = parent.createDiv({ cls: "ledger-mono-card ledger-reveal" });
  shell.createDiv({ cls: "ledger-mono-badge", text: badge });
  shell.createEl("h3", { text: title });
  shell.createDiv({ cls: "ledger-mono-sub", text: subtitle });
  const chart = shell.createDiv({ cls: "ledger-mono-chart" });
  return { shell, chart };
}

function sourceLine(parent: HTMLElement, text: string): void {
  parent.createDiv({ cls: "ledger-mono-source", text });
}

function niceCurrencyUnit(maxCents: number, targetTicks = 32): number {
  if (maxCents <= 0) return 100;
  const raw = maxCents / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return Math.max(1, Math.round(step * magnitude));
}

function accessibleTarget(element: SVGElement, label: string, activate: () => void): void {
  element.setAttribute("tabindex", "0");
  element.setAttribute("role", "button");
  element.setAttribute("aria-label", label);
  element.classList.add("ledger-chart-target");
  element.addEventListener("click", activate);
  element.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") activate();
  });
}

function trendTooltip(x: number, y: number, chartWidth: number, value: string, mobile = false): SVGGElement {
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
  target.addEventListener("click", (event) => {
    if (previewOnFirstActivation && !group.classList.contains("is-active")) {
      event.preventDefault();
      event.stopPropagation();
      svg.querySelectorAll(".ledger-trend-point.is-active").forEach((point) => point.classList.remove("is-active"));
      group.classList.add("is-active");
      return;
    }
    activate();
  });
  target.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate();
    }
  });
}

function strongestCategory(data: CategorySummary[]): string {
  return data[0]?.category ?? "暂无分类";
}

function pctText(cents: number, total: number): string {
  return total === 0 ? "占比 0.0%" : `占比 ${(cents / total * 100).toFixed(1)}%`;
}

function renderMobileTickRows(parent: HTMLElement, data: CategorySummary[], max: number, onClick: (category: string) => void): void {
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
    const track = row.createDiv({ cls: "ledger-mobile-tick-track", attr: { "aria-hidden": "true" } });
    const tickCount = Math.max(item.cents > 0 ? 1 : 0, Math.round(item.cents / max * 28));
    for (let tick = 0; tick < tickCount; tick += 1) {
      const mark = track.createSpan({ cls: `ledger-mobile-tick${index === 0 ? " is-leading" : ""}` });
      mark.style.height = `${10 + deterministic(tick + 1, index + 2) * 13}px`;
      mark.style.animationDelay = `${index * 0.05 + tick * 0.012}s`;
    }
    row.addEventListener("click", () => onClick(item.category));
  });
}

export function renderHorizontalBars(parent: HTMLElement, data: CategorySummary[], onClick: (category: string) => void): void {
  const total = data.reduce((sum, item) => sum + item.cents, 0);
  const leader = data[0];
  const { shell, chart } = monoCard(
    parent,
    "LUPI BASICS · F5 TICK ROWS",
    leader ? `${leader.category}是本期最重的一行` : "本期还没有形成分类队列",
    leader ? `每根刻线代表同一金额单位 · 行尾保留精确金额 · ${pctText(leader.cents, total)}` : "分类金额 · 当前筛选范围"
  );
  if (data.length === 0) return renderEmpty(chart, "当前筛选条件下没有可绘制的数据");
  const width = 820;
  const height = Math.max(330, data.length * 44 + 58);
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
    accessibleTarget(group, `${item.category} ${formatCents(item.cents)}，${item.count} 笔`, () => onClick(item.category));
    const label = svgEl("text", { x: x0 - 12, y: y + 3, "text-anchor": "end", class: "ledger-axis-label" });
    label.textContent = item.category;
    const baseline = svgEl("line", { x1: x0, y1: y + 9, x2: x0 + plotWidth, y2: y + 9, stroke: GRID, "stroke-width": 0.8 });
    group.append(label, baseline);
    const full = Math.floor(item.cents / unit);
    const remainder = item.cents % unit;
    for (let tick = 0; tick < full; tick += 1) {
      const x = x0 + (tick + 0.5) * px;
      group.append(svgEl("line", {
        x1: x, y1: y + 9, x2: x, y2: y - 2 - deterministic(tick + 1, index + 2) * 7,
        stroke: index === 0 ? HERO : LADDER[Math.min(index, 4)], "stroke-width": index === 0 ? 1.8 : 1,
        class: "ledger-fade", style: `animation-delay:${index * 0.08 + tick * 0.012}s`
      }));
      if (tick % 5 === 4) group.append(svgEl("circle", { cx: x, cy: y + 14, r: 1, fill: FAINT }));
    }
    if (remainder > 0) {
      const x = x0 + (full + 0.5) * px;
      group.append(svgEl("line", {
        x1: x, y1: y + 9, x2: x, y2: y + 9 - 13 * remainder / unit,
        stroke: LADDER[Math.min(index, 4)], "stroke-width": 1, "stroke-dasharray": "2 2",
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
  unitText.textContent = `ONE TICK = ${formatCents(unit)} · DASHED FINAL TICK = REMAINDER`;
  svg.append(unitText);
  chart.append(svg);
  renderMobileTickRows(chart, data, max, onClick);
  sourceLine(shell, "TICK ROWS · MONO-BASIC · LOCAL LEDGER");
}

function polar(cx: number, cy: number, radius: number, angle: number): { x: number; y: number } {
  const radians = angle * Math.PI / 180;
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
}

function allocateHundred(data: CategorySummary[]): number[] {
  const exact = data.map((item) => item.share * 100);
  const allocated = exact.map(Math.floor);
  let remainder = 100 - allocated.reduce((sum, value) => sum + value, 0);
  const order = exact.map((value, index) => ({ index, fraction: value - Math.floor(value) })).sort((a, b) => b.fraction - a.fraction);
  for (let index = 0; index < order.length && remainder > 0; index += 1, remainder -= 1) allocated[order[index].index] += 1;
  return allocated;
}

export function renderDonut(parent: HTMLElement, data: CategorySummary[], onClick: (category: string) => void): void {
  const total = data.reduce((sum, item) => sum + item.cents, 0);
  const { shell, chart } = monoCard(
    parent,
    "LUPI BASICS · F4 TICK DONUT",
    data.length ? `${strongestCategory(data)}占据最大的表盘区段` : "表盘等待第一笔支出",
    "一根刻线 = 约 1 个百分点 · 精确占比见图例 · 顺时针读取"
  );
  if (data.length === 0 || total === 0) return renderEmpty(chart, "合计为零，无法计算占比");
  const wrap = chart.createDiv({ cls: "ledger-donut-wrap" });
  const svg = svgEl("svg", { viewBox: "0 0 340 320", role: "img", "aria-label": "分类支出百分比刻线环" });
  svg.classList.add("ledger-svg", "ledger-tick-donut");
  const allocation = allocateHundred(data);
  let cursor = 0;
  data.forEach((item, categoryIndex) => {
    const group = svgEl("g");
    accessibleTarget(group, `${item.category} ${(item.share * 100).toFixed(1)}%，${formatCents(item.cents)}`, () => onClick(item.category));
    for (let local = 0; local < allocation[categoryIndex]; local += 1) {
      const tick = cursor + local;
      const angle = tick * 3.6 - 90;
      const inner = polar(170, 145, 70, angle);
      const length = 11 + deterministic(tick + 1, categoryIndex + 2) * 7;
      const outer = polar(170, 145, 70 + length, angle);
      group.append(svgEl("line", {
        x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y,
        stroke: categoryIndex === 0 ? HERO : LADDER[Math.min(categoryIndex, LADDER.length - 1)], "stroke-width": categoryIndex === 0 ? 1.8 : 1,
        class: "ledger-fade", style: `animation-delay:${tick * 0.012}s`
      }));
      if (tick % 10 === 0) {
        const dot = polar(170, 145, 63, angle);
        group.append(svgEl("circle", { cx: dot.x, cy: dot.y, r: 1, fill: FAINT }));
      }
    }
    cursor += allocation[categoryIndex];
    svg.append(group);
  });
  const center = svgEl("text", { x: 170, y: 140, "text-anchor": "middle", class: "ledger-donut-total" });
  center.textContent = formatCents(total);
  const centerSub = svgEl("text", { x: 170, y: 160, "text-anchor": "middle", class: "ledger-foot-label" });
  centerSub.textContent = "100 TICKS · LOCAL TOTAL";
  svg.append(center, centerSub);
  wrap.append(svg);
  const legend = wrap.createDiv({ cls: "ledger-legend" });
  data.forEach((item, index) => {
    const button = legend.createEl("button", { cls: "ledger-legend-item" });
    const swatch = button.createSpan({ cls: "ledger-swatch" });
    swatch.style.backgroundColor = LADDER[Math.min(index, LADDER.length - 1)];
    button.createSpan({ text: `${item.category} · ${(item.share * 100).toFixed(1)}%` });
    button.addEventListener("click", () => onClick(item.category));
  });
  sourceLine(shell, "TICK DONUT · MONO-BASIC · LOCAL LEDGER");
}

function trendConclusion(points: TrendPoint[]): string {
  if (points.length === 0) return "这段时间还没有形成趋势";
  const peak = points.reduce((best, point) => point.cents > best.cents ? point : best, points[0]);
  return `${peak.label}是这段时间的支出峰值`;
}

function renderMobileTrend(parent: HTMLElement, points: TrendPoint[], isLine: boolean, onClick: (point: TrendPoint) => void): void {
  const viewport = parent.createDiv({ cls: "ledger-mobile-trend-scroll" });
  const width = points.length > 10 ? points.length * 34 + 74 : 360;
  const height = 252;
  const left = 44;
  const right = width - 14;
  const top = 38;
  const base = 194;
  const plotWidth = right - left;
  const plotHeight = base - top;
  const max = Math.max(...points.map((point) => point.cents), 1);
  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": isLine ? "移动端支出折线图" : "移动端支出柱状图" });
  svg.classList.add("ledger-svg", "ledger-mobile-trend");
  svg.style.width = `${width}px`;
  for (let tick = 0; tick <= 3; tick += 1) {
    const y = base - tick / 3 * plotHeight;
    svg.append(svgEl("line", { x1: left, y1: y, x2: right, y2: y, stroke: GRID, "stroke-width": 0.8 }));
    const label = svgEl("text", { x: left - 7, y: y + 4, "text-anchor": "end", class: "ledger-mobile-axis-value" });
    label.textContent = formatCents(Math.round(max * tick / 3)).replace(".00", "");
    svg.append(label);
  }
  const slot = plotWidth / Math.max(points.length, 1);
  const coords: Array<{ x: number; y: number }> = [];
  const peakIndex = points.reduce((best, point, index) => point.cents > points[best].cents ? index : best, 0);
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));
  points.forEach((point, index) => {
    const x = left + slot * index + slot / 2;
    const y = base - point.cents / max * plotHeight;
    coords.push({ x, y });
    if (!isLine) svg.append(svgEl("line", { x1: x, y1: base, x2: x, y2: y, stroke: index === peakIndex ? INK : MUTED, "stroke-width": index === peakIndex ? 2.4 : 1.4, class: "ledger-fade" }));
    if (isLine) {
      const group = svgEl("g", { class: "ledger-trend-point" });
      group.append(svgEl("circle", { cx: x, cy: y, r: index === peakIndex ? 4.8 : 3, fill: index === peakIndex ? HERO : INK, class: "ledger-pop ledger-trend-dot" }));
      if (index === peakIndex) {
        const peak = svgEl("text", { x, y: Math.max(19, y - 11), "text-anchor": "middle", class: "ledger-mobile-value-label ledger-peak-label ledger-persistent-peak" });
        peak.textContent = formatCents(point.cents);
        group.append(peak);
      }
      group.append(trendTooltip(x, y, width, formatCents(point.cents), true));
      const hit = svgEl("circle", { cx: x, cy: y, r: 22, fill: "transparent" });
      interactiveTrendTarget(svg, group, hit, `${point.label} ${formatCents(point.cents)}，${point.count} 笔`, () => onClick(point), true);
      group.append(hit);
      svg.append(group);
    } else {
      const hitWidth = Math.max(slot, 24);
      const hit = svgEl("rect", { x: x - hitWidth / 2, y: top, width: hitWidth, height: plotHeight + 30, fill: "transparent" });
      accessibleTarget(hit, `${point.label} ${formatCents(point.cents)}，${point.count} 笔`, () => onClick(point));
      svg.append(hit);
    }
    if (!isLine && index === peakIndex) {
      const value = svgEl("text", { x, y: Math.max(19, y - 11), "text-anchor": "middle", class: "ledger-mobile-value-label ledger-peak-label" });
      value.textContent = formatCents(point.cents);
      svg.append(value);
    }
    if ((index % labelEvery === 0 && index <= points.length - 1 - labelEvery) || index === points.length - 1) {
      const label = svgEl("text", { x, y: base + 23, "text-anchor": "middle", class: "ledger-mobile-axis-label" });
      label.textContent = point.label.length > 5 ? point.label.slice(-5) : point.label;
      svg.append(label);
    }
  });
  const outline = svgEl("path", { d: `M${coords.map((point) => `${point.x} ${point.y}`).join(" L ")}`, fill: "none", stroke: INK, "stroke-width": isLine ? 1.8 : 1.2, pathLength: 1, class: "ledger-draw" });
  if (isLine) svg.insertBefore(outline, svg.firstChild); else svg.append(outline);
  const foot = svgEl("text", { x: width / 2, y: height - 10, "text-anchor": "middle", class: "ledger-mobile-foot-label" });
  foot.textContent = isLine
    ? (points.length > 10 ? "左右滑动 · 轻点顶点显示金额" : "轻点顶点显示金额 · 再点一次查看明细")
    : (points.length > 10 ? "左右滑动查看完整时间范围" : "点击数据点查看对应明细");
  svg.append(foot);
  viewport.append(svg);
}

export function renderTrendChart(parent: HTMLElement, points: TrendPoint[], type: "line" | "bar", onClick: (point: TrendPoint) => void): void {
  const isLine = type === "line";
  const { shell, chart } = monoCard(
    parent,
    isLine ? "LUPI BASICS · F2 HAIRLINE LINE" : "LUPI BASICS · F3 HAIRLINE AREA",
    trendConclusion(points),
    isLine ? "一个圆点 = 一个时间桶 · 发丝折线保持逐日读数" : "一根发丝 = 一个时间桶 · 从地板生长到当期金额"
  );
  if (points.length === 0) return renderEmpty(chart, "当前筛选条件下没有可绘制的数据");
  const width = 820;
  const height = 330;
  const left = 54;
  const top = 34;
  const base = 254;
  const plotWidth = width - left - 26;
  const plotHeight = base - top;
  const max = Math.max(...points.map((point) => point.cents), 1);
  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": isLine ? "支出发丝折线图" : "支出发丝柱状图" });
  svg.classList.add("ledger-svg", "ledger-hairline-chart", "ledger-desktop-chart");
  for (let tick = 0; tick <= 4; tick += 1) {
    const y = base - tick / 4 * plotHeight;
    svg.append(svgEl("line", { x1: left, y1: y, x2: left + plotWidth, y2: y, stroke: GRID, "stroke-width": 0.6 }));
    const label = svgEl("text", { x: left - 8, y: y + 3, "text-anchor": "end", class: "ledger-foot-label" });
    label.textContent = formatCents(Math.round(max * tick / 4)).replace(".00", "");
    svg.append(label);
  }
  const slot = plotWidth / Math.max(points.length, 1);
  const coords: Array<{ x: number; y: number }> = [];
  const peaks = [...points.keys()].sort((a, b) => points[b].cents - points[a].cents).filter((index, position, chosen) => position === 0 || chosen.slice(0, position).every((other) => Math.abs(other - index) >= 3)).slice(0, 2);
  points.forEach((point, index) => {
    const x = left + slot * index + slot / 2;
    const y = base - point.cents / max * plotHeight;
    coords.push({ x, y });
    svg.append(svgEl("line", { x1: x, y1: base, x2: x, y2: base - 8, stroke: FAINT, "stroke-width": 0.7 }));
    if (!isLine) {
      svg.append(svgEl("line", {
        x1: x, y1: base, x2: x, y2: y,
        stroke: peaks.includes(index) ? INK : MUTED, "stroke-width": peaks.includes(index) ? 1.2 : 0.65,
        opacity: 0.55 + deterministic(index + 1, 7) * 0.4,
        class: "ledger-fade", style: `animation-delay:${index * 0.014}s`
      }));
    }
    if (isLine) {
      const group = svgEl("g", { class: "ledger-trend-point" });
      group.append(svgEl("circle", { cx: x, cy: y, r: peaks.includes(index) ? 4.2 : 2.2, fill: peaks.includes(index) ? HERO : index % 7 >= 5 ? PAPER : INK, stroke: peaks.includes(index) ? HERO : INK, "stroke-width": 1, class: "ledger-pop ledger-trend-dot" }));
      if (index === peaks[0]) {
        const peak = svgEl("text", { x, y: Math.max(18, y - 12), "text-anchor": "middle", class: "ledger-value-label ledger-peak-label ledger-persistent-peak" });
        peak.textContent = formatCents(point.cents);
        group.append(peak);
      }
      group.append(trendTooltip(x, y, width, formatCents(point.cents)));
      const hit = svgEl("circle", { cx: x, cy: y, r: 14, fill: "transparent" });
      interactiveTrendTarget(svg, group, hit, `${point.label} ${formatCents(point.cents)}，${point.count} 笔`, () => onClick(point));
      group.append(hit);
      svg.append(group);
    } else {
      const hit = svgEl("rect", { x: left + slot * index, y: top, width: slot, height: plotHeight, fill: "transparent" });
      accessibleTarget(hit, `${point.label} ${formatCents(point.cents)}，${point.count} 笔`, () => onClick(point));
      svg.append(hit);
    }
    if (!isLine && peaks.includes(index)) {
      const value = svgEl("text", { x, y: y - 12, "text-anchor": "middle", class: "ledger-value-label ledger-peak-label" });
      value.textContent = formatCents(point.cents);
      svg.append(value);
    }
    const labelEvery = Math.max(1, Math.ceil(points.length / 8));
    if (index % labelEvery === 0 || index === points.length - 1) {
      const label = svgEl("text", { x, y: base + 24, "text-anchor": "middle", class: "ledger-axis-label" });
      label.textContent = point.label;
      svg.append(label);
    }
  });
  const outline = svgEl("path", { d: `M${coords.map((point) => `${point.x} ${point.y}`).join(" L ")}`, fill: "none", stroke: INK, "stroke-width": isLine ? 1.2 : 1, pathLength: 1, class: "ledger-draw" });
  if (isLine) svg.insertBefore(outline, svg.firstChild); else svg.append(outline);
  const foot = svgEl("text", { x: width / 2, y: height - 10, "text-anchor": "middle", class: "ledger-foot-label" });
  foot.textContent = isLine ? "HOVER A DOT · REVEAL THE EXACT AMOUNT" : "ONE HAIRLINE = ONE PERIOD, FLOOR TO PEAK";
  svg.append(foot);
  chart.append(svg);
  renderMobileTrend(chart, points, isLine, onClick);
  sourceLine(shell, `${isLine ? "HAIRLINE LINE" : "HAIRLINE AREA"} · MONO-BASIC · LOCAL LEDGER`);
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
  const width = 820;
  const rowHeight = 44;
  const height = data.length * rowHeight + 72;
  const left = 138;
  const right = 744;
  const max = Math.max(...data.flatMap((item) => [item.currentCents, item.previousCents]), 1);
  const unit = niceCurrencyUnit(max, 24);
  const scale = (value: number): number => left + value / max * (right - left);
  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "分类支出两期哑铃对比图" });
  svg.classList.add("ledger-svg", "ledger-dumbbell-chart", "ledger-desktop-chart");
  data.forEach((item, index) => {
    const y = 34 + index * rowHeight;
    const previousX = scale(item.previousCents);
    const currentX = scale(item.currentCents);
    const group = svgEl("g");
    accessibleTarget(group, `${item.category}，本期 ${formatCents(item.currentCents)}，基期 ${formatCents(item.previousCents)}`, () => onClick(item.category));
    const label = svgEl("text", { x: left - 12, y: y + 3, "text-anchor": "end", class: "ledger-axis-label" });
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
    const value = svgEl("text", { x: Math.min(right, Math.max(previousX, currentX) + 10), y: y + 3, class: "ledger-value-label" });
    value.textContent = formatCents(item.currentCents - item.previousCents);
    group.append(value);
    svg.append(group);
  });
  const foot = svgEl("text", { x: width / 2, y: height - 12, "text-anchor": "middle", class: "ledger-foot-label" });
  foot.textContent = `ONE BEAD ≈ ${formatCents(unit)} CHANGE · HOLLOW = BASE · INK = CURRENT`;
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

export function renderEmpty(parent: HTMLElement, message: string): void {
  parent.createDiv({ cls: "ledger-empty", text: message });
}

export function renderFinanceAdvisor(parent: HTMLElement, snapshot: FinanceAdvisorSnapshot, state: FinanceAdviceViewState, onRefresh: () => void, animate = true): void {
  const card = parent.createDiv({ cls: `ledger-advisor-card${animate ? " ledger-reveal" : ""}` });
  card.setAttribute("aria-busy", String(state.status === "loading"));
  const heading = card.createDiv({ cls: "ledger-advisor-heading" });
  const copy = heading.createDiv({ cls: "ledger-advisor-heading-copy" });
  copy.createDiv({ cls: "ledger-advisor-badge", text: "AI FINANCE BRIEF · SALARY CYCLE" });
  copy.createEl("h3", { text: "洞察" });
  copy.createDiv({ cls: "ledger-advisor-period", text: `${snapshot.currentRange.start.replace(/-/g, ".")} — ${snapshot.currentRange.end.replace(/-/g, ".")}` });

  if (state.canRefresh) {
    const refresh = heading.createEl("button", { cls: "ledger-advisor-refresh", attr: { type: "button", "aria-label": "重新生成财务判断" } });
    setIcon(refresh, state.status === "loading" ? "loader-circle" : "refresh-cw");
    refresh.createSpan({ text: state.status === "loading" ? "分析中" : "刷新判断" });
    refresh.disabled = state.status === "loading";
    refresh.addEventListener("click", onRefresh);
  }

  if (snapshot.salaryCents <= 0) {
    card.addClass("is-empty");
    const empty = card.createDiv({ cls: "ledger-advisor-empty" });
    empty.createEl("strong", { text: state.canRefresh ? "AI 已配置，还差工资金额" : "填写工资后启用洞察" });
    empty.createSpan({ text: "请在插件设置中填写“每个工资周期到账工资”。余额、周期预测和 AI 判断都依赖这项数据。" });
    if (state.message) empty.createDiv({ cls: `ledger-advisor-ai-status is-${state.status}`, text: state.message });
    card.createDiv({ cls: "ledger-advisor-source", text: "SALARY CYCLE · TWO-CYCLE BASELINE · LOCAL LEDGER" });
    return;
  }

  const remaining = heading.createDiv({ cls: `ledger-advisor-remaining${snapshot.remainingSalaryCents < 0 ? " is-negative" : ""}` });
  remaining.createSpan({ text: snapshot.remainingSalaryCents < 0 ? "已超出工资" : "目前还剩" });
  remaining.createEl("strong", { text: formatCents(Math.abs(snapshot.remainingSalaryCents)) });

  const summary = card.createDiv({ cls: "ledger-advisor-summary" });
  const spent = summary.createDiv({ cls: "ledger-advisor-summary-item" });
  spent.createSpan({ text: "本次自工资日支出" });
  spent.createEl("strong", { text: formatCents(snapshot.currentSpentCents) });
  const average = summary.createDiv({ cls: "ledger-advisor-summary-item" });
  average.createSpan({ text: snapshot.historyCycleCount === 2 ? "前两个完整周期平均" : `可用历史周期 ${snapshot.historyCycleCount}/2` });
  average.createEl("strong", { text: snapshot.historyCycleCount > 0 ? formatCents(snapshot.historicalAverageSpentCents) : "参考数据不足" });
  const forecast = summary.createDiv({ cls: "ledger-advisor-summary-item ledger-advisor-forecast" });
  forecast.createSpan({ text: `周期末支出参考${snapshot.forecastAvailable && snapshot.forecastConfidence === "low" ? " · 低置信度" : ""}` });
  forecast.createEl("strong", { text: snapshot.forecastAvailable ? formatCents(snapshot.forecastCents) : "数据不足，暂不预测" });
  forecast.createEl("small", { text: "已花金额＋历史剩余阶段平均支出" });

  const event = snapshot.events[0];
  const observation = card.createDiv({ cls: `ledger-advisor-observation is-${event.type}${state.advice?.tone === "warning" ? " is-warning" : ""}` });
  observation.createDiv({ cls: "ledger-advisor-observation-label", text: state.advice ? "AI 财务判断" : "本地候选判断" });
  observation.createEl("h4", { text: state.advice?.headline ?? event.title });
  observation.createEl("p", { text: state.advice?.summary ?? event.detail });
  if (state.message) observation.createDiv({ cls: `ledger-advisor-ai-status is-${state.status}`, text: state.message });

  const adviceCategories = new Map(state.advice?.categoryLines.map((line) => [line.category, line.text]) ?? []);
  const references = state.advice && adviceCategories.size > 0
    ? snapshot.categories.filter((item) => adviceCategories.has(item.category)).slice(0, 3)
    : snapshot.categories
      .filter((item) => item.baselineCycleCents > 0 || item.currentCents > 0)
      .sort((a, b) => b.remainingReferenceCents - a.remainingReferenceCents || b.baselineCycleCents - a.baselineCycleCents)
      .slice(0, 3);
  if (references.length > 0 && snapshot.historyCycleCount > 0) {
    const section = card.createDiv({ cls: "ledger-advisor-categories" });
    const sectionHeading = section.createDiv({ cls: "ledger-advisor-section-heading" });
    sectionHeading.createSpan({ text: snapshot.historyCycleCount === 2 ? "分类参考余量" : "分类参考余量 · 仅一个历史周期" });
    sectionHeading.createEl("small", { text: `已扫描 ${snapshot.categories.length} 个分类` });
    const list = section.createDiv({ cls: "ledger-advisor-category-list" });
    for (const item of references) {
      const row = list.createDiv({ cls: "ledger-advisor-category" });
      row.createSpan({ text: item.category });
      const value = row.createDiv();
      value.createEl("strong", { text: formatCents(item.remainingReferenceCents) });
      value.createEl("small", { text: adviceCategories.get(item.category) ?? `过往周期均值 ${formatCents(item.baselineCycleCents)}` });
    }
  }
  card.createDiv({ cls: "ledger-advisor-source", text: "CURRENT SALARY CYCLE · PREVIOUS 2 FULL CYCLES · ALL CATEGORIES SCANNED · LOCAL LEDGER" });
}

export function renderLiquidBudget(parent: HTMLElement, spentCents: number, budgetCents: number, dateLabel: string, currentCycleCents: number, budgetCategory: string, includeStarred: boolean): void {
  const card = parent.createDiv({ cls: "ledger-budget-card ledger-reveal" });
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
  const heading = card.createDiv({ cls: "ledger-starred-heading" });
  const headingCopy = heading.createDiv({ cls: "ledger-starred-heading-copy" });
  headingCopy.createDiv({ cls: "ledger-mono-badge", text: "STARRED EXPENSES · MANUAL CURATION" });
  headingCopy.createEl("h3", { text: "大额支出" });
  headingCopy.createDiv({ cls: "ledger-mono-sub", text: "仅汇总所选时间内的手动星标记录，不按金额自动判断。" });
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
