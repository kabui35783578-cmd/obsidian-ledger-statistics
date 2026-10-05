const test = require('node:test');
const assert = require('node:assert/strict');
global.window = global;
const core = require('../dist/core.cjs');
const { insightAsOf, withDailyInsight } = require('../dist/daily-insight.cjs');
const { financeAiInput, financeAiEvidence, parseFinanceAdvice } = require('../dist/ai.cjs');
const { assessFinanceAdvice, createFinanceAdviceCache } = require('../dist/advice-lifecycle.cjs');
const { withInsightHistory, markInsightSeen } = require('../dist/insights.cjs');
const { LedgerStatisticsView } = require('../dist/view.cjs');
const options = { dailyBudgetCents: 6000, budgetCategory: '', includeStarredInBudget: true, starredRecordIds: [] };
const now = new Date(2026, 9, 2, 8);
function file(date, amount = 0, category = '餐饮') {
  return core.parseLedgerFile(`private/${date}.md`, `---\ndate: ${date}\ntotal: ${amount}\n---\n# 今日消费记录\n${amount ? `- 12:00｜${category}｜￥${amount}.00（午饭）\n` : ''}`);
}
function snapshot(files = [file('2026-10-01', 42)], settings = {}, date = now) {
  const asOf = insightAsOf(date);
  const eligible = files.filter(f => !f.date || f.date <= core.isoFromDate(asOf));
  const base = core.buildFinanceAdvisorSnapshot(core.flattenRecords(eligible), asOf, 600000, [], core.financeCompleteDates(eligible, asOf));
  return withDailyInsight(base, files, date, { ...options, ...settings });
}
function payload(data) {
  return { primary_event_id: data.events[0].id, headline: '昨天消费在日预算内',
    cause_hypothesis: '昨天已记录42元，日预算还剩18元。就已记录的消费而言，目前仍在日预算内。',
    action: '按实际需要安排剩余消费，不必因为有预算余量就额外购买。',
    evidence_ids: [financeAiEvidence(data).find(e => e.eventIds.includes(data.events[0].id)).id],
    category_insights: [], fact_claims: [{ metric_id: 'daily.spent', value: 42 }, { metric_id: 'daily.budget_remaining', value: 18 }] };
}
function advice(data) { return parseFinanceAdvice(JSON.stringify(payload(data)), data); }

function actualSnapshot(files, date = now) {
  const v = Object.create(LedgerStatisticsView.prototype);
  v.plugin = { repository: { files: new Map(files.map((f, i) => [i, f])) }, settings: {
    ...options, salaryCents: 600000, excludedCategories: [], fixedExpenses: [], insightHistory: []
  } };
  return v.currentFinanceSnapshot(date);
}

test('morning insights include yesterday, exclude today and future data, and keep the cache current', () => {
  const yesterday = file('2026-10-01', 42);
  const first = actualSnapshot([yesterday]);
  assert.equal(first.daily.date, '2026-10-01');
  assert.equal(first.currentRange.end, '2026-10-01');
  assert.equal(first.daily.spentCents, 4200);
  assert.equal(first.daily.status, 'normal');
  const today = file('2026-10-02', 999, '当日独有分类');
  today.diagnostics.push({ kind: 'total', path: today.path, reason: 'today mismatch' });
  const changed = actualSnapshot([yesterday, today, file('2026-10-03', 1234)], new Date(2026, 9, 2, 23, 59));
  assert.deepEqual(changed, first);
  assert.equal(assessFinanceAdvice(changed, createFinanceAdviceCache(first, advice(first))).needsRefresh, false);
  const input = JSON.parse(financeAiInput(changed));
  assert.equal(input.period.end, '2026-10-01');
  assert.equal(input.daily_brief.date, '2026-10-01');
  assert.equal(input.numeric_facts['daily.spent'].value, 42);
  assert.equal(input.numeric_facts['today.spent'], undefined);
  assert.doesNotMatch(financeAiInput(changed), /当日独有分类|999|1234/);
});

test('previous local calendar day handles month, year, leap day and salary-cycle boundaries', () => {
  for (const [date, expected] of [
    [new Date(2026, 9, 1, 0, 1), '2026-09-30'],
    [new Date(2027, 0, 1, 8), '2026-12-31'],
    [new Date(2028, 2, 1, 8), '2028-02-29'],
    [new Date(2026, 9, 15, 8), '2026-10-14']
  ]) {
    const original = date.getTime();
    const data = actualSnapshot([file(expected, 42)], date);
    assert.equal(date.getTime(), original);
    assert.equal(data.daily.date, expected);
    assert.equal(data.currentRange.end, expected);
    assert.equal(data.daily.spentCents, 4200);
    if (expected === '2026-10-14') assert.equal(data.currentRange.start, '2026-09-15');
  }
});

test('previous today-based cache is replaced and yesterday backfills refresh the analysis', () => {
  const first = actualSnapshot([file('2026-10-01', 42)]);
  const cache = createFinanceAdviceCache(first, advice(first));
  const oldCache = { ...cache, date: '2026-10-02', advice: { ...cache.advice, primaryEventId: 'daily:2026-10-02' } };
  assert.equal(assessFinanceAdvice(first, oldCache).advice, null);
  const backfilled = actualSnapshot([file('2026-10-01', 43)]);
  assert.equal(assessFinanceAdvice(backfilled, cache).needsRefresh, true);
  const nextMorning = actualSnapshot([file('2026-10-01', 42), file('2026-10-02', 55)], new Date(2026, 9, 3, 8));
  assert.equal(nextMorning.daily.date, '2026-10-02');
  assert.equal(nextMorning.daily.spentCents, 5500);
  assert.equal(assessFinanceAdvice(nextMorning, cache).advice, null);
});

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
  const next = snapshot([file('2026-10-01', 42)], {}, new Date(2026, 9, 3, 0, 1));
  assert.equal(next.daily.date, '2026-10-02');
  assert.equal(next.daily.status, 'unrecorded');
  const cache = createFinanceAdviceCache(first, advice(first));
  assert.equal(assessFinanceAdvice(next, cache).advice, null);
  assert.match(assessFinanceAdvice(next, cache).reason, /截止日期已变化/);
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

