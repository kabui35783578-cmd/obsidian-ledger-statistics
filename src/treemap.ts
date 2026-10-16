import { CategorySummary, formatCents } from "./core";
import { registerChartCleanup } from "./chart-animation";

export type CategoryMeasure = "amount" | "count";
export interface CategoryTreeNode {
  name: string;
  value: number;
  cents: number;
  count: number;
  category?: string;
  children?: CategoryTreeNode[];
  itemStyle?: { color: string };
  label?: { color: string };
}
export interface CategoryTree {
  nodes: CategoryTreeNode[];
  rows: CategorySummary[];
  omitted: CategorySummary[];
  total: number;
  measure: CategoryMeasure;
  leader?: CategorySummary;
}

/** Only explicit slash-separated category names introduce parent groups. */
export function categoryTree(data: CategorySummary[], measure: CategoryMeasure): CategoryTree {
  const weight = (row: CategorySummary): number => measure === "count" ? row.count : row.cents;
  const rows = data.filter(row => Number.isFinite(weight(row)) && weight(row) > 0)
    .slice().sort((a, b) => weight(b) - weight(a) || a.category.localeCompare(b.category));
  const groups = new Map<string, CategoryTreeNode>();
  const nodes: CategoryTreeNode[] = [];
  for (const row of rows) {
    const slash = row.category.indexOf("/");
    const nested = slash > 0 && slash < row.category.length - 1;
    const node: CategoryTreeNode = { name: nested ? row.category.slice(slash + 1) : row.category, category: row.category, value: weight(row), cents: row.cents, count: row.count };
    if (!nested) { nodes.push(node); continue; }
    const parentName = row.category.slice(0, slash);
    let parent = groups.get(parentName);
    if (!parent) { parent = { name: parentName, value: 0, cents: 0, count: 0, children: [] }; groups.set(parentName, parent); nodes.push(parent); }
    parent.children!.push(node); parent.value += node.value; parent.cents += node.cents; parent.count += node.count;
  }
  nodes.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  return { nodes, rows, omitted: data.filter(row => !rows.includes(row)), total: rows.reduce((sum, row) => sum + weight(row), 0), measure, leader: rows[0] };
}

export function treeValue(value: number, measure: CategoryMeasure): string {
  return measure === "count" ? `${value} 笔` : formatCents(value);
}

/** Delay loading the bundled ECharts engine until the chart is actually visible. */
export function mountCategoryTree(host: HTMLElement, tree: CategoryTree, onSelect: (category: string) => void): void {
  let disposed = false, visible = typeof IntersectionObserver === "undefined", starting = false, frame = 0;
  let chart: { resize(): void; dispose(): void } | undefined;
  const start = async (): Promise<void> => {
    if (disposed || starting || chart || !visible || !host.isConnected || !host.clientWidth) return;
    starting = true;
    try {
      const { createCategoryTree } = await import("./treemap-engine");
      if (disposed || !host.isConnected) return;
      chart = createCategoryTree(host, tree, onSelect);
    } catch {
      if (!disposed) host.textContent = "图表暂未显示，可展开下方分类明细查看。";
    } finally { starting = false; }
  };
  const resize = (): void => {
    if (disposed || frame) return;
    frame = requestAnimationFrame(() => { frame = 0; if (disposed) return; if (chart) chart.resize(); else void start(); });
  };
  const intersection = typeof IntersectionObserver === "undefined" ? undefined : new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    visible = true; intersection?.disconnect(); void start();
  }, { threshold: 0 });
  const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(resize);
  registerChartCleanup(host, () => { disposed = true; intersection?.disconnect(); observer?.disconnect(); if (frame) cancelAnimationFrame(frame); chart?.dispose(); });
  intersection?.observe(host); observer?.observe(host); void start();
}
