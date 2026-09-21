const test = require('node:test');
const assert = require('node:assert/strict');
global.window = global;
const { LedgerRepository } = require('../dist/repository.cjs');
const { RequestGate } = require('../dist/request-gate.cjs');
const { BudgetMonitor, barkSucceeded } = require('../dist/budget-monitor.cjs');
const core = require('../dist/core.cjs');
const ai = require('../dist/ai.cjs');
const { LedgerStatisticsView } = require('../dist/view.cjs');
const note = (amount, date = '2026-09-21') => `---\ndate: ${date}\ntotal: ${amount}\n---\n# 今日消费记录\n- 12:00｜餐饮｜￥${amount}.00\n`;
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));

function repository() {
  const files = new Map(), reads = [];
  const vault = {
    getMarkdownFiles: () => [...files.values()], getAbstractFileByPath: path => files.get(path),
    read: file => { const task = deferred(); reads.push({ ...task, path: file.path }); return task.promise; },
    on: () => ({}), offref: () => {}
  };
  const repo = new LedgerRepository({ vault }, '记账', () => {});
  const file = new global.__ledgerTestTFile('记账/day.md'); files.set(file.path, file);
  return { repo, files, reads, file };
}

test('old reads cannot overwrite newer edits, including during rescan', async () => {
  const { repo, reads, file } = repository();
  try {
    const scan = repo.rescan();
    const edit = repo.handleCreateOrModify(file);
    reads[1].resolve(note(20)); await edit;
    reads[0].resolve(note(10)); await scan;
    assert.equal(repo.files.get(file.path).records[0].cents, 2000);
    const first = repo.handleCreateOrModify(file), last = repo.handleCreateOrModify(file);
    reads[3].resolve(note(40)); await last; reads[2].resolve(note(30)); await first;
    assert.equal(repo.files.get(file.path).records[0].cents, 4000);
  } finally { repo.dispose(); }
});

test('delete during read never resurrects a record; folder deletion clears descendants', async () => {
  const { repo, reads, file, files } = repository();
  try {
    const scan = repo.rescan(); reads[0].resolve(note(10)); await scan;
    const edit = repo.handleCreateOrModify(file);
    files.clear(); repo.handleDelete({ path: '记账' });
    reads[1].resolve(note(20)); await edit;
    assert.equal(repo.files.size, 0);
  } finally { repo.dispose(); }
});

test('moving a folder out removes records; moving it in rescans descendants', async () => {
  const { repo, reads, file, files } = repository();
  try {
    const scan = repo.rescan(); reads[0].resolve(note(10)); await scan;
    files.clear(); file.path = '归档/day.md'; files.set(file.path, file);
    await repo.handleRename({ path: '归档' }, '记账');
    assert.equal(repo.files.size, 0);
    files.clear(); file.path = '记账/day.md'; files.set(file.path, file);
    const move = repo.handleRename({ path: '记账' }, '归档');
    reads[1].resolve(note(30)); await move;
    assert.equal(repo.files.get(file.path).records[0].cents, 3000);
  } finally { repo.dispose(); }
});

test('rename and dispose invalidate already pending reads', async () => {
  const { repo, reads, file, files } = repository();
  const old = repo.handleCreateOrModify(file);
  files.clear(); file.path = '记账/new.md'; files.set(file.path, file);
  const renamed = repo.handleRename(file, '记账/day.md');
  reads[1].resolve(note(20)); await renamed; reads[0].resolve(note(10)); await old;
  assert.deepEqual([...repo.files.keys()], ['记账/new.md']);
  const pending = repo.handleCreateOrModify(file); repo.dispose(); reads[2].resolve(note(30)); await pending;
  assert.equal(repo.files.get(file.path).records[0].cents, 2000);
});

