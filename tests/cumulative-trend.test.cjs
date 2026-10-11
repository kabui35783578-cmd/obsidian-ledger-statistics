const test = require('node:test');
const assert = require('node:assert/strict');
const { cumulativeTrendPoints } = require('../dist/core.cjs');
const { renderTrendChart } = require('../dist/ui.cjs');
const record = (date, cents) => ({ date, cents });

test('daily accumulation sums multiple transactions, carries missing days, and starts at the selected range', () => {
  const records = [record('2026-10-02', 3000), record('2026-09-30', 9999), record('2026-10-01', 2000), record('2026-10-01', 3000), record('2026-10-05', 9999)];
  const points = cumulativeTrendPoints(records, { start: '2026-10-01', end: '2026-10-04' }, 'day');
  assert.deepEqual(points.map(p => p.cents), [5000, 8000, 8000, 8000]);
  assert.deepEqual(points.map(p => p.count), [2, 3, 3, 3]);
  assert.deepEqual(points.map(p => [p.start, p.end]), ['01', '02', '03', '04'].map(day => ['2026-10-01', `2026-10-${day}`]));
  assert.deepEqual(records.map(r => r.cents), [3000, 9999, 2000, 3000, 9999]);
});

test('leading dates start at zero and cent values remain exact', () => {
  const points = cumulativeTrendPoints([record('2026-02-28', 501), record('2026-03-01', 33)], { start: '2026-02-27', end: '2026-03-01' }, 'day');
  assert.deepEqual(points.map(p => p.cents), [0, 501, 534]);
  assert.deepEqual(points.map(p => p.count), [0, 1, 2]);
});

test('weekly and monthly accumulation clip partial buckets and drill into the entire cumulative range', () => {
  const records = [record('2026-09-30', 5000), record('2026-10-01', 3000), record('2026-10-05', 2000)];
  const range = { start: '2026-09-30', end: '2026-10-06' };
  for (const unit of ['week', 'month']) {
    const points = cumulativeTrendPoints(records, range, unit);
    assert.deepEqual(points.map(p => p.cents), unit === 'week' ? [8000, 10000] : [5000, 10000]);
    assert.equal(points[0].start, range.start);
    assert.equal(points.at(-1).start, range.start);
    assert.equal(points.at(-1).end, range.end);
    assert.equal(points.at(-1).count, records.length);
  }
});

test('an empty or invalid range has no invented cumulative series', () => {
  const records = [record('2026-10-01', 5000)];
  for (const range of [
    { start: '2026-10-02', end: '2026-10-04' },
    { start: '2026-10-04', end: '2026-10-01' },
    { start: '2026-02-30', end: '2026-03-01' }
  ]) assert.deepEqual(cumulativeTrendPoints(records, range, 'day'), []);
});

class Element {
  constructor(tag, options = {}) {
    this.tag = tag; this.textContent = options.text ?? ''; this.attributes = {}; this.children = []; this.style = {}; this.listeners = {};
    const classes = new Set((options.cls ?? '').split(' ').filter(Boolean));
    this.classList = { add: (...names) => names.forEach(n => classes.add(n)), remove: n => classes.delete(n), contains: n => classes.has(n) };
  }
  setAttribute(name, value) { this.attributes[name] = value; if (name === 'class') value.split(' ').forEach(c => this.classList.add(c)); }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  append(...children) { children.forEach(child => { child.parentElement = this; this.children.push(child); }); }
  insertBefore(child, before) { child.parentElement = this; this.children.splice(this.children.indexOf(before), 0, child); }
  get firstChild() { return this.children[0]; }
  createEl(tag, options) { const child = new Element(tag, options); this.append(child); return child; }
  createDiv(options) { return this.createEl('div', options); }
  all() { return this.children.flatMap(child => [child, ...child.all()]); }
  querySelectorAll(selector) { return this.all().filter(child => selector.slice(1).split('.').every(c => child.classList.contains(c))); }
}

test('cumulative charts share the native style, label totals, and preserve desktop and mobile evidence clicks', () => {
  const previous = global.document;
  global.document = { createElementNS: (_, tag) => new Element(tag) };
  try {
    const points = cumulativeTrendPoints([record('2026-10-01', 5000), record('2026-10-02', 3000)], { start: '2026-10-01', end: '2026-10-03' }, 'day');
    const root = new Element('div');
    const clicked = [];
    renderTrendChart(root, points, 'cumulative', point => clicked.push(point));
    assert.ok(root.children[0].classList.contains('ledger-mono-card'));
    assert.ok(root.all().some(el => el.tag === 'h3' && el.textContent === '累计支出 · ¥80.00'));
    const charts = root.all().filter(el => el.tag === 'svg');
    assert.equal(charts.length, 2);
    for (const svg of charts) {
      assert.ok(svg.attributes['aria-label'].includes('累计支出折线图'));
      const groups = svg.all().filter(el => el.classList.contains('ledger-trend-point'));
      assert.equal(groups.filter(g => g.all().some(el => el.classList.contains('ledger-persistent-peak'))).length, 1);
      assert.ok(groups.at(-1).all().some(el => el.classList.contains('ledger-persistent-peak')));
      const target = groups[1].all().find(el => el.classList.contains('ledger-trend-hit-target'));
      assert.ok(target.attributes['aria-label'].includes('累计 ¥80.00'));
      const event = { preventDefault() {}, stopPropagation() {} };
      const before = clicked.length;
      target.listeners.click(event);
      if (svg.classList.contains('ledger-mobile-trend')) {
        assert.equal(clicked.length, before);
        assert.ok(groups[1].classList.contains('is-active'));
        target.listeners.click(event);
      }
      assert.equal(clicked.at(-1), points[1]);
      assert.deepEqual([clicked.at(-1).start, clicked.at(-1).end], ['2026-10-01', '2026-10-02']);
    }
  } finally { global.document = previous; }
});
