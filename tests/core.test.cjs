const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseLedgerFile,
  parseMoneyToCents,
  filteredRecords,
  categorySummaries,
  summarize,
  compareValue,
  trendPoints,
  salaryDayRange,
  salaryCycleFullRange,
  buildFinanceAdvisorSnapshot,
  weekRange,
  budgetProgress,
  budgetScopedRecords,
  barkPushUrl
} = require("../dist/core.cjs");

function note(date, body, total = "0.00") {
  return `---\ntitle: ${date.replaceAll("-", "")} 日记账\ndate: ${date}\ntotal: ${total}\n---\n\n# 今日消费记录\n\n${body}\n\n## 今日汇总\n\n总支出：￥${total}\n`;
}

function coverage(start, end) {
  const days = [];
  for (let day = start; day <= end; day = require("../dist/core.cjs").addDays(day, 1)) days.push(day);
  return days;
}

test("stars survive inserted lines and unrelated transactions, and migrate legacy IDs", () => {
  const { migrateStarredIds, renameStarredIds } = require("../dist/core.cjs");
  const body = "- 12:00｜餐饮｜￥10.00（午餐）";
  const original = parseLedgerFile("记账/day.md", note("2026-09-21", body, "10.00")).records[0];
  const edited = parseLedgerFile("记账/day.md", note("2026-09-21", "\n- 09:00｜购物｜￥20.00\n" + body, "30.00")).records;
  assert.equal(edited[1].id, original.id);
  assert.deepEqual(migrateStarredIds([`记账/day.md:${original.line}`], [original]), [original.id]);
  assert.deepEqual(migrateStarredIds([original.id], edited), [original.id]);
  assert.deepEqual(budgetScopedRecords(edited, false, [original.id]).map(r => r.cents), [2000]);
  const renamed = parseLedgerFile("新记账/day.md", note("2026-09-21", body, "10.00")).records[0];
  assert.deepEqual(renameStarredIds([original.id], "记账", "新记账"), [renamed.id]);
  const changed = parseLedgerFile("记账/day.md", note("2026-09-21", body.replace("10.00", "11.00"), "11.00")).records[0];
  assert.notEqual(changed.id, original.id);
});

test("identical duplicates have separate stars and changing their count cannot transfer a star", () => {
  const body = "- 12:00｜餐饮｜￥10.00";
  const two = parseLedgerFile("day.md", note("2026-09-21", body + "\n" + body, "20.00")).records;
  assert.notEqual(two[0].id, two[1].id);
  assert.equal(budgetScopedRecords(two, false, [two[0].id]).length, 1);
  const one = parseLedgerFile("day.md", note("2026-09-21", body, "10.00")).records;
  assert.equal(budgetScopedRecords(one, false, [two[0].id]).length, 1);
});

test("missing history is not a zero cycle and suppresses comparative anomalies", () => {
  const records = parseLedgerFile("20260915.md", note("2026-09-15", "- 12:00｜住房｜￥2000.00", "2000.00")).records;
  const result = buildFinanceAdvisorSnapshot(records, new Date(2026, 8, 15, 12), 500000, []);
  assert.equal(result.historyCycleCount, 0);
  assert.equal(result.forecastAvailable, false);
  assert.deepEqual(result.events.map(e => e.id), ["stable"]);
  assert.equal(result.events[0].title, "参考数据不足");
});

test("one complete cycle is averaged alone including explicit zero days", () => {
  const records = parseLedgerFile("20260815.md", note("2026-08-15", "- 12:00｜餐饮｜￥100.00", "100.00")).records;
  const dates = coverage("2026-08-15", "2026-09-15");
  const result = buildFinanceAdvisorSnapshot(records, new Date(2026, 8, 15, 12), 500000, [], dates);
  assert.equal(result.historyCycleCount, 1);
  assert.equal(result.historicalAverageSpentCents, 10000);
  assert.equal(result.forecastConfidence, "low");
  const missing = buildFinanceAdvisorSnapshot(records, new Date(2026, 8, 15, 12), 500000, [], dates.filter(d => d !== "2026-08-20"));
  assert.equal(missing.historyCycleCount, 0);
});

