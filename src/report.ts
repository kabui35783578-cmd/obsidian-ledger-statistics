import { addDays, budgetScopedRecords, DateRange, FilterState, flattenRecords, isoFromDate, LedgerRecord, monthRange, normalizeLedgerText, ParsedLedgerFile, recordMatches, salaryCycleFullRange } from "./core";

export const REPORT_RULE_VERSION = "1";
export interface ReportPreferences {
  mode: "salary" | "month" | "custom";
  offset: number;
  /** Keep an explicitly selected historical cycle fixed across salary/month boundaries. */
  anchorDate?: string;
  customRange: DateRange;
  scope: "consumption" | "all";
  category: string;
  keyword: string;
  includeStarred: boolean;
}
export interface ReportFact { label: string; value: number; unit: "元" | "笔" | "天" | "周" | "%" | "倍" }
export interface ReportEvidence {
  id: string; label: string; ranges: Array<{ label: string; range: DateRange }>;
  facts: Record<string, ReportFact>; recordIds: string[]; limits: string[];
}
export interface ReportFinding {
  id: string; subject: string; type: string; title: string; observation: string;
  score: number; evidenceIds: string[]; limits: string[];
}
export interface ReportCoverage { range: DateRange; complete: boolean; missingDates: string[]; problems: Array<{ path: string; date: string; reason: string }> }
export interface ReportSnapshot {
  ruleVersion: string; fingerprint: string; label: string; range: DateRange; fullRange: DateRange;
  previousRange: DateRange; historicalRanges: DateRange[]; coverage: ReportCoverage[];
  undatedPaths: string[]; comparable: boolean; findings: ReportFinding[]; evidence: ReportEvidence[];
  records: LedgerRecord[]; preferences: ReportPreferences; excludedCategories: string[];
}
export interface ReportParagraph { heading: string; text: string; findingIds: string[]; evidenceIds: string[] }
export interface SpendingReport { title: string; summary: string; paragraphs: ReportParagraph[] }
export interface ReportCache { fingerprint: string; configuration: string; generatedAt: string; report: SpendingReport }

export function defaultReportPreferences(now = new Date()): ReportPreferences {
  return { mode: "salary", offset: 0, customRange: { start: isoFromDate(now), end: isoFromDate(now) }, scope: "consumption", category: "", keyword: "", includeStarred: true };
}
export function normalizeReportPreferences(value: Partial<ReportPreferences> | null | undefined, now = new Date()): ReportPreferences {
  const base = defaultReportPreferences(now);
  if (!value || typeof value !== "object") return base;
  return { ...base, mode: ["salary", "month", "custom"].includes(value.mode ?? "") ? value.mode! : base.mode,
    offset: Number.isInteger(value.offset) && value.offset! >= 0 ? Math.min(120, value.offset!) : 0,
    anchorDate: value.anchorDate && validRange({ start: value.anchorDate, end: value.anchorDate }) && value.anchorDate <= isoFromDate(now) ? value.anchorDate : undefined,
    customRange: value.customRange && validRange(value.customRange) && value.customRange.start <= isoFromDate(now) && reportDays(value.customRange) <= 366 ? { ...value.customRange } : base.customRange,
    scope: value.scope === "all" ? "all" : "consumption", category: typeof value.category === "string" ? value.category : "",
    keyword: typeof value.keyword === "string" ? value.keyword : "", includeStarred: value.includeStarred !== false };
}
function validRange(r: DateRange): boolean {
  return !!r && /^\d{4}-\d{2}-\d{2}$/.test(r.start) && /^\d{4}-\d{2}-\d{2}$/.test(r.end) && r.start <= r.end &&
    isoFromDate(new Date(`${r.start}T12:00:00`)) === r.start && isoFromDate(new Date(`${r.end}T12:00:00`)) === r.end;
}
export function reportDays(r: DateRange): number { return Math.max(0, Math.round((new Date(`${r.end}T12:00:00`).getTime() - new Date(`${r.start}T12:00:00`).getTime()) / 86400000) + 1); }
export function reportPeriods(p: ReportPreferences, now: Date): { range: DateRange; fullRange: DateRange; previous: DateRange; history: DateRange[] } {
  const today = isoFromDate(now);
  if (p.mode === "custom") {
    const fullRange = { ...p.customRange };
    const range = { ...fullRange, end: fullRange.end > today ? today : fullRange.end };
    const n = reportDays(fullRange);
    const previousStart = addDays(fullRange.start, -n);
    return { range, fullRange, previous: { start: previousStart, end: addDays(previousStart, reportDays(range) - 1) },
      history: Array.from({ length: 6 }, (_, i) => ({ start: addDays(fullRange.start, -n * (i + 1)), end: addDays(fullRange.start, -n * i - 1) })) };
  }
  const baseDate = p.offset > 0 && p.anchorDate ? new Date(`${p.anchorDate}T12:00:00`) : now;
  const selectedOffset = p.offset > 0 && p.anchorDate ? 0 : p.offset;
  const full = (offset: number) => p.mode === "salary" ? salaryCycleFullRange(baseDate, offset) : monthRange(baseDate.getFullYear(), baseDate.getMonth() - offset);
  const fullRange = full(selectedOffset);
  const range = { ...fullRange, end: fullRange.end > today ? today : fullRange.end };
  const history = Array.from({ length: 6 }, (_, i) => full(selectedOffset + i + 1));
  const elapsed = reportDays(range);
  const previous = p.offset === 0 ? { start: history[0].start, end: addDays(history[0].start, Math.min(elapsed, reportDays(history[0])) - 1) } : history[0];
  return { range, fullRange, previous, history };
}
export function reportCoverage(files: ParsedLedgerFile[], range: DateRange): ReportCoverage {
  const byDate = new Map<string, ParsedLedgerFile[]>();
  files.forEach(f => { if (f.date) byDate.set(f.date, [...(byDate.get(f.date) ?? []), f]); });
  const missingDates: string[] = [], problems: ReportCoverage["problems"] = [];
  for (let day = range.start; day <= range.end; day = addDays(day, 1)) {
    const entries = byDate.get(day);
    if (!entries) { missingDates.push(day); continue; }
    for (const f of entries) {
      const reasons = f.diagnostics.map(d => d.reason);
      if (!f.records.length && f.frontmatterTotalCents !== 0) reasons.push("空账本没有明确记录零消费");
      if (reasons.length) problems.push({ path: f.path, date: day, reason: reasons.join("；") });
    }
  }
  return { range, complete: reportDays(range) > 0 && !missingDates.length && !problems.length, missingDates, problems };
}

