import type { CategorySummary } from "./core";

export interface DonutSegment extends CategorySummary {
  members: CategorySummary[];
  ticks: number;
}

/** Keep the dial legible without discarding any category from the breakdown. */
export function prepareDonut(data: CategorySummary[]): DonutSegment[] {
  const sorted = [...data].filter((item) => item.cents > 0).sort((a, b) => b.cents - a.cents || a.category.localeCompare(b.category));
  const total = sorted.reduce((sum, item) => sum + item.cents, 0);
  if (total === 0) return [];

  const leading = sorted.length > 6 ? sorted.slice(0, 5) : sorted;
  const rest = sorted.length > 6 ? sorted.slice(5) : [];
  const parts: Array<{ category: string; cents: number; count: number; members: CategorySummary[] }> =
    leading.map((item) => ({ category: item.category, cents: item.cents, count: item.count, members: [item] }));
  if (rest.length > 0) {
    parts.push({
      category: `其余 ${rest.length} 类`,
      cents: rest.reduce((sum, item) => sum + item.cents, 0),
      count: rest.reduce((sum, item) => sum + item.count, 0),
      members: rest
    });
  }

  const exact = parts.map((part) => part.cents / total * 100);
  const ticks = exact.map((value) => Math.max(1, Math.floor(value)));
  let difference = 100 - ticks.reduce((sum, value) => sum + value, 0);
  const fractions = exact.map((value, index) => ({ index, fraction: value - Math.floor(value) }));
  if (difference > 0) {
    fractions.sort((a, b) => b.fraction - a.fraction || a.index - b.index);
    for (let i = 0; i < difference; i += 1) ticks[fractions[i % fractions.length].index] += 1;
  } else if (difference < 0) {
    while (difference < 0) {
      const index = ticks.reduce((best, value, current) => value > 1 && (best < 0 || value - exact[current] > ticks[best] - exact[best]) ? current : best, -1);
      if (index < 0) break;
      ticks[index] -= 1;
      difference += 1;
    }
  }

  return parts.map((part, index) => ({ ...part, share: part.cents / total, ticks: ticks[index] }));
}