test("forecast adds historical remaining spending without multiplying payday rent", () => {
  const records = ["2026-07-15", "2026-08-15", "2026-09-15"].flatMap(date =>
    parseLedgerFile(`${date}.md`, note(date, "- 12:00｜住房｜￥2000.00", "2000.00")).records);
  for (const date of ["2026-08-01", "2026-09-01"]) records.push(...parseLedgerFile(`${date}.md`, note(date, "- 12:00｜餐饮｜￥600.00", "600.00")).records);
  const dates = coverage("2026-07-15", "2026-10-14");
  const result = buildFinanceAdvisorSnapshot(records, new Date(2026, 8, 15, 12), 500000, [], dates);
  assert.equal(result.forecastCents, 260000);
  assert.equal(result.forecastAvailable, true);
  assert.equal(result.forecastConfidence, "low");
  const end = buildFinanceAdvisorSnapshot(records, new Date(2026, 9, 14, 12), 500000, [], dates);
  assert.equal(end.forecastCents, end.currentSpentCents);
  const gap = buildFinanceAdvisorSnapshot(records, new Date(2026, 8, 21, 12), 500000, [], dates.filter(d => d !== "2026-09-19"));
  assert.equal(gap.forecastAvailable, false);
  assert.deepEqual(gap.events.map(e => e.id), ["stable"]);
});

test("blank and invalid ledger days do not prove zero spending", () => {
  const { financeCompleteDates } = require("../dist/core.cjs");
  const zero = parseLedgerFile("20260915.md", note("2026-09-15", "", "0.00"));
  const blank = { ...zero, frontmatterTotalCents: null };
  assert.deepEqual(financeCompleteDates([zero]), ["2026-09-15"]);
  assert.deepEqual(financeCompleteDates([blank]), []);
  assert.deepEqual(financeCompleteDates([zero, { ...zero, diagnostics: [{ kind: "parse", path: "bad", reason: "bad" }] }]), []);
});

test("AI fingerprint invalidates cached results after spending, salary or coverage changes", () => {
  const { financeSnapshotFingerprint, financeAiInput } = require("../dist/ai.cjs");
  const snapshot = buildFinanceAdvisorSnapshot([], new Date(2026, 8, 15, 12), 500000, [], []);
  const fingerprint = financeSnapshotFingerprint(snapshot);
  assert.equal(fingerprint, financeSnapshotFingerprint(structuredClone(snapshot)));
  for (const change of [{ currentSpentCents: 100 }, { salaryCents: 600000 }, { historyCycleCount: 1 }, { forecastAvailable: true }]) {
    assert.notEqual(fingerprint, financeSnapshotFingerprint({ ...snapshot, ...change }));
  }
  const input = JSON.parse(financeAiInput(snapshot));
  assert.equal(input.salary_summary.forecast, null);
  assert.equal(input.salary_summary.historical_average, null);
});

test("parses ordinary, backfilled, thousands, one-decimal, spaces and full-width records into integer cents", () => {
  const raw = note("2026-09-12", [
    "- 11:50｜餐饮｜￥14.70（午饭）",
    "- 补记 ｜ 购物 ｜ ￥1,017.00 （干发帽）",
    "- 12：04｜餐饮｜￥29．6 螺蛳粉",
    "- １３：０５｜咖啡奶茶｜￥３．７５（咖啡）",
    "- "
  ].join("\n"), "1065.05");
  const parsed = parseLedgerFile("记账/20260912日记账.md", raw);
  assert.equal(parsed.records.length, 4);
  assert.deepEqual(parsed.records.map((record) => record.cents), [1470, 101700, 2960, 375]);
  assert.equal(parsed.records[1].time, "补记");
  assert.equal(parsed.records[1].note, "干发帽");
  assert.equal(parsed.records[2].note, "螺蛳粉");
  assert.equal(parsed.diagnostics.length, 0);
});

test("ignores blank bullets but reports malformed nonblank records with source and line", () => {
  const raw = note("2026-09-12", "- \n- 12:00｜餐饮｜金额未知", "0.00");
  const parsed = parseLedgerFile("记账/20260912日记账.md", raw);
  assert.equal(parsed.records.length, 0);
  const problem = parsed.diagnostics.find((item) => item.kind === "parse");
  assert.ok(problem);
  assert.equal(problem.line, 10);
  assert.match(problem.source, /金额未知/);
});

test("falls back to filename date, reports missing date, and still verifies total", () => {
  const raw = `---\ntitle: test\ntotal: 18.4\n---\n# 今日消费记录\n- 补记｜餐饮｜￥18.4\n## 今日汇总\n总支出：￥18.4`;
  const parsed = parseLedgerFile("记账/20260528日记账.md", raw);
  assert.equal(parsed.date, "2026-05-28");
  assert.equal(parsed.records[0].cents, 1840);
  assert.ok(parsed.diagnostics.some((item) => item.kind === "date" && item.reason.includes("缺少")));
  assert.equal(parsed.diagnostics.filter((item) => item.kind === "total").length, 0);
});

