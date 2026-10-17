const test = require('node:test');
const assert = require('node:assert/strict');
const { LedgerStatisticsView } = require('../dist/view.cjs');
const { parseLedgerFile } = require('../dist/core.cjs');

class Element {
  constructor(tag = 'div', options = {}) {
    this.tag = tag;
    this.textContent = options.text ?? '';
    this.children = [];
    this.attributes = { ...options.attr };
    this.listeners = {};
    this.dataset = {};
    this.classes = new Set((options.cls ?? '').split(' '));
    this.style = { setProperty() {} };
  }
  createEl(tag, options) { const el = new Element(tag, options); this.children.push(el); return el; }
  createDiv(options) { return this.createEl('div', options); }
  createSpan(options) { return this.createEl('span', options); }
  createTHead() { return this.createEl('thead'); }
  createTBody() { return this.createEl('tbody'); }
  insertRow() { return this.createEl('tr'); }
  addClass(name) { this.classes.add(name); }
  removeClass(name) { this.classes.delete(name); }
  empty() { this.children = []; }
  querySelectorAll() { return []; }
  toggleClass(name, enabled) { enabled ? this.classes.add(name) : this.classes.delete(name); }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  all() { return [this, ...this.children.flatMap(el => el.all())]; }
}

function file(date, entries) {
  return parseLedgerFile(`记账/${date}.md`, `---\ndate: ${date}\ntotal: ${entries.reduce((sum, e) => sum + e[1], 0)}\n---\n# 今日消费记录\n${entries.map(([category, amount], i) => `- 12:0${i}｜${category}｜￥${amount}.00`).join('\n')}`);
}

function view() {
  const files = [file('2026-10-01', [['餐饮', 10], ['购物', 20], ['债务/还款', 100]]), file('2026-10-02', [['餐饮', 30]])];
  const v = new LedgerStatisticsView({}, { settings: { defaultView: 'overview', defaultDatePreset: 'month', excludedCategories: ['债务/还款'], starredRecordIds: [] }, repository: { files: new Map(files.map(f => [f.path, f])) } });
  v.filter.range = { start: '2026-10-01', end: '2026-10-31' };
  v.contentEl = { scrollTop: 120 };
  v.bindRecordInteractions = () => {};
  v.renderSpendingAnalysis = () => {};
  v.render = () => { v.root = new Element(); v.renderCalendar(v.root); };
  return v;
}

function displayedDates(v) {
  return v.root.all().filter(e => e.tag === 'tbody').flatMap(e => e.children.map(row => row.children[1].textContent));
}

test('calendar keeps its month and filters details to each clicked day, including empty days', () => {
  const v = view();
  v.goDetails();
  const originalRange = structuredClone(v.filter.range);
  assert.deepEqual(displayedDates(v), ['2026-10-02', '2026-10-01', '2026-10-01']);
  const clickDay = date => v.root.all().find(el => el.dataset.date === date).listeners.click();
  clickDay('2026-10-01');
  assert.equal(v.activeView, 'calendar');
  assert.deepEqual(v.filter.range, originalRange);
  assert.deepEqual(displayedDates(v), ['2026-10-01', '2026-10-01']);
  assert.equal(v.root.all().filter(e => e.classes.has('ledger-calendar-day')).length, 31);
  assert.equal(v.root.all().find(e => e.classes.has('is-selected')).dataset.date, '2026-10-01');
  clickDay('2026-10-02');
  assert.deepEqual(displayedDates(v), ['2026-10-02']);
  clickDay('2026-10-03');
  assert.deepEqual(displayedDates(v), []);
  assert.equal(v.contentEl.scrollTop, 120);
  v.selectCalendarDate(null);
  assert.equal(displayedDates(v).length, 3);
});

test('day details keep category and scope filters, and month changes clear stale selection', () => {
  const v = view();
  v.filter.categories = ['餐饮'];
  v.render();
  v.selectCalendarDate('2026-10-01');
  assert.deepEqual(displayedDates(v), ['2026-10-01']);
  v.setCalendarMonth(2026, 8);
  assert.equal(v.calendarSelectedDate, null);
  assert.deepEqual(displayedDates(v), []);
  v.filter.range = { start: '2026-10-02', end: '2026-10-02' };
  v.render();
  assert.equal(v.calendarSelectedDate, '2026-10-02');
  assert.deepEqual(displayedDates(v), ['2026-10-02']);
});

