const test = require('node:test');
const assert = require('node:assert/strict');
const { cumulativeTrendPoints, dailySpendingAverage, normalizeTrendDateNotes } = require('../dist/core.cjs');
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

test('daily average includes zero-spend days, clips future records and dates, and handles leap years', () => {
  const records = [record('2026-09-30', 9999), record('2026-10-01', 5000), record('2026-10-03', 3000), record('2026-10-16', 9999)];
  assert.deepEqual(dailySpendingAverage(records, { start: '2026-10-01', end: '2026-10-31' }, '2026-10-04'), { cents: 2000, days: 4 });
  assert.deepEqual(dailySpendingAverage(records, { start: '2026-10-01', end: '2026-10-03' }, '2026-10-15'), { cents: 2667, days: 3 });
  assert.deepEqual(dailySpendingAverage([record('2024-02-29', 101)], { start: '2024-02-28', end: '2024-03-01' }, '2024-03-02'), { cents: 34, days: 3 });
  assert.deepEqual(dailySpendingAverage([], { start: '2026-10-01', end: '2026-10-01' }, '2026-10-01'), { cents: 0, days: 1 });
  assert.equal(dailySpendingAverage(records, { start: '2026-10-16', end: '2026-10-31' }, '2026-10-15'), null);
  assert.equal(dailySpendingAverage(records, { start: '2026-02-30', end: '2026-03-02' }, '2026-10-15'), null);
  assert.equal(dailySpendingAverage(records, { start: '2026-10-04', end: '2026-10-01' }, '2026-10-15'), null);
});

test('synced date notes keep literal multiline text and reject invalid data', () => {
  for (const value of [null, [], 123, 'note']) assert.deepEqual(normalizeTrendDateNotes(value), {});
  assert.deepEqual(normalizeTrendDateNotes({
    '2026-10-01': '第一行\n<script>literal</script>', '2026-02-30': 'bad', '2026-10-02': 123, '2026-10-03': '  ', '__proto__': 'bad'
  }), { '2026-10-01': '第一行\n<script>literal</script>' });
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
      assert.equal(clicked.length, before + 1, 'A single click opens the note editor on both desktop and mobile');
      assert.equal(clicked.at(-1), points[1]);
      assert.deepEqual([clicked.at(-1).start, clicked.at(-1).end], ['2026-10-01', '2026-10-02']);
    }
  } finally { global.document = previous; }
});

test('both layouts show a dashed daily mean at the correct height, including weekly totals', () => {
  const previous = global.document;
  global.document = { createElementNS: (_, tag) => new Element(tag) };
  try {
    const points = [{ key: '2026-10', start: '2026-10-01', end: '2026-10-07', label: '10-01周', cents: 70000, count: 7 }];
    for (const type of ['line', 'bar', 'cumulative']) {
      const root = new Element('div');
      renderTrendChart(root, points, type, () => {}, { dailyAverage: { cents: 10000, days: 7 }, dateNotes: { '2026-10-07': '聚餐\n家庭' } });
      const charts = root.all().filter(el => el.tag === 'svg');
      for (const svg of charts) {
        const average = svg.all().find(el => el.classList.contains('ledger-trend-average'));
        if (type !== 'line') { assert.equal(average, undefined); continue; }
        assert.match(average.attributes['aria-label'], /日均支出 ¥100.00.*7 个自然日/);
        const line = average.children[0];
        assert.equal(line.attributes['stroke-dasharray'], '6 5');
        assert.equal(line.attributes.y1, line.attributes.y2);
        const [base, height] = svg.classList.contains('ledger-mobile-trend') ? [194, 156] : [254, 220];
        assert.ok(Math.abs(Number(line.attributes.y1) - (base - height / 7)) < 0.00001);
      }
      if (type === 'cumulative') {
        assert.equal(root.all().filter(el => el.classList.contains('ledger-trend-note-marker')).length, 2);
        assert.ok(root.all().filter(el => el.classList.contains('ledger-trend-hit-target')).every(el => el.attributes['aria-label'].includes('备注：聚餐\n家庭')));
      }
    }
  } finally { global.document = previous; }
});

test('long cumulative ranges reserve space for each daily hit target instead of shrinking the year to a single screen', () => {
  const previous = global.document;
  global.document = { createElementNS: (_, tag) => new Element(tag) };
  try {
    const points = cumulativeTrendPoints([record('2026-01-01', 100)], { start: '2026-01-01', end: '2026-10-15' }, 'day');
    const root = new Element('div');
    renderTrendChart(root, points, 'cumulative', () => {});
    const desktop = root.all().find(el => el.tag === 'svg' && el.classList.contains('ledger-desktop-chart'));
    assert.equal(desktop.all().filter(el => el.classList.contains('ledger-trend-hit-target')).length, 288);
    assert.ok(Number.parseFloat(desktop.style.minWidth) >= points.length * 34);
    assert.ok(desktop.parentElement.classList.contains('ledger-trend-desktop-scroll'));
  } finally { global.document = previous; }
});
