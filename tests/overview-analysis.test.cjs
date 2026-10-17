const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLedgerFile, addDays } = require('../dist/core.cjs');
const { buildCategoryAnalysis } = require('../dist/category-analysis.cjs');
const { renderOverviewAnalysis, renderCategoryAnalysis } = require('../dist/category-ui.cjs');
const { comparisonRanges } = require('../dist/trend-comparison.cjs');

const range = { start: '2026-09-15', end: '2026-09-28' };
const prior = { start: '2026-08-15', end: '2026-08-28' };
const filter = { range, categories: [], scope: 'consumption', excludedCategories: ['债务/还款'], keyword: '' };
function file(date) {
  return parseLedgerFile(`记账/${date}.md`, `---\ndate: ${date}\ntotal: 59.00\n---\n# 今日消费记录\n- 12:00｜餐饮｜￥12.00（午餐）\n- 13:00｜购物｜￥6.00（咖啡）\n- 14:00｜餐饮｜￥1.00（咖啡）\n- 15:00｜债务/还款｜￥40.00（午餐）`);
}
function fixture() { return [range, prior].flatMap(r => Array.from({ length: 14 }, (_, index) => file(addDays(r.start, index)))); }
class Element {
  constructor(tag = 'div', options = {}) {
    this.tag = tag; this.textContent = options.text ?? ''; this.attributes = options.attr ?? {}; this.children = []; this.listeners = {}; this.dataset = {}; this.style = {};
    this.classes = new Set((options.cls ?? '').split(' '));
    this.classList = { add: (...names) => names.forEach(n => this.classes.add(n)), remove: n => this.classes.delete(n), contains: n => this.classes.has(n) };
  }
  createEl(tag, options) { const el = new Element(tag, options); this.append(el); return el; }
  createDiv(options) { return this.createEl('div', options); }
  createSpan(options) { return this.createEl('span', options); }
  append(...els) { this.children.push(...els); }
  insertBefore(el, before) { this.children.splice(this.children.indexOf(before), 0, el); }
  get firstChild() { return this.children[0]; }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'class') value.split(' ').forEach(c => this.classes.add(c)); }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  all() { return this.children.flatMap(el => [el, ...el.all()]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector) { return this.all().filter(el => selector.startsWith('.') ? el.classes.has(selector.slice(1)) : el.tag === selector); }
}
function render(files = fixture(), selected = filter, previousRange = prior, category = false) {
  const previous = global.document;
  global.document = { createElementNS: (_, tag) => new Element(tag) };
  try {
    const root = new Element();
    const a = buildCategoryAnalysis(files, selected, previousRange, undefined, !category);
    const shown = [];
    const show = (label, records) => shown.push({ label, records });
    if (category) renderCategoryAnalysis(root, '咖啡奶茶', a, 'day', () => {}, show, () => {});
    else renderOverviewAnalysis(root, a, () => {}, show);
    return { root, a, shown };
  } finally { global.document = previous; }
}

test('overview repetition groups keep categories distinct, retain filters, and omit empty notes', () => {
  const files = fixture();
  const a = buildCategoryAnalysis(files, filter, prior, undefined, true);
  assert.deepEqual(a.repeats.map(g => g.label), ['餐饮 · 午餐', '购物 · 咖啡', '餐饮 · 咖啡']);
  assert.equal(a.summary.cents, 14 * 1900);
  assert.equal(a.comparable, true);
  const single = buildCategoryAnalysis(files, { ...filter, categories: ['餐饮'], keyword: '咖啡' }, prior, undefined, true);
  assert.equal(single.repeats.length, 1);
  assert.equal(single.summary.cents, 1400);
  files.forEach(f => f.records.forEach(r => { r.note = ''; }));
  assert.equal(buildCategoryAnalysis(files, filter, prior, undefined, true).repeats.length, 0);
});

test('overview renders all three shared analysis charts and retains source-linked repeated-project evidence', () => {
  const { root, shown } = render();
  assert.equal(root.querySelectorAll('.ledger-mono-card').length, 3);
  assert.ok(root.all().some(e => e.attributes['aria-label'] === '本期与上期单笔金额箱线图'));
  assert.ok(root.all().some(e => e.attributes['aria-label'] === '各星期按账本日期计算的日均金额'));
  const repeat = root.all().find(e => e.attributes['aria-label']?.includes('餐饮 · 午餐') && e.listeners.click);
  assert.ok(repeat);
  repeat.listeners.click();
  assert.equal(shown[0].label, '重复项目 · 餐饮 · 午餐');
  assert.equal(shown[0].records.length, 28);
  assert.ok(shown[0].records.every(r => r.category === '餐饮'));
});

