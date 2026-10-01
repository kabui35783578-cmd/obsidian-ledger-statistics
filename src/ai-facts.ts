import type { FinanceAdvisorSnapshot } from "./core";

export interface NumericFact { value: number; unit: "元" | "%" | "笔" }

export function financeNumericFacts(snapshot: FinanceAdvisorSnapshot): Record<string, NumericFact> {
  const facts: Record<string, NumericFact> = {};
  const money = (id: string, cents: number) => { facts[id] = { value: cents / 100, unit: "元" }; };
  if (snapshot.salaryCents > 0) {
    money("cycle.salary", snapshot.salaryCents);
    money("cycle.remaining", snapshot.remainingSalaryCents);
  }
  money("cycle.spent", snapshot.currentSpentCents);
  if (snapshot.historyCycleCount) money("cycle.historical_average", snapshot.historicalAverageSpentCents);
  if (snapshot.forecastAvailable) money("cycle.forecast", snapshot.forecastCents);
  const daily = snapshot.daily;
  if (daily) {
    money("today.spent", daily.spentCents);
    facts["today.count"] = { value: daily.count, unit: "笔" };
    if (daily.budgetCents > 0) {
      money("today.budget", daily.budgetCents);
      money("today.budget_spent", daily.budgetSpentCents);
      money("today.budget_remaining", daily.remainingCents);
      money("today.budget_over", daily.overCents);
    }
    daily.categories.forEach((item, index) => {
      money(`today.category.${index}.spent`, item.cents);
      facts[`today.category.${index}.share`] = { value: Number((item.share * 100).toFixed(1)), unit: "%" };
      facts[`today.category.${index}.count`] = { value: item.count, unit: "笔" };
    });
  }
  snapshot.categories.forEach((item, index) => {
    money(`cycle.category.${index}.spent`, item.currentCents);
    money(`cycle.category.${index}.reference`, item.remainingReferenceCents);
    money(`cycle.category.${index}.historical_average`, item.baselineCycleCents);
    money(`cycle.category.${index}.historical_progress`, item.baselineProgressCents);
    money(`cycle.category.${index}.change`, item.currentCents - item.baselineProgressCents);
    facts[`cycle.category.${index}.count`] = { value: item.currentCount, unit: "笔" };
    facts[`cycle.category.${index}.share`] = { value: Number((item.currentShare * 100).toFixed(1)), unit: "%" };
    facts[`cycle.category.${index}.baseline_share`] = { value: Number((item.baselineShare * 100).toFixed(1)), unit: "%" };
  });
  snapshot.events.forEach((event, index) => {
    if (event.impactCents !== undefined) money(`event.${index}.impact`, event.impactCents);
  });
  return facts;
}

/** Check critical quoted quantities, rather than prohibiting all digits in prose. */
export function validateNumericNarrative(text: string, snapshot: FinanceAdvisorSnapshot, suggestion = false): void {
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  text = text.replace(/[０-９]/g, char => String(char.charCodeAt(0) - 0xff10));
  text = text.replace(/[零〇一二两三四五六七八九十百千万亿]+(?=元|块|笔)/g, raw => {
    let total = 0, section = 0, digit = 0;
    for (const char of raw) {
      if (char in digits) { digit = digits[char]; continue; }
      const unit = ({ 十: 10, 百: 100, 千: 1000, 万: 10000, 亿: 100000000 } as Record<string, number>)[char];
      if (unit >= 10000) { total += (section + digit) * unit; section = 0; }
      else section += (digit || 1) * unit;
      digit = 0;
    }
    return String(total + section + digit);
  });
  const facts = Object.values(financeNumericFacts(snapshot));
  const number = "([+-]?[0-9]+(?:,[0-9]{3})*(?:\\.[0-9]+)?)";
  const pattern = new RegExp(`(?:[¥￥]\\s*${number})|(?:${number}\\s*(元|块|%|％|笔))`, "g");
  for (const clause of text.split(/[。；;\n]/)) {
    // Explicit hypothetical targets are not claims about already recorded spending.
    if (suggestion && /^(?:建议目标|可考虑|可以|例如|不妨|目标)/.test(clause.trim())
      && /目标|设在|控制在|预留|上限|以内|减少到/.test(clause)
      && !/已花|已记录|已支出|已经|实际(?:已|花|消费|支出|发生)|超出|还剩/.test(clause)) continue;
    for (const match of clause.matchAll(pattern)) {
      const value = Number((match[1] ?? match[2]).replace(/,/g, ""));
      const unit = match[1] || match[3] === "块" ? "元" : match[3] === "％" ? "%" : match[3];
      const approximate = /(?:约|大约|大概|接近)\s*$/.test(clause.slice(0, match.index));
      if (!facts.some(fact => fact.unit === unit && (Math.abs(fact.value - value) < 0.005
        || (unit === "%" && Math.abs(Math.round(fact.value) - value) < 0.005)
        || (unit === "元" && approximate && Number.isInteger(value) && Math.round(fact.value) === value)))) {
        throw new Error("AI 引用了程序未提供的金额、比例或笔数，请重新分析");
      }
    }
  }
}
