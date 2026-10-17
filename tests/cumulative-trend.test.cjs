const test = require('node:test');
const assert = require('node:assert/strict');
const { cumulativeTrendPoints, cumulativeAverageProgress, dailySpendingAverage, normalizeTrendDateNotes } = require('../dist/core.cjs');
const { renderTrendChart, renderDonut, renderDumbbell } = require('../dist/ui.cjs');
const { alignedTrendSeries, previousTrendRange } = require('../dist/trend-comparison.cjs');
const { LedgerStatisticsView } = require('../dist/view.cjs');
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

test('average progress spreads the final total over all selected days and rejoins the actual total exactly', () => {
  const records = [record('2026-09-30', 99999), record('2026-10-02', 100), record('2026-10-04', 88888)];
  const points = cumulativeTrendPoints(records, { start: '2026-10-01', end: '2026-10-03' }, 'day');
  const progress = cumulativeAverageProgress(points);
  assert.equal(progress.days, 3);
  assert.equal(progress.dailyCents, 33);
  assert.ok(Math.abs(progress.amounts[0] - 100 / 3) < 1e-10);
  assert.ok(Math.abs(progress.amounts[1] - 200 / 3) < 1e-10);
  assert.equal(progress.amounts.at(-1), 100, 'Do not multiply the rounded 33-cent daily label to produce a 99-cent endpoint');
  assert.deepEqual(points.map(point => point.cents), [0, 100, 100], 'The reference must not modify real cumulative spending');
});

