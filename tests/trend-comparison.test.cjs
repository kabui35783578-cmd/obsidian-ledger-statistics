const test = require('node:test');
const assert = require('node:assert/strict');
const { previousTrendRange, alignedTrendSeries } = require('../dist/trend-comparison.cjs');
const { addDays } = require('../dist/core.cjs');
const record = (date, cents) => ({ date, cents });
const dates = (range) => {
  const result = new Set();
  for (let date = range.start; date <= range.end; date = addDays(date, 1)) result.add(date);
  return result;
};

test('salary and custom monthly cycles use calendar boundaries even when month lengths differ', () => {
  for (const preset of ['salary', 'custom']) {
    assert.deepEqual(previousTrendRange({ start: '2026-10-15', end: '2026-11-14' }, preset), { start: '2026-09-15', end: '2026-10-14' });
    assert.deepEqual(previousTrendRange({ start: '2024-03-15', end: '2024-04-14' }, preset), { start: '2024-02-15', end: '2024-03-14' });
  }
  assert.deepEqual(previousTrendRange({ start: '2026-01-15', end: '2026-01-17' }, 'salary'), { start: '2025-12-15', end: '2025-12-17' });
  assert.deepEqual(previousTrendRange({ start: '2026-10-15', end: '2026-11-13' }, 'salary'), { start: '2026-09-15', end: '2026-10-14' });
});

test('month, year, and arbitrary intervals retain their own comparison boundaries', () => {
  assert.deepEqual(previousTrendRange({ start: '2024-03-01', end: '2024-03-31' }, 'month'), { start: '2024-02-01', end: '2024-02-29' });
  assert.deepEqual(previousTrendRange({ start: '2024-01-01', end: '2024-02-29' }, 'year'), { start: '2023-01-01', end: '2023-02-28' });
  assert.deepEqual(previousTrendRange({ start: '2026-10-05', end: '2026-10-07' }, 'custom'), { start: '2026-10-02', end: '2026-10-04' });
  assert.deepEqual(previousTrendRange({ start: '2026-10-01', end: '2026-10-04' }, 'week'), { start: '2026-09-27', end: '2026-09-30' });
});

test('daily comparison includes zero days, keeps cents exact, and does not move previous transactions into current dates', () => {
  const range = { start: '2026-10-15', end: '2026-10-17' };
  const prior = previousTrendRange(range, 'salary');
  const currentRecords = [record('2026-10-16', 150), record('2026-10-18', 9999)];
  const previousRecords = [record('2026-09-15', 200), record('2026-09-17', 301), record('2026-09-18', 9999)];
  const result = alignedTrendSeries(currentRecords, previousRecords, range, prior, 'day', false, dates(prior));
  assert.deepEqual(result.points.map(p => p.cents), [0, 150, 0]);
  assert.deepEqual(result.comparison.points.map(p => p.cents), [200, 0, 301]);
  assert.deepEqual(result.points.map(p => p.start), ['2026-10-15', '2026-10-16', '2026-10-17']);
  assert.deepEqual(result.comparison.points.map(p => p.start), ['2026-09-15', '2026-09-16', '2026-09-17']);
  assert.equal(currentRecords[1].cents, 9999);
});

test('cumulative comparisons restart at the previous cycle start and stop when it has fewer days', () => {
  const range = { start: '2026-10-15', end: '2026-11-14' };
  const prior = previousTrendRange(range, 'salary');
  const result = alignedTrendSeries([record(range.start, 100)], [record(prior.start, 200), record(prior.end, 500)], range, prior, 'day', true, dates(prior));
  assert.equal(result.points.length, 31);
  assert.equal(result.comparison.points[0].cents, 200);
  assert.equal(result.comparison.points[29].cents, 700);
  assert.equal(result.comparison.points[29].end, '2026-10-14');
  assert.equal(result.comparison.points[30], null, 'Do not borrow October 15 into the previous cycle');
  assert.equal(result.points[30].cents, 100);
  assert.equal(result.comparison.missingDays, 0);
});

test('a known empty ledger is zero; a missing ledger breaks the line and all subsequent cumulative points', () => {
  const range = { start: '2026-10-15', end: '2026-10-18' };
  const prior = previousTrendRange(range, 'salary');
  const known = dates(prior);
  known.delete('2026-09-16');
  const previous = [record('2026-09-15', 200), record('2026-09-18', 500)];
  const daily = alignedTrendSeries([], previous, range, prior, 'day', false, known);
  assert.deepEqual(daily.comparison.points.map(p => p?.cents ?? null), [200, null, 0, 500]);
  const cumulative = alignedTrendSeries([], previous, range, prior, 'day', true, known);
  assert.deepEqual(cumulative.comparison.points.map(p => p?.cents ?? null), [200, null, null, null]);
  assert.equal(cumulative.comparison.missingDays, 1);
});

test('a longer previous cycle retains its final day without adding current-period spending or note targets', () => {
  const range = { start: '2026-09-15', end: '2026-10-14' };
  const prior = previousTrendRange(range, 'salary');
  assert.deepEqual(prior, { start: '2026-08-15', end: '2026-09-14' });
  for (const unit of ['day', 'week', 'month']) {
    const result = alignedTrendSeries([record(range.end, 100)], [record(prior.end, 500)], range, prior, unit, false, dates(prior));
    assert.equal(result.points.at(-1).end, range.end);
    assert.equal(result.comparison.points.at(-1).end, prior.end);
    assert.equal(result.comparison.points.at(-1).cents, 500);
    assert.equal(result.comparison.points.length, result.points.length + 1);
    assert.equal(result.points.reduce((sum, p) => sum + p.cents, 0), 100);
  }
});

test('weekly and monthly comparisons aggregate the same day positions and clip partial buckets', () => {
  const range = { start: '2026-10-15', end: '2026-11-02' };
  const prior = { start: '2026-09-15', end: '2026-10-03' };
  const previous = [record('2026-09-15', 200), record('2026-09-19', 400), record('2026-10-02', 800)];
  for (const unit of ['week', 'month']) {
    const result = alignedTrendSeries([record('2026-10-15', 100)], previous, range, prior, unit, false, dates(prior));
    assert.equal(result.points[0].start, range.start);
    assert.equal(result.points.at(-1).end, range.end);
    assert.equal(result.comparison.points[0].start, prior.start);
    assert.equal(result.comparison.points.at(-1).end, prior.end);
    assert.equal(result.comparison.points.reduce((sum, p) => sum + p.cents, 0), 1400);
    assert.deepEqual(result.comparison.points.map(p => p.cents), unit === 'week' ? [200, 400, 800, 0] : [600, 800]);
  }
});

test('invalid and future-only displayed ranges do not fabricate a timeline', () => {
  for (const range of [{ start: '2026-02-30', end: '2026-03-02' }, { start: '2026-10-20', end: '2026-10-17' }]) {
    assert.deepEqual(alignedTrendSeries([], [], range, { start: '2026-09-01', end: '2026-09-30' }, 'day', false, new Set()).points, []);
  }
  assert.deepEqual(alignedTrendSeries([], [], { start: '2026-10-15', end: '2026-10-17' }, { start: '2026-09-15', end: '2026-09-17' }, 'day', false, new Set()).points, []);
});
