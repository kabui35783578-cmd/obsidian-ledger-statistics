const test = require('node:test');
const assert = require('node:assert/strict');
global.window = global;
const core = require('../dist/core.cjs');
const { assessFixedExpenses } = require('../dist/fixed-expenses.cjs');
const { withInsightHistory, markInsightSeen, eventAdvice, unmatchedStarIds, relinkStar } = require('../dist/insights.cjs');
const { testFinanceConnection } = require('../dist/ai.cjs');
const { RequestGate } = require('../dist/request-gate.cjs');
const dates = [];
for (let d = '2026-07-15'; d <= '2026-09-22'; d = core.addDays(d, 1)) dates.push(d);
function record(date, amount, category = '住房') {
  return core.parseLedgerFile(`记账/${date}.md`, `---\ndate: ${date}\ntotal: ${amount}\n---\n# 今日消费记录\n- 12:00｜${category}｜￥${amount}.00\n`).records[0];
}
const past1 = record('2026-08-28', 1000), past2 = record('2026-07-28', 1000), now = record('2026-09-16', 1100);
const bill = { id: 'rent', name: '房租', amountCents: 110000, payments: { '2026-07-15': past2.id, '2026-08-15': past1.id, '2026-09-15': now.id } };
const snapshot = (bills = [], records = [past1, past2, now]) => core.buildFinanceAdvisorSnapshot(records, new Date(2026, 8, 22), 500000, [], dates, bills);

function file(date, amount = 0) {
  return core.parseLedgerFile(`记账/${date}.md`, `---\ndate: ${date}\ntotal: ${amount}\n---\n# 今日消费记录\n${amount ? `- 12:00｜餐饮｜￥${amount}.00` : ''}\n`);
}
function fromFiles(files) {
  const date = new Date(2026, 8, 22);
  return core.buildFinanceAdvisorSnapshot(core.flattenRecords(files), date, 500000, [], core.financeCompleteDates(files, date));
}
test('unrecorded today and historical gaps count as zero without disabling insight', () => {
  const files = [file('2026-07-15', 10), file('2026-08-15', 20), file('2026-09-15', 30)];
  const result = fromFiles(files);
  assert.equal(result.historyCycleCount, 2);
  assert.equal(result.forecastAvailable, true);
  assert.equal(result.currentSpentCents, 3000);
  assert.equal(result.historicalAverageSpentCents, 1500);
  const report = core.financeCoverageReport(files, new Date(2026, 8, 22));
  assert.ok(report.cycles[0].assumedZeroDates.includes('2026-09-22'));
  assert.deepEqual(report.cycles[0].missingDates, []);
});
test('backfilling an assumed zero day immediately updates totals and cache fingerprint', () => {
  const files = [file('2026-07-15'), file('2026-08-15'), file('2026-09-15')];
  const before = fromFiles(files), after = fromFiles([...files, file('2026-09-22', 50)]);
  assert.equal(before.currentSpentCents, 0);
  assert.equal(after.currentSpentCents, 5000);
  assert.equal(after.forecastAvailable, true);
  const { financeSnapshotFingerprint } = require('../dist/ai.cjs');
  assert.notEqual(financeSnapshotFingerprint(before), financeSnapshotFingerprint(after));
});
test('bad dated ledgers cannot be hidden by zero-day filling or duplicate good files', () => {
  const files = [file('2026-07-15'), file('2026-08-15'), file('2026-09-15')];
  const bad = file('2026-09-22', 20);
  bad.diagnostics.push({ kind: 'total', path: bad.path, reason: '总额不一致' });
  assert.equal(fromFiles([...files, bad]).forecastAvailable, false);
  assert.equal(fromFiles([...files, bad, file('2026-09-22')]).forecastAvailable, false);
  const historicalBad = file('2026-08-18');
  historicalBad.diagnostics.push({ kind: 'parse', path: historicalBad.path, reason: '记录解析失败' });
  assert.equal(fromFiles([...files, historicalBad]).historyCycleCount, 1);
});
test('zero filling does not invent historical cycles before tracking began', () => {
  const result = fromFiles([file('2026-09-16', 50)]);
  assert.equal(result.historyCycleCount, 0);
  assert.equal(result.forecastAvailable, false);
  const report = core.financeCoverageReport([file('2026-09-16')], new Date(2026, 8, 22));
  assert.ok(report.cycles[0].assumedZeroDates.includes('2026-09-15'));
  assert.ok(report.cycles[1].missingDates.includes('2026-08-15'));
});

