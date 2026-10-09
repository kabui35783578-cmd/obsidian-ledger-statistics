import { ASSET_NAMES, AssetKind, AssetSnapshot, assetTotals } from "./assets";
import { formatCents } from "./core";
import { enableAssetGestures } from "./asset-gestures";

const NS = "http://www.w3.org/2000/svg";
// A single soft multicolor palette, shared with account markers.
const COLORS: Record<AssetKind, string> = { cash: "var(--asset-cash, #76A69A)", investment: "var(--asset-investment, #7C9CBF)", fixed: "var(--asset-fixed, #C6B16B)", receivable: "var(--asset-receivable, #A895BD)", liability: "var(--asset-liability, #D69B89)" };
const HOLDING_COLORS = ["#A895BD", "#76A69A", "#C6B16B", "#7C9CBF", "#D69B89"];
let gradientSequence = 0;
export function renderAssetAllocation(parent: HTMLElement, snapshot: AssetSnapshot, excludeFixed: boolean, hide: boolean): void {
  const accounts = snapshot.accounts.filter(a => a.kind !== "liability" && !(excludeFixed && a.kind === "fixed") && a.cents > 0);
  const total = accounts.reduce((sum, a) => sum + a.cents, 0);
  if (!total) { parent.createEl("p", { cls: "ledger-assets-empty", text: "暂无正资产，添加账户或持仓后显示图表。" }); return; }
  const groups = (["cash", "investment", "fixed", "receivable"] as AssetKind[]).map(kind => ({ kind, cents: accounts.filter(a => a.kind === kind).reduce((sum, a) => sum + a.cents, 0) })).filter(g => g.cents > 0);
  const layout = parent.createDiv({ cls: "ledger-assets-allocation" });
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 240 240"); svg.setAttribute("class", "ledger-assets-ring");
  svg.setAttribute("role", "img"); svg.setAttribute("aria-label", hide ? "资产组成，金额已隐藏" : "正资产分类占比"); layout.appendChild(svg);
  const radius = 86, circumference = 2 * Math.PI * radius;
  el("circle", { cx: 120, cy: 120, r: radius, fill: "none", stroke: "var(--background-modifier-border)", "stroke-width": 24 }, svg);
  let offset = 0;
  const legend = layout.createDiv({ cls: "ledger-assets-allocation-legend" });
  for (const group of groups) {
    const share = group.cents / total, length = share * circumference;
    if (!hide) el("circle", { cx: 120, cy: 120, r: radius, fill: "none", stroke: COLORS[group.kind], "stroke-width": 24, "stroke-dasharray": `${length} ${circumference - length}`, "stroke-dashoffset": -offset, transform: "rotate(-90 120 120)" }, svg);
    offset += length;
    const row = legend.createDiv({ cls: "ledger-assets-allocation-row" }), dot = row.createSpan({ cls: "ledger-assets-dot" }); dot.style.background = COLORS[group.kind];
    row.createSpan({ text: ASSET_NAMES[group.kind] });
    row.createEl("strong", { text: hide ? "••••" : formatCents(group.cents) });
    row.createEl("small", { text: hide ? "" : `${(share * 100).toFixed(1)}%` });
  }
  label(svg, 120, 110, "资产分布", 15, "middle");
  label(svg, 120, 137, hide ? "••••" : `${accounts.length}个账户`, 20, "middle");
  if (snapshot.accounts.some(a => a.kind !== "liability" && a.cents < 0)) parent.createEl("small", { cls: "ledger-assets-hint", text: "占比按正资产计算，负余额计入总资产。" });
}
function el<K extends keyof SVGElementTagNameMap>(type: K, attrs: Record<string, string | number>, parent: SVGElement): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, type);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  parent.appendChild(node); return node;
}
function label(parent: SVGElement, x: number, y: number, text: string, size = 16, anchor = "start"): void {
  el("text", { x, y, "font-size": size, "font-weight": 600, "text-anchor": anchor, "dominant-baseline": "middle", fill: "currentColor" }, parent).textContent = text;
}
function band(svg: SVGElement, x1: number, y1: number, x2: number, y2: number, height: number, color: string, endColor = color): void {
  if (height <= 0) return;
  const middle = (x1 + x2) / 2;
  const id = `ledger-asset-flow-${++gradientSequence}`;
  const gradient = el("linearGradient", { id, gradientUnits: "userSpaceOnUse", x1, y1: 0, x2, y2: 0 }, el("defs", {}, svg));
  el("stop", { offset: "0%", "stop-color": color, "stop-opacity": .44 }, gradient);
  el("stop", { offset: "100%", "stop-color": endColor, "stop-opacity": .24 }, gradient);
  el("path", { d: `M${x1},${y1} C${middle},${y1} ${middle},${y2} ${x2},${y2} L${x2},${y2 + height} C${middle},${y2 + height} ${middle},${y1 + height} ${x1},${y1 + height} Z`, fill: `url(#${id})` }, svg);
}
function interactive(node: SVGElement, text: string, action: () => void): void {
  node.setAttribute("role", "button"); node.setAttribute("tabindex", "0"); node.setAttribute("aria-label", text);
  node.addEventListener("click", action);
  node.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); action(); } });
}
/** Home preview follows the reference hierarchy; the expanded chart retains every holding. */
export function renderAssetOverviewSankey(parent: HTMLElement, snapshot: AssetSnapshot, excludeFixed: boolean, hide: boolean, expand: () => void): void {
  const totals = assetTotals(snapshot, excludeFixed);
  const accounts = snapshot.accounts.filter(a => a.kind !== "liability" && !(excludeFixed && a.kind === "fixed") && a.cents > 0);
  const total = accounts.reduce((sum, a) => sum + a.cents, 0);
  if (!total) { parent.createEl("p", { cls: "ledger-assets-empty", text: snapshot.accounts.length ? "当前没有可绘制的正资产，请在资产管理中查看余额与持仓。" : "添加账户和持仓后，这里显示资产组成桑基图。" }); return; }
  const kinds: AssetKind[] = ["cash", "fixed", "investment", "receivable"];
  const groups = kinds.map(kind => ({ kind, accounts: accounts.filter(a => a.kind === kind) })).filter(g => g.accounts.length);
  const height = Math.max(480, groups.length * 95 + 180), scale = (height - 170 - (groups.length - 1) * 32) / total;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 800 ${height}`); svg.setAttribute("class", "ledger-assets-overview-sankey");
  svg.setAttribute("role", "group"); svg.setAttribute("aria-label", hide ? "资产组成，金额已隐藏" : "净资产、总资产与资产类别，点击查看完整组成"); parent.appendChild(svg);
  const complete = !accounts.some(a => a.cents < 0) && !snapshot.accounts.some(a => a.kind !== "liability" && !(excludeFixed && a.kind === "fixed") && a.cents < 0) && totals.netCents >= 0;
  const sourceHeight = total * scale;
  if (complete) {
    const netHeight = totals.netCents * scale;
    // Keep the first ribbon green and the total/category ribbons in the existing soft palette.
    el("rect", { x: 125, y: 115, width: 11, height: netHeight, fill: "#76A69A", "fill-opacity": .72 }, svg);
    band(svg, 136, 115, 345, 115, netHeight, "#76A69A");
    label(svg, 25, 115 + netHeight / 2, "净资产", 25);
    if (totals.liabilitiesCents > 0) {
      const debtHeight = totals.liabilitiesCents * scale, y = 115 + netHeight + 24;
      el("rect", { x: 125, y, width: 11, height: debtHeight, fill: COLORS.liability, "fill-opacity": .72 }, svg);
      band(svg, 136, y, 345, 115 + netHeight, debtHeight, COLORS.liability);
      label(svg, 25, y + debtHeight / 2, "负债", 25);
    }
  } else label(svg, 25, 115 + sourceHeight / 2, totals.netCents < 0 ? "净资产缺口" : "净资产", 22);
  el("rect", { x: 365, y: 115, width: 20, height: sourceHeight, fill: COLORS.investment, "fill-opacity": .72 }, svg);
  label(svg, 365, 82, totals.missing || !complete ? "已估值正资产" : "总资产", 27);
  let cursor = 80, source = 115;
  for (const group of groups) {
    const cents = group.accounts.reduce((sum, a) => sum + a.cents, 0), h = cents * scale;
    band(svg, 385, source, 620, cursor, h, COLORS.investment, COLORS.investment);
    el("rect", { x: 620, y: cursor, width: 11, height: h, fill: COLORS[group.kind], "fill-opacity": .72 }, svg);
    // Faint tails hint at the account/holding detail available in the full view.
    let tail = cursor;
    for (const account of group.accounts) {
      const leaves = account.kind === "investment" ? account.holdings.filter(h => (h.valueCents ?? 0) > 0).map(h => h.valueCents!) : [];
      const remaining = account.cents - leaves.reduce((sum, value) => sum + value, 0);
      const values = remaining >= 0 ? [...leaves, ...(remaining > 0 ? [remaining] : [])] : [account.cents];
      for (const value of values) { const size = value * scale; band(svg, 631, tail, 850, tail - 55, size, "var(--mono-grid)"); tail += size; }
    }
    const target = el("g", {}, svg);
    el("rect", { x: 616, y: cursor + h / 2 - 24, width: 182, height: 48, fill: "transparent" }, target);
    label(target, 639, cursor + h / 2, ASSET_NAMES[group.kind], 25);
    interactive(target, `${ASSET_NAMES[group.kind]}，${hide ? "金额已隐藏" : formatCents(cents)}，查看完整组成`, expand);
    cursor += h + 32; source += h;
  }
  if (!complete || totals.missing) parent.createEl("small", { cls: "ledger-assets-hint", text: "图中展示已估值正资产，负余额与待核对项请查看总览及资产管理。" });
}
export function renderAssetSankey(parent: HTMLElement, snapshot: AssetSnapshot, excludeFixed: boolean, hide: boolean, onSelect: (accountId: string, holdingId?: string) => void, showControls = true): void {
  const amounts = (cents: number): string => hide ? "••••" : formatCents(cents);
  const visible = snapshot.accounts.filter(a => a.kind !== "liability" && !(excludeFixed && a.kind === "fixed") && a.cents > 0);
  const kinds: AssetKind[] = ["cash", "fixed", "investment", "receivable"];
  const groups = kinds.map(kind => ({ kind, accounts: visible.filter(a => a.kind === kind) })).filter(g => g.accounts.length);
  const rows = groups.flatMap(g => g.accounts.flatMap(a => {
    if (a.kind !== "investment") return [{ account: a, id: a.id, name: a.name, cents: a.cents, holding: false }];
    const cash = a.unallocatedCents ?? a.cents - a.holdings.reduce((sum, h) => sum + (h.valueCents ?? 0), 0);
    // Negative cash cannot be a positive flow; retain the aggregate in that case.
    if (cash < 0) return [{ account: a, id: a.id, name: a.name, cents: a.cents, holding: false }];
    const rows = a.holdings.filter(h => (h.valueCents ?? 0) > 0).map(h => ({ account: a, id: h.id, name: h.name, cents: h.valueCents!, holding: true }));
    if (cash > 0) rows.push({ account: a, id: a.id, name: a.name, cents: cash, holding: false });
    return rows;
  }));
  if (!rows.length) { parent.createEl("p", { cls: "ledger-assets-empty", text: snapshot.accounts.length ? "当前没有可绘制的正资产；未估值持仓、负余额与净资产缺口请查看总览和账户。" : "添加账户和持仓后，这里显示资产组成桑基图。" }); return; }
  const rowGap = 44;
  const total = visible.reduce((sum, a) => sum + a.cents, 0), height = Math.max(360, rows.length * 64 + groups.length * 24 + 100);
  const plotHeight = height - 130 - Math.max(0, rows.length - 1) * rowGap - Math.max(0, groups.length - 1) * 20;
  const scale = plotHeight / total;
  const tools = showControls ? parent.createDiv({ cls: "ledger-assets-zoom-tools" }) : null;
  const scroll = parent.createDiv({ cls: "ledger-assets-sankey-scroll" });
  scroll.setAttribute("aria-label", "资产组成桑基图，直接展示账户余额与持仓");
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 1240 ${height}`); svg.setAttribute("class", "ledger-assets-sankey");
  svg.setAttribute("role", "group"); svg.setAttribute("aria-label", "资产总量、资产类别、账户组成"); scroll.appendChild(svg);
  const totals = assetTotals(snapshot, excludeFixed), sources = totals.netCents >= 0 && !snapshot.accounts.some(a => a.cents < 0);
  let cursor = 95, rootCursor = 100;
  const groupLayout: { kind: AssetKind; y: number; cents: number; rowYs: number[]; }[] = [];
  for (const group of groups) {
    const groupRows = rows.filter(r => r.account.kind === group.kind), rowYs: number[] = [], start = cursor;
    for (const row of groupRows) { rowYs.push(cursor); cursor += row.cents * scale + rowGap; }
    groupLayout.push({ kind: group.kind, y: start, cents: groupRows.reduce((s, r) => s + r.cents, 0), rowYs }); cursor += 20;
  }
  if (sources) {
    const debt = totals.liabilitiesCents, net = totals.netCents, netHeight = net * scale, debtHeight = debt * scale;
    el("rect", { x: 80, y: 100, width: 12, height: netHeight, rx: 3, fill: "#76A69A", "fill-opacity": .72 }, svg);
    band(svg, 92, 100, 310, 100, netHeight, "#76A69A", "#7C9CBF");
    label(svg, 75, 82, `净资产 ${amounts(net)}`, 16);
    if (debt > 0) {
      const y = 100 + netHeight + 28;
      el("rect", { x: 80, y, width: 12, height: debtHeight, rx: 3, fill: COLORS.liability }, svg);
      band(svg, 92, y, 310, 100 + netHeight, debtHeight, COLORS.liability);
      label(svg, 75, y + debtHeight + 22, `负债 ${amounts(debt)}`, 15);
    }
  } else {
    label(svg, 75, 82, `净资产 ${amounts(totals.netCents)}`, 16);
    label(svg, 75, 112, "缺口单独列示", 14);
  }
  el("rect", { x: 310, y: 100, width: 13, height: total * scale, rx: 3, fill: "#7C9CBF", "fill-opacity": .72 }, svg);
  label(svg, 310, 62, `${totals.missing || !sources ? "已估值正资产" : "总资产"} ${amounts(total)}`, 17);
  for (const group of groupLayout) {
    const color = COLORS[group.kind], groupHeight = group.cents * scale, groupRows = rows.filter(r => r.account.kind === group.kind);
    band(svg, 323, rootCursor, 675, group.y, groupHeight, color);
    el("rect", { x: 675, y: group.y, width: 12, height: groupHeight, rx: 3, fill: color, "fill-opacity": .72 }, svg);
    label(svg, 660, group.y + groupHeight / 2, `${ASSET_NAMES[group.kind]} ${amounts(group.cents)}`, 15, "end");
    let source = group.y;
    groupRows.forEach((row, index) => {
      const y = group.rowYs[index], h = row.cents * scale;
      const leafColor = row.holding ? HOLDING_COLORS[row.account.holdings.findIndex(holding => holding.id === row.id) % HOLDING_COLORS.length]
        : row.account.kind === "investment" ? "#D69B89" : color;
      band(svg, 687, source, 945, y, h, color, leafColor);
      el("rect", { x: 945, y, width: 8, height: h, rx: 3, fill: leafColor, "fill-opacity": .72 }, svg);
      const node = el("g", {}, svg), middle = y + h / 2;
      el("rect", { x: 955, y: middle - 22, width: 282, height: 44, fill: "transparent" }, node);
      const name = row.name.length > 17 ? `${row.name.slice(0, 16)}…` : row.name;
      label(node, 967, middle - 8, name, 14);
      label(node, 967, middle + 12, amounts(row.cents), 14);
      el("title", {}, node).textContent = `${row.holding ? `${row.account.name} · ` : ""}${row.name} ${amounts(row.cents)}`;
      interactive(node, `${row.name}，${amounts(row.cents)}${row.holding ? `，来自${row.account.name}` : ""}，查看详情`, () => onSelect(row.account.id, row.holding ? row.id : undefined));
      source += h;
    });
    rootCursor += groupHeight;
  }
  if (snapshot.accounts.some(a => a.cents < 0) || totals.netCents < 0) parent.createEl("p", { cls: "ledger-assets-hint", text: `桑基图展示正资产；负余额与净资产缺口保留在总览及账户列表中${hide ? "。" : `：${snapshot.accounts.filter(a => a.cents < 0).map(a => `${a.name} ${formatCents(a.cents)}`).join("；") || formatCents(totals.netCents)}`}` });
  enableAssetGestures(scroll, svg, tools, true, !!parent.closest?.(".ledger-assets"));
}
