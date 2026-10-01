const test = require('node:test');
const assert = require('node:assert/strict');
global.window = global;
const core = require('../dist/core.cjs');
const { withDailyInsight } = require('../dist/daily-insight.cjs');
const { financeAiInput, financeAiEvidence, parseFinanceAdvice } = require('../dist/ai.cjs');
const { assessFinanceAdvice, createFinanceAdviceCache } = require('../dist/advice-lifecycle.cjs');
const { withInsightHistory, markInsightSeen } = require('../dist/insights.cjs');
const { LedgerStatisticsView } = require('../dist/view.cjs');
const options = { dailyBudgetCents: 6000, budgetCategory: '', includeStarredInBudget: true, starredRecordIds: [] };
const now = new Date(2026, 9, 1, 12);
function file(date, amount = 0, category = '餐饮') {
  return core.parseLedgerFile(`private/${date}.md`, `---\ndate: ${date}\ntotal: ${amount}\n---\n# 今日消费记录\n${amount ? `- 12:00｜${category}｜￥${amount}.00（午饭）\n` : ''}`);
}
function snapshot(files = [file('2026-10-01', 42)], settings = {}, date = now) {
  const base = core.buildFinanceAdvisorSnapshot(core.flattenRecords(files), date, 600000, [], core.financeCompleteDates(files, date));
  return withDailyInsight(base, files, date, { ...options, ...settings });
}
function payload(data) {
  return { primary_event_id: data.events[0].id, headline: '今天消费在日预算内',
    cause_hypothesis: '今天已记录42元，日预算还剩18元。就已记录的消费而言，目前仍在日预算内。',
    action: '按实际需要安排剩余消费，不必因为有预算余量就额外购买。',
    evidence_ids: [financeAiEvidence(data).find(e => e.eventIds.includes(data.events[0].id)).id],
    category_insights: [], fact_claims: [{ metric_id: 'today.spent', value: 42 }, { metric_id: 'today.budget_remaining', value: 18 }] };
}
function advice(data) { return parseFinanceAdvice(JSON.stringify(payload(data)), data); }

test('daily brief distinguishes unrecorded, explicit zero, normal, near budget and over budget', () => {
  for (const [files, expected] of [[[], 'unrecorded'], [[file('2026-10-01')], 'zero'], [[file('2026-10-01', 42)], 'normal'], [[file('2026-10-01', 55)], 'near-budget'], [[file('2026-10-01', 85)], 'over-budget']]) {
    const data = snapshot(files);
    assert.equal(data.daily.status, expected);
    assert.equal(data.events[0].type, 'daily');
    assert.equal(data.events[0].id, 'daily:2026-10-01');
  }
  assert.match(snapshot([]).events[0].detail, /不能据此认定零消费/);
  const over = snapshot([file('2026-10-01', 85)]);
  assert.equal(over.daily.overCents, 2500);
  assert.match(over.events[0].detail, /超出 ¥25.00/);
  assert.equal(snapshot([file('2026-10-01', 85)], { dailyBudgetCents: 0 }).daily.status, 'recorded');
});

test('budget calculation matches category and starred settings without hiding total spending', () => {
  const files = [file('2026-10-01', 42), file('2026-10-01', 100, '购物')];
  const data = snapshot(files, { budgetCategory: '餐饮' });
  assert.equal(data.daily.spentCents, 14200);
  assert.equal(data.daily.budgetSpentCents, 4200);
  assert.equal(data.daily.status, 'normal');
  const excluded = snapshot(files, { includeStarredInBudget: false, starredRecordIds: [files[1].records[0].id] });
  assert.equal(excluded.daily.budgetSpentCents, 4200);
  assert.equal(excluded.daily.spentCents, 14200);
});

test('bad totals, parse errors and undated ledgers never produce a normal verdict', () => {
  const bad = file('2026-10-01', 42);
  bad.diagnostics.push({ kind: 'total', path: bad.path, reason: 'Mismatch' });
  assert.equal(snapshot([bad]).daily.status, 'incomplete');
  const undated = core.parseLedgerFile('bad.md', '# 今日消费记录\n- 12:00｜餐饮｜￥42.00');
  assert.equal(snapshot([file('2026-10-01', 42), undated]).daily.status, 'incomplete');
  const failed = core.parseLedgerFile('private/2026-10-01.md', '---\ndate: 2026-10-01\ntotal: 42\n---\n# 今日消费记录\n- broken');
  assert.equal(snapshot([failed]).daily.status, 'incomplete');
});

test('local-day rollover changes the brief even when cycle anomalies are unchanged', () => {
  const first = snapshot();
  const next = snapshot([file('2026-10-01', 42)], {}, new Date(2026, 9, 2, 0, 1));
  assert.equal(next.daily.date, '2026-10-02');
  assert.equal(next.daily.status, 'unrecorded');
  const cache = createFinanceAdviceCache(first, advice(first));
  assert.equal(assessFinanceAdvice(next, cache).advice, null);
  assert.match(assessFinanceAdvice(next, cache).reason, /新的一天/);
});

test('any backfill, deletion, amount or budget change invalidates numeric AI copy immediately', () => {
  const first = snapshot(), cache = createFinanceAdviceCache(first, advice(first));
  assert.equal(assessFinanceAdvice(first, cache).needsRefresh, false);
  for (const next of [snapshot([file('2026-10-01', 43)]), snapshot([]), snapshot(undefined, { dailyBudgetCents: 6100 }), snapshot(undefined, { budgetCategory: '购物' })]) {
    const assessment = assessFinanceAdvice(next, cache);
    assert.equal(assessment.needsRefresh, true);
    assert.equal(assessment.advice, null);
    assert.notEqual(assessment.refreshKey, assessFinanceAdvice(first, cache).refreshKey);
  }
  const marked = { ...first, repeatedEvents: [first.events.at(-1)] };
  assert.equal(assessFinanceAdvice(marked, cache).needsRefresh, false, 'reading history is not a data change');
});

