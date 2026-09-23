const test = require('node:test');
const assert = require('node:assert/strict');
global.window = global;
const core = require('../dist/core.cjs');
const ai = require('../dist/ai.cjs');
const { withInsightHistory, markInsightSeen } = require('../dist/insights.cjs');
const { assessFinanceAdvice, createFinanceAdviceCache } = require('../dist/advice-lifecycle.cjs');
const { LedgerStatisticsView } = require('../dist/view.cjs');

function snapshot(day = 22) {
  const records = ['2026-07', '2026-08'].flatMap(month => [15, 16, 17].map(date => ({
    id: `old-${month}-${date}`, date: `${month}-${date}`, category: '住房', cents: 2000, note: '燃气费', line: date
  })));
  records.push({ id: 'current-gas', date: '2026-09-16', category: '住房', cents: 20000, note: '燃气费', line: 1 });
  const dates = [];
  for (let date = '2026-07-15'; date <= `2026-09-${day}`; date = core.addDays(date, 1)) dates.push(date);
  return core.buildFinanceAdvisorSnapshot(records, new Date(2026, 8, day), 300000, [], dates);
}

function advice(data, id = data.events.find(event => event.type === 'large-expense').id) {
  return { primaryEventId: id, headline: '住房支出值得继续关注', judgment: '燃气费用变化可能与近期使用习惯或账单覆盖时段有关，后续可结合实际使用情况观察。',
    action: '对照后续账单和近期使用习惯，观察费用变化是否持续。',
    evidenceIds: [ai.financeAiEvidence(data).find(item => item.eventIds.includes(id)).id], categoryLines: [], tone: 'normal' };
}

function cached(data = snapshot(), result = advice(data)) {
  return createFinanceAdviceCache(data, result, '2026-09-22T08:00:00.000Z');
}

function extraEvent(id, type, priority, category = '购物', impactCents = 10000) {
  return { id, type, priority, category, impactCents, title: '新的消费变化', detail: '新的消费变化', evidence: [] };
}

test('valid AI text and generation time survive next-day rollover and a settings round trip', () => {
  const first = snapshot(), cache = JSON.parse(JSON.stringify(cached(first)));
  const next = withInsightHistory(snapshot(23), markInsightSeen([], first, cache.advice.primaryEventId));
  const result = assessFinanceAdvice(next, cache);
  assert.equal(result.advice, cache.advice);
  assert.equal(result.needsRefresh, false);
  assert.equal(cache.updatedAt, '2026-09-22T08:00:00.000Z');
  assert.notEqual(cache.fingerprint, ai.financeSnapshotFingerprint(next));
  assert.equal(result.refreshKey, assessFinanceAdvice(first, cache).refreshKey);
  assert.doesNotMatch(JSON.stringify(cache.basis), /燃气费/);
});

test('minor unrelated spending does not replace a still-valid insight', () => {
  const data = snapshot(), cache = cached(data), next = structuredClone(data);
  next.currentSpentCents += 1000; next.remainingSalaryCents -= 1000;
  next.events.push(extraEvent('new-small', 'spending-spike', 40));
  assert.equal(assessFinanceAdvice(next, cache).needsRefresh, false);
});

test('another signal in the same category does not rotate the same matter into a new alert', () => {
  const data = snapshot(), cache = cached(data), next = structuredClone(data);
  next.events.push(extraEvent('new-frequency:住房', 'frequency-spike', 110, '住房'));
  assert.equal(assessFinanceAdvice(next, cache).needsRefresh, false);
});

test('substantial new activity in the same category is not hidden by grouping', () => {
  const data = snapshot(), cache = cached(data), next = structuredClone(data);
  next.categories[0].currentCount += 6;
  next.categories[0].currentCents += 15000;
  next.events.push(extraEvent('new-frequency:住房', 'frequency-spike', 110, '住房'));
  assert.equal(assessFinanceAdvice(next, cache).needsRefresh, true);
});

test('a more important new event requests reassessment while retaining valid prior text', () => {
  const data = snapshot(), cache = cached(data), next = structuredClone(data);
  next.events.push(extraEvent('new-large', 'large-expense', 99, '购物', 100000));
  const result = assessFinanceAdvice(next, cache);
  assert.equal(result.needsRefresh, true);
  assert.equal(result.advice, cache.advice);
});

test('a distinct large expense in the same category can still prompt reassessment', () => {
  const data = snapshot(), cache = cached(data), next = structuredClone(data);
  next.events.push(extraEvent('new-large:住房', 'large-expense', 99, '住房', 100000));
  assert.equal(assessFinanceAdvice(next, cache).needsRefresh, true);
});

test('already assessed high-priority alternatives do not cause an endless request loop', () => {
  const data = snapshot(); data.events.push(extraEvent('higher', 'large-expense', 99, '购物', 100000));
  const cache = cached(data);
  assert.equal(assessFinanceAdvice(data, cache).needsRefresh, false);
});