test('incomplete previous periods suppress the comparison rather than inventing zero history', () => {
  const files = fixture().filter(f => f.date !== prior.end);
  const { root, a } = render(files);
  assert.equal(a.comparable, false);
  assert.ok(root.all().some(e => e.textContent.includes('只展示本期分布')));
  assert.ok(root.all().some(e => e.textContent.includes('只展示本期重复项目')));
  assert.equal(root.all().filter(e => e.tag === 'text' && e.textContent.startsWith('上期 ·')).length, 0);
});

test('short periods show observed weekdays only, with dashes and no click target for unobserved weekdays', () => {
  const { root } = render([file(range.start), file(addDays(range.start, 1))], { ...filter, range: { start: range.start, end: addDays(range.start, 1) } });
  assert.ok(root.all().some(e => e.textContent === '已记录日期的星期分布'));
  const svg = root.all().find(e => e.attributes['aria-label'] === '各星期按账本日期计算的日均金额');
  assert.equal(svg.all().filter(e => e.tag === 'text' && e.textContent === '—').length, 5);
  assert.equal(svg.all().filter(e => e.attributes.role === 'button').length, 2);
});

test('empty overview analysis does not render invented distributions or peaks', () => {
  const { root } = render([]);
  assert.equal(root.querySelectorAll('.ledger-mono-card').length, 0);
  assert.ok(root.all().some(e => e.classes.has('ledger-empty')));
});

function spendingFile(date, amounts) {
  return parseLedgerFile(`记账/${date}.md`, `---\ndate: ${date}\ntotal: ${amounts.reduce((s, x) => s + x, 0).toFixed(2)}\n---\n# 今日消费记录\n${amounts.map((amount, i) => `- 12:0${i}｜咖啡奶茶｜￥${amount.toFixed(2)}（咖啡）`).join('\n')}`);
}
function cycleFiles(current, previous) {
  return [current, previous].flatMap((r, period) => {
    const files = [];
    for (let date = r.start; date <= r.end; date = addDays(date, 1)) files.push(spendingFile(date, date === r.start ? period ? [33.68, 33.68] : [33.70, 33.70] : []));
    return files;
  });
}

test('unequal full cycles display the actual four-cent coffee increase in overview and category charts', () => {
  const { current, previous } = comparisonRanges({ start: '2026-09-15', end: '2026-10-14' }, 'salary', '2026-10-17');
  const files = cycleFiles(current, previous);
  for (const category of [false, true]) {
    const { root, a, shown } = render(files, { ...filter, range: current, categories: category ? ['咖啡奶茶'] : [] }, previous, category);
    assert.equal(a.comparable, true);
    assert.equal(a.currentDays, 30);
    assert.equal(a.previousDays, 31);
    assert.equal(a.summary.cents - a.previousSummary.cents, 4);
    assert.equal(a.decomposition.frequency + a.decomposition.ticket, 4);
    const delta = root.querySelector('.ledger-dumbbell-value');
    assert.equal(delta.textContent, '¥0.04', 'Do not inflate actual spending with a 30/31 multiplier');
    assert.ok(root.all().some(e => e.textContent.includes('本期 30 天，上期 31 天')));
    assert.ok(!root.all().some(e => e.textContent.includes('上期折算')));
    const target = root.all().find(e => e.attributes['aria-label']?.includes('本期 ¥67.40，基期 ¥67.36') && e.listeners.click);
    assert.ok(target);
    target.listeners.click();
    assert.equal(shown.at(-1).records.reduce((s, r) => s + r.cents, 0), 13476);
    assert.equal(a.currentDailyCents, 6740 / 30);
    assert.equal(a.previousDailyCents, 6736 / 31);
  }
});

test('ongoing cycles use only matching elapsed transactions, preserving category and keyword filters', () => {
  const { current, previous } = comparisonRanges({ start: '2026-10-15', end: '2026-11-14' }, 'salary', '2026-10-17');
  const files = cycleFiles(current, previous).concat([spendingFile('2026-10-18', [999]), spendingFile('2026-09-18', [999])]);
  const { a } = render(files, { ...filter, range: current, categories: ['咖啡奶茶'], keyword: '咖啡' }, previous);
  assert.equal(a.currentDays, 3);
  assert.equal(a.previousDays, 3);
  assert.equal(a.summary.cents, 6740);
  assert.equal(a.previousSummary.cents, 6736);
  const incomplete = render(files.filter(f => f.date !== previous.end), { ...filter, range: current }, previous);
  assert.equal(incomplete.a.comparable, false);
  assert.equal(incomplete.a.currentDailyCents, null);
  assert.ok(!incomplete.root.querySelector('.ledger-dumbbell-value'));
});
