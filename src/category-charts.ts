import { formatCents, LedgerRecord } from "./core";
import { categoryBoxStats } from "./category-analysis";

// Structure sources: lieflat-charts/templates/basics-gallery.html,
// F1 (rung bars) and F15 (tick box). Keep the plugin's existing Wire tokens.
const NS = "http://www.w3.org/2000/svg";
const observers = new WeakMap<Element, IntersectionObserver>();
function el(parent: SVGElement, tag: string, attrs: Record<string, string | number>) {
  const node = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
  parent.append(node);
  return node;
}
function text(parent: SVGElement, attrs: Record<string, string | number>, value: string) { const node = el(parent, "text", attrs); node.textContent = value; return node; }
function target(node: SVGElement, label: string, activate: () => void) {
  node.setAttribute("tabindex", "0"); node.setAttribute("role", "button"); node.setAttribute("aria-label", label);
  const title = el(node, "title", {}); title.textContent = label;
  node.addEventListener("click", activate);
  node.addEventListener("keydown", event => { const key = (event as KeyboardEvent).key; if (key === "Enter" || key === " ") { event.preventDefault(); activate(); } });
}
function plot(parent: HTMLElement, label: string, width = 400, height = 320): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img"); svg.setAttribute("aria-label", label);
  svg.classList.add("ledger-svg", "ledger-category-plot", "is-pending");
  parent.append(svg);
  const observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) { svg.classList.remove("is-pending"); observer.disconnect(); observers.delete(svg); }
  });
  observers.set(svg, observer); observer.observe(svg);
  return svg;
}
export function disposeCategoryCharts(root: HTMLElement): void {
  root.querySelectorAll(".ledger-category-plot").forEach(svg => { observers.get(svg)?.disconnect(); observers.delete(svg); });
}
const money = (cents: number) => formatCents(Math.round(cents));
const INK = "var(--mono-ink)", PAPER = "var(--mono-paper)", MUTED = "var(--mono-muted)", GRID = "var(--mono-grid)", HERO = "var(--ledger-accent)";
const rnd = (i: number, k: number) => Math.abs(((i * 73856093) ^ (k * 19349663)) % 1000) / 1000;

export function renderSelectedBox(parent: HTMLElement, current: LedgerRecord[], previous: LedgerRecord[], open: (record: LedgerRecord) => void, show: (label: string, records: LedgerRecord[]) => void): void {
  const groups = [{ label: "本期", records: current }, ...(previous.length >= 4 ? [{ label: "上期", records: previous }] : [])]
    .map(group => ({ ...group, box: categoryBoxStats(group.records) })).filter(group => !!group.box);
  if (!groups.length) { parent.createDiv({ cls: "ledger-note", text: "当前不足四笔，暂不绘制箱线图。" }); return; }
  // F15: linear vertical amount axis, hairline whiskers, capsule IQR,
  // paper median tick and one hollow point per actual outlier transaction.
  const svg = plot(parent, "本期与上期单笔金额箱线图", 480, 320);
  const max = Math.max(100, ...groups.flatMap(group => group.records.map(record => record.cents))) * 1.12;
  const top = 34, base = 258, y = (v: number) => base - v / max * (base - top);
  for (let tick = 0; tick <= 4; tick++) {
    const value = max * tick / 4;
    el(svg, "line", { x1: 68, y1: y(value), x2: 458, y2: y(value), stroke: GRID, "stroke-width": .8 });
    text(svg, { x: 62, y: y(value) + 3, "font-size": 12, "font-weight": 600, fill: MUTED, "text-anchor": "end" }, money(value));
  }
  groups.forEach((group, index) => {
    const box = group.box!, x = groups.length === 1 ? 250 : 185 + index * 170, bw = 32;
    const g = el(svg, "g", {});
    target(g, `${group.label}中间一半 ${money(box.q1)} 至 ${money(box.q3)}，中位数 ${money(box.median)}`, () => show(`${group.label}单笔金额`, group.records));
    el(g, "line", { x1: x, y1: y(box.min), x2: x, y2: y(box.max), stroke: MUTED, "stroke-width": .8, class: "ledger-draw", pathLength: 1 });
    [box.min, box.max].forEach(value => el(g, "line", { x1: x - 8, y1: y(value), x2: x + 8, y2: y(value), stroke: MUTED, "stroke-width": 1 }));
    el(g, "rect", { x: x - bw / 2, y: y(box.q3), width: bw, height: Math.max(1, y(box.q1) - y(box.q3)), rx: 9, fill: index ? MUTED : INK, class: "ledger-pop" });
    el(g, "line", { x1: x - bw / 2 + 3, y1: y(box.median), x2: x + bw / 2 - 3, y2: y(box.median), stroke: PAPER, "stroke-width": 2.2 });
    text(g, { x: x + bw / 2 + 6, y: y(box.median) + 3, "font-size": 14, "font-weight": 800, fill: INK }, money(box.median));
    text(g, { x, y: base + 20, "font-size": 13, "font-weight": 700, fill: MUTED, "text-anchor": "middle" }, `${group.label} · ${group.records.length} 笔`);
    svg.append(g);
    box.outliers.forEach((record, i) => {
      const dot = el(svg, "circle", { cx: x + (rnd(i + 1, index + 3) - .5) * 10, cy: y(record.cents), r: 3, fill: PAPER, stroke: index ? MUTED : HERO, "stroke-width": 1.2, class: "ledger-pop", style: `animation-delay:${.7 + i * .012}s` });
      target(dot, `${group.label} ${record.note || "无备注"} · ${record.date} · ${money(record.cents)}`, () => open(record));
    });
  });
  text(svg, { x: 260, y: 309, "font-size": 11, "font-weight": 600, fill: MUTED, "text-anchor": "middle" }, "箱体 = 中间一半 · 横线 = 中位数 · 空心点 = 统计离群值");
}