test("accepts Obsidian ISO datetime frontmatter as its written calendar date", () => {
  const may = note("2026-05-28", "- 12:32｜餐饮｜￥80.31", "80.31")
    .replace("date: 2026-05-28", "date: 2026-05-28T13:56:00");
  const june = note("2026-06-01", "- 12:09｜餐饮｜￥41.10", "41.10")
    .replace("date: 2026-06-01", "date: '2026-06-01T00:00:00'");
  const withOffset = note("2026-05-28", "- 12:32｜餐饮｜￥1.00", "1.00")
    .replace("date: 2026-05-28", "date: 2026-05-28T23:30:00-05:00");

  for (const [path, raw, expected] of [
    ["记账/20260528日记账.md", may, "2026-05-28"],
    ["记账/20260601日记账.md", june, "2026-06-01"],
    ["记账/20260528日记账.md", withOffset, "2026-05-28"]
  ]) {
    const parsed = parseLedgerFile(path, raw);
    assert.equal(parsed.date, expected);
    assert.equal(parsed.diagnostics.filter((item) => item.kind === "date").length, 0);
  }
});

test("rejects an invalid frontmatter time instead of accepting only its date prefix", () => {
  const raw = note("2026-05-28", "- 12:32｜餐饮｜￥1.00", "1.00")
    .replace("date: 2026-05-28", "date: 2026-05-28T25:61:00");
  const parsed = parseLedgerFile("记账/20260528日记账.md", raw);
  assert.equal(parsed.date, "2026-05-28");
  assert.ok(parsed.diagnostics.some((item) => item.kind === "date" && item.reason.includes("无效")));
});

test("reports frontmatter total mismatch without changing records", () => {
  const parsed = parseLedgerFile("记账/20260912日记账.md", note("2026-09-12", "- 12:00｜餐饮｜￥10.00", "12.00"));
  assert.equal(parsed.records[0].cents, 1000);
  assert.ok(parsed.diagnostics.some((item) => item.kind === "total" && item.reason.includes("相差 -¥2.00")));
});

test("filters cross-month dates, accounting scope, category and keyword consistently", () => {
  const may = parseLedgerFile("记账/20260531日记账.md", note("2026-05-31", "- 12:00｜餐饮｜￥10.00\n- 补记｜债务/还款｜￥50.00", "60.00"));
  const june = parseLedgerFile("记账/20260601日记账.md", note("2026-06-01", "- 12:00｜购物｜￥20.00（雨伞）", "20.00"));
  const baseFilter = { range: { start: "2026-05-31", end: "2026-06-01" }, scope: "consumption", excludedCategories: ["债务/还款"], categories: [], keyword: "" };
  const records = filteredRecords([may, june], baseFilter);
  assert.equal(records.length, 2);
  assert.equal(records.reduce((sum, record) => sum + record.cents, 0), 3000);
  assert.deepEqual(categorySummaries(records).map((item) => item.category), ["购物", "餐饮"]);
  assert.equal(filteredRecords([may, june], { ...baseFilter, keyword: "雨伞" }).length, 1);
  assert.equal(filteredRecords([may, june], { ...baseFilter, categories: ["餐饮"] }).length, 1);
  assert.equal(filteredRecords([may, june], { ...baseFilter, scope: "all" }).length, 3);
});

test("budget category filtering counts only the selected category", () => {
  const day = parseLedgerFile("记账/20260912日记账.md", note("2026-09-12", "- 12:00｜餐饮｜￥10.00\n- 18:00｜购物｜￥20.00", "30.00"));
  const records = filteredRecords([day], {
    range: { start: "2026-09-12", end: "2026-09-12" },
    scope: "all",
    excludedCategories: [],
    categories: ["餐饮"],
    keyword: ""
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].cents, 1000);
});

test("budget starred scope can include or exclude starred records", () => {
  const day = parseLedgerFile("记账/20260912日记账.md", note("2026-09-12", "- 12:00｜餐饮｜￥10.00\n- 18:00｜购物｜￥20.00", "30.00"));
  const starredIds = [day.records[0].id];
  assert.deepEqual(budgetScopedRecords(day.records, true, starredIds).map((record) => record.cents), [1000, 2000]);
  assert.deepEqual(budgetScopedRecords(day.records, false, starredIds).map((record) => record.cents), [2000]);
});