test('material worsening and improvement both prompt a fresh assessment', () => {
  const data = snapshot(), cache = cached(data);
  for (const delta of [-6000, 6000]) {
    const next = structuredClone(data);
    next.events.find(event => event.id === cache.advice.primaryEventId).impactCents += delta;
    assert.equal(assessFinanceAdvice(next, cache).needsRefresh, true);
  }
});

test('frequency and share changes can be material even without a large money change', () => {
  for (const type of ['frequency-spike', 'mix-shift']) {
    const data = snapshot();
    const event = extraEvent(`selected:${type}`, type, 99, '住房', 20000);
    data.events.push(event);
    if (type === 'mix-shift') data.categories[0].currentShare = 0.5;
    const cache = cached(data, advice(data, event.id)), next = structuredClone(data);
    if (type === 'frequency-spike') next.categories[0].currentCount += 3;
    else next.categories[0].currentShare = 0.7;
    assert.equal(assessFinanceAdvice(next, cache).needsRefresh, true);
  }
});

test('a resolved or deleted primary event immediately withdraws its old AI text', () => {
  const data = snapshot(), cache = cached(data);
  data.events = data.events.filter(event => event.id !== cache.advice.primaryEventId);
  assert.equal(assessFinanceAdvice(data, cache).advice, null);
});

test('new salary cycles, changed salary, incomplete data and changed seasonal context withdraw old text', () => {
  const data = snapshot(), cache = cached(data);
  for (const change of [
    { currentRange: { start: '2026-10-15', end: '2026-10-22' } },
    { salaryCents: 400000 }, { historyCycleCount: 1 }, { forecastAvailable: false },
    { currentRange: { ...data.currentRange, end: '2026-10-01' } }
  ]) {
    const result = assessFinanceAdvice({ ...data, ...change }, cache);
    assert.equal(result.advice, null); assert.equal(result.needsRefresh, true);
  }
});

test('editing the transaction purpose invalidates the saved causal explanation', () => {
  const data = snapshot(), cache = cached(data), next = structuredClone(data);
  for (const event of next.events) event.evidence = event.evidence.map(line => line.replaceAll('燃气费', '维修费'));
  assert.equal(assessFinanceAdvice(next, cache).advice, null);
});

test('category opinions are withdrawn when their reference balance changes meaning', () => {
  const data = snapshot(); data.categories[0].remainingReferenceCents = 10000;
  const result = advice(data); result.categoryLines = [{ category: '住房', text: '参考余量仍可用于对照后续安排。' }];
  const cache = cached(data, result), next = structuredClone(data);
  next.categories[0].remainingReferenceCents = 0;
  assert.equal(assessFinanceAdvice(next, cache).advice, null);
});

test('legacy cache is accepted only with its exact original snapshot', () => {
  const data = snapshot(), cache = cached(data); delete cache.basis;
  assert.equal(assessFinanceAdvice(data, cache).advice, cache.advice);
  assert.equal(assessFinanceAdvice(snapshot(23), cache).advice, null);
});

test('stable judgments survive ordinary spending but yield to a new anomaly', () => {
  const data = snapshot(); data.events = data.events.filter(event => event.type === 'stable');
  const cache = cached(data, advice(data, 'stable')), next = structuredClone(data);
  next.currentSpentCents += 6000; next.events[0].impactCents += 6000;
  assert.equal(assessFinanceAdvice(next, cache).needsRefresh, false);
  next.events.push(extraEvent('new', 'spending-spike', 80));
  assert.equal(assessFinanceAdvice(next, cache).needsRefresh, true);
});

function viewFor(data, cache) {
  const view = Object.create(LedgerStatisticsView.prototype);
  Object.assign(view, { closed: false, financeAdviceLoading: false, financeAutoTimer: null, financeController: null, financeAdviceAttemptedKey: '', financeAdviceError: '',
    plugin: { settings: { financeAiEnabled: true, financeAiEndpoint: 'https://example.invalid/v1', financeAiApiKey: '', financeAiModel: 'test', financeAdviceCache: cache }, saveSettings: async () => {} },
    app: { vault: { getName: () => 'lifecycle-tests' } }, currentFinanceSnapshot: () => data, refreshFinanceSection: () => {} });
  return view;
}

