const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLedgerFile } = require('../dist/core.cjs');
const { buildCategoryAnalysis, categoryPreviousRange, categoryBoxStats } = require('../dist/category-analysis.cjs');
const { LedgerStatisticsView } = require('../dist/view.cjs');

function file(date, entries = []) {
  const amount = entries.reduce((s, e) => s + e[1], 0);
  return parseLedgerFile(`记账/${date}.md`, `---\ndate: ${date}\ntotal: ${(amount / 100).toFixed(2)}\n---\n# 今日消费记录\n${entries.map(([category, cents, note = ''], i) => `- 12:${String(i).padStart(2, '0')}｜${category}｜￥${(cents / 100).toFixed(2)}（${note}）`).join('\n')}`);
}
const range = { start: '2026-09-15', end: '2026-09-16' };
const filter = { range, categories: ['餐饮'], scope: 'consumption', excludedCategories: ['债务/还款'], keyword: '' };
const prior = { start: '2026-08-15', end: '2026-08-16' };

test('top ten ranks only selected records, preserves tied transactions and source links', () => {
  const entries = Array.from({ length: 12 }, (_, i) => ['餐饮', (i + 1) * 100, '午餐']);
  entries.push(['购物', 999999, '手机'], ['餐饮', 1200, '晚餐']);
  const a = buildCategoryAnalysis([file(range.start, entries), file(range.end)], filter, prior);
  assert.equal(a.topTen.length, 10);
  assert.deepEqual(a.topTen.map(r => r.cents), [1200, 1200, 1100, 1000, 900, 800, 700, 600, 500, 400]);
  assert.equal(new Set(a.topTen.map(r => r.id)).size, 10);
  assert.ok(a.topTen.every(r => r.path === '记账/2026-09-15.md' && r.line > 0));
  assert.equal(a.summary.count, 13);
});

test('small and empty samples do not pad ranking or invent averages', () => {
  const a = buildCategoryAnalysis([file(range.start, [['餐饮', 0, '午餐']]), file(range.end)], filter, prior);
  assert.equal(a.topTen.length, 1);
  assert.equal(a.mean, 0);
  const empty = buildCategoryAnalysis([file(range.start), file(range.end)], filter, prior);
  assert.equal(empty.mean, null);
  assert.equal(empty.median, null);
  assert.deepEqual(empty.topTen, []);
});

test('purpose amounts form a partition without double counting mixed and multi-label notes', () => {
  const entries = [['餐饮', 1000, '午餐'], ['餐饮', 2000, '午饭'], ['餐饮', 3000, '早餐 外卖'], ['餐饮', 4000, '超市水果、零食'], ['餐饮', 5000, '瑞幸'], ['餐饮', 6000, '牛肉面']];
  const a = buildCategoryAnalysis([file(range.start, entries), file(range.end)], filter, prior);
  assert.equal(a.purposes.reduce((s, g) => s + g.cents, 0), a.summary.cents);
  assert.equal(a.purposes.reduce((s, g) => s + g.records.length, 0), a.records.length);
  assert.equal(a.purposes.find(g => g.label === '午餐').cents, 3000);
  assert.ok(a.purposes.some(g => g.label === '多用途（未拆分）'));
  assert.ok(a.purposes.some(g => g.label === '混合购物'));
  assert.equal(a.purposes.find(g => g.label === '未识别用途').cents, 11000);
  assert.equal(a.repeats[0].label, '午餐');
  assert.equal(a.repeats[0].records.length, 2);
});

test('missing or invalid ledgers prevent change claims; empty category dates remain observed', () => {
  const files = [file(range.start, [['餐饮', 3000, '午餐']]), file(range.end, [['购物', 4000]]), file(prior.start, [['餐饮', 2000]]), file(prior.end)];
  const a = buildCategoryAnalysis(files, filter, prior);
  assert.equal(a.comparable, true);
  assert.equal(a.summary.recordedDays, 2);
  assert.equal(a.activeDays, 1);
  assert.equal(a.activeDayMean, 3000);
  assert.equal(a.summary.averagePerRecordedDayCents, 1500);
  assert.equal(a.decomposition.frequency + a.decomposition.ticket, 1000);
  assert.equal(buildCategoryAnalysis(files.slice(0, -1), filter, prior).comparable, false);
  const invalid = file(prior.end); invalid.diagnostics.push({ kind: 'total', reason: '总额不一致' });
  assert.equal(buildCategoryAnalysis([...files.slice(0, -1), invalid], filter, prior).decomposition, null);
});

test('amount bins exhaust tied and zero values exactly once', () => {
  const a = buildCategoryAnalysis([file(range.start, [0, 0, 100, 100, 100, 100, 900].map(c => ['餐饮', c])), file(range.end)], filter, prior);
  assert.equal(a.bins.reduce((s, b) => s + b.records.length, 0), 7);
  assert.equal(new Set(a.bins.flatMap(b => b.records.map(r => r.id))).size, 7);
});

test('prior ranges anchor to previous week, month and salary cycle, including historical selections', () => {
  assert.deepEqual(categoryPreviousRange({ start: '2026-09-15', end: '2026-10-04' }, 'salary'), { start: '2026-08-15', end: '2026-09-03' });
  assert.deepEqual(categoryPreviousRange({ start: '2026-09-28', end: '2026-10-01' }, 'week'), { start: '2026-09-21', end: '2026-09-24' });
  assert.deepEqual(categoryPreviousRange({ start: '2026-03-01', end: '2026-03-31' }, 'month'), { start: '2026-02-01', end: '2026-02-28' });
  assert.deepEqual(categoryPreviousRange(range, 'custom'), { start: '2026-09-13', end: '2026-09-14' });
});

test('starred list respects category, scope, keyword and range together', () => {
  const files = [file(range.start, [['餐饮', 100, '午餐'], ['购物', 300], ['债务/还款', 900], ['餐饮', 200, '晚餐']]), file('2026-09-14', [['餐饮', 500, '午餐']])];
  const view = Object.create(LedgerStatisticsView.prototype);
  view.plugin = { repository: { files: new Map(files.map(f => [f.path, f])) }, settings: { starredRecordIds: files.flatMap(f => f.records.map(r => r.id)) } };
  view.filter = { ...filter, keyword: '午餐' };
  assert.deepEqual(view.starredRecords().map(r => r.cents), [100]);
  view.filter = { ...filter, categories: [] };
  assert.deepEqual(view.starredRecords().map(r => r.cents), [300, 200, 100]);
});

test('single-category overview and category tab route to dedicated analysis', () => {
  const view = Object.create(LedgerStatisticsView.prototype);
  view.filter = filter;
  let rendered = 0;
  view.renderSingleCategory = () => rendered++;
  view.renderOverview({}); view.renderCategory({});
  assert.equal(rendered, 2);
});

test('box plot distinguishes actual outlier records from the middle half and handles ties', () => {
  const records = [100, 200, 300, 400, 500, 10000].map((cents, i) => ({ id: `r${i}`, cents }));
  const box = categoryBoxStats(records);
  assert.equal(box.q1, 225);
  assert.equal(box.median, 350);
  assert.equal(box.q3, 475);
  assert.equal(box.min, 100);
  assert.equal(box.max, 500);
  assert.deepEqual(box.outliers.map(r => r.id), ['r5']);
  assert.equal(categoryBoxStats(records.slice(0, 3)), null);
  const tied = categoryBoxStats(Array.from({ length: 4 }, () => ({ cents: 200 })));
  assert.equal(tied.min, tied.max);
  assert.deepEqual(tied.outliers, []);
});
