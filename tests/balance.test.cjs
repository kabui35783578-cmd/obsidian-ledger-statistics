const test = require('node:test');
const assert = require('node:assert/strict');
const balance = require('../dist/balance.cjs');
const core = require('../dist/core.cjs');

function record(date, time, cents, line = 1) {
  return { id: `${date}:${line}`, path: `${date}.md`, date, time, cents, category: '餐饮', note: '', line, raw: '' };
}

test('calibration is the displayed balance and never changes the finance judgment snapshot', () => {
  const now = new Date(2026, 8, 23, 12, 0);
  const records = [record('2026-09-20', '11:00', 200000)];
  const original = core.buildFinanceAdvisorSnapshot(records, now, 600000, []);
  const saved = balance.createBalanceCalibration(records, now, 350000);
  const shown = balance.balanceStatus(records, now, 600000, saved);
  assert.equal(shown.remainingCents, 350000);
  assert.equal(shown.unrecordedNetCents, 50000);
  assert.equal(shown.recordedSpentCents, 200000);
  assert.equal(original.remainingSalaryCents, 400000);
  assert.deepEqual(core.buildFinanceAdvisorSnapshot(records, now, 600000, []), original);
});

test('new expenses deduct, old backfills do not deduct twice, and the difference follows ledger totals', () => {
  const now = new Date(2026, 8, 23, 12, 0);
  const baseline = [record('2026-09-20', '11:00', 200000)];
  const saved = balance.createBalanceCalibration(baseline, now, 350000);
  const later = [
    ...baseline,
    record('2026-09-23', '13:00', 10000, 2),
    record('2026-09-23', '12:00', 2000, 5),
    record('2026-09-21', '补记', 5000, 3),
    record('2026-09-23', '11:00', 3000, 4)
  ];
  const status = balance.balanceStatus(later, new Date(2026, 8, 23, 14, 0), 600000, saved);
  assert.equal(status.remainingCents, 338000);
  assert.equal(status.recordedSpentCents, 220000);
  assert.equal(status.unrecordedNetCents, 42000);
});

test('a forgotten pre-calibration meal resolves the gap without changing actual balance', () => {
  const now = new Date(2026, 8, 23, 12);
  const alreadyRecorded = [record('2026-09-20', '11:00', 100000)];
  const saved = balance.createBalanceCalibration(alreadyRecorded, now, 480000);
  const before = balance.balanceStatus(alreadyRecorded, now, 600000, saved);
  assert.equal(before.unrecordedNetCents, 20000);
  const after = balance.balanceStatus([...alreadyRecorded, record('2026-09-22', '补记', 20000, 2)], new Date(2026, 8, 23, 13), 600000, saved);
  assert.equal(after.recordedSpentCents, 120000);
  assert.equal(after.remainingCents, 480000);
  assert.equal(after.unrecordedNetCents, 0);
});

test('new salary cycle ignores old calibration and invalid calibration is rejected', () => {
  const saved = balance.createBalanceCalibration([], new Date(2026, 8, 23, 12), 250000);
  const next = balance.balanceStatus([record('2026-10-15', '13:00', 10000)], new Date(2026, 9, 15, 14), 600000, saved);
  assert.equal(next.calibrated, false);
  assert.equal(next.remainingCents, 590000);
  assert.equal(balance.isBalanceCalibration({ ...saved, balanceCents: -1 }), false);
  assert.equal(balance.isBalanceCalibration({ ...saved, postAnchorSpentCents: '0' }), false);
  assert.equal(balance.balanceStatus([], new Date(2026, 8, 23, 14), 600000, { ...saved, balanceCents: -1 }).remainingCents, 600000);
});