export interface ReportObject { key: string; label: string; kind: "object" | "brand" | "mixed" | "note" }
const OBJECT_RULES: Array<[string, RegExp]> = [
  ["咖啡", /咖啡|拿铁|美式/], ["奶茶", /奶茶/], ["矿泉水", /矿泉水/], ["早餐", /早餐|早饭/],
  ["午餐", /午餐|午饭/], ["晚餐", /晚餐|晚饭/], ["零食", /零食/], ["水果", /水果|西瓜(?!霜)|榴莲|香蕉|葡萄/],
  ["生活用品", /洗发水|洗衣液|牙膏|牙线|纸巾|面巾纸|洗脸巾|洗面巾|洗衣粉|香皂|沐浴露/]
];
export function identifyReportObjects(note: string): ReportObject[] {
  const text = normalizeLedgerText(note).trim().toLocaleLowerCase("zh-CN").replace(/\s+/g, " ");
  if (!text) return [];
  const matches = OBJECT_RULES.filter(([, re]) => re.test(text));
  const mixed = matches.length > 1 && (/超市|购物|[+、]/.test(text) || matches.some(([label]) => ["水果", "生活用品", "零食"].includes(label)));
  const result: ReportObject[] = mixed ? [{ key: "mixed:购物", label: "混合购物", kind: "mixed" }] : matches.map(([label]) => ({ key: `object:${label}`, label, kind: "object" }));
  for (const [brand, re] of [["瑞幸", /瑞幸/], ["蜜雪冰城", /蜜雪冰城/], ["海底捞", /海底捞/]] as Array<[string, RegExp]>) {
    if (re.test(text)) result.push({ key: `brand:${brand}`, label: `${brand}（品牌）`, kind: "brand" });
  }
  if (!result.length) result.push({ key: `note:${text}`, label: text, kind: "note" });
  return result;
}
export function reportHash(value: string): string {
  let a = 2166136261, b = 5381;
  for (let i = 0; i < value.length; i++) { a = Math.imul(a ^ value.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ value.charCodeAt(i); }
  return `${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`;
}
const total = (r: LedgerRecord[]) => r.reduce((s, t) => s + t.cents, 0);
export function reportMedian(a: number[]): number { const b = [...a].sort((x, y) => x - y); return b.length ? (b[Math.floor((b.length - 1) / 2)] + b[Math.floor(b.length / 2)]) / 2 : 0; }
export function cosine(a: number[], b: number[]): number { const norm = Math.sqrt(a.reduce((s, v) => s + v * v, 0) * b.reduce((s, v) => s + v * v, 0)); return norm ? a.reduce((s, v, i) => s + v * b[i], 0) / norm : 0; }
export function theilSen(values: number[]): number { const slopes: number[] = []; values.forEach((v, i) => { for (let j = i + 1; j < values.length; j++) slopes.push((values[j] - v) / (j - i)); }); return reportMedian(slopes); }
export function symmetricDecomposition(n0: number, a0: number, n1: number, a1: number): { frequency: number; ticket: number } {
  const p0 = n0 ? a0 / n0 : 0, p1 = n1 ? a1 / n1 : 0;
  return { frequency: (n1 - n0) * (p0 + p1) / 2, ticket: (p1 - p0) * (n0 + n1) / 2 };
}
function stats(r: LedgerRecord[]) { return { n: r.length, cents: total(r), mean: r.length ? total(r) / r.length : 0, median: reportMedian(r.map(t => t.cents)), days: new Set(r.map(t => t.date)).size }; }
function unique(r: LedgerRecord[]) { return [...new Map(r.map(t => [t.id, t])).values()]; }
function group(r: LedgerRecord[], key: (r: LedgerRecord) => string) { const out = new Map<string, LedgerRecord[]>(); r.forEach(t => out.set(key(t), [...(out.get(key(t)) ?? []), t])); return out; }
function dateList(r: DateRange) { return Array.from({ length: reportDays(r) }, (_, i) => addDays(r.start, i)); }
function weekday(d: string) { return (new Date(`${d}T12:00:00`).getDay() + 6) % 7; }

export function buildReportSnapshot(files: ParsedLedgerFile[], preferences: ReportPreferences, now: Date, excludedCategories: string[], starredIds: string[]): ReportSnapshot {
  const periods = reportPeriods(preferences, now);
  const coverage = [periods.range, periods.previous, ...periods.history].map(r => reportCoverage(files, r));
  const undatedPaths = files.filter(f => !f.date).map(f => f.path);
  const selected = (range: DateRange) => budgetScopedRecords(flattenRecords(files).filter(r => recordMatches(r, {
    range, scope: preferences.scope, excludedCategories, categories: preferences.category ? [preferences.category] : [], keyword: preferences.keyword
  } as FilterState)), preferences.includeStarred, starredIds);
  const allRange = { start: periods.history[5].start, end: periods.range.end };
  const all = selected(allRange), current = selected(periods.range), previous = selected(periods.previous);
  const snapshot: ReportSnapshot = { ruleVersion: REPORT_RULE_VERSION, fingerprint: "", label: preferences.mode === "salary" ? "工资周期支出报告" : preferences.mode === "month" ? "自然月支出报告" : "自定义支出报告",
    range: periods.range, fullRange: periods.fullRange, previousRange: periods.previous, historicalRanges: periods.history.filter((_, i) => coverage[i + 2].complete),
    coverage, undatedPaths, comparable: coverage[0].complete && coverage[1].complete && !undatedPaths.length,
    findings: [], evidence: [], records: all, preferences: { ...preferences }, excludedCategories: [...excludedCategories] };
  const objectGroups = (rs: LedgerRecord[]) => {
    const g = new Map<string, { label: string; records: LedgerRecord[] }>();
    for (const r of rs) for (const o of identifyReportObjects(r.note)) {
      const value = g.get(o.key) ?? { label: o.label, records: [] }; value.records.push(r); g.set(o.key, value);
    }
    return g;
  };
  const objectsNow = objectGroups(current), objectsPrev = objectGroups(previous), objectsAll = objectGroups(all);
  const add = (subject: string, type: string, title: string, observation: string, score: number, rs: LedgerRecord[], facts: Record<string, ReportFact>, limits: string[], ranges = [{ label: "本期", range: periods.range }, { label: "基期", range: periods.previous }], narrativeSubject = subject) => {
    const id = `${type}:${reportHash(subject)}`;
    if (snapshot.findings.some(f => f.id === id)) return;
    snapshot.findings.push({ id, subject: narrativeSubject, type, title, observation, score, evidenceIds: [id], limits });
    const weekDays = ranges.length === 1 && ranges[0].label.includes("周") ? reportDays(ranges[0].range) : 0;
    snapshot.evidence.push({ id, label: title, ranges, facts: { ...facts, ...(weekDays && weekDays % 7 === 0 ? { observed_weeks: { label: "观察完整周数", value: weekDays / 7, unit: "周" as const } } : {}) }, recordIds: unique(rs).map(r => r.id), limits });
  };
  const fact = (label: string, value: number, unit: ReportFact["unit"]): ReportFact => ({ label, value: Number(value.toFixed(2)), unit });
  const comparisonFacts = (x: LedgerRecord[], y: LedgerRecord[]) => {
    const a = stats(x), b = stats(y), decomposition = symmetricDecomposition(b.n, b.cents, a.n, a.cents);
    return { current_amount: fact("本期金额", a.cents / 100, "元"), previous_amount: fact("基期金额", b.cents / 100, "元"),
      current_count: fact("本期笔数", a.n, "笔"), previous_count: fact("基期笔数", b.n, "笔"),
      current_mean: fact("本期平均每笔", a.mean / 100, "元"), previous_mean: fact("基期平均每笔", b.mean / 100, "元"),
      current_median: fact("本期中位数", a.median / 100, "元"), previous_median: fact("基期中位数", b.median / 100, "元"),
      current_days: fact("本期出现天数", a.days, "天"), previous_days: fact("基期出现天数", b.days, "天"),
      current_calendar_days: fact("本期观察自然日数", reportDays(periods.range), "天"), previous_calendar_days: fact("基期观察自然日数", reportDays(periods.previous), "天"),
      current_daily_count: fact("本期每自然日笔数", a.n / Math.max(1, reportDays(periods.range)), "笔"), previous_daily_count: fact("基期每自然日笔数", b.n / Math.max(1, reportDays(periods.previous)), "笔"),
      current_active_day_count: fact("本期每个消费日笔数", a.days ? a.n / a.days : 0, "笔"), previous_active_day_count: fact("基期每个消费日笔数", b.days ? b.n / b.days : 0, "笔"),
      frequency_contribution: fact("笔数变化的金额贡献（对称分解）", decomposition.frequency / 100, "元"),
      ticket_contribution: fact("笔均变化的金额贡献（对称分解）", decomposition.ticket / 100, "元") };
  };
  const boundaries = ["账目笔数不等于商品数量；平均每笔金额不是商品单价。", "备注识别反映已记录用途，不证明没有漏记或记账方式变化。"];
  if (snapshot.comparable) {
    const subjects = new Map<string, { label: string; a: LedgerRecord[]; b: LedgerRecord[]; object: boolean }>();
    for (const [category, rs] of group(current, r => r.category)) subjects.set(`category:${category}`, { label: category, a: rs, b: previous.filter(r => r.category === category), object: false });
    for (const [category, rs] of group(previous, r => r.category)) if (!subjects.has(`category:${category}`)) subjects.set(`category:${category}`, { label: category, a: [], b: rs, object: false });
    for (const key of new Set([...objectsNow.keys(), ...objectsPrev.keys()])) subjects.set(key, { label: (objectsNow.get(key) ?? objectsPrev.get(key))!.label, a: unique(objectsNow.get(key)?.records ?? []), b: unique(objectsPrev.get(key)?.records ?? []), object: true });
    for (const [key, s] of subjects) {
      const a = stats(s.a), b = stats(s.b);
      if (Math.max(a.n, b.n) < 5) continue;
      const rate = b.n ? (a.n / Math.max(1, reportDays(periods.range))) / (b.n / Math.max(1, reportDays(periods.previous))) - 1 : null;
      const frequency = Math.abs(a.n - b.n) >= 5 && (rate === null || Math.abs(rate) >= .2);
      const amount = Math.abs(a.cents - b.cents) >= 10000 && (!b.cents || Math.abs(a.cents / b.cents - 1) >= .2);
      let title = "", observation = "", score = 0;
      if (frequency || amount) {
        title = !b.n ? `${s.label}在本期新增记录` : frequency ? `${s.label}的记录频率${a.n > b.n ? "增加" : "下降"}` : `${s.label}的金额变化需要拆开理解`;
        observation = !b.n ? "基期没有这组记录，本期出现了多笔；目前可以确认新增记录，还不能认定形成长期习惯。" :
          frequency ? `已记录的${s.label}在笔数和每天频次上均有变化。应同时观察出现天数、单日笔数和笔均金额，判断变化来自更多消费日还是同日更多记录。` : "金额变化同时受笔数和平均每笔影响；对称分解提供两部分贡献，不将笔均变化直接解释为商品涨价。";
        score = (s.object ? 35 : 20) + Math.min(25, Math.abs(a.n - b.n)) + Math.min(20, Math.abs(a.cents - b.cents) / 10000);
      }
      const top = (r: LedgerRecord[]) => [...r].sort((x, y) => y.cents - x.cents).slice(0, 3);
      const delta = a.cents - b.cents, topDelta = total(top(s.a)) - total(top(s.b));
      const big = a.n >= 10 && b.n >= 10 && delta >= 10000 && topDelta / delta >= .5;
      if (big) { title = `${s.label}上涨主要集中在少数较大记录`; observation = "两期各自最大的三笔记录，其金额差额解释了本期增量的一半以上。总额变化不能直接推广到每一笔日常消费。"; score += 40; }
      const distribution = a.n >= 10 && b.n >= 10;
      const smallA = a.n ? s.a.filter(r => r.cents < 2000).length / a.n : 0, smallB = b.n ? s.b.filter(r => r.cents < 2000).length / b.n : 0;
      if (distribution && a.mean > b.mean && a.median <= b.median && amount) {
        title = `${s.label}平均金额上升，典型单笔没有同步变贵`; observation = `平均每笔上升，中位数却没有上升，说明金额分布内部变化。${big ? "两期最大三笔的差额解释了增量的一半以上，较大记录拉高了平均数，不能推广到每一笔日常消费。" : "较大记录可能拉高平均数，应结合其增量贡献理解。"}`; score += 35;
      } else if (distribution && Math.abs(smallA - smallB) >= .1) {
        if (!title) { title = `${s.label}的小额记录占比改变`; observation = "二十元以下记录的占比变化超过十个百分点，金额分布的变化可能被总额掩盖。"; }
        score += 15;
      }
      if (s.object && a.days - b.days >= 5) { title = `${s.label}出现在更多日子里`; observation = "这组消费不仅笔数改变，也分布到更多日期，较单次集中购买更接近日常重复出现；是否持续仍需跨周观察。"; score += 35; }
      const limits = [...boundaries];
      let narrativeSubject = key;
      let componentFacts: Record<string, ReportFact> = {};
      const binFacts: Record<string, ReportFact> = {};
      if (distribution) for (const [i, lower, upper, label] of [[0, 0, 1000, "十元以下"], [1, 1000, 3000, "十元至三十元（不含）"], [2, 3000, 5000, "三十元至五十元（不含）"], [3, 5000, Infinity, "五十元及以上"]] as Array<[number, number, number, string]>) {
        binFacts[`current_bin_${i}`] = fact(`本期${label}笔数`, s.a.filter(r => r.cents >= lower && r.cents < upper).length, "笔");
        binFacts[`previous_bin_${i}`] = fact(`基期${label}笔数`, s.b.filter(r => r.cents >= lower && r.cents < upper).length, "笔");
      }
      if (!s.object && (frequency || amount || Math.abs(a.n - b.n) >= 5)) {
        const contributions = [...objectsNow.entries()].map(([objectKey, g]) => ({ key: objectKey, label: g.label,
          a: g.records.filter(r => r.category === s.label), b: (objectsPrev.get(objectKey)?.records ?? []).filter(r => r.category === s.label) }))
          .filter(o => o.key.startsWith("object:") || o.key.startsWith("mixed:"))
          .sort((x, y) => Math.abs(y.a.length - y.b.length) - Math.abs(x.a.length - x.b.length));
        const lead = contributions[0];
        if (lead && Math.abs(lead.a.length - lead.b.length) >= 5 && Math.abs(lead.a.length - lead.b.length) >= Math.abs(a.n - b.n) * .5) {
          const residual = (a.n - lead.a.length) - (b.n - lead.b.length);
          componentFacts = {
            component_current_count: fact(`${lead.label}本期笔数（该原分类内）`, lead.a.length, "笔"),
            component_previous_count: fact(`${lead.label}基期笔数（该原分类内）`, lead.b.length, "笔"),
            residual_current_count: fact("本期扣除该对象后的笔数", a.n - lead.a.length, "笔"),
            residual_previous_count: fact("基期扣除该对象后的笔数", b.n - lead.b.length, "笔")
          };
          title = !b.n ? `${s.label}在本期新增，主要来自${lead.label}记录` : `${s.label}笔数变化主要来自${lead.label}记录`;
          observation = `分类笔数的变化中，${lead.label}记录贡献明显；扣除这些记录后，其余笔数${residual > 0 ? "增加" : residual < 0 ? "减少" : "不变"}，不能把分类变化泛化成每一种消费都变频繁。${observation} ${big ? "金额增量主要集中在少数较大记录，金额与笔数的变化有不同来源。" : ""}`;
          score += 45;
          const leadNowIds = new Set(lead.a.map(r => r.id)), leadPreviousIds = new Set(lead.b.map(r => r.id));
          const remainderNow = s.a.filter(r => !leadNowIds.has(r.id)), remainderPrevious = s.b.filter(r => !leadPreviousIds.has(r.id));
          if (!big && remainderNow.length === remainderPrevious.length && total(remainderNow) === total(remainderPrevious)) {
            // A category and its sole changing object describe the same phenomenon.
            narrativeSubject = lead.key; score = Math.min(score, 60);
          }
        }
      }
      if (title) add(key, "comparison", title, observation, score, [...s.a, ...s.b], { ...comparisonFacts(s.a, s.b), ...componentFacts, ...binFacts,
        small_threshold: fact("小额区间上界（不含）", 20, "元"),
        current_small_share: fact("本期二十元以下占比", smallA * 100, "%"), previous_small_share: fact("基期二十元以下占比", smallB * 100, "%"),
        top3_current_n: fact("本期最大记录取样笔数", Math.min(3, a.n), "笔"), top3_previous_n: fact("基期最大记录取样笔数", Math.min(3, b.n), "笔"),
        top3_current_amount: fact("本期最大三笔合计", total(top(s.a)) / 100, "元"), top3_previous_amount: fact("基期最大三笔合计", total(top(s.b)) / 100, "元"),
        top3_difference: fact("两期各自最大三笔合计差", topDelta / 100, "元"), ...(big ? { top3_contribution: fact("最大三笔差额占增量", topDelta / delta * 100, "%") } : {}) }, limits, undefined, narrativeSubject);
      if (s.object && s.a.length > 0 && s.b.length > 0 && Math.max(s.a.length, s.b.length) >= 5) {
        const ca = new Set(s.a.map(r => r.category)), cb = new Set(s.b.map(r => r.category));
        if ([...ca].some(c => !cb.has(c)) || [...cb].some(c => !ca.has(c))) add(key, "classification", `${s.label}的分类归属发生变化`, "同一备注对象在两期出现的原分类不同，分类报表中的变化可能部分来自归类方式。实际购买变化需要跨分类合并后再判断。", 85, [...s.a, ...s.b], comparisonFacts(s.a, s.b), [...boundaries, `本期原分类：${[...ca].join("、")}；基期原分类：${[...cb].join("、")}`]);
      }
    }
    const aCats = group(current, r => r.category), bCats = group(previous, r => r.category);
    const cats = [...new Set([...aCats.keys(), ...bCats.keys()])];
    const changes = cats.map(c => ({ c, a: total(aCats.get(c) ?? []), b: total(bCats.get(c) ?? []) })).sort((a, b) => Math.abs(b.a - b.b) - Math.abs(a.a - a.b));
    const rising = changes.find(c => c.a - c.b >= 10000), falling = changes.find(c => c.b - c.a >= 10000);
    if (rising && falling && Math.abs(total(current) - total(previous)) <= Math.max(total(previous) * .1, 10000)) add("structure", "structure", "总额相近，内部支出重心却在变化", `${rising.c}增加与${falling.c}减少在金额上相互抵消。总额稳定掩盖了分类构成变化，不能据此证明两种消费存在资金转移关系。`, 80, [...current, ...previous],
      { increase: fact(`${rising.c}增加金额`, (rising.a - rising.b) / 100, "元"), decrease: fact(`${falling.c}减少金额`, (falling.b - falling.a) / 100, "元"), ...comparisonFacts(current, previous) }, ["金额抵消不等于消费替代或因果关系。"]);
    const union = new Set([...aCats.keys(), ...bCats.keys()]), intersection = [...aCats.keys()].filter(c => bCats.has(c)).length;
    const entropy = (groups: Map<string, LedgerRecord[]>, n: number) => union.size <= 1 || !n ? 0 : -[...groups.values()].reduce((s, r) => { const p = r.length / n; return s + p * Math.log(p); }, 0) / Math.log(union.size);
    const hA = entropy(aCats, current.length), hB = entropy(bCats, previous.length);
    const shares = cats.map(c => ({ c, a: current.length ? (aCats.get(c)?.length ?? 0) / current.length : 0, b: previous.length ? (bCats.get(c)?.length ?? 0) / previous.length : 0 })).sort((a, b) => Math.abs(b.a - b.b) - Math.abs(a.a - a.b));
    if (current.length >= 10 && previous.length >= 10 && shares[0] && (Math.abs(shares[0].a - shares[0].b) >= .1 || Math.abs(hA - hB) >= .1)) add("structure", "mix", "购买构成发生变化，需同时看笔数和金额", `${shares[0].c}的笔数占比或整体类别分散程度变化明显。占比变化既可能来自该类增加，也可能来自其他类减少；证据同时列出两期总量。`, 55, [...current, ...previous],
      { ...comparisonFacts(current, previous), current_share: fact(`${shares[0].c}本期笔数占比`, shares[0].a * 100, "%"), previous_share: fact(`${shares[0].c}基期笔数占比`, shares[0].b * 100, "%"), category_overlap: fact("类别集合重合度", union.size ? intersection / union.size * 100 : 0, "%"), current_diversity: fact("本期类别分散程度", hA * 100, "%"), previous_diversity: fact("基期类别分散程度", hB * 100, "%") }, ["分类调整会影响类别结构；归一化熵使用两期相同类别集合。"]);
  }

  // Only uninterrupted, verified calendar weeks feed temporal analyses; never fill gaps with zero.
  const weekRanges: DateRange[] = [];
  const start = addDays(allRange.start, (7 - weekday(allRange.start)) % 7);
  for (let d = start; addDays(d, 6) <= periods.range.end; d = addDays(d, 7)) weekRanges.push({ start: d, end: addDays(d, 6) });
  const consecutive: DateRange[] = [];
  const verifiedPeriods = [coverage[0], ...coverage.slice(2)].filter(c => c.complete).map(c => c.range);
  if (!undatedPaths.length) for (const w of weekRanges) {
    const verified = dateList(w).every(d => verifiedPeriods.some(r => d >= r.start && d <= r.end));
    if (verified && reportCoverage(files, w).complete) consecutive.push(w); else consecutive.length = 0;
  }
  // The last verified run must reach the last completed week, not an old run before a gap.
  const weeks = consecutive.slice(-24);
  const temporalRange = weeks.length ? { start: weeks[0].start, end: weeks[weeks.length - 1].end } : periods.range;
  const temporal = selected(temporalRange);
  const temporalRanges = [{ label: "连续完整周", range: temporalRange }];
  for (const [key, g] of objectsAll) {
    const records = unique(g.records.filter(r => r.date >= temporalRange.start && r.date <= temporalRange.end));
    const last4 = weeks.slice(-4), counts = weeks.map(w => records.filter(r => r.date >= w.start && r.date <= w.end).length);
    const lastRecords = last4.length ? records.filter(r => r.date >= last4[0].start) : [];
    const ordinaryMeal = ["object:早餐", "object:午餐", "object:晚餐"].includes(key);
    const changedSubject = snapshot.findings.some(f => f.subject === key);
    if (last4.length === 4 && counts.slice(-4).filter(n => n > 0).length >= 3 && lastRecords.length >= 8 && objectsNow.has(key) && (!ordinaryMeal || changedSubject)) {
      const days = [...new Set(lastRecords.map(r => r.date))].sort(), intervals = days.slice(1).map((d, i) => reportDays({ start: days[i], end: d }) - 1);
      const lastCounts = counts.slice(-4), concentration = Math.max(...lastCounts) / lastRecords.length;
      add(key, "repeat", `${g.label}已经连续多周出现`, "最近四个完整周至少三个周有这组记录。它已反复出现在不同周，而非只发生于某一次集中购买；是否长期保持仍需继续观察。", 25 + Math.min(10, lastRecords.length), lastRecords,
        { count: fact("最近四周笔数", lastRecords.length, "笔"), days: fact("出现天数", days.length, "天"), interval: fact("相邻消费日间隔中位数", reportMedian(intervals), "天"), concentration: fact("最多一周笔数占比", concentration * 100, "%") }, boundaries, [{ label: "最近四个完整周", range: { start: last4[0].start, end: last4[3].end } }]);
    }
    if (weeks.length < 8 || records.length < 10 || !objectsNow.has(key)) continue;
    const slope = theilSen(counts), early = reportMedian(counts.slice(0, 4)), late = reportMedian(counts.slice(-4));
    if (Math.abs(late - early) >= 5 && (!early || Math.abs(late / early - 1) >= .3) && Math.abs(slope) >= .3) add(key, "trend", `${g.label}的周频次呈持续${slope > 0 ? "上升" : "下降"}`, "连续完整周的笔数变化具有一致方向，前后四周中位数也有明显差异。可以确认记录频率的持续变化，不能据此确定生活原因。", 80, records,
      { early: fact("前四周周笔数中位数", early, "笔"), late: fact("后四周周笔数中位数", late, "笔"), slope: fact("稳健趋势每周笔数变化", slope, "笔") }, boundaries, temporalRanges);
    let split: { index: number; before: number; after: number; difference: number } | null = null;
    for (let i = 4; i <= counts.length - 4; i++) {
      const before = reportMedian(counts.slice(0, i)), after = reportMedian(counts.slice(i)), difference = Math.abs(after - before);
      if (difference >= 5 && (!before || difference / before >= .3) && (!split || difference > split.difference)) split = { index: i, before, after, difference };
    }
    if (split) add(key, "level", `${g.label}的频率在某一周前后改变`, `以${weeks[split.index].start}开始的周附近为分界，前后周笔数中位数明显不同。这是候选水平变化位置，不能精确到某一天或断言原因。`, 75, records,
      { before: fact("分界前周笔数中位数", split.before, "笔"), after: fact("分界后周笔数中位数", split.after, "笔") }, [...boundaries, "分界来自探索性扫描，不代表统计显著性。"], temporalRanges);
  }
  if (weeks.length >= 8 && temporal.length >= 10) {
    const vectors = weeks.map(w => Array.from({ length: 7 }, (_, day) => total(temporal.filter(r => r.date === addDays(w.start, day)))));
    const similarities = vectors.slice(1).map((v, i) => cosine(vectors[i], v));
    const wknd = temporal.filter(r => weekday(r.date) >= 5), work = temporal.filter(r => weekday(r.date) < 5);
    const ratio = work.length && total(work) ? (total(wknd) / (weeks.length * 2)) / (total(work) / (weeks.length * 5)) : 0;
    const repeated = vectors.filter(v => (v[5] + v[6]) / 2 >= v.slice(0, 5).reduce((s, n) => s + n, 0) / 5 * 1.5 && v[5] + v[6] > 0).length;
    const weekdayFacts: Record<string, ReportFact> = {};
    for (let day = 0; day < 7; day++) {
      const rs = temporal.filter(r => weekday(r.date) === day), label = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][day];
      weekdayFacts[`weekday_amount_${day}`] = fact(`${label}日均金额`, total(rs) / weeks.length / 100, "元");
      weekdayFacts[`weekday_count_${day}`] = fact(`${label}日均笔数`, rs.length / weeks.length, "笔");
    }
    if (ratio >= 1.5 && repeated >= Math.ceil(weeks.length * .6)) add("rhythm", "rhythm", "周末支出高峰在多个星期重复出现", "按每一天标准化后，周末支出仍明显高于周一至周五，并在多数完整周重复。它更接近稳定节奏，不能将单个周末直接称为异常。", 70, temporal,
      { ...weekdayFacts, ratio: fact("周末与周一至周五日均金额之比", ratio, "倍"), repeat_share: fact("重复出现周末高峰的周占比", repeated / weeks.length * 100, "%"), persistence: fact("相邻周分布平均相似度", similarities.reduce((s, n) => s + n, 0) / similarities.length * 100, "%") }, ["相似度衡量分布形状，不代表预算合理或生活原因。"], temporalRanges);
    const objects = objectGroups(temporal), frequent = [...objects.entries()].filter(([key, g]) => key.startsWith("object:") && new Set(g.records.map(r => r.date)).size >= 10).sort((a, b) => b[1].records.length - a[1].records.length).slice(0, 12);
    const dates = dateList(temporalRange);
    for (let i = 0; i < frequent.length; i++) for (let j = 0; j < frequent.length; j++) {
      if (i === j) continue;
      const [aKey, a] = frequent[i], [bKey, b] = frequent[j], aDays = new Set(a.records.map(r => r.date)), bDays = new Set(b.records.map(r => r.date));
      if ([aKey, bKey].every(k => ["object:早餐", "object:午餐", "object:晚餐"].includes(k))) continue;
      const together = [...aDays].filter(d => bDays.has(d));
      if (together.length < 5) continue;
      let matched = 0, weight = 0;
      for (let day = 0; day < 7; day++) {
        const exposed = [...aDays].filter(d => weekday(d) === day).length;
        const controls = dates.filter(d => weekday(d) === day && !aDays.has(d));
        if (exposed && !controls.length) { weight = -1; break; }
        if (exposed) { matched += exposed * controls.filter(d => bDays.has(d)).length / controls.length; weight += exposed; }
      }
      if (weight <= 0 || matched <= 0) continue;
      const lift = together.length / matched;
      if (lift >= 2) add([aKey, bKey].sort().join("+"), "association", `${a.label}与${b.label}经常在同一天出现`, "在出现前一对象的日子，后一对象更常出现；按星期匹配后仍有差异。这只是同日关联线索，不能证明先后顺序、触发关系或原因。", 45 + Math.min(20, together.length), [...a.records, ...b.records],
        { together: fact("共同出现天数", together.length, "天"), lift: fact("匹配对照后的发生比例倍数", lift, "倍") }, ["多对象探索可能产生偶然关联，仍需后续周期观察。"], temporalRanges);
    }
  }
  // Group correlated signals into one narrative subject and one combined evidence item.
  const merged = new Map<string, ReportFinding>();
  for (const f of snapshot.findings.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))) {
    const existing = merged.get(f.subject);
    if (!existing) merged.set(f.subject, { ...f, evidenceIds: [...f.evidenceIds], limits: [...f.limits] });
    else { existing.evidenceIds.push(...f.evidenceIds); existing.observation += ` ${f.observation}`; existing.limits = [...new Set([...existing.limits, ...f.limits])]; }
  }
  snapshot.findings = [...merged.values()].slice(0, 5);
  const used = new Set(snapshot.findings.flatMap(f => f.evidenceIds));
  snapshot.evidence = snapshot.evidence.filter(e => used.has(e.id));
  const relevantFiles = files.filter(f => !f.date || (f.date >= allRange.start && f.date <= allRange.end));
  snapshot.fingerprint = reportHash(JSON.stringify({ rule: REPORT_RULE_VERSION, preferences, excludedCategories, periods,
    stars: preferences.includeStarred ? [] : [...starredIds].sort(), files: relevantFiles.map(f => [f.path, f.date, f.frontmatterTotalCents, f.diagnostics, f.records.map(r => [r.id, r.date, r.time, r.category, r.cents, r.note])]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))) }));
  return snapshot;
}

export function localSpendingReport(snapshot: ReportSnapshot): SpendingReport {
  return { title: snapshot.label, summary: snapshot.findings.length ? "本期值得关注的是以下消费变化和重复模式。具体比较与相关账目可从每段证据查看。" :
    snapshot.comparable ? "本期未发现证据充分的明显变化。现有记录未达到报告的筛选门槛。" : "可比数据不足，暂不判断本期整体变化。请先核对缺失日期和异常账本；完整周中的可靠发现仍可查看。",
    paragraphs: snapshot.findings.map(f => ({ heading: f.title, text: f.observation, findingIds: [f.id], evidenceIds: f.evidenceIds })) };
}
