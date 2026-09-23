const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareDonut } = require('../dist/donut.cjs');

function categories(amounts) {
  const total = amounts.reduce((sum, cents) => sum + cents, 0);
  return amounts.map((cents, index) => ({ category: `分类${index + 1}`, cents, count: 1, share: cents / total }));
}

test('donut keeps at most six sections and preserves every category in the breakdown', () => {
  const input = categories([3400, 2400, 1500, 1000, 800, 500, 300, 100]);
  const sections = prepareDonut(input);
  assert.equal(sections.length, 6);
  assert.deepEqual(sections.slice(0, 5).map((part) => part.category), input.slice(0, 5).map((part) => part.category));
  assert.equal(sections[5].category, '其余 3 类');
  assert.deepEqual(sections[5].members.map((item) => item.category), input.slice(5).map((item) => item.category));
  assert.equal(sections.reduce((sum, part) => sum + part.cents, 0), 10000);
  assert.equal(sections.reduce((sum, part) => sum + part.ticks, 0), 100);
});

test('donut highlights the largest amount regardless of the input ordering', () => {
  const sections = prepareDonut(categories([100, 600, 300]));
  assert.deepEqual(sections.map((part) => part.category), ['分类2', '分类3', '分类1']);
  assert.equal(sections[0].share, 0.6);
});

test('six or fewer categories stay separate', () => {
  const input = categories([400, 300, 200, 100, 50, 25]);
  const sections = prepareDonut(input);
  assert.equal(sections.length, input.length);
  assert.ok(sections.every((part) => part.members.length === 1));
});

test('every positive donut section gets a visible tick without changing the total', () => {
  const sections = prepareDonut(categories([9910, 30, 20, 20, 10, 10]));
  assert.equal(sections.length, 6);
  assert.ok(sections.every((part) => part.ticks >= 1));
  assert.equal(sections.reduce((sum, part) => sum + part.ticks, 0), 100);
  assert.equal(sections.reduce((sum, part) => sum + part.cents, 0), 10000);
});
