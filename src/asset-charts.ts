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
  if (!total) { parent.createEl("p", { cls: "ledger-assets-empty", text: "暂无资产，添加账户或持仓后显示图表。" }); return; }
  const groups = (["cash", "investment", "fixed", "receivable"] as AssetKind[]).map(kind => ({ kind, cents: accounts.filter(a => a.kind === kind).reduce((sum, a) => sum + a.cents, 0) })).filter(g => g.cents > 0);
  const layout = parent.createDiv({ cls: "ledger-assets-allocation" });
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 240 240"); svg.setAttribute("class", "ledger-assets-ring");
  svg.setAttribute("role", "img"); svg.setAttribute("aria-label", hide ? "资产组成，金额已隐藏" : "资产分类占比"); layout.appendChild(svg);
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
  if (snapshot.accounts.some(a => a.kind === "cash" && a.cents < 0)) parent.createEl("small", { cls: "ledger-assets-hint", text: "支出账户负余额已计入负债。" });
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
/** Start with the reference's first three columns; dragging reveals the actual account/holding nodes. */
export function renderAssetOverviewSankey(parent: HTMLElement, snapshot: AssetSnapshot, excludeFixed: boolean, hide: boolean, onSelect: (accountId: string, holdingId?: string) => void): void {
  renderAssetSankey(parent, snapshot, excludeFixed, hide, onSelect, false, true);
}
export function renderAssetSankey(parent: HTMLElement, snapshot: AssetSnapshot, excludeFixed: boolean, hide: boolean, onSelect: (accountId: string, holdingId?: string) => void, showControls = true, overview = false): void {
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
  if (!rows.length) { parent.createEl("p", { cls: "ledger-assets-empty", text: snapshot.accounts.length ? "暂无资产，账户余额请在资产管理中查看。" : "添加账户和持仓后，这里显示资产组成。" }); return; }
  const rowGap = 44;
  const total = visible.reduce((sum, a) => sum + a.cents, 0), height = Math.max(overview ? 480 : 360, rows.length * 64 + groups.length * 24 + 100);
  const plotHeight = height - 130 - Math.max(0, rows.length - 1) * rowGap - Math.max(0, groups.length - 1) * 20;
  const scale = plotHeight / total;
  const tools = showControls ? parent.createDiv({ cls: "ledger-assets-zoom-tools" }) : null;
  const scroll = parent.createDiv({ cls: `ledger-assets-sankey-scroll${overview ? " ledger-assets-overview-scroll" : ""}` });
  scroll.setAttribute("aria-label", "资产组成桑基图，直接展示账户余额与持仓");
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 1240 ${height}`); svg.setAttribute("class", `ledger-assets-sankey${overview ? " ledger-assets-overview-sankey" : ""}`);
  if (overview) { svg.style.minWidth = "0"; svg.style.width = `${1240 / 800 * 100}%`; }
  svg.setAttribute("role", "group"); svg.setAttribute("aria-label", "资产总量、资产类别、账户组成"); scroll.appendChild(svg);
  const totals = assetTotals(snapshot, excludeFixed), sources = totals.netCents >= 0 && !snapshot.accounts.some(a => a.kind !== "cash" && a.kind !== "liability" && !(excludeFixed && a.kind === "fixed") && a.cents < 0);
  const sourceX = overview ? 125 : 80, rootX = overview ? 365 : 310, groupX = overview ? 620 : 675;
  let cursor = 95, rootCursor = 100;
  const groupLayout: { kind: AssetKind; y: number; cents: number; rowYs: number[]; }[] = [];
  for (const group of groups) {
    const groupRows = rows.filter(r => r.account.kind === group.kind), rowYs: number[] = [], start = cursor;
    for (const row of groupRows) { rowYs.push(cursor); cursor += row.cents * scale + rowGap; }
    groupLayout.push({ kind: group.kind, y: start, cents: groupRows.reduce((s, r) => s + r.cents, 0), rowYs }); cursor += 20;
  }
  if (sources) {
    const debt = totals.liabilitiesCents, net = totals.netCents, netHeight = net * scale, debtHeight = debt * scale;
    el("rect", { x: sourceX, y: 100, width: 12, height: netHeight, rx: 3, fill: "#76A69A", "fill-opacity": .72 }, svg);
    band(svg, sourceX + 12, 100, rootX - (overview ? 20 : 0), 100, netHeight, "#76A69A", overview ? "#76A69A" : "#7C9CBF");
    label(svg, overview ? 25 : 75, overview ? 100 + netHeight / 2 : 82, overview ? "净资产" : `净资产 ${amounts(net)}`, overview ? 25 : 16);
    if (debt > 0) {
      const y = 100 + netHeight + 28;
      el("rect", { x: sourceX, y, width: 12, height: debtHeight, rx: 3, fill: COLORS.liability }, svg);
      band(svg, sourceX + 12, y, rootX - (overview ? 20 : 0), 100 + netHeight, debtHeight, COLORS.liability);
      label(svg, overview ? 25 : 75, overview ? y + debtHeight / 2 : y + debtHeight + 22, overview ? "负债" : `负债 ${amounts(debt)}`, overview ? 25 : 15);
    }
  } else {
    label(svg, overview ? 25 : 75, overview ? 100 + total * scale / 2 : 82, overview ? "净资产" : `净资产 ${amounts(totals.netCents)}`, overview ? 25 : 16);
  }
  el("rect", { x: rootX, y: 100, width: overview ? 20 : 13, height: total * scale, rx: 3, fill: "#7C9CBF", "fill-opacity": .72 }, svg);
  label(svg, rootX, overview ? 68 : 62, overview ? "总资产" : `总资产 ${amounts(totals.assetsCents)}`, overview ? 27 : 17);
  for (const group of groupLayout) {
    const color = COLORS[group.kind], groupHeight = group.cents * scale, groupRows = rows.filter(r => r.account.kind === group.kind);
    band(svg, rootX + (overview ? 20 : 13), rootCursor, groupX, group.y, groupHeight, overview ? COLORS.investment : color);
    el("rect", { x: groupX, y: group.y, width: 12, height: groupHeight, rx: 3, fill: color, "fill-opacity": .72 }, svg);
    label(svg, overview ? groupX + 19 : groupX - 15, group.y + groupHeight / 2, overview ? ASSET_NAMES[group.kind] : `${ASSET_NAMES[group.kind]} ${amounts(group.cents)}`, overview ? 25 : 15, overview ? "start" : "end");
    let source = group.y;
    groupRows.forEach((row, index) => {
      const y = group.rowYs[index], h = row.cents * scale;
      const leafColor = row.holding ? HOLDING_COLORS[row.account.holdings.findIndex(holding => holding.id === row.id) % HOLDING_COLORS.length]
        : row.account.kind === "investment" ? "#D69B89" : color;
      band(svg, groupX + 12, source, 945, y, h, overview ? "var(--mono-grid)" : color, overview ? "var(--mono-grid)" : leafColor);
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
  if (totals.missing) parent.createEl("small", { cls: "ledger-assets-hint", text: "部分账户金额待补全" });
  if (totals.netCents < 0) parent.createEl("small", { cls: "ledger-assets-hint", text: hide ? "净资产金额已隐藏" : `净资产 ${amounts(totals.netCents)}` });
  enableAssetGestures(scroll, svg, tools, true, overview || !!parent.closest?.(".ledger-assets"), overview ? 1240 / 800 : 1);
}