test('daily notes do not pollute abnormal-event history and valid anomalies remain secondary', () => {
  const data = snapshot();
  data.events.push({ id: 'spike', type: 'spending-spike', title: '购物偏高', detail: '仍有效', priority: 80 });
  const seen = markInsightSeen([], data, 'spike');
  assert.equal(markInsightSeen(seen, data, data.events[0].id), seen);
  assert.equal(withInsightHistory(data, seen).repeatedEvents[0].id, 'spike');
  const resolved = { ...data, events: data.events.filter(e => e.id !== 'spike') };
  assert.equal(withInsightHistory(resolved, seen).repeatedEvents.length, 0);
});

test('AI accepts verified numbers, dates and suggested targets without fabricated amounts', () => {
  const data = snapshot(), p = payload(data);
  assert.equal(advice(data).judgment, p.cause_hypothesis);
  assert.doesNotThrow(() => parseFinanceAdvice(JSON.stringify({ ...p, headline: '10月1日消费在预算内', action: '可考虑把下一次非必要购买的目标设在10元以内，按实际需要决定。' }), data));
  assert.throws(() => parseFinanceAdvice(JSON.stringify({ ...p, cause_hypothesis: '今天已记录999元，远超预算，必须立即停止所有消费安排。' }), data), /程序未提供/);
  assert.throws(() => parseFinanceAdvice(JSON.stringify({ ...p, action: '可以先确认今天已花999元，再把目标设在预算内。' }), data), /程序未提供/);
  assert.throws(() => parseFinanceAdvice(JSON.stringify({ ...p, fact_claims: [{ metric_id: 'today.spent', value: 43 }] }), data), /不一致/);
  assert.throws(() => parseFinanceAdvice(JSON.stringify({ ...p, fact_claims: [{ metric_id: 'imaginary', value: 42 }] }), data), /不一致/);
  assert.throws(() => parseFinanceAdvice(JSON.stringify({ ...p, primary_event_id: 'stable' }), data), /今日简报/);
  const input = JSON.parse(financeAiInput(data));
  assert.equal(input.numeric_facts['today.spent'].value, 42);
  assert.equal(input.daily_event_id, p.primary_event_id);
  assert.equal(input.daily_brief.status, 'normal');
  assert.doesNotMatch(financeAiInput(data), /private\//);
});

function view(data, cache = null) {
  const result = Object.create(LedgerStatisticsView.prototype);
  Object.assign(result, { closed: false, financeAdviceLoading: false, financeAutoTimer: null, financeController: null, financeAdviceAttemptedKey: '', financeAdviceError: '',
    plugin: { repository: { loaded: true }, settings: { financeAiEnabled: true, financeAiEndpoint: 'https://example.invalid/v1', financeAiApiKey: '', financeAiModel: 'test', financeAdviceCache: cache }, saveSettings: async () => {} },
    app: { vault: { getName: () => 'daily-tests' } }, currentFinanceSnapshot: () => data, refreshFinanceSection: () => {}, financeSectionVisible: () => true });
  return result;
}

test('first daily analysis auto-schedules, debounces and needs no salary configuration', () => {
  const data = snapshot(); data.salaryCents = 0;
  const v = view(data);
  let queued = [], requested;
  const original = global.setTimeout;
  global.setTimeout = (fn, delay) => { queued.push({ fn, delay }); return queued.length; };
  try {
    v.scheduleFinanceAdviceUpdate(); v.scheduleFinanceAdviceUpdate();
    assert.equal(queued.length, 1); assert.equal(queued[0].delay, 1500);
    v.loadFinanceAdvice = value => { requested = value; };
    queued[0].fn(); assert.equal(requested, data);
  } finally { global.setTimeout = original; }
});

test('manual refresh can regenerate a current daily analysis', async () => {
  const data = snapshot(), v = view(data, createFinanceAdviceCache(data, advice(data)));
  let requests = 0;
  global.__ledgerTestRequest = async () => { requests++; return { status: 200, json: { choices: [{ message: { content: JSON.stringify(payload(data)) } }] } }; };
  try { await v.loadFinanceAdvice(data, true); assert.equal(requests, 1); assert.equal(v.financeAdviceError, ''); }
  finally { delete global.__ledgerTestRequest; }
});

test('late responses from yesterday cannot replace today and failures fall back locally', async () => {
  const data = snapshot(), v = view(data);
  let resolve;
  global.__ledgerTestRequest = () => new Promise(done => { resolve = done; });
  try {
    const pending = v.loadFinanceAdvice(data, false);
    await new Promise(done => setImmediate(done));
    const next = snapshot([], {}, new Date(2026, 9, 2));
    v.currentFinanceSnapshot = () => next;
    resolve({ status: 200, json: { choices: [{ message: { content: JSON.stringify(payload(data)) } }] } });
    await pending;
    assert.equal(v.plugin.settings.financeAdviceCache, null);
    assert.match(v.financeAdviceError, /依据已变化/);
    assert.equal(assessFinanceAdvice(next, v.plugin.settings.financeAdviceCache).advice, null);
  } finally { delete global.__ledgerTestRequest; }
});
