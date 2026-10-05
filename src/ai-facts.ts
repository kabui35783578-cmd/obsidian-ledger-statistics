import type { FinanceAdvisorSnapshot } from "./core";

export interface NumericFact { value: number; unit: "元" | "%" | "笔" | "天" }

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
  const weekly = snapshot.weekly;
  if (weekly) {
    money("week.spent", weekly.spentCents);
    money("week.previous_spent", weekly.previousSpentCents);
    facts["week.count"] = { value: weekly.count, unit: "笔" };
    facts["week.recorded_days"] = { value: weekly.coverage.recordedDays, unit: "天" };
    if (weekly.changeCents !== null) money("week.change", weekly.changeCents);
    if (weekly.changeRatio !== null) facts["week.change_percent"] = { value: Number((weekly.changeRatio * 100).toFixed(1)), unit: "%" };
    if (weekly.historicalAverageCents !== null) money("week.historical_average", weekly.historicalAverageCents);
    if (weekly.historicalChangeCents !== null) money("week.historical_change", weekly.historicalChangeCents);
    if (weekly.historicalChangeRatio !== null) facts["week.historical_change_percent"] = { value: Number((weekly.historicalChangeRatio * 100).toFixed(1)), unit: "%" };
    if (weekly.budgetCents > 0) {
      money("week.budget", weekly.budgetCents);
      money("week.budget_spent", weekly.budgetSpentCents);
      money("week.budget_over", weekly.overCents);
      facts["week.budget_used_percent"] = { value: Number((weekly.budgetRatio! * 100).toFixed(1)), unit: "%" };
    }
    weekly.categories.forEach((item, index) => { money(`week.category.${index}.spent`, item.cents); facts[`week.category.${index}.share`] = { value: Number((item.share * 100).toFixed(1)), unit: "%" }; });
  }
  const daily = snapshot.daily;
  if (daily) {
    money("daily.spent", daily.spentCents);
    facts["daily.count"] = { value: daily.count, unit: "笔" };
    if (daily.budgetCents > 0) {
      money("daily.budget", daily.budgetCents);
      money("daily.budget_spent", daily.budgetSpentCents);
      money("daily.budget_remaining", daily.remainingCents);
      money("daily.budget_over", daily.overCents);
    }
    daily.categories.forEach((item, index) => {
      money(`daily.category.${index}.spent`, item.cents);
      facts[`daily.category.${index}.share`] = { value: Number((item.share * 100).toFixed(1)), unit: "%" };
      facts[`daily.category.${index}.count`] = { value: item.count, unit: "笔" };
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
