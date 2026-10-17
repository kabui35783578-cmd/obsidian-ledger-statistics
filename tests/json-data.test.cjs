const test = require('node:test');
const assert = require('node:assert/strict');
const { jsonDataEqual } = require('../dist/json-data.cjs');

test('persisted objects ignore nested key order and omitted undefined properties', () => {
  assert.equal(jsonDataEqual({ accounts: [{ name: '现金', cents: 100, optional: undefined }] }, { accounts: [{ cents: 100, name: '现金' }] }), true);
  assert.equal(jsonDataEqual({ optional: undefined }, {}), true);
  assert.equal(jsonDataEqual(JSON.parse('{"__proto__":"x","value":1}'), JSON.parse('{"value":1,"__proto__":"x"}')), true);
});

test('actual monetary, type, deletion and array-order differences stay significant', () => {
  for (const [a, b] of [[{ cents: 100 }, { cents: 101 }], [{ cents: 100 }, { cents: '100' }], [{ cents: 0 }, {}],
    [{ note: null }, {}], [[1, 2], [2, 1]], [[1], { 0: 1 }], [false, 0]]) assert.equal(jsonDataEqual(a, b), false);
});
