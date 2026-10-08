import { ASSET_NAMES, AssetKind, AssetSnapshot, assetTotals } from "./assets";
import { formatCents } from "./core";

const NS = "http://www.w3.org/2000/svg";
const COLORS: Record<AssetKind, string> = { cash: "#bb8967", investment: "#8678b0", fixed: "#a6acb6", receivable: "#8a93a4", liability: "#cb8f96" };
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
  el("path", { d: `M${x1},${y1} C${middle},${y1} ${middle},${y2} ${x2},${y2} L${x2},${y2 + height} C${middle},${y2 + height} ${middle},${y1 + height} ${x1},${y1 + height} Z`, fill: color, "fill-opacity": .35 }, svg);
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
  const rows = groups.flatMap(g => g.accounts.flatMap(a => expanded.has(a.id) && a.kind === "investment"
    ? a.holdings.filter(h => (h.valueCents ?? 0) > 0).map(h => ({ account: a, id: h.id, name: h.name, cents: h.valueCents!, holding: true }))
    : [{ account: a, id: a.id, name: a.name, cents: a.cents, holding: false }]));
  if (!rows.length) { parent.createEl("p", { cls: "ledger-assets-empty", text: snapshot.accounts.length ? "当前没有可绘制的正资产；未估值持仓、负余额与净资产缺口请查看总览和账户。" : "添加账户和持仓后，这里显示资产组成桑基图。" }); return; }
  const rowGap = 44;
  const total = visible.reduce((sum, a) => sum + a.cents, 0), height = Math.max(360, rows.length * 64 + groups.length * 24 + 100);
  const plotHeight = height - 130 - Math.max(0, rows.length - 1) * rowGap - Math.max(0, groups.length - 1) * 20;
  const scale = plotHeight / total;
  const scroll = parent.createDiv({ cls: "ledger-assets-sankey-scroll" });
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
    el("rect", { x: 80, y: 100, width: 12, height: netHeight, fill: "#78bf9f" }, svg);
    band(svg, 92, 100, 310, 100, netHeight, "#78bf9f");
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
  el("rect", { x: 310, y: 100, width: 13, height: total * scale, fill: "#9b94bd" }, svg);
  label(svg, 310, 62, `${totals.missing || !sources ? "已估值正资产" : "总资产"} ${amounts(total)}`, 19);
  for (const group of groupLayout) {
    const color = COLORS[group.kind], groupHeight = group.cents * scale, groupRows = rows.filter(r => r.account.kind === group.kind);
    band(svg, 323, rootCursor, 675, group.y, groupHeight, "#9b94bd");
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
}
