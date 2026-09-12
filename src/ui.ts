import { CategorySummary, TrendPoint, formatCents } from "./core";

const SVG_NS = "http://www.w3.org/2000/svg";
const INK = "#1C1C1A";
const PAPER = "#F0EFEB";
const MUTED = "#8F8E88";
const FAINT = "#C6C5BF";
const GRID = "#DEDDD6";
const LADDER = ["#1C1C1A", "#4A4944", "#6A6963", "#8F8E88", "#B0AFA9", "#C6C5BF", "#D8D7D1"];

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

function strongestCategory(data: CategorySummary[]): string {
  return data[0]?.category ?? "暂无分类";
}

function pctText(cents: number, total: number): string {
  return total === 0 ? "占比 0.0%" : `占比 ${(cents / total * 100).toFixed(1)}%`;
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
  const width = 760;
  const rowHeight = 44;
  const height = data.length * rowHeight + 58;
  const x0 = 126;
  const plotWidth = 430;
  const max = Math.max(...data.map((item) => item.cents), 1);
  const unit = niceCurrencyUnit(max);
  const maxUnits = max / unit;
  const px = plotWidth / Math.max(maxUnits, 1);
  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "分类支出刻线队列图" });
  svg.classList.add("ledger-svg", "ledger-tick-rows");
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
        stroke: index === 0 ? INK : LADDER[Math.min(index, 4)], "stroke-width": 1,
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
    const count = svgEl("text", { x: 704, y: y + 3, "text-anchor": "end", class: "ledger-count-label" });
    count.textContent = `${item.count}笔`;
    group.append(value, count);
    svg.append(group);
  });
  const unitText = svgEl("text", { x: width / 2, y: height - 12, "text-anchor": "middle", class: "ledger-foot-label" });
  unitText.textContent = `ONE TICK = ${formatCents(unit)} · DASHED FINAL TICK = REMAINDER`;
  svg.append(unitText);
  chart.append(svg);
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
        stroke: LADDER[Math.min(categoryIndex, LADDER.length - 1)], "stroke-width": 1,
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
  svg.classList.add("ledger-svg", "ledger-hairline-chart");
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
    const hit = svgEl("rect", { x: left + slot * index, y: top, width: slot, height: plotHeight, fill: "transparent" });
    accessibleTarget(hit, `${point.label} ${formatCents(point.cents)}，${point.count} 笔`, () => onClick(point));
    svg.append(hit);
    if (isLine) svg.append(svgEl("circle", { cx: x, cy: y, r: peaks.includes(index) ? 4.2 : 2.2, fill: index % 7 >= 5 ? PAPER : INK, stroke: INK, "stroke-width": 1, class: "ledger-pop" }));
    if (peaks.includes(index)) {
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
  foot.textContent = isLine ? "ONE DOT = ONE PERIOD · HAIRLINE PATH · PEAKS LABELED" : "ONE HAIRLINE = ONE PERIOD, FLOOR TO PEAK";
  svg.append(foot);
  chart.append(svg);
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
  svg.classList.add("ledger-svg", "ledger-dumbbell-chart");
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
  sourceLine(shell, "DUMBBELL QUEUE · MONO-BASIC · LOCAL LEDGER COMPARISON");
}

export function renderEmpty(parent: HTMLElement, message: string): void {
  parent.createDiv({ cls: "ledger-empty", text: message });
}

export function createButton(parent: HTMLElement, text: string, active = false): HTMLButtonElement {
  const button = parent.createEl("button", { cls: `ledger-button${active ? " is-active" : ""}`, text });
  button.type = "button";
  return button;
}
