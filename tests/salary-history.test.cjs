const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('../dist/salary-history.cjs');
const b = require('../dist/balance.cjs');
const charts = require('../dist/chart-data.cjs');
const Plugin = require('../dist/main.cjs').default;
const assets = require('../dist/assets.cjs');
const core = require('../dist/core.cjs');
const date = (month, day = 20, hour = 12) => new Date(2026, month - 1, day, hour);
const copy = x => JSON.parse(JSON.stringify(x));
const initial = () => ({ salaryCents: 600000, salaryCycleStart: '', salaryCycles: [], balanceCalibration: null, balanceCalibrationNote: '' });
const rec = (day, cents, time = '13:00') => ({ id: day + time, path: day + '.md', date: day, time, cents, category: '餐饮', note: '', line: 1, raw: '' });

test('upgrade migrates the surviving calibration and note without inventing older records', () => {
  const state = initial();
  state.balanceCalibration = b.createBalanceCalibration([], date(9), -23000);
  state.balanceCalibrationNote = '还款\n转给家人';
  const before = copy(state), next = h.reconcileSalaryCycles(state, date(10, 13));
  assert.deepEqual(state, before, 'migration is pure');
  assert.equal(next.salaryCycles.length, 1);
  assert.deepEqual(next.salaryCycles[0].calibration, before.balanceCalibration);
  assert.equal(next.salaryCycles[0].note, before.balanceCalibrationNote);
  assert.deepEqual(h.reconcileSalaryCycles(copy(next), date(10, 13)), next, 'reload is idempotent');
});

test('upgrade after payday archives an old calibration and leaves the new cycle uncalibrated', () => {
  const state = initial();
  state.balanceCalibration = b.createBalanceCalibration([], date(9), 350000);
  state.balanceCalibrationNote = '九月差额';
  const next = h.reconcileSalaryCycles(state, date(10));
  assert.equal(next.salaryCycleStart, '2026-10-15');
  assert.equal(next.balanceCalibration, null);
  assert.equal(next.balanceCalibrationNote, '');
  assert.equal(next.salaryCycles[0].note, '九月差额');
  assert.equal(next.salaryCycles[0].salarySource, 'legacy', 'old wage could not be verified');
});

test('payday, repeated calibrations and next-month wage/note edits preserve the prior cycle', () => {
  let state = h.reconcileSalaryCycles(initial(), date(9));
  state.balanceCalibration = b.createBalanceCalibration([], date(9), 350000);
  state.balanceCalibrationNote = '家用';
  state = h.reconcileSalaryCycles(state, date(9));
  state.balanceCalibration = b.createBalanceCalibration([], date(10, 14), -23000);
  state = h.reconcileSalaryCycles(state, date(10, 14));
  const prior = copy(state.salaryCycles[0]);
  state = h.reconcileSalaryCycles(state, date(10, 15));
  assert.equal(state.balanceCalibration, null);
  assert.equal(state.balanceCalibrationNote, '');
  assert.equal(state.salaryCents, 600000);
  state.salaryCents = 700000;
  state.balanceCalibrationNote = '新周期';
  state.balanceCalibration = b.createBalanceCalibration([], date(10), 450000);
  state = h.reconcileSalaryCycles(state, date(10));
  assert.deepEqual(state.salaryCycles[0], prior);
  assert.equal(state.salaryCycles[1].salaryCents, 700000);
  assert.equal(state.salaryCycles[1].note, '新周期');
  assert.equal(state.salaryCycles[0].calibration.balanceCents, -23000);
});

