const test = require('node:test');
const assert = require('node:assert/strict');
const { LedgerStatisticsView } = require('../dist/view.cjs');

class Element {
  constructor(tag = 'div', options = {}, parent = null) {
    this.tag = tag;
    this.textContent = options.text ?? '';
    this.value = options.value ?? '';
    this.classes = new Set((options.cls ?? '').split(' '));
    this.children = [];
    this.listeners = {};
    this.parent = parent;
    this.ownerDocument = parent?.ownerDocument ?? { activeElement: null };
  }
  createEl(tag, options) { const el = new Element(tag, options, this); this.children.push(el); return el; }
  createDiv(options) { return this.createEl('div', options); }
  createSpan(options) { return this.createEl('span', options); }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  all() { return this.children.flatMap(el => [el, ...el.all()]); }
  matches(selector) { return selector.split(',').some(s => s.trim().startsWith('.') ? this.classes.has(s.trim().slice(1)) : this.tag === s.trim()); }
  querySelectorAll(selector) { return this.all().filter(el => el.matches(selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector); }
  contains(el) { return this.all().includes(el); }
  focus(options) { assert.deepEqual(options, { preventScroll: true }); this.ownerDocument.activeElement = this; }
  empty() { this.children = []; this.scrollRoot.scrollTop = 0; }
}

function fixture() {
  const v = new LedgerStatisticsView({}, {
    settings: { defaultView: 'overview', defaultDatePreset: 'month', excludedCategories: [] },
    repository: { files: new Map() }
  });
  v.contentEl = { scrollTop: 2400 };
  v.render = () => assert.fail('Changing an overview control must not rebuild the page');
  const body = new Element();
  body.scrollRoot = v.contentEl;
  return { v, body };
}

function change(v, body, label, value) {
  const select = body.querySelectorAll('.ledger-field').find(el => el.querySelector('span').textContent === label).querySelector('select, input');
  body.ownerDocument.activeElement = select;
  const before = v.contentEl.scrollTop;
  select.value = value;
  select.listeners.change();
  assert.equal(v.contentEl.scrollTop, before, 'Restore scroll even if rebuilding the module clamps it');
  const replacement = body.querySelectorAll('.ledger-field').find(el => el.querySelector('span').textContent === label).querySelector('select, input');
  assert.equal(replacement.value, value);
  assert.equal(body.ownerDocument.activeElement, replacement, 'Keep keyboard focus on the chosen control');
}

test('category display and sorting change in place at the current scroll position', () => {
  const { v, body } = fixture();
  v.renderCategory(body);
  for (const mode of ['donut', 'table', 'bar']) {
    change(v, body, '显示', mode);
    assert.equal(v.categoryChart, mode);
    if (mode !== 'donut') {
      for (const sort of ['count', 'amount']) { change(v, body, '排序', sort); assert.equal(v.categorySort, sort); }
    }
  }
});

test('trend graph and aggregation change in place at the current scroll position', () => {
  const { v, body } = fixture();
  v.renderTrend(body);
  for (const graph of ['bar', 'line', 'cumulative']) {
    change(v, body, '图形', graph);
    assert.equal(v.trendChart, graph);
    assert.equal(body.querySelectorAll('.ledger-mono-card').length, 1, 'Render only the selected trend chart');
  }
  assert.equal(body.querySelectorAll('.ledger-field').length, 1, 'Cumulative spending always uses daily points');
  change(v, body, '图形', 'line');
  for (const unit of ['day', 'week', 'month', 'auto']) { change(v, body, '汇总', unit); assert.equal(v.trendUnit, unit); }
});

test('comparison mode and all four dates change in place without navigating to the top', () => {
  const { v, body } = fixture();
  v.renderCompare(body);
  change(v, body, '比较方式', 'custom');
  for (const [label, range, key, value] of [
    ['本期开始', 'customCurrent', 'start', '2026-10-01'],
    ['本期结束', 'customCurrent', 'end', '2026-10-11'],
    ['基期开始', 'customPrevious', 'start', '2026-09-01'],
    ['基期结束', 'customPrevious', 'end', '2026-09-11']
  ]) { change(v, body, label, value); assert.equal(v[range][key], value); }
  change(v, body, '比较方式', 'auto');
  assert.equal(v.compareMode, 'auto');
});

test('saving a trend note refreshes only its chart and retains vertical and horizontal scroll', () => {
  const { v, body } = fixture();
  v.trendChart = 'cumulative';
  v.contentEl.querySelector = selector => selector === '.ledger-trend-host' ? body : null;
  const addScrollers = () => {
    for (const cls of ['ledger-trend-desktop-scroll', 'ledger-mobile-trend-scroll']) body.createDiv({ cls }).scrollLeft = 0;
  };
  addScrollers();
  body.children[0].scrollLeft = 780; body.children[1].scrollLeft = 340;
  v.renderTrend = addScrollers;
  v.refreshTrendDateNotes();
  assert.equal(v.contentEl.scrollTop, 2400);
  assert.deepEqual(body.children.map(el => el.scrollLeft), [780, 340]);
});

test('salary history navigation stays in place, returns to the live cycle and prevents future periods', () => {
  const { v, body } = fixture();
  v.plugin.settings.salaryCents = 0;
  v.plugin.settings.salaryCycles = [{ cycleStart: require('../dist/core.cjs').salaryDayRange(new Date(), 1).start, salaryCents: 0, salarySource: 'saved', calibration: null, note: '' }];
  v.allRecords = () => [];
  v.renderSalaryCycle(body);
  const firstLabel = body.querySelector('.ledger-salary-cycle-label').textContent;
  const button = text => body.querySelectorAll('button').find(b => b.textContent === text);
  assert.equal(button('下一周期').disabled, true);
  button('上一周期').listeners.click();
  assert.match(body.querySelector('.ledger-salary-cycle-label').textContent, /历史周期/);
  const fixed = v.selectedSalaryCycleStart;
  const render = v.render;
  v.render = () => {};
  v.refreshDate(new Date(Date.now() + 86400000 * 35));
  v.render = render;
  assert.equal(v.selectedSalaryCycleStart, fixed, 'an explicitly selected historical cycle stays fixed');
  button('回到本周期').listeners.click();
  assert.equal(body.querySelector('.ledger-salary-cycle-label').textContent, firstLabel);
  assert.equal(v.selectedSalaryCycleStart, null);
  assert.equal(v.contentEl.scrollTop, 2400);
});

test('top salary filter and its arrows select the same cycle as the waterfall', () => {
  const { v, body } = fixture();
  v.render = () => {};
  v.plugin.settings.salaryCents = 0;
  v.allRecords = () => [];
  v.selectedSalaryCycleStart = '2025-01-15';
  v.applyPreset('salary');
  v.shiftPeriod(1);
  v.renderSalaryCycle(body);
  assert.equal(v.selectedSalaryCycleStart, null);
  assert.ok(body.querySelector('.ledger-salary-cycle-label').textContent.startsWith(v.filter.range.start));
  assert.match(body.querySelector('.ledger-salary-cycle-label').textContent, /历史周期/);
});
