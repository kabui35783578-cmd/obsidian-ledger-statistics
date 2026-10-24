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
  p.settings = { assets: a.emptyAssets(), balanceCalibration: null, salaryCents: 600000, salaryCycleStart: '', salaryCycles: [], balanceCalibrationNote: '' };
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

test('default cash corrections and repayments update calibration to the actual cash balance', async () => {
  const p = plugin();
  await p.calibrateBalance(-10000, now(12));
  await p.updateAssets(s => {
    s.accounts.find(x => x.id === 'loan').balanceCents = 80000;
    a.calibrateAccount(s, 'wechat', -15000, [], now(13));
  }, now(13));
  assert.equal(b.balanceStatus([], now(13), 600000, p.settings.balanceCalibration).remainingCents, -15000);
  assert.equal(a.assetTotals(a.buildAssetSnapshot(p.settings.assets, [], now(13))).liabilitiesCents, 95000);
  await p.updateAssets(s => a.repayAssetLiability(s, 'loan', 1000, { now: now(14) }), now(14));
  assert.equal(p.saved.balanceCalibration.balanceCents, -16000);
});

test('debt increases persist cash, debt and matching salary calibration together and roll back on failure', async () => {
  const p = plugin(); await p.calibrateBalance(100000, now(12));
  const before = copy(p.settings), save = p.saveSettings;
  p.saveSettings = async () => { throw new Error('磁盘错误'); };
  await assert.rejects(p.updateAssets(s => a.calibrateAccount(s, 'loan', 60000, [], now(13)), now(13)), /磁盘错误/);
  assert.deepEqual(p.settings, before);
  p.saveSettings = save;
  await p.updateAssets(s => a.calibrateAccount(s, 'loan', 60000, [], now(13)), now(13));
  const snap = a.buildAssetSnapshot(a.normalizeAssets(p.saved.assets), [], now(14));
  assert.equal(snap.accounts.find(x => x.id === 'wechat').cents, 90000);
  assert.equal(snap.accounts.find(x => x.id === 'loan').cents, 60000);
  assert.equal(p.saved.balanceCalibration.balanceCents, 90000);
});

test('editing default cash to 2500 synchronizes both sides, persists and refreshes the settings summary', async () => {
  const p = plugin();
  let refreshed = 0;
  p.settingTab = { refreshBalanceSummary: () => refreshed++ };
  await p.updateAssets(s => a.calibrateAccount(s, 'wechat', 250000, [], now(12)), now(12));
  assert.equal(b.balanceStatus([], now(12), 600000, p.settings.balanceCalibration).remainingCents, 250000);
  assert.equal(p.saved.assets.accounts[0].balanceCents, 250000);
  assert.equal(p.saved.balanceCalibration.balanceCents, 250000);
  assert.equal(refreshed, 1);
  await p.calibrateBalance(260000, now(13));
  assert.equal(a.buildAssetSnapshot(p.settings.assets, [], now(13)).accounts[0].cents, 260000);
});

test('zero and negative default cash corrections synchronize without duplicating debt', async () => {
  const p = plugin();
  for (const cents of [0, -250000]) {
    await p.updateAssets(s => a.calibrateAccount(s, 'wechat', cents, [], now(12)), now(12));
    assert.equal(b.balanceStatus([], now(12), 600000, p.settings.balanceCalibration).remainingCents, cents);
    assert.equal(a.assetTotals(a.buildAssetSnapshot(p.settings.assets, [], now(12))).liabilitiesCents, 50000 + Math.max(0, -cents));
  }
  assert.equal(p.settings.assets.accounts.length, 2);
});

test('other accounts, renames and display changes preserve calibration even when it differs from cash', async () => {
  const p = plugin();
  await p.calibrateBalance(100000, now(12));
  p.settings.assets.accounts[0].balanceCents = 200000;
  p.settings.assets.accounts.push({ ...copy(p.settings.assets.accounts[0]), id: 'bank', name: '银行卡' });
  const calibration = copy(p.settings.balanceCalibration);
  await p.updateAssets(s => {
    a.calibrateAccount(s, 'bank', 250000, [], now(13));
    a.calibrateAccount(s, 'loan', 10000, [], now(13));
    s.accounts[0].name = '微信改名';
    s.hideAmounts = true;
  }, now(13));
  assert.deepEqual(p.settings.balanceCalibration, calibration);
});

