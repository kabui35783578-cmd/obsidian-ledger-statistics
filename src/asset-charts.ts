import { ASSET_NAMES, AssetKind, AssetSnapshot, assetTotals } from "./assets";
import { formatCents } from "./core";
import { enableAssetGestures } from "./asset-gestures";

const NS = "http://www.w3.org/2000/svg";
const COLORS: Record<AssetKind, string> = { cash: "var(--mono-2)", investment: "var(--mono-ink)", fixed: "var(--mono-3)", receivable: "var(--mono-muted)", liability: "var(--mono-2)" };
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
  el("text", { x, y, "font-size": size, "text-anchor": anchor, "dominant-baseline": "middle", fill: "currentColor" }, parent).textContent = text;
}
function band(svg: SVGElement, x1: number, y1: number, x2: number, y2: number, height: number, color: string): void {
  if (height <= 0) return;
  const middle = (x1 + x2) / 2;
  el("path", { d: `M${x1},${y1} C${middle},${y1} ${middle},${y2} ${x2},${y2} L${x2},${y2 + height} C${middle},${y2 + height} ${middle},${y1 + height} ${x1},${y1 + height} Z`, fill: color, "fill-opacity": .5 }, svg);
}
function interactive(node: SVGElement, text: string, action: () => void): void {
  node.setAttribute("role", "button"); node.setAttribute("tabindex", "0"); node.setAttribute("aria-label", text);
  node.addEventListener("click", action);
  node.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); action(); } });
}
export function renderAssetSankey(parent: HTMLElement, snapshot: AssetSnapshot, excludeFixed: boolean, hide: boolean, expanded: Set<string>, onExpand: (id: string) => void, onAccount: (id: string) => void): void {
  const amounts = (cents: number): string => hide ? "••••" : formatCents(cents);
  const visible = snapshot.accounts.filter(a => a.kind !== "liability" && !(excludeFixed && a.kind === "fixed") && a.cents > 0);
  const kinds: AssetKind[] = ["cash", "fixed", "investment", "receivable"];
  const groups = kinds.map(kind => ({ kind, accounts: visible.filter(a => a.kind === kind) })).filter(g => g.accounts.length);
  const rows = groups.flatMap(g => g.accounts.flatMap(a => {
    if (!expanded.has(a.id) || a.kind !== "investment") return [{ account: a, id: a.id, name: a.name, cents: a.cents, holding: false }];
    const cash = a.unallocatedCents ?? a.cents - a.holdings.reduce((sum, h) => sum + (h.valueCents ?? 0), 0);
    // Negative cash cannot be a positive flow; retain the aggregate in that case.
    if (cash < 0) return [{ account: a, id: a.id, name: a.name, cents: a.cents, holding: false }];
    const rows = a.holdings.filter(h => (h.valueCents ?? 0) > 0).map(h => ({ account: a, id: h.id, name: h.name, cents: h.valueCents!, holding: true }));
    if (cash > 0) rows.push({ account: a, id: `${a.id}-unallocated`, name: a.unallocatedCents === undefined ? `${a.name} · 现金` : "待添加持仓", cents: cash, holding: true });
    return rows;
  }));
  if (!rows.length) { parent.createEl("p", { cls: "ledger-assets-empty", text: snapshot.accounts.length ? "当前没有可绘制的正资产；未估值持仓、负余额与净资产缺口请查看总览和账户。" : "添加账户和持仓后，这里显示资产组成桑基图。" }); return; }
  const rowGap = 44;
  const total = visible.reduce((sum, a) => sum + a.cents, 0), height = Math.max(360, rows.length * 64 + groups.length * 24 + 100);
  const plotHeight = height - 130 - Math.max(0, rows.length - 1) * rowGap - Math.max(0, groups.length - 1) * 20;
  const scale = plotHeight / total;
  const tools = parent.createDiv({ cls: "ledger-assets-zoom-tools" }), scroll = parent.createDiv({ cls: "ledger-assets-sankey-scroll" });
  scroll.setAttribute("aria-label", "资产组成桑基图，可横向滑动并点击账户展开");
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
    el("rect", { x: 80, y: 100, width: 12, height: netHeight, fill: "var(--mono-3)" }, svg);
    band(svg, 92, 100, 310, 100, netHeight, "var(--mono-3)");
    label(svg, 75, 82, `净资产 ${amounts(net)}`, 16);
    if (debt > 0) {
      const y = 100 + netHeight + 28;
      el("rect", { x: 80, y, width: 12, height: debtHeight, fill: COLORS.liability }, svg);
      band(svg, 92, y, 310, 100 + netHeight, debtHeight, COLORS.liability);
      label(svg, 75, y + debtHeight + 22, `负债 ${amounts(debt)}`, 15);
    }
  } else {
    label(svg, 75, 82, `净资产 ${amounts(totals.netCents)}`, 16);
    label(svg, 75, 112, "缺口单独列示", 14);
  }
  el("rect", { x: 310, y: 100, width: 13, height: total * scale, fill: "var(--mono-2)" }, svg);
  label(svg, 310, 62, `${totals.missing || !sources ? "已估值正资产" : "总资产"} ${amounts(total)}`, 19);
  for (const group of groupLayout) {
    const color = COLORS[group.kind], groupHeight = group.cents * scale, groupRows = rows.filter(r => r.account.kind === group.kind);
    band(svg, 323, rootCursor, 675, group.y, groupHeight, "var(--mono-2)");
    el("rect", { x: 675, y: group.y, width: 12, height: groupHeight, fill: color }, svg);
    label(svg, 660, group.y + groupHeight / 2, `${ASSET_NAMES[group.kind]} ${amounts(group.cents)}`, 17, "end");
    let source = group.y;
    groupRows.forEach((row, index) => {
      const y = group.rowYs[index], h = row.cents * scale;
      band(svg, 687, source, 945, y, h, color);
      el("rect", { x: 945, y, width: 8, height: h, fill: color }, svg);
      const node = el("g", {}, svg), middle = y + h / 2;
      el("rect", { x: 955, y: middle - 22, width: 282, height: 44, fill: "transparent" }, node);
      const name = row.name.length > 17 ? `${row.name.slice(0, 16)}…` : row.name;
      label(node, 967, middle - 8, `${name}${row.account.kind === "investment" && !row.holding ? " ›" : ""}`, 16);
      label(node, 967, middle + 12, amounts(row.cents), 14);
      el("title", {}, node).textContent = `${row.name} ${amounts(row.cents)}`;
      interactive(node, `${row.name}，${amounts(row.cents)}，查看详情`, () => row.account.kind === "investment" && !row.holding ? onExpand(row.account.id) : onAccount(row.account.id));
      source += h;
    });
    rootCursor += groupHeight;
  }
  if (snapshot.accounts.some(a => a.cents < 0) || totals.netCents < 0) parent.createEl("p", { cls: "ledger-assets-hint", text: `桑基图展示正资产；负余额与净资产缺口保留在总览及账户列表中${hide ? "。" : `：${snapshot.accounts.filter(a => a.cents < 0).map(a => `${a.name} ${formatCents(a.cents)}`).join("；") || formatCents(totals.netCents)}`}` });
  enableAssetGestures(scroll, svg, tools);
}