test('calendar month summary follows filters and distinguishes zero and missing dates', () => {
  const v = view();
  const empty = file('2026-10-03', []);
  v.plugin.repository.files.set(empty.path, empty);
  v.filter.range = { start: '2026-10-01', end: '2026-10-01' };
  v.filter.categories = ['餐饮'];
  v.render();
  const summary = v.root.all().find(e => e.classes.has('ledger-calendar-summary'));
  assert.deepEqual(summary.all().filter(e => e.tag === 'strong').map(e => e.textContent), ['¥40.00', '2 笔']);
  const day = date => v.root.all().find(e => e.dataset.date === date);
  assert.ok(day('2026-10-03').classes.has('has-record'));
  assert.equal(day('2026-10-03').all().find(e => e.classes.has('ledger-calendar-amount')).textContent, '0.00');
  assert.ok(day('2026-10-04').classes.has('is-missing'));
  assert.equal(day('2026-10-04').all().find(e => e.classes.has('ledger-calendar-amount')).textContent, '—');
});

test('old default pages still migrate and the standalone insights page is a valid saved default', () => {
  for (const [old, expected] of [['category', 'overview'], ['trend', 'overview'], ['compare', 'overview'], ['details', 'calendar'], ['report', 'report'], ['assets', 'assets'], ['insights', 'insights']]) {
    const v = new LedgerStatisticsView({}, { settings: { defaultView: old, defaultDatePreset: 'month', excludedCategories: [] } });
    assert.equal(v.activeView, expected);
  }
  const v = view();
  const originalRange = structuredClone(v.filter.range);
  v.drillCategory('餐饮');
  assert.equal(v.activeView, 'calendar');
  assert.equal(displayedDates(v).length, 2);
  v.restoreDrillContext();
  assert.equal(v.activeView, 'overview');
  assert.deepEqual(v.filter.range, originalRange);
  assert.deepEqual(v.filter.categories, []);
  v.drillRange({ start: '2026-10-02', end: '2026-10-02' });
  assert.equal(v.activeView, 'calendar');
  assert.deepEqual(displayedDates(v), ['2026-10-02']);
});

test('insights lives behind its own first tab, independent of retained filters; leaving it aborts its pending request', () => {
  const v = view();
  v.render = LedgerStatisticsView.prototype.render;
  v.plugin.repository.loaded = true;
  v.contentEl = new Element();
  v.renderHeader = root => root.createDiv({ cls: 'header' });
  v.renderToolbar = root => root.createDiv({ cls: 'filters' });
  v.renderDrillBack = () => {};
  v.renderDiagnostics = () => {};
  v.renderOverview = root => root.createDiv({ cls: 'overview' });
  v.renderCompare = () => {};
  let financeRenders = 0, aborted = 0;
  v.renderFinanceSection = host => { financeRenders++; host.createDiv({ text: '洞察和今日预算' }); };
  v.financeController = { abort: () => aborted++ };
  v.filter.categories = ['餐饮'];
  const originalFilter = structuredClone(v.filter);
  v.activeView = 'insights';
  v.render();
  const tabs = () => v.contentEl.all().filter(el => el.attributes.role === 'tab');
  assert.deepEqual(tabs().map(el => el.textContent), ['洞察', '总览', '日历', '报告', '资产']);
  assert.equal(tabs()[0].attributes['aria-selected'], 'true');
  assert.equal(financeRenders, 1);
  assert.equal(aborted, 0, 'A retained category filter must not cancel insight refreshes');
  assert.ok(!v.contentEl.all().some(el => el.classes.has('filters') || el.classes.has('overview')));
  const children = v.contentEl.children;
  assert.ok(children.findIndex(el => el.classes.has('ledger-tabs')) < children.findIndex(el => el.classes.has('ledger-content')));
  tabs()[1].listeners.click();
  assert.equal(v.activeView, 'overview');
  assert.equal(aborted, 1);
  assert.equal(financeRenders, 1);
  assert.ok(!v.contentEl.all().some(el => el.classes.has('ledger-advisor-host')));
  assert.ok(v.contentEl.all().some(el => el.classes.has('filters')));
  assert.deepEqual(v.filter, originalFilter);
  tabs()[0].listeners.click();
  assert.equal(financeRenders, 2);
  assert.deepEqual(v.filter, originalFilter);
});

test('overview places spending trend before category statistics and keeps salary and period summaries', () => {
  const v = view();
  v.renderSalaryCycle = () => {};
  v.renderTrend = () => {};
  v.renderCategory = () => {};
  const root = new Element();
  v.renderOverview(root);
  assert.deepEqual(root.all().filter(el => el.tag === 'section').map(el => el.attributes['aria-label']), ['期间概览', '工资周期收支', '支出趋势', '分类统计', '消费分析']);
});