test('timeout retains native request lock until transport ends and discards late result', async () => {
  const gate = new RequestGate(), task = deferred(); let calls = 0;
  await assert.rejects(gate.run(() => { calls++; return task.promise; }, undefined, 10), /等待时限/);
  await assert.rejects(gate.run(async () => { calls++; }), /尚未结束/);
  assert.equal(calls, 1);
  task.resolve('late'); await flush();
  assert.equal(gate.busy, false);
  assert.equal(await gate.run(async () => 'new'), 'new');
});

test('cancel rejects caller but prevents parallel native requests', async () => {
  const gate = new RequestGate(), task = deferred(), controller = new AbortController();
  const waiting = gate.run(() => task.promise, controller.signal);
  await flush();
  controller.abort(); await assert.rejects(waiting, /取消/);
  assert.equal(gate.busy, true);
  task.reject(new Error('transport ended')); await flush();
  assert.equal(gate.busy, false);
});

test('AI prose cannot inject invented numbers and category selection is validated', () => {
  const snapshot = core.buildFinanceAdvisorSnapshot([], new Date(2026, 8, 21), 300000, [], []);
  const payload = { primary_event_id: 'stable', action_id: 'observe', category_names: [], headline: '已花999999元', summary: '你已经欠款九百万元' };
  const advice = ai.parseFinanceAdvice(JSON.stringify(payload), snapshot);
  assert.equal(advice.headline, snapshot.events[0].title);
  assert.ok(!advice.summary.includes('九百万元'));
  assert.ok(!advice.headline.includes('999999'));
  assert.throws(() => ai.parseFinanceAdvice(JSON.stringify({ ...payload, primary_event_id: 'fake' }), snapshot));
  assert.throws(() => ai.parseFinanceAdvice(JSON.stringify({ ...payload, category_names: ['不存在'] }), snapshot));
  assert.throws(() => ai.parseFinanceAdvice(JSON.stringify({ ...payload, action_id: 'fake' }), snapshot));
  assert.throws(() => ai.parseFinanceAdvice(JSON.stringify({ ...payload, action_id: '__proto__' }), snapshot));
});

test('aborting before dispatch sends no request', async () => {
  const gate = new RequestGate(), controller = new AbortController(); let calls = 0;
  const result = gate.run(async () => { calls++; }, controller.signal);
  controller.abort(); await assert.rejects(result, /取消/); await flush();
  assert.equal(calls, 0); assert.equal(gate.busy, false);
});

test('late successful Bark response after timeout still prevents repeat delivery', async () => {
  const settings = budgetSettings(), task = deferred(); let sends = 0;
  const monitor = new BudgetMonitor(() => settings, () => { sends++; return task.promise; }, async () => {}, () => {}, new RequestGate(), 10);
  const files = [core.parseLedgerFile('day.md', note(20))];
  await monitor.check(files, new Date(2026, 8, 21, 12));
  task.resolve({ status: 200, json: { code: 200, message: 'success' } }); await flush();
  await monitor.check(files, new Date(2026, 8, 21, 13));
  assert.equal(sends, 1); assert.equal(settings.lastBudgetNotificationDate, '2026-09-21');
});

test('coverage report identifies missing dates, bad files, zero days and undated files', () => {
  const good = core.parseLedgerFile('20260915.md', note(0, '2026-09-15'));
  const bad = core.parseLedgerFile('20260916.md', note(10, '2026-09-16').replace('total: 10', 'total: 11'));
  const unknown = core.parseLedgerFile('unknown.md', 'bad');
  const report = core.financeCoverageReport([good, bad, unknown], new Date(2026, 8, 17));
  assert.deepEqual(report.cycles[0].missingDates, []);
  assert.deepEqual(report.cycles[0].assumedZeroDates, ['2026-09-17']);
  assert.equal(report.cycles[0].problems[0].path, '20260916.md');
  assert.equal(report.undated[0].path, 'unknown.md');
});

