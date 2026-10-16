import { init, use } from "echarts/core";
import { TreemapChart } from "echarts/charts";
import { AriaComponent, TooltipComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import { CategoryTree, CategoryTreeNode, treeValue } from "./treemap";
import { formatCents } from "./core";

use([TreemapChart, TooltipComponent, AriaComponent, SVGRenderer]);

interface TreeParam { name: string; value: number; data: CategoryTreeNode; }

/** C9/F13 "Where the work went", basics-wire.html: SVG treemap, same geometry. */
export function createCategoryTree(host: HTMLElement, tree: CategoryTree, onSelect: (category: string) => void): { resize(): void; dispose(): void } {
  const style = host.ownerDocument.defaultView!.getComputedStyle(host);
  const paper = style.getPropertyValue("--mono-paper").trim() || "#F0F0EE";
  const ink = style.getPropertyValue("--mono-ink").trim() || "#1F1E1C";
  const muted = style.getPropertyValue("--mono-3").trim() || "#6E6D66";
  const orange = "#F5572F", dark = "#22211F", gray = "#8F8E86", faint = "#C0BFB7";
  // Shared parent color identifies the real group; only the largest leaf is orange.
  const names = tree.nodes.map(node => node.name).sort((a, b) => a.localeCompare(b));
  const paint = (node: CategoryTreeNode, fill: string): CategoryTreeNode => {
    const hero = !!node.category && node.category === tree.leader?.category;
    return { ...node, itemStyle: { color: hero ? orange : fill }, label: { color: hero || fill === dark ? "#F0F0EE" : "#1F1E1C" }, children: node.children?.map(child => paint(child, fill)) };
  };
  const nodes = tree.nodes.map(node => paint(node, [dark, gray, faint][names.indexOf(node.name) % 3]));
  const chart = init(host, undefined, { renderer: "svg" });
  const reduce = host.ownerDocument.defaultView!.matchMedia("(prefers-reduced-motion: reduce)").matches;
  chart.setOption({
    animation: !reduce, animationDuration: 900, animationEasing: "quarticOut",
    aria: { enabled: true, label: { description: `分类矩形树图，矩形面积表示${tree.measure === "count" ? "记账笔数" : "支出金额"}，橙色为最大分类。完整分类可在下方明细中选择。` } },
    tooltip: { backgroundColor: paper, borderColor: ink, borderWidth: 1, textStyle: { color: ink, fontSize: 12 }, confine: true,
      formatter: (value: unknown) => {
        const { data } = value as TreeParam;
        const tip = host.ownerDocument.createElement("div"); tip.className = "ledger-treemap-tooltip";
        const name = tip.appendChild(host.ownerDocument.createElement("strong")); name.textContent = data.category ?? data.name;
        const detail = tip.appendChild(host.ownerDocument.createElement("div"));
        detail.textContent = `${formatCents(data.cents)} · ${data.count} 笔 · ${(data.value / tree.total * 100).toFixed(1)}%`;
        return tip;
      } },
    series: [{ type: "treemap", data: nodes, top: 0, right: 0, bottom: 0, left: 0, roam: false, nodeClick: false, breadcrumb: { show: false }, leafDepth: 2, squareRatio: 1.2, sort: "desc", visibleMin: 0,
      label: { show: true, position: "insideTopLeft", padding: [10, 8], color: ink, fontSize: 12, fontWeight: 700, fontFamily: "Inter, sans-serif", lineHeight: 18, overflow: "truncate",
        formatter: (value: unknown) => {
          const p = value as TreeParam;
          // Do not print a truncated currency amount in a tiny leaf; full values
          // remain available in the tooltip and accessible category list.
          const showValue = p.value / tree.total >= (host.clientWidth < 500 ? .09 : .04);
          return p.data.category && showValue ? `${p.name}\n${treeValue(p.value, tree.measure)}` : p.name;
        } },
      upperLabel: { show: true, height: 32, padding: [0, 10], color: ink, fontSize: 10, fontWeight: 700, backgroundColor: paper,
        formatter: (value: unknown) => { const p = value as TreeParam; return p.name ? `${p.name} · ${(p.value / tree.total * 100).toFixed(0)}%` : ""; } },
      itemStyle: { borderColor: paper, borderWidth: 2, gapWidth: 2 }, emphasis: { focus: "ancestor", itemStyle: { borderColor: ink, borderWidth: 1.5 } },
      levels: [{ upperLabel: { show: false }, itemStyle: { borderWidth: 0, gapWidth: 5 } }, { upperLabel: { show: true, height: 32 }, itemStyle: { borderColor: paper, borderWidth: 3, gapWidth: 3 } }, { upperLabel: { show: false }, itemStyle: { borderColor: paper, borderWidth: 2, gapWidth: 2 } }]
    }]
  });
  host.style.color = muted;
  chart.on("click", params => { const data = params.data as CategoryTreeNode | undefined; if (data?.category) onSelect(data.category); });
  return { resize: () => chart.resize(), dispose: () => chart.dispose() };
}
