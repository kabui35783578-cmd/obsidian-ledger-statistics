import { ReportFact, ReportSnapshot, reportDays } from "./report";

const NUMBER = "[+−-]?\\d+(?:,\\d{3})*(?:\\.\\d+)?";
function decimal(value: string, places: number): string {
  const n = Number(value.replace(/,/g, "").replace("−", "-"));
  const digits = Math.abs(n).toFixed(places);
  return `${n < 0 && Number(digits) ? "−" : value.startsWith("+") ? "+" : ""}${digits}`;
}

/** Presentation only: raw reports and local evidence retain their original values. */
export function reportPlainLanguage(text: string): string {
  return text.replace(/基期/g, "上期")
    .replace(/笔数变化的金额贡献（对称分解）|笔数贡献/g, "次数变化带来的影响")
    .replace(/笔均变化的金额贡献（对称分解）|笔均贡献/g, "每笔金额变化带来的影响")
    .replace(/头部大额记录/g, "最贵的几笔")
    .replace(/头部三笔|最大三笔/g, "最贵的三笔")
    .replace(/解释边界/g, "注意事项")
    .replace(/单笔更便宜|单笔变便宜了/g, "每笔付款金额更低")
    .replace(/每笔均价|均价/g, "平均每笔金额");
}
export function formatReportText(text: string): string {
  return reportPlainLanguage(text)
    .replace(new RegExp(`(${NUMBER})([～~至])(${NUMBER})(元|块钱|块)`, "g"), (_m, a, sep, b, unit) => `${decimal(a, 2)}${sep}${decimal(b, 2)}${unit}`)
    .replace(new RegExp(`([¥￥]\\s*)?(${NUMBER})\\s*(元|块钱|块)`, "g"), (_m, currency, amount, unit) => `${currency ?? ""}${decimal(amount, 2)}${unit}`)
    .replace(new RegExp(`([¥￥])\\s*(${NUMBER})(?![\\d.])`, "g"), (_m, currency, amount) => `${currency}${decimal(amount, 2)}`)
    .replace(new RegExp(`(${NUMBER})\\s*[%％]`, "g"), (_m, value) => `${decimal(value, 1)}%`)
    .replace(/-(\d+(?:\.\d+)?)(笔|天)/g, "−$1$2");
}

export interface ReportTextPart { text: string; bold: boolean; tone?: "increase" | "decrease" }
export function reportTextParts(text: string, emphasis: { remaining: number }): ReportTextPart[] {
  const parts: ReportTextPart[] = [];
  const add = (value: string, bold: boolean) => {
    const pattern = /[+−](?:[¥￥])?\d+(?:\.\d+)?(?:元|块钱|块|%|笔|天)|[¥￥][+−]\d+(?:\.\d+)?/g;
    let cursor = 0;
    for (const m of value.matchAll(pattern)) {
      if (m.index! > cursor) parts.push({ text: value.slice(cursor, m.index), bold });
      parts.push({ text: m[0], bold, tone: m[0].includes("−") ? "decrease" : "increase" });
      cursor = m.index! + m[0].length;
    }
    if (cursor < value.length) parts.push({ text: value.slice(cursor), bold });
  };
  const formatted = formatReportText(text), pattern = /\*\*([^\n]+?)\*\*/g;
  let cursor = 0;
  for (const m of formatted.matchAll(pattern)) {
    add(formatted.slice(cursor, m.index), false);
    const bold = emphasis.remaining > 0;
    if (bold) emphasis.remaining--;
    add(m[1], bold);
    cursor = m.index! + m[0].length;
  }
  add(formatted.slice(cursor), false);
  return parts;
}

export function reportProgress(snapshot: ReportSnapshot): string {
  const elapsed = reportDays(snapshot.range), full = reportDays(snapshot.fullRange), previous = reportDays(snapshot.previousRange);
  const custom = snapshot.preferences.mode === "custom", ongoing = snapshot.range.end < snapshot.fullRange.end;
  const progress = ongoing ? `${custom ? "所选范围" : "本周期"}已过 ${elapsed} / ${full} 天` : `${custom ? "所选范围" : "本周期"}共 ${full} 天`;
  const comparison = ongoing
    ? previous === elapsed ? `上期取同样的前 ${elapsed} 天对比` : `上期仅 ${previous} 天，频次按自然日折算`
    : custom ? `与前一等长范围（${previous} 天）对比` : `与上期完整周期（${previous} 天）对比`;
  return `${progress} · ${comparison}${snapshot.comparable ? "" : " · 数据待核对"}`;
}

export function formatReportFact(key: string, f: ReportFact): { text: string; tone?: "increase" | "decrease" } {
  const change = ["frequency_contribution", "ticket_contribution", "top3_difference", "increase", "decrease"].includes(key);
  const value = key === "decrease" ? -Math.abs(f.value) : f.value;
  const places = f.unit === "元" ? 2 : f.unit === "%" ? 1 : Number.isInteger(value) ? 0 : 2;
  const text = `${decimal(`${change && value > 0 ? "+" : ""}${value}`, places)}${f.unit}`;
  return { text, ...(change && value !== 0 ? { tone: value < 0 ? "decrease" as const : "increase" as const } : {}) };
}
