const test = require('node:test');
const assert = require('node:assert/strict');
const { previousDaySnapshot, dailyAssetChange, emptyAssets, storeAssetSnapshot } = require('../dist/assets.cjs');
function snapshot(date, cash, fixed = 0, debt = 0) {
  return { date, savedAt: `${date}T12:00:00Z`, pending: [], accounts: [
    { id: 'c', name: '现金', kind: 'cash', cents: cash, missing: false, holdings: [] },
    { id: 'f', name: '房产', kind: 'fixed', cents: fixed, missing: false, holdings: [] },
    { id: 'd', name: '借款', kind: 'liability', cents: debt, missing: false, holdings: [] }
  ] };
}
test('daily comparison uses the preceding calendar day across month, year and leap-day boundaries', () => {
  for (const [today, yesterday] of [['2026-10-01','2026-09-30'], ['2027-01-01','2026-12-31'], ['2024-03-01','2024-02-29']]) {
    const previous = snapshot(yesterday, 100), state = { snapshots: [snapshot(today, 900), previous] };
    assert.equal(previousDaySnapshot(state, today), previous);
    assert.equal(dailyAssetChange(state, snapshot(today, 101)), 1);
  }
});
test('increase, decline and unchanged are based on total assets with consistent fixed-asset filtering', () => {
  const state = { snapshots: [snapshot('2026-10-09', 10000, 20000, 50000)] };
  assert.equal(dailyAssetChange(state, snapshot('2026-10-10', 12500, 20000, 0)), 2500);
  assert.equal(dailyAssetChange(state, snapshot('2026-10-10', 8000, 20000)), -2000);
  assert.equal(dailyAssetChange(state, snapshot('2026-10-10', 10000, 20000, 0)), 0);
  assert.equal(dailyAssetChange(state, snapshot('2026-10-10', 10000, 90000), true), 0);
});
test('missing calendar days and incomplete valuations never become a fabricated daily change', () => {
  const current = snapshot('2026-10-10', 20000);
  assert.equal(dailyAssetChange({ snapshots: [snapshot('2026-10-08', 10000)] }, current), null);
  const previous = snapshot('2026-10-09', 10000), state = { snapshots: [previous] };
  previous.accounts[0].missing = true; assert.equal(dailyAssetChange(state, current), null);
  previous.accounts[0].missing = false; current.pending.push('待核对'); assert.equal(dailyAssetChange(state, current), null);
  assert.equal(previousDaySnapshot(state, 'invalid'), undefined);
});
test('same-day saved changes replace the current snapshot and survive persistence without double counting', () => {
  const state = emptyAssets(); state.accounts.push({ id: 'c' });
  storeAssetSnapshot(state, snapshot('2026-10-09', 10000));
  storeAssetSnapshot(state, snapshot('2026-10-10', 11000));
  storeAssetSnapshot(state, snapshot('2026-10-10', 12000));
  const restored = JSON.parse(JSON.stringify(state));
  assert.equal(restored.snapshots.length, 2);
  assert.equal(dailyAssetChange(restored, restored.snapshots[1]), 2000);
});