test('history uses cycle-end spending, not spending or calibration from the new cycle', () => {
  let state = h.reconcileSalaryCycles(initial(), date(9));
  const baseline = [rec('2026-09-19', 100000)];
  state.balanceCalibration = b.createBalanceCalibration(baseline, date(9), 350000);
  state.balanceCalibrationNote = '旧期';
  state = h.reconcileSalaryCycles(state, date(10, 14));
  state = h.reconcileSalaryCycles(state, date(10, 15));
  state.salaryCents = 700000;
  state.balanceCalibration = b.createBalanceCalibration([], date(10), 100000);
  const records = [...baseline, rec('2026-10-14', 20000, '23:59'), rec('2026-10-15', 50000)];
  const old = h.salaryCycleDetails(state, '2026-09-15', records, date(10));
  assert.deepEqual(old.range, { start: '2026-09-15', end: '2026-10-14' });
  assert.equal(old.balance.remainingCents, 330000);
  assert.equal(old.balance.recordedSpentCents, 120000);
  assert.equal(old.balance.unrecordedNetCents, 150000);
  assert.equal(old.cycle.salaryCents, 600000);
  assert.equal(old.cycle.note, '旧期');
  const steps = charts.salaryWaterfall(records, old.range, old.cycle.salaryCents, old.balance);
  assert.equal(steps.find(s => s.kind === 'calibration').deltaCents, -150000);
  assert.equal(steps.at(-1).toCents, 330000);
  const backfill = h.salaryCycleDetails(state, '2026-09-15', [...records, rec('2026-09-18', 5000, '补记')], date(10));
  assert.equal(backfill.balance.remainingCents, 330000);
  assert.equal(backfill.balance.unrecordedNetCents, 145000);
});

test('unobserved cycles are explicitly wage references with no borrowed calibration or note', () => {
  const state = h.reconcileSalaryCycles(initial(), date(10));
  state.balanceCalibrationNote = '当前备注';
  const old = h.salaryCycleDetails(state, '2026-08-15', [], date(10));
  assert.equal(old.salaryRecorded, false);
  assert.equal(old.balance.calibrated, false);
  assert.equal(old.cycle.note, '');
});

test('cycle navigation crosses years and leap February without losing fixed historical dates', () => {
  assert.equal(h.shiftSalaryCycle('2026-01-15', 1), '2025-12-15');
  assert.equal(h.shiftSalaryCycle('2025-12-15', -1), '2026-01-15');
  assert.deepEqual(h.salaryCycleRange('2024-02-15', date(10)), { start: '2024-02-15', end: '2024-03-14' });
  assert.deepEqual(h.salaryCycleRange('2026-09-15', date(10, 13)), { start: '2026-09-15', end: '2026-10-13' });
  const afterSkip = h.reconcileSalaryCycles(h.reconcileSalaryCycles(initial(), date(1)), date(10));
  assert.deepEqual(afterSkip.salaryCycles.map(c => c.cycleStart), ['2026-01-15', '2026-10-15'], 'do not fabricate skipped wages');
});

test('malformed synced history is rejected and calibration is restricted to its own cycle', () => {
  const calibration = b.createBalanceCalibration([], date(9), 350000);
  const rows = [null, { cycleStart: '2026-99-15', salaryCents: 1 }, { cycleStart: '2026-09-15', salaryCents: -1 },
    { cycleStart: '2026-08-15', salaryCents: 600000, calibration, note: 1 },
    { cycleStart: '2026-09-15', salaryCents: 600000, calibration, note: '正确' }];
  const next = h.normalizeSalaryCycles(rows);
  assert.equal(next.length, 2);
  assert.equal(next[0].calibration, null);
  assert.equal(next[0].note, '');
  assert.equal(next[1].calibration.balanceCents, 350000);
});

function plugin() {
  const p = Object.create(Plugin.prototype);
  p.settings = { ...initial(), assets: assets.emptyAssets(), financeAdviceCache: null };
  p.repository = { files: new Map() };
  p.assetQueue = Promise.resolve(); p.saveQueue = Promise.resolve(); p.assetsStopped = false;
  p.refreshViews = () => {}; p.checkBudget = () => {};
  p.saveData = async data => { p.saved = copy(data); };
  return p;
}