test('switching the default cash account adopts its current value including transactions', async () => {
  const p = plugin();
  p.settings.assets.accounts.push({ ...copy(p.settings.assets.accounts[0]), id: 'bank', name: '银行卡', balanceCents: 300000 });
  a.addAssetEvent(p.settings.assets, { id: 'transfer', kind: 'transfer', accountId: 'bank', cashAccountId: 'wechat', amountCents: 50000, feeCents: 0, date: '2026-10-10', createdAt: now(10).toISOString(), note: '' });
  await p.updateAssets(s => a.setDefaultCash(s, 'bank', [], now(12)), now(12));
  assert.equal(p.saved.balanceCalibration.balanceCents, 250000);
  await p.calibrateBalance(200000, now(13));
  assert.equal(a.buildAssetSnapshot(p.settings.assets, [], now(13)).accounts.find(x => x.id === 'bank').cents, 200000);
});

test('backdated default cash corrections use the current value and new spending is deducted only once', async () => {
  const p = plugin();
  const file = core.parseLedgerFile('2026-10-10.md', '---\ndate: 2026-10-10\n---\n# 今日消费记录\n- 11:00 | 餐饮 | Y50.00\n- 13:00 | 餐饮 | Y10.00');
  p.repository.files.set('2026-10-10.md', { ...file, records: file.records.slice(0, 1) });
  await p.updateAssets(s => a.calibrateAccount(s, 'wechat', 250000, file.records.slice(0, 1), now(10)), now(12));
  assert.equal(p.saved.balanceCalibration.balanceCents, 245000);
  p.repository.files.set('2026-10-10.md', file);
  const current = a.buildAssetSnapshot(p.settings.assets, file.records, now(14)).accounts[0].cents;
  assert.equal(current, 244000);
  assert.equal(b.balanceStatus(file.records, now(14), 600000, p.settings.balanceCalibration).remainingCents, current);
});

test('recalibrating the same cash value repairs divergence, and cancelled calibration stays cancelled on passive updates', async () => {
  const p = plugin();
  await p.calibrateBalance(250000, now(12));
  p.settings.balanceCalibration.balanceCents = 200000;
  await p.updateAssets(s => a.calibrateAccount(s, 'wechat', 250000, [], now(13)), now(13));
  assert.equal(p.settings.balanceCalibration.balanceCents, 250000);
  await p.clearBalanceCalibration(now(13));
  await p.updateAssets(s => { s.hideAmounts = true; }, now(14));
  assert.equal(p.settings.balanceCalibration, null);
});

test('removing or unsetting the default cash account does not replace calibration with zero', async () => {
  for (const remove of [false, true]) {
    const p = plugin();
    await p.calibrateBalance(250000, now(12));
    const before = copy(p.settings.balanceCalibration);
    await p.updateAssets(s => {
      if (remove) s.accounts[0].archived = true;
      else s.defaultCashId = '';
    }, now(13));
    assert.deepEqual(p.settings.balanceCalibration, before);
  }
});

test('renaming a linked ledger file preserves calibration and does not invent a fresh balance anchor', async () => {
  const p = plugin();
  const file = core.parseLedgerFile('2026-10-10.md', '---\ndate: 2026-10-10\n---\n# 今日消费记录\n- 11:00 | 餐饮 | Y50.00');
  p.repository.files.set('2026-10-10.md', file);
  await p.calibrateBalance(250000, now(12));
  const before = copy(p.settings.balanceCalibration);
  p.repository.files.clear();
  p.repository.files.set('renamed.md', core.parseLedgerFile('renamed.md', '---\ndate: 2026-10-10\n---\n# 今日消费记录\n- 11:00 | 餐饮 | Y50.00'));
  await p.updateAssets(s => a.renameAssetLinks(s, '2026-10-10.md', 'renamed.md'), now(13));
  assert.deepEqual(p.settings.balanceCalibration, before);
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