test("daily average uses dates with files, including zero days, and not missing calendar dates", () => {
  const first = parseLedgerFile("记账/20260901日记账.md", note("2026-09-01", "- 12:00｜餐饮｜￥10.00", "10.00"));
  const third = parseLedgerFile("记账/20260903日记账.md", note("2026-09-03", "", "0.00"));
  const records = [...first.records, ...third.records];
  const stats = summarize([first, third], records, { start: "2026-09-01", end: "2026-09-03" });
  assert.equal(stats.recordedDays, 2);
  assert.equal(stats.averagePerRecordedDayCents, 500);
});

test("zero comparison bases never produce infinity or misleading percentages", () => {
  assert.deepEqual(compareValue(1000, 0), { currentCents: 1000, previousCents: 0, differenceCents: 1000, ratio: "new" });
  assert.equal(compareValue(0, 0).ratio, "none");
  assert.equal(compareValue(0, 1000).ratio, -1);
});

test("budget progress reports remaining and caps the visual fill when overspent", () => {
  assert.deepEqual(budgetProgress(3850, 10000), {
    ratio: 0.385,
    percent: 38.5,
    remainingCents: 6150,
    overBudgetCents: 0
  });
  assert.deepEqual(budgetProgress(12500, 10000), {
    ratio: 1.25,
    percent: 100,
    remainingCents: 0,
    overBudgetCents: 2500
  });
  assert.deepEqual(budgetProgress(5000, 0), {
    ratio: 0,
    percent: 0,
    remainingCents: 0,
    overBudgetCents: 0
  });
});