export function renderWeekdayRungs(parent: HTMLElement, days: Array<{ label: string; mean: number; records: LedgerRecord[] }>, show: (label: string, records: LedgerRecord[]) => void): void {
  // F1: one vertical ladder per weekday; every full rung is the same amount.
  const svg = plot(parent, "各星期按账本日期计算的日均金额", 460, 320);
  const max = Math.max(100, ...days.map(day => day.mean));
  const raw = max / 28, magnitude = 10 ** Math.floor(Math.log10(raw)), normalized = raw / magnitude;
  const unit = Math.max(1, magnitude * (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10));
  const step = 194 / Math.max(1, max / unit), base = 256, leading = days.findIndex(day => day.mean === max);
  days.forEach((day, index) => {
    const x = 46 + index * 61, group = el(svg, "g", {}), units = day.mean / unit;
    target(group, `${day.label}日均 ${money(day.mean)}`, () => show(day.label, day.records));
    for (let rung = 0; rung < Math.ceil(units); rung++) {
      const fraction = Math.min(1, units - rung), yy = base - (rung + fraction) * step, half = 14 - 1.5 + rnd(rung + 1, index + 2) * 3;
      el(group, "line", { x1: x - half, y1: yy, x2: x + half, y2: yy, stroke: index === leading ? HERO : INK, "stroke-width": 1, "stroke-dasharray": fraction < 1 ? "2 2" : "", class: "ledger-fade", style: `animation-delay:${index * .08 + rung * .012}s` });
      if (rung % 5 === 4) el(group, "circle", { cx: x + 18.5, cy: yy, r: .8, fill: MUTED });
    }
    text(group, { x, y: base - units * step - 12, "text-anchor": "middle", "font-size": 10, "font-weight": 800, fill: INK }, money(day.mean));
    text(group, { x, y: base + 20, "text-anchor": "middle", "font-size": 10, "font-weight": 700, fill: MUTED }, day.label);
  });
  el(svg, "line", { x1: 22, y1: base + 4, x2: 442, y2: base + 4, stroke: GRID, "stroke-width": .8 });
  text(svg, { x: 230, y: 310, "text-anchor": "middle", "font-size": 11, "font-weight": 600, fill: MUTED }, `每档 = ${money(unit)} · 虚线档按不足一单位的金额绘制`);
}
