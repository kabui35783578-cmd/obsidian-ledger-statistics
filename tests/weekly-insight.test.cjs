const test = require('node:test');
const assert = require('node:assert/strict');
global.window = global;
const core = require('../dist/core.cjs');
const { LedgerStatisticsView } = require('../dist/view.cjs');
const ai = require('../dist/ai.cjs');
const { createFinanceAdviceCache, assessFinanceAdvice } = require('../dist/advice-lifecycle.cjs');
const { markInsightSeen, withInsightHistory } = require('../dist/insights.cjs');
const now = new Date(2026, 9, 5, 8);
function file(date, amount, category = '餐饮', note = '午饭') {
  return core.parseLedgerFile(`private/${category}/${date}.md`, `---\ndate: ${date}\ntotal: ${amount}\n---\n# 今日消费记录\n${amount ? `- 12:00｜${category}｜￥${amount.toFixed(2)}（${note}）` : ''}`);
}
function files() { return Array.from({ length: 35 }, (_, i) => file(core.addDays('2026-10-04', -i), [10, 5, 20, 0, 15][Math.floor(i / 7)])); }
function snapshot(data = files(), settings = {}, date = now) {
  const v = Object.create(LedgerStatisticsView.prototype);
  v.plugin = { repository: { files: new Map(data.map((f, i) => [i, f])) }, settings: { dailyBudgetCents: 5000, budgetCategory: '', includeStarredInBudget: true, starredRecordIds: [], salaryCents: 600000, excludedCategories: [], fixedExpenses: [], insightHistory: [], ...settings } };
  return v.currentFinanceSnapshot(date);
}
test('rolling seven days cross the month and compare equal preceding windows with four complete historical weeks', () => {
  const s = snapshot(), w = s.weekly;
  assert.deepEqual(w.range, { start: '2026-09-28', end: '2026-10-04' });
  assert.deepEqual(w.previousRange, { start: '2026-09-21', end: '2026-09-27' });
  assert.equal(w.spentCents, 7000);
  assert.equal(w.count, 7);
  assert.equal(w.previousSpentCents, 3500);
  assert.equal(w.changeCents, 3500);
  assert.equal(w.changeRatio, 1);
  assert.equal(w.historicalWeeks, 4);
  assert.equal(w.historicalAverageCents, 7000);
  assert.equal(w.historicalChangeCents, 0);
  assert.equal(w.budgetCents, 35000);
  assert.equal(w.budgetRatio, .2);
  assert.equal(w.coverage.recordedDays, 7);
  assert.equal(s.events[0].type, 'weekly');
  assert.equal(s.events.some(e => e.type === 'daily'), false);
});
test('missing yesterday keeps the week visible but never claims missing consumption was zero', () => {
  const s = snapshot(files().filter(f => f.date !== '2026-10-04'));
  assert.equal(s.daily.status, 'unrecorded');
  assert.equal(s.weekly.spentCents, 6000);
  assert.equal(s.weekly.coverage.recordedDays, 6);
  assert.deepEqual(s.weekly.coverage.missingDates, ['2026-10-04']);
  assert.equal(s.weekly.changeCents, null);
  assert.equal(s.weekly.historicalChangeCents, null);
  assert.match(s.events[0].title, /6\/7/);
  assert.doesNotMatch(s.events[0].title, /预算内/);
  assert.equal(s.weekly.changes.some(c => c.kind === 'high-day' || c.kind === 'category'), false);
});
test('bad totals, duplicate bad files and undated records degrade coverage and historical comparison', () => {
  const data = files(), bad = file('2026-10-04', 30);
  bad.diagnostics.push({ kind: 'total', path: bad.path, reason: 'mismatch' });
  const s = snapshot([...data, bad]);
  assert.deepEqual(s.weekly.coverage.problemDates, ['2026-10-04']);
  assert.equal(s.weekly.coverage.recordedDays, 6);
  const undated = core.parseLedgerFile('private/unknown.md', '# 今日消费记录\n- 12:00｜餐饮｜￥42.00');
  const unknown = snapshot([...data, undated]);
  assert.equal(unknown.weekly.undatedCount, 1);
  assert.equal(unknown.weekly.coverage.complete, false);
  assert.equal(unknown.weekly.historicalWeeks, 0);
  const previousMissing = snapshot(data.filter(f => f.date !== '2026-09-22'));
  assert.equal(previousMissing.weekly.changeCents, null);
  assert.equal(previousMissing.weekly.historicalWeeks, 3);
});
test('explicit zero days count as recorded, with no division by zero or invented growth percentage', () => {
  const data = files().map(f => f.date >= '2026-09-21' && f.date <= '2026-09-27' ? file(f.date, 0) : f);
  const w = snapshot(data).weekly;
  assert.equal(w.previousCoverage.recordedDays, 7);
  assert.equal(w.previousSpentCents, 0);
  assert.equal(w.changeCents, 7000);
  assert.equal(w.changeRatio, null);
  const zero = snapshot(data.map(f => f.date >= '2026-09-28' ? file(f.date, 0) : f)).weekly;
  assert.equal(zero.coverage.complete, true);
  assert.equal(zero.spentCents, 0);
  assert.equal(zero.count, 0);
  assert.deepEqual(zero.changes, []);
});
test('week budget follows category and star settings while headline spending remains whole ledger', () => {
  const data = [...files(), file('2026-10-04', 100, '购物')];
  const w = snapshot(data, { budgetCategory: '餐饮', includeStarredInBudget: false, starredRecordIds: [data[0].records[0].id] }).weekly;
  assert.equal(w.spentCents, 17000);
  assert.equal(w.budgetSpentCents, 6000);
  assert.equal(w.budgetCategory, '餐饮');
  assert.equal(w.includeStarred, false);
  assert.equal(w.budgetCents, 35000);
  assert.equal(snapshot(data, { dailyBudgetCents: 0 }).weekly.budgetRatio, null);
});
test('change points preserve category decreases, the largest source record and a high spending day', () => {
  const data = files().map(f => f.date >= '2026-09-28' ? file(f.date, f.date === '2026-10-01' ? 100 : 0, '购物', '超市采购') : f);
  const w = snapshot(data).weekly;
  assert.equal(w.changes.length, 3);
  assert.equal(w.changes[0].kind, 'category');
  assert.match(w.changes[0].text, /增加 ¥100.00/);
  assert.equal(w.changes[1].records[0].date, '2026-10-01');
  assert.equal(w.changes[1].records[0].cents, 10000);
  assert.match(w.changes[2].text, /100.0%/);
  assert.ok(w.changes.every(c => c.records.every(r => data.some(f => f.records.includes(r)))));
});
test('today does not invalidate cached weekly text, while backfills and a new cutoff do', () => {
  const data = files(), s = snapshot(data), advice = ai.parseFinanceAdvice('AI 周分析无需内容校验，金额 9999 元也不拦截。', s);
  const cache = createFinanceAdviceCache(s, advice);
  assert.equal(advice.primaryEventId, 'weekly:2026-09-28:2026-10-04');
  assert.equal(assessFinanceAdvice(snapshot([...data, file('2026-10-05', 999)]), cache).needsRefresh, false);
  assert.equal(assessFinanceAdvice(snapshot(data.slice(1)), cache).needsRefresh, true);
  assert.equal(assessFinanceAdvice(snapshot(data, {}, new Date(2026, 9, 6, 8)), cache).advice, null);
  assert.equal(assessFinanceAdvice(s, { ...cache, advice: { ...advice, primaryEventId: 'daily:2026-10-04' } }).advice, null);
  assert.deepEqual(markInsightSeen([], s, advice.primaryEventId), []);
  assert.equal(withInsightHistory(s, [{ cycle: s.currentRange.start, id: advice.primaryEventId }]).repeatedEvents.length, 0);
});
test('AI receives weekly calculations and coverage without local file paths or today data', () => {
  const s = snapshot([...files(), file('2026-10-05', 999, '今天专属分类')]);
  const input = ai.financeAiInput(s), data = JSON.parse(input);
  assert.equal(data.weekly_brief.range.end, '2026-10-04');
  assert.equal(data.weekly_brief.coverage.recordedDays, 7);
  assert.equal(data.numeric_facts['week.spent'].value, 70);
  assert.equal(data.numeric_facts['week.change_percent'].value, 100);
  assert.doesNotMatch(input, /private\/|今天专属分类/);
  assert.ok(data.weekly_brief.changes.every(c => !('records' in c)));
  assert.equal(s.weekly.spentCents, 7000);
});