test('AI prose is retained regardless of numeric claims and optional event bindings', () => {
  const data = snapshot(), p = payload(data);
  assert.equal(advice(data).judgment, p.cause_hypothesis);
  assert.doesNotThrow(() => parseFinanceAdvice(JSON.stringify({ ...p, headline: '10月1日消费在预算内', action: '可考虑把下一次非必要购买的目标设在10元以内，按实际需要决定。' }), data));
  const prose = '昨天已记录999元，远超预算，必须立即停止所有消费安排。';
  assert.equal(parseFinanceAdvice(JSON.stringify({ ...p, cause_hypothesis: prose }), data).judgment, prose);
  const action = '可以先确认昨天已花999元，再把目标设在预算内。';
  assert.equal(parseFinanceAdvice(JSON.stringify({ ...p, action }), data).action, action);
  for (const extra of [{ fact_claims: [{ metric_id: 'daily.spent', value: 43 }] }, { fact_claims: [{ metric_id: 'imaginary', value: 42 }] }, { fact_claims: undefined }, { primary_event_id: 'stable' }]) {
    const parsed = parseFinanceAdvice(JSON.stringify({ ...p, ...extra }), data);
    assert.equal(parsed.judgment, p.cause_hypothesis);
    assert.equal(parsed.primaryEventId, data.events[0].id);
  }
  assert.equal(data.daily.spentCents, 4200, 'AI prose never changes the calculated facts');
  const input = JSON.parse(financeAiInput(data));
  assert.equal(input.numeric_facts['daily.spent'].value, 42);
  assert.equal(input.daily_event_id, p.primary_event_id);
  assert.equal(input.daily_brief.status, 'normal');
  assert.doesNotMatch(financeAiInput(data), /private\//);
});

test('plain text, Markdown, repaired JSON, legacy fields and long output remain displayable', () => {
  const data = snapshot();
  for (const raw of ['昨天的消费值得继续观察。', '## 昨日消费\n\n餐饮占比较高。', '很长的分析。'.repeat(100), '{"analysis":"昨日的支出可以结合实际用途来看。"', '```json\n{"analysis":"昨日的支出可以结合实际用途来看。"}\n```', JSON.stringify(JSON.stringify({ judgment: '旧格式分析也要显示。' }))]) {
    const parsed = parseFinanceAdvice(raw, data);
    assert.ok(parsed.judgment.length > 0);
    assert.equal(parsed.primaryEventId, data.events[0].id);
  }
  const parsed = parseFinanceAdvice(JSON.stringify({ headline: '短', cause_hypothesis: '短', action: '短', evidence_ids: ['fake'], category_insights: [{ category: '不存在', opinion: '保留此分类分析。' }] }), data);
  assert.equal(parsed.headline, '短');
  assert.match(parsed.judgment, /保留此分类分析/);
  assert.deepEqual(parsed.evidenceIds, []);
});

function view(data, cache = null) {
  const result = Object.create(LedgerStatisticsView.prototype);
  Object.assign(result, { closed: false, financeAdviceLoading: false, financeAutoTimer: null, financeController: null, financeAdviceAttemptedKey: '', financeAdviceError: '',
    plugin: { repository: { loaded: true }, settings: { financeAiEnabled: true, financeAiEndpoint: 'https://example.invalid/v1', financeAiApiKey: '', financeAiModel: 'test', financeAdviceCache: cache }, saveSettings: async () => {} },
    app: { vault: { getName: () => 'daily-tests' } }, currentFinanceSnapshot: () => data, refreshFinanceSection: () => {}, financeSectionVisible: () => true });
  return result;
}

test('first daily analysis requires a manual refresh and needs no salary configuration', async () => {
  const data = snapshot(); data.salaryCents = 0;
  const v = view(data);
  let requests = 0;
  global.__ledgerTestRequest = async () => { requests++; return { status: 200, json: { choices: [{ message: { content: JSON.stringify(payload(data)) } }] } }; };
  try {
    await v.loadFinanceAdvice(data, false);
    assert.equal(requests, 0);
    await v.loadFinanceAdvice(data, true);
    assert.equal(requests, 1);
    assert.ok(v.plugin.settings.financeAdviceCache);
  } finally { delete global.__ledgerTestRequest; }
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
    const pending = v.loadFinanceAdvice(data, true);
    await new Promise(done => setImmediate(done));
    const next = snapshot([], {}, new Date(2026, 9, 3));
    v.currentFinanceSnapshot = () => next;
    resolve({ status: 200, json: { choices: [{ message: { content: JSON.stringify(payload(data)) } }] } });
    await pending;
    assert.equal(v.plugin.settings.financeAdviceCache, null);
    assert.match(v.financeAdviceError, /依据已变化/);
    assert.equal(assessFinanceAdvice(next, v.plugin.settings.financeAdviceCache).advice, null);
  } finally { delete global.__ledgerTestRequest; }
});