test('fixed expenses paid early are not forecast twice; recorded spending remains unchanged', () => {
  const before = snapshot(), after = snapshot([bill]);
  assert.equal(before.forecastCents, 210000);
  assert.equal(after.forecastCents, 110000);
  assert.equal(after.currentSpentCents, before.currentSpentCents);
  assert.equal(after.remainingSalaryCents, before.remainingSalaryCents);
  assert.equal(after.forecastAvailable, true);
});
test('unpaid fixed expenses replace historical remaining fixed amounts', () => {
  const result = snapshot([{ ...bill, payments: { ...bill.payments, '2026-09-15': 'unpaid' } }], [past1, past2]);
  assert.equal(result.forecastCents, 110000);
  assert.equal(result.currentSpentCents, 0);
  assert.equal(result.fixedExpenses.unpaidCents, 110000);
});
test('missing, edited, duplicate or out-of-period associations disable fixed-adjusted forecast', () => {
  assert.equal(snapshot([{ ...bill, payments: {} }]).forecastAvailable, false);
  assert.equal(snapshot([bill], [past1, past2]).forecastAvailable, false);
  assert.equal(snapshot([bill, { ...bill, id: 'duplicate' }]).forecastAvailable, false);
  assert.equal(snapshot([{ ...bill, payments: { ...bill.payments, '2026-09-15': past1.id } }]).forecastAvailable, false);
});
test('explicit no payment and empty draft rules do not invent spending', () => {
  const empty = { ...bill, payments: { '2026-07-15': 'none', '2026-08-15': 'none', '2026-09-15': 'none' } };
  assert.equal(snapshot([empty], []).forecastCents, 0);
  assert.equal(snapshot([{ ...bill, name: '', amountCents: 0 }]).forecastAvailable, true);
});
test('new salary cycle requires fresh payment confirmation, salary day remains fifteenth', () => {
  const ranges = core.salaryDayRange(new Date(2026, 9, 15));
  assert.equal(ranges.start, '2026-10-15');
  const assessed = assessFixedExpenses([bill], [past1, past2, now], ranges, []);
  assert.equal(assessed.available, false);
});
const event = { id: 'frequency:餐饮', type: 'frequency-spike', priority: 90, title: '次数增加', detail: '消费次数变化', impactCents: 10000 };
const base = () => ({ ...snapshot(), events: [event, { id: 'stable', type: 'stable', priority: 10, title: '暂未发现明显变化', detail: '' }] });
test('reading a valid insight never removes it on the next day or invents a stable state', () => {
  const first = base(), history = markInsightSeen([], first, event.id);
  assert.equal(withInsightHistory(first, history).events[0].id, event.id);
  const next = { ...first, currentRange: { ...first.currentRange, end: '2026-09-23' } };
  const filtered = withInsightHistory(next, history);
  assert.equal(filtered.events[0].id, event.id);
  assert.deepEqual(filtered.events, next.events);
  assert.equal(filtered.repeatedEvents.length, 1);
  const worse = { ...next, events: [{ ...event, impactCents: 16000 }, next.events[1]] };
  assert.equal(withInsightHistory(worse, history).events[0].id, event.id);
  const newCycle = { ...next, currentRange: { start: '2026-10-15', end: '2026-10-16' } };
  assert.equal(withInsightHistory(newCycle, history).events[0].id, event.id);
  assert.equal(withInsightHistory(newCycle, history).repeatedEvents.length, 0);
});
test('urgent salary pressure is not silenced; history is bounded', () => {
  const pressure = { ...base(), events: [{ ...event, id: 'salary-pressure', type: 'salary-pressure' }] };
  const history = markInsightSeen([], pressure, 'salary-pressure');
  pressure.currentRange = { ...pressure.currentRange, end: '2026-09-23' };
  assert.equal(withInsightHistory(pressure, history).events.length, 1);
  assert.equal(markInsightSeen(Array.from({ length: 210 }, (_, i) => ({ id: String(i), cycle: '', date: '', impact: 0 })), base(), event.id).length, 200);
});
test('event-specific advice distinguishes frequency, ticket price and composition', () => {
  assert.match(eventAdvice(event, 'review'), /分单/);
  assert.match(eventAdvice({ ...event, type: 'ticket-spike' }, 'review'), /单价与数量/);
  assert.match(eventAdvice({ ...event, type: 'mix-shift' }), /不一定是超支/);
});
test('small-amount but significant frequency changes resurface; same-day high water avoids repeat drift', () => {
  const first = { ...base(), events: [{ ...event, category: '餐饮' }, base().events[1]], categories: [{ category: '餐饮', currentCount: 5, currentCents: 10000, currentShare: 0.2 }] };
  const seen = markInsightSeen([], first, event.id);
  const next = { ...first, currentRange: { ...first.currentRange, end: '2026-09-23' }, categories: [{ ...first.categories[0], currentCount: 8 }] };
  assert.equal(withInsightHistory(next, seen).events[0].id, event.id);
  const rising = { ...first, events: [{ ...first.events[0], impactCents: 20000 }, first.events[1]] };
  const updated = markInsightSeen(seen, rising, event.id);
  assert.equal(updated[0].impact, 20000);
  assert.equal(markInsightSeen(updated, rising, event.id), updated);
});
test('fixed expense paid historically before current stage is still forecast when currently unpaid', () => {
  const earlier1 = record('2026-08-16', 1000), earlier2 = record('2026-07-16', 1000);
  const rule = { ...bill, payments: { '2026-08-15': earlier1.id, '2026-07-15': earlier2.id, '2026-09-15': 'unpaid' } };
  const result = snapshot([rule], [earlier1, earlier2]);
  assert.equal(result.forecastCents, 110000);
  assert.equal(result.fixedExpenses.historicalDeductionCents, 0);
});
test('unmatched stars can be relinked safely without duplicates', () => {
  assert.deepEqual(unmatchedStarIds(['old', now.id], [now]), ['old']);
  assert.deepEqual(relinkStar(['old', now.id], 'old', now.id, [now]), [now.id]);
  assert.throws(() => relinkStar(['old'], 'old', 'missing', [now]), /记录已变化/);
});
test('connection test sends no ledger data and classifies provider errors', async () => {
  const config = { endpoint: 'https://example.com/v1', model: 'test-model', apiKey: 'SECRET' };
  let request;
  global.__ledgerTestRequest = async (r) => { request = r; return { status: 200, json: { choices: [{ message: { content: 'OK' } }] } }; };
  await testFinanceConnection(config, undefined, new RequestGate());
  assert.equal(JSON.parse(request.body).messages.length, 1);
  assert.doesNotMatch(request.body, /salary|candidate_events|SECRET|记账/);
  for (const [status, pattern] of [[401, /认证失败/], [403, /权限/], [404, /接口或模型不存在/], [429, /请求受限/], [500, /暂不可用/]]) {
    global.__ledgerTestRequest = async () => ({ status });
    await assert.rejects(testFinanceConnection(config, undefined, new RequestGate()), pattern);
  }
  global.__ledgerTestRequest = async () => { throw new Error('SECRET provider internals'); };
  await assert.rejects(testFinanceConnection(config, undefined, new RequestGate()), (error) => /网络/.test(error.message) && !error.message.includes('SECRET'));
  delete global.__ledgerTestRequest;
});
