const test = require('node:test');
const assert = require('node:assert/strict');
const Plugin = require('../dist/main.cjs').default;
const a = require('../dist/assets.cjs');
const b = require('../dist/balance.cjs');
const core = require('../dist/core.cjs');
const now = hour => new Date(2026, 9, 10, hour);
const copy = value => JSON.parse(JSON.stringify(value));

function plugin() {
  const p = Object.create(Plugin.prototype);
  p.settings = { assets: a.emptyAssets(), balanceCalibration: null, salaryCents: 600000 };
  p.settings.assets.accounts = [
    { id: 'wechat', name: '微信', kind: 'cash', balanceCents: -23000, baselineAt: now(9).toISOString(), includedEventIds: [], includedRecordIds: [] },
    { id: 'loan', name: '贷款', kind: 'liability', balanceCents: 50000, baselineAt: now(9).toISOString(), includedEventIds: [], includedRecordIds: [] }
  ];
  a.setDefaultCash(p.settings.assets, 'wechat', [], now(9));
  p.repository = { files: new Map() };
  p.assetQueue = Promise.resolve(); p.assetsStopped = false;
  p.saveSettings = async () => { p.saved = copy(p.settings); };
  p.refreshViews = () => {};
  return p;
}

test('calibration reduces the existing default cash debt once and persists both sides together', async () => {
  const p = plugin();
  await p.calibrateBalance(-10000, now(12));
  const snap = a.buildAssetSnapshot(p.settings.assets, [], now(12));
  assert.equal(snap.accounts.find(x => x.id === 'wechat').cents, -10000);
  assert.equal(a.assetTotals(snap).liabilitiesCents, 60000);
  assert.equal(a.assetTotals(snap).netCents, -60000);
  assert.equal(p.settings.assets.accounts.length, 2, 'reuse existing cash; no duplicate debt');
  assert.equal(p.saved.balanceCalibration.balanceCents, -10000);
  assert.equal(p.saved.assets.accounts[0].balanceCents, -10000);
  const restored = a.normalizeAssets(p.saved.assets);
  assert.equal(a.assetTotals(a.buildAssetSnapshot(restored, [], now(13))).liabilitiesCents, 60000);
  await p.calibrateBalance(0, now(13));
  assert.equal(a.assetTotals(a.buildAssetSnapshot(p.settings.assets, [], now(13))).liabilitiesCents, 50000);
  await p.calibrateBalance(1000, now(14));
  assert.equal(a.assetTotals(a.buildAssetSnapshot(p.settings.assets, [], now(14))).groups.cash, 1000);
});

test('asset debt additions, cash corrections and repayments never write back to calibrated balance', async () => {
  const p = plugin();
  await p.calibrateBalance(-10000, now(12));
  const calibration = copy(p.settings.balanceCalibration);
  await p.updateAssets(s => {
    s.accounts.find(x => x.id === 'loan').balanceCents = 80000;
    a.calibrateAccount(s, 'wechat', -15000, [], now(13));
  });
  assert.deepEqual(p.settings.balanceCalibration, calibration);
  assert.equal(b.balanceStatus([], now(13), 600000, calibration).remainingCents, -10000);
  assert.equal(a.assetTotals(a.buildAssetSnapshot(p.settings.assets, [], now(13))).liabilitiesCents, 95000);
  await p.updateAssets(s => a.repayAssetLiability(s, 'loan', 1000, { now: now(14) }));
  assert.deepEqual(p.settings.balanceCalibration, calibration);
});

test('new ledger spending reaches both balances while old backfills are not deducted twice', async () => {
  const p = plugin();
  await p.calibrateBalance(-10000, now(12));
  const records = core.parseLedgerFile('2026-10-10.md', '---\ndate: 2026-10-10\n---\n# 今日消费记录\n- 11:00 | 餐饮 | Y50.00\n- 13:00 | 餐饮 | Y10.00').records;
  const snap = a.buildAssetSnapshot(p.settings.assets, records, now(14));
  assert.equal(snap.accounts.find(x => x.id === 'wechat').cents, -11000);
  assert.equal(b.balanceStatus(records, now(14), 600000, p.settings.balanceCalibration).remainingCents, -11000);
});

test('cancel and salary rollover leave existing asset debt intact', async () => {
  const p = plugin();
  await p.calibrateBalance(-10000, now(12));
  const calibration = copy(p.settings.balanceCalibration), assets = copy(p.settings.assets);
  assert.equal(b.balanceStatus([], new Date(2026, 9, 15, 12), 600000, calibration).calibrated, false);
  await p.clearBalanceCalibration();
  assert.equal(p.settings.balanceCalibration, null);
  assert.deepEqual(p.settings.assets, assets);
  assert.equal(a.assetTotals(a.buildAssetSnapshot(p.settings.assets, [], now(14))).liabilitiesCents, 60000);
});

test('calibration without a default creates one cash account and reuses it next time', async () => {
  const p = plugin(); p.settings.assets = a.emptyAssets();
  await p.calibrateBalance(-23000, now(12));
  assert.equal(p.settings.assets.accounts.length, 1);
  assert.equal(p.settings.assets.accounts[0].kind, 'cash');
  assert.equal(p.settings.assets.defaultCashId, p.settings.assets.accounts[0].id);
  assert.equal(a.assetTotals(a.buildAssetSnapshot(p.settings.assets, [], now(13))).liabilitiesCents, 23000);
  await p.calibrateBalance(-10000, now(13));
  assert.equal(p.settings.assets.accounts.length, 1);
  assert.equal(a.assetTotals(a.buildAssetSnapshot(p.settings.assets, [], now(14))).liabilitiesCents, 10000);
});

test('failed combined persistence rolls back both sides and the next queued calibration succeeds', async () => {
  const p = plugin(), before = copy(p.settings);
  let resolve, saves = 0;
  const gate = new Promise(r => { resolve = r; });
  p.saveSettings = async () => { if (++saves === 1) { await gate; throw new Error('磁盘错误'); } p.saved = copy(p.settings); };
  const first = p.calibrateBalance(-10000, now(12));
  const rejection = assert.rejects(first, /磁盘错误/);
  const second = p.assetQueue.then(() => assert.deepEqual(p.settings, before));
  await Promise.resolve(); resolve(); await rejection; await second;
  await p.calibrateBalance(-5000, now(13));
  assert.equal(p.settings.balanceCalibration.balanceCents, -5000);
  assert.equal(p.settings.assets.accounts[0].balanceCents, -5000);
});

test('asset edits, calibration and cancellation execute in order on the same queue', async () => {
  const p = plugin();
  await Promise.all([
    p.updateAssets(s => s.accounts.find(x => x.id === 'loan').balanceCents = 70000),
    p.calibrateBalance(-10000, now(12)),
    p.clearBalanceCalibration()
  ]);
  assert.equal(p.settings.balanceCalibration, null);
  assert.equal(p.settings.assets.accounts.find(x => x.id === 'loan').balanceCents, 70000);
  assert.equal(p.settings.assets.accounts.find(x => x.id === 'wechat').balanceCents, -10000);
});