function budgetSettings() {
  return { barkUrl: 'https://example.invalid/key', dailyBudgetCents: 1000, budgetCategory: '', includeStarredInBudget: true, starredRecordIds: [], lastBudgetNotificationDate: '' };
}
test('budget checks run without a view and confirm business success before daily dedup', async () => {
  const settings = budgetSettings(); let sends = 0, saves = 0;
  const monitor = new BudgetMonitor(() => settings, async () => { sends++; return { status: 200, json: { code: 200, message: 'success' } }; }, async () => { saves++; }, () => {}, new RequestGate());
  const files = [core.parseLedgerFile('day.md', note(20))];
  await Promise.all([monitor.check(files, new Date(2026, 8, 21)), monitor.check(files, new Date(2026, 8, 21))]);
  await monitor.check(files, new Date(2026, 8, 21));
  assert.equal(sends, 1); assert.equal(saves, 1); assert.equal(settings.lastBudgetNotificationDate, '2026-09-21');
});

test('Bark business failures remain retryable with cooldown; stopped monitor sends nothing', async () => {
  const settings = budgetSettings(); let sends = 0;
  const monitor = new BudgetMonitor(() => settings, async () => { sends++; return { status: 200, json: { code: 400, message: 'bad' } }; }, async () => {}, () => {}, new RequestGate());
  const files = [core.parseLedgerFile('day.md', note(20))];
  await monitor.check(files, new Date(2026, 8, 21, 12));
  await monitor.check(files, new Date(2026, 8, 21, 12, 1));
  assert.equal(sends, 1); assert.equal(settings.lastBudgetNotificationDate, '');
  await monitor.check(files, new Date(2026, 8, 21, 12, 6)); assert.equal(sends, 2);
  monitor.stop(); await monitor.check(files, new Date(2026, 8, 21, 13)); assert.equal(sends, 2);
  assert.equal(barkSucceeded({ status: 500, json: { code: 200, message: 'success' } }), false);
});

test('day rollover updates current presets but preserves custom and historical ranges', () => {
  for (const preset of ['today', 'week', 'month', 'salary', 'year', 'custom']) {
    const view = Object.create(LedgerStatisticsView.prototype);
    Object.assign(view, { lastDate: '2026-12-31', closed: false, financeController: null, financeAutoTimer: null, periodOffset: 0, preset,
      filter: { range: { start: '2026-12-01', end: '2026-12-31' } }, drillContext: null, render: () => {} });
    view.refreshDate(new Date(2027, 0, 1, 12));
    if (preset === 'custom') assert.equal(view.filter.range.end, '2026-12-31');
    else assert.ok(view.filter.range.end.startsWith('2027-'));
    view.lastDate = '2026-12-31'; view.periodOffset = 1;
    const before = { ...view.filter.range }; view.refreshDate(new Date(2027, 0, 1, 12));
    assert.deepEqual(view.filter.range, before);
  }
});

test('closing a view during AI request prevents cache writes after response', async () => {
  const task = deferred(); global.__ledgerTestRequest = () => task.promise;
  const view = Object.create(LedgerStatisticsView.prototype); let saves = 0;
  const snapshot = core.buildFinanceAdvisorSnapshot([], new Date(2026, 8, 21), 300000, [], []);
  Object.assign(view, { closed: false, financeAdviceLoading: false, financeAutoTimer: null, financeController: null,
    plugin: { settings: { financeAiEnabled: true, financeAiEndpoint: 'https://example.invalid/v1', financeAiApiKey: '', financeAiModel: 'test', financeAdviceCache: null }, saveSettings: async () => { saves++; } },
    app: { vault: { getName: () => 'request-lifecycle-test' } }, refreshFinanceSection: () => {} });
  const request = view.loadFinanceAdvice(snapshot, false); await flush();
  view.closed = true; view.cancelFinanceRequest(); await request;
  task.resolve({ json: { choices: [{ message: { content: JSON.stringify({ primary_event_id: 'stable', action_id: 'observe', category_names: [] }) } }] } });
  await flush(); assert.equal(saves, 0); assert.equal(view.plugin.settings.financeAdviceCache, null);
  delete global.__ledgerTestRequest;
});