test('the four overview metrics open their dedicated cards without navigating or changing filters and scroll', () => {
  const v = view();
  v.renderSalaryCycle = v.renderTrend = v.renderCategory = () => {};
  v.goDetails = () => assert.fail('Summary cards must not navigate to details');
  const opened = [];
  v.openOverviewMetric = metric => opened.push(metric);
  const before = structuredClone(v.filter);
  const root = new Element();
  v.renderOverview(root);
  const metrics = root.all().filter(el => el.classes.has('ledger-metric'));
  assert.equal(metrics.length, 4);
  for (const metric of metrics) {
    assert.equal(metric.attributes['aria-haspopup'], 'dialog');
    metric.listeners.click();
  }
  assert.deepEqual(opened, ['spending', 'count', 'average', 'largest']);
  assert.deepEqual(v.filter, before);
  assert.equal(v.contentEl.scrollTop, 120);
});

test('overview arrows compare the same filters and dates, and distinguish increases, decreases and unchanged values', () => {
  for (const [previousEntries, arrows, changes] of [
    [[['餐饮', 10]], ['↑', '↑', '↑'], ['+¥40.00', '+1', '+¥20.00']],
    [[['餐饮', 30], ['购物', 30]], ['↓', '↓', '↓'], ['−¥60.00', '−1', '−¥30.00']],
    [null, [], ['¥0.00', '0', '¥0.00']]
  ]) {
    const v = view();
    v.filter.range = { start: '2026-10-01', end: '2026-10-02' };
    const previous = previousEntries
      ? [file('2026-09-01', [...previousEntries, ['债务/还款', 1000]]), file('2026-09-02', previousEntries)]
      : [file('2026-09-01', [['餐饮', 10], ['购物', 20]]), file('2026-09-02', [['餐饮', 30]])];
    previous.forEach(f => v.plugin.repository.files.set(f.path, f));
    v.renderSalaryCycle = v.renderTrend = v.renderCategory = () => {};
    const root = new Element();
    v.renderOverview(root);
    const metrics = root.all().filter(e => e.classes.has('ledger-metric'));
    assert.equal(root.all().filter(e => e.classes.has('ledger-metric-change-arrow')).length, 0);
    metrics.slice(0, 3).forEach((m, i) => {
      const delta = m.all().find(e => e.classes.has('ledger-metric-change-detail'));
      assert.equal(delta.children.at(-1).textContent, changes[i]);
      assert.ok(delta.attributes.title.includes('2026-09-01 至 2026-09-02'));
    });
    assert.deepEqual(root.all().filter(e => e.classes.has('ledger-metric-change-triangle')).map(e => e.textContent), arrows.map(a => a === '↑' ? '▲' : '▼'));
    assert.equal(root.all().find(e => e.classes.has('ledger-metric-comparison-note')).textContent, '2026-09-01 至 2026-09-02');
    assert.equal(metrics[2].all().find(e => e.classes.has('ledger-metric-value')).children.at(-1).textContent, '¥30.00', 'Show the current daily amount, not the delta');
    assert.ok(!metrics[3].all().some(e => e.classes.has('ledger-metric-change-detail')), 'Keep the largest transaction free of an unrelated change marker');
  }
});

test('overview does not invent decreases when the previous ledger or current dates are missing', () => {
  for (const missingCurrent of [false, true]) {
    const v = view();
    v.filter.range = { start: '2026-10-01', end: '2026-10-02' };
    if (missingCurrent) {
      v.plugin.repository.files.delete('记账/2026-10-02.md');
      for (const day of ['2026-09-01', '2026-09-02']) {
        const f = file(day, [['餐饮', 10]]); v.plugin.repository.files.set(f.path, f);
      }
    }
    v.renderSalaryCycle = v.renderTrend = v.renderCategory = () => {};
    const root = new Element();
    v.renderOverview(root);
    assert.equal(root.all().filter(e => e.classes.has('ledger-metric-change-arrow')).length, 0);
    assert.equal(root.all().filter(e => e.classes.has('ledger-metric-change-triangle')).length, 0);
    assert.equal(root.all().filter(e => e.classes.has('ledger-metric-change-detail') && e.attributes['aria-label'] === '暂无可比记录' && e.children.at(-1).textContent === '—').length, 3);
  }
});
