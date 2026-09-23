const test = require('node:test');
const assert = require('node:assert/strict');
const { salaryWaterfall, categoryBoxReference } = require('../dist/chart-data.cjs');

function record(date, category, cents, id = `${date}:${category}:${cents}`) {
  return { id, date, category, cents };
}

test('waterfall deducts every posted category exactly once, including long tail', () => {
  const records = [
    record('2026-09-15', '餐饮', 3000), record('2026-09-16', '餐饮', 2000),
    record('2026-09-17', '住房', 4000), record('2026-09-18', '购物', 3000),
    record('2026-09-19', '交通', 2000), record('2026-09-20', '零食', 1000),
    record('2026-08-20', '住房', 9000)
  ];
  const steps = salaryWaterfall(records, { start: '2026-09-15', end: '2026-09-23' }, 12000);
  assert.equal(steps.length, 6);
  assert.equal(steps[4].label, '其余 2 类');
  assert.equal(steps[5].toCents, -3000);
  assert.equal(steps.filter((item) => item.kind === 'expense').reduce((sum, item) => sum - item.deltaCents, 0), 15000);
  for (let index = 2; index < steps.length - 1; index += 1) assert.equal(steps[index].fromCents, steps[index - 1].toCents);
});

test('waterfall refuses an unset salary and ignores outside-period transactions', () => {
  const records = [record('2026-08-20', '餐饮', 1000), record('2026-09-20', '餐饮', 2000)];
  assert.deepEqual(salaryWaterfall(records, { start: '2026-09-15', end: '2026-09-23' }, 0), []);
  const steps = salaryWaterfall(records, { start: '2026-09-15', end: '2026-09-23' }, 10000);
  assert.equal(steps[1].deltaCents, -2000);
  assert.equal(steps.at(-1).toCents, 8000);
});

test('box reference uses the two completed salary cycles preceding selected range', () => {
  const amounts = [100, 110, 120, 130, 140, 150, 160, 500];
  const history = amounts.map((cents, index) => record(index < 4 ? '2026-08-20' : '2026-07-20', '餐饮', cents, `h${index}`));
  const current = [record('2026-09-20', '餐饮', 300, 'current'), record('2026-09-21', '餐饮', 80, 'small')];
  const box = categoryBoxReference([...history, ...current, record('2026-08-20', '购物', 9999)], current, '餐饮', '2026-09-15');
  assert.ok(box);
  assert.equal(box.sampleCount, 8);
  assert.equal(box.medianCents, 135);
  assert.equal(box.q1Cents, 115);
  assert.equal(box.q3Cents, 155);
  assert.equal(box.maxCents, 160);
  assert.deepEqual(box.outlierCents, [500]);
  assert.equal(box.largestCurrent.id, 'current');
  assert.equal(box.historyRanges[0].start, '2026-08-15');
  assert.equal(box.historyRanges[1].start, '2026-07-15');
});

test('box reference does not claim a distribution from sparse history', () => {
  const history = Array.from({ length: 7 }, (_, index) => record('2026-08-20', '住房', index + 1, `h${index}`));
  assert.equal(categoryBoxReference(history, [record('2026-09-20', '住房', 100)], '住房', '2026-09-15'), null);
});
