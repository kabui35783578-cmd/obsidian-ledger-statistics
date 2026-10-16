const test = require('node:test');
const assert = require('node:assert/strict');
const { categoryTree, treeValue } = require('../dist/treemap.cjs');

const row = (category, cents, count) => ({ category, cents, count });
const leaves = nodes => nodes.flatMap(node => node.children ? leaves(node.children) : [node]);

test('category treemap preserves exact amounts and only groups explicitly nested category names', () => {
  const data = [row('餐饮/午餐', 2301, 2), row('餐饮/晚餐', 4312, 3), row('交通', 89999, 1), row('其他', 0, 5)];
  const before = structuredClone(data), tree = categoryTree(data, 'amount');
  assert.deepEqual(data, before);
  assert.equal(tree.total, 96612);
  assert.equal(tree.leader.category, '交通');
  const food = tree.nodes.find(n => n.name === '餐饮');
  assert.equal(food.value, 6613);
  assert.equal(food.cents, 6613);
  assert.equal(food.count, 5);
  assert.deepEqual(food.children.map(n => n.category).sort(), ['餐饮/午餐', '餐饮/晚餐']);
  assert.equal(leaves(tree.nodes).reduce((sum, n) => sum + n.value, 0), tree.total);
  assert.equal(tree.omitted[0].category, '其他');
  assert.equal(treeValue(2301, 'amount'), '¥23.01');
});

test('count mode encodes counts rather than reusing currency areas and keeps zero-amount records', () => {
  const tree = categoryTree([row('高金额', 100000, 1), row('多笔', 500, 20), row('零金额', 0, 5)], 'count');
  assert.equal(tree.total, 26);
  assert.equal(tree.leader.category, '多笔');
  assert.deepEqual(leaves(tree.nodes).map(n => n.value), [20, 5, 1]);
  assert.equal(tree.omitted.length, 0);
  assert.equal(treeValue(20, 'count'), '20 笔');
});

test('flat classifications stay flat, ties are deterministic, and nonpositive amounts are never fabricated as rectangles', () => {
  const data = [row('B', 100, 1), row('A', 100, 1), row('退款', -500, 1), row('零', 0, 1)];
  const tree = categoryTree(data, 'amount');
  assert.equal(tree.nodes.length, 2);
  assert.ok(tree.nodes.every(n => !n.children));
  assert.equal(tree.leader.category, 'A');
  assert.deepEqual(tree.omitted.map(n => n.category), ['退款', '零']);
  assert.equal(categoryTree([], 'amount').total, 0);
});
