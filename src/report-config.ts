export const REPORT_THRESHOLDS = {
  minSubjectCount: 5, countDelta: 4, rateDelta: .2, amountDeltaCents: 10000, amountRate: .2,
  distributionMin: 10, shareDelta: .1, daysDelta: 4, topCount: 3, topContribution: .5,
  maxTrailingGap: 2, maxInteriorGapRatio: .05, maxInteriorGap: 1, degradedRate: .3,
  repeatWeeks: 4, repeatActiveWeeks: 3, repeatCount: 8, trendMinWeeks: 8,
  temporalMaxLagDays: 7, temporalMaxWeeks: 24, temporalMinCount: 10, trendSegmentWeeks: 4,
  trendAbsolute: 2, trendRelative: .5, rhythmRatio: 1.5, rhythmDayRatio: 1.8, rhythmPersistence: .6,
  associationMinWeeks: 8, associationMinDays: 10, associationTogether: 5,
  associationLift: 2, associationAlpha: .05, associationMaxObjects: 12,
  classificationMinMoved: 2, classificationShare: .2, dedupJaccard: .8,
  historyPeriods: 3, historyMadMultiplier: 3, historyScale: 1.4826,
  outlierHistoryCount: 10, outlierP90Multiplier: 3, outlierFloorCents: 20000,
  topFindings: 5, maxComparisonFamily: 3, minSmallCents: 1000, binRoundCents: 500
} as const;
export type ReportThresholds = { [K in keyof typeof REPORT_THRESHOLDS]: number };
export const DEFAULT_REPORT_OBJECT_RULES = `咖啡=咖啡|拿铁|美式
奶茶=奶茶
矿泉水=矿泉水
早餐=早餐|早饭
午餐=午餐|午饭
晚餐=晚餐|晚饭
零食=零食
水果=水果|西瓜(?!霜)|榴莲|香蕉|葡萄
生活用品=洗发水|洗衣液|牙膏|牙线|纸巾|面巾纸|洗脸巾|洗面巾|洗衣粉|香皂|沐浴露
外卖=外卖
打车=打车|出租车|网约车|滴滴
地铁公交=地铁|公交
饮料=饮料|汽水|可乐|雪碧|柠檬茶
烟酒=香烟|啤酒|白酒|红酒
话费=话费
停车=停车
@瑞幸=瑞幸
@蜜雪冰城=蜜雪冰城
@海底捞=海底捞`;
export interface ParsedObjectRules { objects: Array<[string, RegExp]>; brands: Array<[string, RegExp]>; errors: string[]; source: string }
export function parseObjectRules(text = DEFAULT_REPORT_OBJECT_RULES): ParsedObjectRules {
  const out: ParsedObjectRules = { objects: [], brands: [], errors: [], source: text };
  const labels = new Set<string>();
  text.split(/\r?\n/).forEach((line, i) => {
    const trimmed = line.trim(); if (!trimmed || trimmed.startsWith('#')) return;
    const equal = trimmed.indexOf('='), raw = trimmed.slice(0, equal).trim(), pattern = trimmed.slice(equal + 1).trim();
    const label = raw.startsWith('@') ? raw.slice(1).trim() : raw;
    if (equal < 1 || !label || !pattern || labels.has(raw)) { out.errors.push(`第${i + 1}行：需要不重复的“标签=正则”`); return; }
    try {
      // Patterns run on a short normalized note. Reject empty matches which label every record.
      const re = new RegExp(pattern, 'i'); if (re.test('')) throw new Error('不能匹配空备注');
      (raw.startsWith('@') ? out.brands : out.objects).push([label, re]); labels.add(raw);
    } catch { out.errors.push(`第${i + 1}行：正则无效或匹配空备注`); }
  });
  return out;
}