test('same-day foreground checks schedule important changes only when the card is visible and data is loaded', () => {
  const data = snapshot(), cache = cached(data); data.events.push(extraEvent('new', 'large-expense', 99));
  const view = viewFor(data, cache);
  view.plugin.repository = { loaded: true };
  view.lastDate = '2026-09-22';
  let visible = false, queued = [];
  view.financeSectionVisible = () => visible;
  const realSetTimeout = global.setTimeout;
  global.setTimeout = callback => { queued.push(callback); return queued.length; };
  try {
    view.refreshDate(new Date(2026, 8, 22)); assert.equal(queued.length, 0);
    visible = true; view.plugin.repository.loaded = false;
    view.refreshDate(new Date(2026, 8, 22)); assert.equal(queued.length, 0);
    view.plugin.repository.loaded = true;
    view.refreshDate(new Date(2026, 8, 22)); view.refreshDate(new Date(2026, 8, 22));
    assert.equal(queued.length, 1);
    let requested;
    const newest = { ...data, currentSpentCents: data.currentSpentCents + 100 };
    view.currentFinanceSnapshot = () => newest;
    view.loadFinanceAdvice = value => { requested = value; };
    queued[0](); assert.equal(requested, newest);
  } finally { global.setTimeout = realSetTimeout; }
});

test('pending automatic updates do not send after the card is hidden or the view closes', () => {
  for (const closed of [false, true]) {
    const data = snapshot(), cache = cached(data); data.events.push(extraEvent('new', 'large-expense', 99));
    const view = viewFor(data, cache); view.plugin.repository = { loaded: true };
    let visible = true, callback, requests = 0;
    view.financeSectionVisible = () => visible; view.loadFinanceAdvice = () => { requests++; };
    const realSetTimeout = global.setTimeout;
    global.setTimeout = next => { callback = next; return 1; };
    try {
      view.scheduleFinanceAdviceUpdate();
      if (closed) view.closed = true; else visible = false;
      callback(); assert.equal(requests, 0);
    } finally { global.setTimeout = realSetTimeout; }
  }
});

test('next-day manual refresh does not call the model just because the date changed', async () => {
  const cache = cached(), view = viewFor(snapshot(23), cache);
  let calls = 0; global.__ledgerTestRequest = async () => { calls++; throw new Error('unexpected request'); };
  try { await view.loadFinanceAdvice(snapshot(23), true); assert.equal(calls, 0); assert.equal(view.plugin.settings.financeAdviceCache, cache); }
  finally { delete global.__ledgerTestRequest; }
});

test('failed reassessment retains valid prior insight and does not automatically retry unchanged data', async () => {
  const data = snapshot(), cache = cached(data); data.events.push(extraEvent('new', 'large-expense', 99));
  const view = viewFor(data, cache); let calls = 0;
  global.__ledgerTestRequest = async () => { calls++; throw new Error('offline'); };
  try {
    await view.loadFinanceAdvice(data, false); await view.loadFinanceAdvice(data, false);
    assert.equal(calls, 1); assert.equal(view.plugin.settings.financeAdviceCache, cache);
    assert.equal(assessFinanceAdvice(data, cache).advice, cache.advice);
    assert.match(view.financeAdviceError, /连接失败/);
    await view.loadFinanceAdvice(data, true); assert.equal(calls, 2);
  } finally { delete global.__ledgerTestRequest; }
});

test('successful reassessment persists its basis and does not repeat on the next evaluation', async () => {
  const data = snapshot(), view = viewFor(data, null), chosen = advice(data);
  let saves = 0;
  view.plugin.saveSettings = async () => { saves++; };
  global.__ledgerTestRequest = async () => ({ status: 200, json: { choices: [{ message: { content: JSON.stringify({
    primary_event_id: chosen.primaryEventId, headline: chosen.headline, cause_hypothesis: chosen.judgment,
    action: chosen.action, evidence_ids: chosen.evidenceIds, category_insights: []
  }) } }] } });
  try {
    await view.loadFinanceAdvice(data, true);
    assert.equal(saves, 1); assert.equal(view.plugin.settings.financeAdviceCache.basis.version, 1);
    const retained = assessFinanceAdvice(snapshot(23), view.plugin.settings.financeAdviceCache);
    assert.equal(retained.needsRefresh, false);
    assert.equal(retained.advice.headline, chosen.headline);
  } finally { delete global.__ledgerTestRequest; }
});

test('a late response cannot restore an insight whose supporting transaction disappeared', async () => {
  const data = snapshot(), view = viewFor(data, null); let resolve;
  global.__ledgerTestRequest = () => new Promise(done => { resolve = done; });
  try {
    const pending = view.loadFinanceAdvice(data, true);
    await new Promise(done => setImmediate(done));
    const chosen = advice(data), next = structuredClone(data);
    next.events = next.events.filter(event => event.id !== chosen.primaryEventId);
    view.currentFinanceSnapshot = () => next;
    resolve({ status: 200, json: { choices: [{ message: { content: JSON.stringify({
      primary_event_id: chosen.primaryEventId, headline: chosen.headline, cause_hypothesis: chosen.judgment,
      action: chosen.action, evidence_ids: chosen.evidenceIds, category_insights: []
    }) } }] } });
    await pending;
    assert.equal(view.plugin.settings.financeAdviceCache, null);
    assert.match(view.financeAdviceError, /依据已变化/);
  } finally { delete global.__ledgerTestRequest; }
});