test("Bark URL accepts a copied test URL and encodes generated title and body", () => {
  const url = barkPushUrl("https://api.day.app/test-key/old-title/old-body", "今日预算已超支", "超支 ¥10.00");
  assert.ok(url);
  assert.match(url, /^https:\/\/api\.day\.app\/test-key\//);
  assert.match(url, /%E4%BB%8A%E6%97%A5%E9%A2%84%E7%AE%97%E5%B7%B2%E8%B6%85%E6%94%AF/);
  assert.match(url, /%E8%B6%85%E6%94%AF/);
  assert.equal(barkPushUrl("http://api.day.app/test-key", "title", "body"), null);
  assert.equal(barkPushUrl("not-a-url", "title", "body"), null);
});

test("trend aggregation groups across month boundary", () => {
  const a = parseLedgerFile("记账/20260531日记账.md", note("2026-05-31", "- 12:00｜餐饮｜￥10.00", "10.00"));
  const b = parseLedgerFile("记账/20260601日记账.md", note("2026-06-01", "- 12:00｜餐饮｜￥20.00", "20.00"));
  const points = trendPoints([...a.records, ...b.records], "month");
  assert.deepEqual(points.map((point) => [point.key, point.cents]), [["2026-05", 1000], ["2026-06", 2000]]);
});

test("money parser rejects more than two decimal places", () => {
  assert.equal(parseMoneyToCents("1,017.0"), 101700);
  assert.equal(parseMoneyToCents("1.234"), null);
});

test("salary day range runs from the 15th through today within the current cycle", () => {
  assert.deepEqual(salaryDayRange(new Date(2026, 8, 15, 12)), { start: "2026-09-15", end: "2026-09-15" });
  assert.deepEqual(salaryDayRange(new Date(2026, 8, 30, 12)), { start: "2026-09-15", end: "2026-09-30" });
});

test("week range starts on Monday and current week stops at today", () => {
  assert.deepEqual(weekRange(new Date(2026, 8, 19, 12)), { start: "2026-09-14", end: "2026-09-19" });
  assert.deepEqual(weekRange(new Date(2026, 8, 14, 12)), { start: "2026-09-14", end: "2026-09-14" });
});

test("week range steps through complete historical weeks across month boundaries", () => {
  assert.deepEqual(weekRange(new Date(2026, 8, 19, 12), 1), { start: "2026-09-07", end: "2026-09-13" });
  assert.deepEqual(weekRange(new Date(2026, 8, 2, 12), 1), { start: "2026-08-24", end: "2026-08-30" });
});

test("salary day range uses the previous month's 15th before or on the 14th", () => {
  assert.deepEqual(salaryDayRange(new Date(2026, 8, 1, 12)), { start: "2026-08-15", end: "2026-09-01" });
  assert.deepEqual(salaryDayRange(new Date(2026, 8, 14, 12)), { start: "2026-08-15", end: "2026-09-14" });
  assert.deepEqual(salaryDayRange(new Date(2026, 0, 3, 12)), { start: "2025-12-15", end: "2026-01-03" });
});

test("salary day range can step back through complete previous cycles", () => {
  assert.deepEqual(salaryDayRange(new Date(2026, 8, 15, 12), 1), { start: "2026-08-15", end: "2026-09-14" });
  assert.deepEqual(salaryDayRange(new Date(2026, 8, 14, 12), 1), { start: "2026-07-15", end: "2026-08-14" });
  assert.deepEqual(salaryDayRange(new Date(2026, 0, 3, 12), 1), { start: "2025-11-15", end: "2025-12-14" });
});

test("full salary cycle always ends on the next 14th", () => {
  assert.deepEqual(salaryCycleFullRange(new Date(2026, 8, 21, 12)), { start: "2026-09-15", end: "2026-10-14" });
  assert.deepEqual(salaryCycleFullRange(new Date(2026, 8, 14, 12)), { start: "2026-08-15", end: "2026-09-14" });
  assert.deepEqual(salaryCycleFullRange(new Date(2026, 0, 3, 12), 2), { start: "2025-10-15", end: "2025-11-14" });
});

test("finance advisor subtracts all spending but analyzes consumption categories against two cycles", () => {
  const records = [
    parseLedgerFile("记账/20260915日记账.md", note("2026-09-15", "- 12:00｜餐饮｜￥80.00\n- 18:00｜债务/还款｜￥500.00", "580.00")),
    parseLedgerFile("记账/20260916日记账.md", note("2026-09-16", "- 12:00｜餐饮｜￥70.00", "70.00")),
    parseLedgerFile("记账/20260918日记账.md", note("2026-09-18", "- 12:00｜餐饮｜￥60.00", "60.00")),
    parseLedgerFile("记账/20260920日记账.md", note("2026-09-20", "- 12:00｜餐饮｜￥60.00", "60.00")),
    parseLedgerFile("记账/20260815日记账.md", note("2026-08-15", "- 12:00｜餐饮｜￥30.00\n- 18:00｜购物｜￥100.00", "130.00")),
    parseLedgerFile("记账/20260820日记账.md", note("2026-08-20", "- 12:00｜餐饮｜￥20.00", "20.00")),
    parseLedgerFile("记账/20260910日记账.md", note("2026-09-10", "- 12:00｜餐饮｜￥50.00", "50.00")),
    parseLedgerFile("记账/20260715日记账.md", note("2026-07-15", "- 12:00｜餐饮｜￥40.00\n- 18:00｜购物｜￥80.00", "120.00")),
    parseLedgerFile("记账/20260720日记账.md", note("2026-07-20", "- 12:00｜餐饮｜￥20.00", "20.00")),
    parseLedgerFile("记账/20260810日记账.md", note("2026-08-10", "- 12:00｜餐饮｜￥40.00", "40.00"))
  ].flatMap((file) => file.records);
  const result = buildFinanceAdvisorSnapshot(records, new Date(2026, 8, 21, 12), 100_000, ["债务/还款"], coverage("2026-07-15", "2026-09-21"));

  assert.equal(result.currentSpentCents, 77_000);
  assert.equal(result.remainingSalaryCents, 23_000);
  assert.equal(result.elapsedDays, 7);
  assert.equal(result.totalDays, 30);
  assert.equal(result.categories.some((item) => item.category === "债务/还款"), false);
  const dining = result.categories.find((item) => item.category === "餐饮");
  assert.ok(dining);
  assert.equal(dining.currentCents, 27_000);
  assert.equal(dining.baselineProgressCents, 5_500);
  assert.equal(dining.baselineCycleCents, 10_000);
  assert.ok(result.events.some((event) => event.id === "spending-spike:餐饮"));
  assert.ok(result.events.some((event) => event.id === "frequency-spike:餐饮"));
  assert.ok(result.events.some((event) => event.id === "stable"));
  assert.equal(result.events.some((event) => event.id.includes("记账/")), false);
});

test("current salary cycle can include all categories and stops at today", () => {
  const beforeCycle = parseLedgerFile("记账/20260914日记账.md", note("2026-09-14", "- 12:00｜餐饮｜￥10.00", "10.00"));
  const currentCycle = parseLedgerFile("记账/20260915日记账.md", note("2026-09-15", "- 12:00｜债务/还款｜￥50.00", "50.00"));
  const future = parseLedgerFile("记账/20260917日记账.md", note("2026-09-17", "- 12:00｜购物｜￥30.00", "30.00"));
  const range = salaryDayRange(new Date(2026, 8, 16, 12));
  const records = filteredRecords([beforeCycle, currentCycle, future], {
    range,
    scope: "all",
    excludedCategories: ["债务/还款"],
    categories: [],
    keyword: ""
  });
  assert.deepEqual(range, { start: "2026-09-15", end: "2026-09-16" });
  assert.equal(records.length, 1);
  assert.equal(records[0].cents, 5000);
});
