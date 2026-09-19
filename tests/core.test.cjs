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
  budgetProgress,
  budgetScopedRecords,
  barkPushUrl
} = require("../dist/core.cjs");

function note(date, body, total = "0.00") {
  return `---\ntitle: ${date.replaceAll("-", "")} 日记账\ndate: ${date}\ntotal: ${total}\n---\n\n# 今日消费记录\n\n${body}\n\n## 今日汇总\n\n总支出：￥${total}\n`;
}

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