test('average progress includes leap days and handles a single day, zero spending, and empty input', () => {
  const points = cumulativeTrendPoints([record('2024-03-01', 300)], { start: '2024-02-28', end: '2024-03-01' }, 'day');
  assert.deepEqual(cumulativeAverageProgress(points), { dailyCents: 100, days: 3, amounts: [100, 200, 300] });
  assert.deepEqual(cumulativeAverageProgress(points.slice(0, 1)), { dailyCents: 0, days: 1, amounts: [0] });
  assert.deepEqual(cumulativeAverageProgress([{ ...points[0], cents: 501 }]), { dailyCents: 501, days: 1, amounts: [501] });
  assert.equal(cumulativeAverageProgress([]), null);
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
  createSpan(options) { return this.createEl('span', options); }
  all() { return this.children.flatMap(child => [child, ...child.all()]); }
  querySelectorAll(selector) { return this.all().filter(child => selector.slice(1).split('.').every(c => child.classList.contains(c))); }
}

test('a rightmost previous-period point never covers the negative difference label', () => {
  const previous = global.document;
  global.document = { createElementNS: (_, tag) => new Element(tag) };
  try {
    const root = new Element('div');
    renderDumbbell(root, [{ category: '餐饮 · 晚餐', currentCents: 19346, previousCents: 63010 }], '本期', '上期', () => {});
    const label = root.all().find(el => el.classList.contains('ledger-dumbbell-value'));
    assert.equal(label.textContent, '-¥436.64');
    const points = label.parentElement.children.filter(el => el.tag === 'circle').slice(-2);
    const edge = Math.max(...points.map(p => Number(p.attributes.cx) + Number(p.attributes.r)));
    assert.ok(Number(label.attributes.x) > edge + 4, 'Leave a visible gap beyond the circle edge, even at the chart maximum');
  } finally { global.document = previous; }
});

test('both donut layouts retain a leader and percentage label for every segment, including narrow overview containers', () => {
  const previous = global.document;
  global.document = { createElementNS: (_, tag) => new Element(tag) };
  try {
    const data = [5000, 2500, 1000, 800, 500, 200].map((cents, index) => ({ category: `分类${index + 1}`, cents, count: 1, share: cents / 10000 }));
    const root = new Element('div');
    const clicked = [];
    renderDonut(root, data, label => clicked.push(label));
    const charts = root.all().filter(el => el.tag === 'svg');
    assert.equal(charts.length, 2);
    for (const svg of charts) {
      assert.equal(svg.all().filter(el => el.classList.contains('ledger-donut-label')).length, 6);
      assert.equal(svg.all().filter(el => el.classList.contains('ledger-donut-leader')).length, 6);
      assert.ok(svg.all().filter(el => el.classList.contains('ledger-donut-label')).every(el => /%$/.test(el.textContent)));
      const first = svg.all().find(el => el.classList.contains('ledger-donut-segment'));
      first.listeners.click();
      assert.equal(clicked.at(-1), '分类1');
    }
    assert.equal(root.all().filter(el => el.classList.contains('ledger-legend-item')).length, 6);
  } finally { global.document = previous; }
});

test('all three charts draw a separate previous-period dashed path in both layouts, scale it, and retain current clicks', () => {
  const previous = global.document;
  global.document = { createElementNS: (_, tag) => new Element(tag) };
  try {
    const range = { start: '2026-10-15', end: '2026-10-17' };
    const prior = previousTrendRange(range, 'salary');
    for (const type of ['line', 'bar', 'cumulative']) {
      const series = alignedTrendSeries([record('2026-10-15', 100)], [record('2026-09-15', 50000), record('2026-09-17', 60000)], range, prior, 'day', type === 'cumulative', new Set(['2026-09-15', '2026-09-17']));
      const root = new Element('div');
      const clicked = [];
      renderTrendChart(root, series.points, type, p => clicked.push(p), { comparison: series.comparison, dailyAverage: { cents: 33, days: 3 }, dateNotes: { '2026-10-15': '保留备注' } });
      const charts = root.all().filter(el => el.tag === 'svg');
      assert.equal(charts.length, 2);
      assert.ok(root.all().some(el => el.classList.contains('ledger-trend-previous-key') && el.textContent.includes('2026-09-15')));
      for (const svg of charts) {
        const line = svg.all().find(el => el.classList.contains('ledger-trend-previous-line'));
        assert.equal(line.attributes['stroke-dasharray'], '8 4');
        assert.equal(line.attributes.stroke, '#66838B');
        assert.equal((line.attributes.d.match(/M/g) ?? []).length, type === 'cumulative' ? 1 : 2, 'Never bridge the missing date');
        assert.ok(Number(svg.attributes['data-axis-max']) >= 50000);
        assert.ok(svg.all().some(el => el.classList.contains('ledger-trend-average')));
        const hit = svg.all().find(el => el.classList.contains('ledger-trend-hit-target'));
        assert.match(hit.attributes['aria-label'], /上期 2026-09-15：¥500.00/);
        hit.listeners.click({ preventDefault() {}, stopPropagation() {} });
        assert.equal(clicked.at(-1), series.points[0], 'Comparison must not hijack the current period drilldown or note editor');
      }
    }
  } finally { global.document = previous; }
});

test('the view applies identical category, accounting-scope, and keyword filters to the previous series', () => {
  const previous = global.document;
  global.document = { createElementNS: (_, tag) => new Element(tag) };
  try {
    const records = date => [
      { date, cents: 1000, category: '餐饮', note: '午饭' },
      { date, cents: 2000, category: '餐饮', note: '晚饭' },
      { date, cents: 3000, category: '购物', note: '午饭' },
      { date, cents: 4000, category: '债务/还款', note: '午饭' }
    ].map((r, index) => ({ id: `${date}-${index}`, path: `${date}.md`, time: '12:00', line: index, raw: '', ...r }));
    const files = ['2024-11-15', '2024-12-15'].map(date => ({ date, records: records(date) }));
    const plugin = { settings: { defaultView: 'overview', defaultDatePreset: 'salary', excludedCategories: ['债务/还款'], starredRecordIds: [], trendDateNotes: {} }, repository: { files: new Map(files.map(f => [f.date, f])) } };
    const view = new LedgerStatisticsView({}, plugin);
    view.filter.range = { start: '2024-12-15', end: '2024-12-15' };
    view.filter.categories = ['餐饮'];
    view.filter.keyword = '午饭';
    for (const type of ['line', 'bar', 'cumulative']) {
      view.trendChart = type;
      const root = new Element('div');
      view.renderTrend(root);
      const prior = root.all().find(el => el.classList.contains('ledger-trend-previous'));
      assert.equal(prior.children.find(el => el.tag === 'circle').attributes['data-cents'], '1000');
      const current = root.all().find(el => el.classList.contains('ledger-trend-point'));
      assert.equal(current.attributes['data-cents'], '1000');
    }
    view.filter.categories = [];
    view.filter.keyword = '';
    const root = new Element('div');
    view.renderTrend(root);
    assert.equal(root.all().find(el => el.classList.contains('ledger-trend-previous')).children.find(el => el.tag === 'circle').attributes['data-cents'], '6000', 'Excluded debt stays excluded in the previous cycle');
  } finally { global.document = previous; }
});

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
        if (type === 'cumulative') { assert.ok(average.classList.contains('ledger-trend-average-progress')); continue; }
        assert.match(average.attributes['aria-label'], /日均支出 ¥100.00.*7 个自然日/);
        const line = average.children[0];
        assert.equal(line.attributes.stroke, '#8F8E86');
        assert.equal(line.attributes['stroke-opacity'], '0.6');
        assert.equal(line.attributes['stroke-dasharray'], '6 5');
        assert.equal(line.attributes.y1, line.attributes.y2);
        const [base, height] = svg.classList.contains('ledger-mobile-trend') ? [194, 156] : [254, 220];
        assert.ok(Math.abs(Number(line.attributes.y1) - (base - height / 8)) < 0.00001);
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

test('desktop and mobile cumulative charts draw a muted sloping average that aligns with the daily positions and final total', () => {
  const previous = global.document;
  global.document = { createElementNS: (_, tag) => new Element(tag) };
  try {
    const points = cumulativeTrendPoints([record('2026-10-02', 9000)], { start: '2026-10-01', end: '2026-10-03' }, 'day');
    const root = new Element('div');
    const clicked = [];
    renderTrendChart(root, points, 'cumulative', point => clicked.push(point));
    for (const svg of root.all().filter(el => el.tag === 'svg')) {
      const progress = svg.all().find(el => el.classList.contains('ledger-trend-average-progress'));
      assert.match(progress.attributes['aria-label'], /3 个自然日.*日均 ¥30.00/);
      const path = progress.children[0];
      assert.equal(path.attributes.stroke, '#8F8E86');
      assert.equal(path.attributes['stroke-opacity'], '0.6');
      assert.equal(path.attributes['stroke-dasharray'], '6 5');
      const coords = path.attributes.d.match(/-?\d+(?:\.\d+)?/g).map(Number);
      const targets = svg.all().filter(el => el.classList.contains('ledger-trend-hit-target'));
      const [base, height] = svg.classList.contains('ledger-mobile-trend') ? [194, 156] : [254, 220];
      for (let index = 0; index < 3; index++) {
        assert.ok(Math.abs(coords[index * 2] - Number(targets[index].attributes.cx)) < 0.00001);
        assert.ok(Math.abs(coords[index * 2 + 1] - (base - height * 0.9 * (index + 1) / 3)) < 0.00001);
      }
      assert.equal(coords.at(-1), Number(targets.at(-1).attributes.cy));
      targets[1].listeners.click({ preventDefault() {}, stopPropagation() {} });
      assert.equal(clicked.at(-1), points[1], 'The reference line preserves the original note interaction');
    }
  } finally { global.document = previous; }
});

test('marked points preview literal multiline notes in the hover tooltip and keep previews within the chart edges', () => {
  const previous = global.document;
  global.document = { createElementNS: (_, tag) => new Element(tag) };
  try {
    const points = cumulativeTrendPoints([record('2026-10-01', 5000), record('2026-10-03', 3000)], { start: '2026-10-01', end: '2026-10-03' }, 'day');
    const root = new Element('div');
    const note = '聚餐\n<script>仅文字</script>';
    renderTrendChart(root, points, 'cumulative', () => {}, { dateNotes: { '2026-10-01': note, '2026-10-03': '长备注'.repeat(200) } });
    for (const svg of root.all().filter(el => el.tag === 'svg')) {
      const groups = svg.all().filter(el => el.classList.contains('ledger-trend-point'));
      const tooltip = groups[0].all().find(el => el.classList.contains('ledger-trend-note-tooltip'));
      assert.ok(tooltip, 'The existing hover surface must contain the note without opening a modal');
      assert.deepEqual(tooltip.all().filter(el => el.tag === 'tspan').map(el => el.textContent), note.split('\n'));
      assert.ok(!groups[1].all().some(el => el.classList.contains('ledger-trend-note-tooltip')), 'Unannotated points keep the compact amount tooltip');
      const last = groups[2].all().find(el => el.classList.contains('ledger-trend-note-tooltip'));
      assert.ok(last.all().some(el => el.textContent === '…点击查看完整备注'));
      const chartWidth = Number(svg.attributes.viewBox.split(' ')[2]);
      const chartHeight = Number(svg.attributes.viewBox.split(' ')[3]);
      for (const tip of [tooltip, last]) {
        const rect = tip.children[0].attributes;
        assert.ok(Number(rect.x) >= 0 && Number(rect.x) + Number(rect.width) <= chartWidth);
        assert.ok(Number(rect.y) >= 0 && Number(rect.y) + Number(rect.height) <= chartHeight);
      }
    }
  } finally { global.document = previous; }
});

test('weekend dots use the real date on both layouts, including missing dates and a weekend peak', () => {
  const previous = global.document;
  global.document = { createElementNS: (_, tag) => new Element(tag) };
  try {
    const points = ['2026-09-04', '2026-09-05', '2026-09-07', '2026-09-12'].map((date, index) => ({ key: date, start: date, end: date, label: date.slice(5), cents: (index + 1) * 100, count: 1 }));
    const root = new Element('div');
    renderTrendChart(root, points, 'line', () => {});
    for (const svg of root.all().filter(el => el.tag === 'svg')) {
      const groups = svg.all().filter(el => el.classList.contains('ledger-trend-point'));
      for (let index = 0; index < 4; index++) {
        const dot = groups[index].all().find(el => el.classList.contains('ledger-trend-dot'));
        const hit = groups[index].all().find(el => el.classList.contains('ledger-trend-hit-target'));
        const weekend = index === 1 || index === 3;
        assert.equal(dot.attributes.fill === '#F0F0EE', weekend);
        assert.equal(hit.attributes['aria-label'].includes('周末'), weekend);
      }
      const weekendPeak = groups[3].all().find(el => el.classList.contains('ledger-trend-dot'));
      assert.equal(weekendPeak.attributes.stroke, '#F5572F');
    }
    const weekly = new Element('div');
    renderTrendChart(weekly, [{ ...points[3], start: '2026-09-07', end: '2026-09-13' }], 'line', () => {});
    assert.ok(weekly.all().filter(el => el.classList.contains('ledger-trend-dot')).every(el => el.attributes.fill !== '#F0F0EE'), 'A weekly bucket is not a weekend day');
  } finally { global.document = previous; }
});

test('monthly charts use three spaced date labels and clean currency ticks without rounding source amounts', () => {
  const previous = global.document;
  global.document = { createElementNS: (_, tag) => new Element(tag) };
  try {
    const points = Array.from({ length: 30 }, (_, index) => { const date = `2026-09-${String(index + 1).padStart(2, '0')}`; return { key: date, start: date, end: date, label: date.slice(5), cents: index === 22 ? 89742 : 1000, count: 1 }; });
    const root = new Element('div');
    const clicked = [];
    renderTrendChart(root, points, 'line', point => clicked.push(point));
    const svg = root.all().find(el => el.tag === 'svg' && el.classList.contains('ledger-desktop-chart'));
    assert.equal(svg.attributes['data-axis-max'], '100000');
    assert.deepEqual(svg.all().filter(el => el.classList.contains('ledger-axis-label')).map(el => el.textContent), ['09-01', '09-16', '09-30']);
    assert.deepEqual(svg.children.filter(el => el.tag === 'text' && el.attributes['text-anchor'] === 'end').map(el => el.textContent), ['¥0', '¥250', '¥500', '¥750', '¥1,000']);
    assert.ok(svg.all().some(el => el.textContent === '¥897.42'));
    const hit = svg.all().filter(el => el.classList.contains('ledger-trend-hit-target'))[22];
    hit.listeners.click({ preventDefault() {}, stopPropagation() {} });
    assert.equal(clicked[0].cents, 89742);
  } finally { global.document = previous; }
});

test('F1 rung bars encode exact amounts with one common unit, include partial rungs, and preserve clicks on both layouts', () => {
  const previous = global.document;
  global.document = { createElementNS: (_, tag) => new Element(tag) };
  try {
    const points = [0, 12345, 89742].map((cents, index) => { const date = `2026-09-0${index + 1}`; return { key: date, start: date, end: date, label: date.slice(5), cents, count: 1 }; });
    const root = new Element('div');
    const clicked = [];
    renderTrendChart(root, points, 'bar', point => clicked.push(point), { dailyAverage: { cents: 34029, days: 3 } });
    for (const svg of root.all().filter(el => el.tag === 'svg')) {
      assert.ok(svg.classList.contains('ledger-rung-chart'));
      assert.ok(!svg.all().some(el => el.classList.contains('ledger-draw')), 'Rung bars have no connecting area outline');
      const groups = svg.all().filter(el => el.classList.contains('ledger-trend-point'));
      for (let index = 0; index < points.length; index++) {
        const rungs = groups[index].all().filter(el => el.classList.contains('ledger-trend-rung'));
        const represented = rungs.reduce((sum, rung) => sum + Number(rung.attributes['data-unit-cents']) * Number(rung.attributes['data-fraction']), 0);
        assert.ok(Math.abs(represented - points[index].cents) < 0.000001);
        assert.ok(rungs.every(rung => rung.attributes.y1 === rung.attributes.y2));
        if (index) assert.ok(rungs.some(rung => Number(rung.attributes['data-fraction']) < 1));
        groups[index].all().find(el => el.classList.contains('ledger-trend-hit-target')).listeners.click({ preventDefault() {}, stopPropagation() {} });
        assert.equal(clicked.at(-1), points[index]);
      }
      assert.ok(svg.all().some(el => el.classList.contains('ledger-trend-average')));
    }
  } finally { global.document = previous; }
});