test('real plugin persistence archives the old cycle before calibration, salary and note writes on payday', async () => {
  const p = plugin();
  await p.updateSalaryCycle({ salaryCents: 600000, note: '旧期备注' }, date(9));
  await p.calibrateBalance(-23000, date(9));
  const previous = copy(p.saved.salaryCycles[0]);
  await p.calibrateBalance(400000, date(10, 15));
  await p.updateSalaryCycle({ salaryCents: 800000, note: '新期备注' }, date(10, 15));
  assert.deepEqual(p.saved.salaryCycles[0], previous);
  assert.equal(p.saved.salaryCycles[1].salaryCents, 800000);
  assert.equal(p.saved.salaryCycles[1].calibration.balanceCents, 400000);
  assert.equal(p.saved.salaryCycles[1].note, '新期备注');
  const assetBefore = copy(p.settings.assets);
  await p.clearBalanceCalibration(date(10, 15));
  assert.deepEqual(p.saved.salaryCycles[0], previous);
  assert.equal(p.saved.salaryCycles[1].calibration, null);
  assert.deepEqual(p.settings.assets, assetBefore, 'cancellation never clears asset money');
  assert.deepEqual(h.reconcileSalaryCycles(copy(p.saved), date(10, 15)).salaryCycles, p.saved.salaryCycles);
});

test('failed history writes roll back assets, archive, wage and note together and can retry', async () => {
  const p = plugin();
  await p.calibrateBalance(-23000, date(9));
  const before = copy(p.settings);
  p.saveData = async () => { throw new Error('磁盘错误'); };
  await assert.rejects(p.calibrateBalance(400000, date(10)), /磁盘错误/);
  assert.deepEqual(p.settings, before);
  await assert.rejects(p.updateSalaryCycle({ salaryCents: 700000, note: '不应保存' }, date(10)), /磁盘错误/);
  assert.deepEqual(p.settings, before);
  p.saveData = async data => { p.saved = copy(data); };
  await p.calibrateBalance(400000, date(10));
  assert.deepEqual(p.saved.salaryCycles[0], before.salaryCycles[0]);
  assert.equal(p.saved.salaryCycles[1].calibration.balanceCents, 400000);
});

test('asset balance edits persist the current salary history, preserve prior cycles and roll back both sides', async () => {
  const p = plugin();
  await p.calibrateBalance(100000, date(9));
  const previous = copy(p.saved.salaryCycles[0]);
  const cashId = p.settings.assets.defaultCashId;
  await p.updateAssets(s => assets.calibrateAccount(s, cashId, 250000, [], date(10)), date(10));
  assert.deepEqual(p.saved.salaryCycles[0], previous);
  assert.equal(p.saved.salaryCycles[1].calibration.balanceCents, 250000);
  assert.equal(p.saved.balanceCalibration.balanceCents, 250000);
  assert.equal(p.saved.assets.accounts[0].balanceCents, 250000);
  const before = copy(p.settings);
  p.saveData = async () => { throw new Error('磁盘错误'); };
  await assert.rejects(p.updateAssets(s => assets.calibrateAccount(s, cashId, 300000, [], date(11)), date(11)), /磁盘错误/);
  assert.deepEqual(p.settings, before);
});

test('automatic rollover persistence retries after a failure without losing the old cycle', async () => {
  const p = plugin();
  const now = new Date(), current = core.salaryDayRange(now).start;
  const priorStart = h.shiftSalaryCycle(current, 1);
  const priorDate = new Date(`${priorStart}T12:00:00`);
  p.settings = { ...p.settings, ...h.reconcileSalaryCycles(initial(), priorDate) };
  p.settings.balanceCalibration = b.createBalanceCalibration([], priorDate, -23000);
  p.settings.balanceCalibrationNote = '上期备注';
  p.settings = { ...p.settings, ...h.reconcileSalaryCycles(p.settings, priorDate) };
  const old = copy(p.settings.salaryCycles[0]);
  p.app = { workspace: { getLeavesOfType: () => [] } };
  let writes = 0;
  p.saveData = async data => { if (++writes === 1) throw new Error('暂时无法保存'); p.saved = copy(data); };
  global.document = { hidden: true };
  try {
    p.tick();
    await p.saveQueue;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(p.salaryHistoryDirty, true);
    assert.deepEqual(p.settings.salaryCycles[0], old);
    p.tick();
    await p.saveQueue;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(writes, 2);
    assert.equal(p.salaryHistoryDirty, false);
    assert.deepEqual(p.saved.salaryCycles[0], old);
    assert.equal(p.saved.salaryCycleStart, current);
    assert.equal(p.saved.balanceCalibration, null);
    assert.equal(p.saved.balanceCalibrationNote, '');
  } finally { delete global.document; }
});
