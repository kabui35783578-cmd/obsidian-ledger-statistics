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
  }
  createEl(tag, options) { const el = new Element(tag, options); this.children.push(el); return el; }
  createDiv(options) { return this.createEl('div', options); }
  createSpan(options) { return this.createEl('span', options); }
  createTHead() { return this.createEl('thead'); }
  createTBody() { return this.createEl('tbody'); }
  insertRow() { return this.createEl('tr'); }
  addClass(name) { this.classes.add(name); }
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

test('old default pages migrate to the four supported pages and drills can return to overview', () => {
  for (const [old, expected] of [['category', 'overview'], ['trend', 'overview'], ['compare', 'overview'], ['details', 'calendar'], ['report', 'report'], ['assets', 'assets']]) {
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
