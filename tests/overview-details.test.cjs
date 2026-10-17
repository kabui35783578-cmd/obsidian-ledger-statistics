const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOverviewDetails, OverviewMetricModal } = require('../dist/overview-details.cjs');
const { parseLedgerFile, summarize, filteredRecords } = require('../dist/core.cjs');
const filter = () => ({ range: { start: '2026-10-01', end: '2026-10-04' }, scope: 'consumption', excludedCategories: ['债务/还款'], categories: [], keyword: '' });
const file = (date, entries) => parseLedgerFile(`记账/${date}.md`, `---\ndate: ${date}\ntotal: ${entries.reduce((s, e) => s + e[1], 0)}\n---\n# 今日消费记录\n${entries.map(([category, amount, note], i) => `- 12:${String(i).padStart(2, '0')}｜${category}｜￥${amount.toFixed(2)}｜${note || '备注'}`).join('\n')}`);
const fixture = () => [file('2026-09-30', [['餐饮', 999]]), file('2026-10-01', [['餐饮', 10.01, '午饭'], ['购物', 200, '衣服'], ['债务/还款', 500, '还款']]), file('2026-10-02', [['餐饮', 20.02, '午饭'], ['餐饮', 30, '晚饭']]), file('2026-10-03', [])];

test('overview cards use the exact same range, scope, categories, keyword, and recorded-day denominator as the headline', () => {
  const files = fixture();
  const before = structuredClone(files);
  for (const extra of [{}, { categories: ['餐饮'] }, { keyword: '午饭' }, { scope: 'all' }]) {
    const f = { ...filter(), ...extra };
    const details = buildOverviewDetails(files, f);
    assert.deepEqual(details.stats, summarize(files, filteredRecords(files, f), f.range));
    assert.equal(details.stats.recordedDays, 3, 'A known empty ledger is included in the denominator');
    assert.equal(details.missingDays, 1, 'A missing ledger is distinct from a known zero day');
    assert.equal(details.days.at(-1).label, '2026-10-03');
    assert.equal(details.days.at(-1).cents, 0);
    assert.ok(!details.ranked.some(r => r.date === '2026-09-30'));
    if (f.scope === 'consumption') assert.ok(!details.categories.some(g => g.label === '债务/还款'));
  }
  assert.deepEqual(files, before, 'Sorting must not mutate repository records');
});

class Element {
  constructor(tag = 'div', options = {}) {
    this.tag = tag; this.textContent = options.text ?? ''; this.attributes = options.attr ?? {}; this.dataset = {}; this.children = []; this.listeners = {}; this.classes = new Set((options.cls ?? '').split(' '));
  }
  createEl(tag, options) { const child = new Element(tag, options); this.children.push(child); return child; }
  createDiv(options) { return this.createEl('div', options); }
  createSpan(options) { return this.createEl('span', options); }
  addClass(...classes) { classes.forEach(c => this.classes.add(c)); }
  empty() { this.children = []; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  all() { return this.children.flatMap(child => [child, ...child.all()]); }
  byClass(cls) { return this.all().filter(e => e.classes.has(cls)); }
}
function modal(metric, files = fixture(), f = filter()) {
  const m = new OverviewMetricModal({}, metric, buildOverviewDetails(files, f), r => { m.openedRecord = r; });
  m.modalEl = new Element(); m.contentEl = new Element(); m.setTitle = title => { m.title = title; }; m.close = () => { m.closed = true; };
  m.onOpen();
  return m;
}

test('spending card lists each category separately, ranks it by total, and shows that category’s top five exact transactions', () => {
  const files = [file('2026-10-01', Array.from({ length: 7 }, (_, i) => ['餐饮', i + 1, `午饭${i}`]).concat([['购物', 200, '<script>literal</script>']]))];
  files[0].records.find(r => r.category === '购物').note = '<script>literal</script>';
  const m = modal('spending', files);
  assert.ok(m.modalEl.classes.has('ledger-dialog'));
  const groups = m.contentEl.byClass('ledger-overview-detail-category');
  assert.equal(groups.length, 2);
  assert.equal(groups[0].all().find(e => e.tag === 'h3').textContent, '购物');
  const rows = groups[1].byClass('ledger-overview-detail-record');
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map(r => r.byClass('ledger-overview-detail-amount')[0].textContent), ['¥7.00', '¥6.00', '¥5.00', '¥4.00', '¥3.00']);
  assert.ok(groups[0].all().some(e => e.textContent === '<script>literal</script>'), 'User text remains literal');
  rows[0].listeners.click();
  assert.equal(m.closed, true);
  assert.equal(m.openedRecord.cents, 700);
});

test('count card sorts by count instead of amount, with deterministic amount tie breakers', () => {
  const m = modal('count');
  const rows = m.contentEl.byClass('ledger-overview-detail-count-row');
  assert.deepEqual(rows.map(r => r.byClass('ledger-overview-detail-copy')[0].children[0].textContent), ['餐饮', '购物']);
  assert.deepEqual(rows.map(r => r.children.at(-1).textContent), ['3 笔', '1 笔']);
  assert.ok(rows[0].all().some(e => e.textContent.includes('75.0%')));
});

test('average card explains its denominator and missing dates, ranks spending days and lazily expands their top transactions', () => {
  const m = modal('average');
  const allText = m.contentEl.all().map(e => e.textContent).join('\n');
  assert.match(allText, /¥260.03 ÷ 3 个有账本的日期 = ¥86.68/);
  assert.match(allText, /1 天没有账本，未计入日均分母/);
  const days = m.contentEl.byClass('ledger-overview-detail-day');
  assert.deepEqual(days.map(d => d.byClass('ledger-overview-detail-copy')[0].children[0].textContent), ['2026-10-01', '2026-10-02', '2026-10-03']);
  assert.equal(m.contentEl.byClass('ledger-overview-detail-record').length, 0);
  days[0].open = true; days[0].listeners.toggle(); days[0].listeners.toggle();
  assert.equal(days[0].byClass('ledger-overview-detail-record').length, 2, 'Repeated toggles must not duplicate records');
  assert.equal(days[0].byClass('ledger-overview-detail-amount')[0].textContent, '¥200.00');
});

test('largest card continues the global descending ranking across pages without duplicates', () => {
  const m = modal('largest', [file('2026-10-01', Array.from({ length: 45 }, (_, i) => ['餐饮', i + 1, `记录${i}`]))]);
  const more = m.contentEl.byClass('ledger-overview-detail-more')[0];
  assert.equal(m.contentEl.byClass('ledger-overview-detail-record').length, 20);
  more.listeners.click(); more.listeners.click();
  const rows = m.contentEl.byClass('ledger-overview-detail-record');
  assert.equal(rows.length, 45);
  assert.equal(new Set(rows.map(r => r.dataset.ledgerRecordId)).size, 45);
  assert.equal(rows[0].byClass('ledger-overview-detail-amount')[0].textContent, '¥45.00');
  assert.equal(rows.at(-1).byClass('ledger-overview-detail-amount')[0].textContent, '¥1.00');
  assert.equal(rows.at(-1).byClass('ledger-overview-detail-rank')[0].textContent, '45');
  assert.equal(more.hidden, true);
});

test('empty periods and zero-spend ledgers do not invent rankings or a calculable mean', () => {
  for (const metric of ['spending', 'count', 'average', 'largest']) {
    const m = modal(metric, []);
    assert.equal(m.contentEl.byClass('ledger-overview-detail-record').length, 0);
    assert.ok(m.contentEl.all().some(e => e.classes.has('ledger-empty')));
  }
  const m = modal('average', [file('2026-10-01', [])]);
  assert.ok(m.contentEl.all().some(e => e.textContent.includes('¥0.00 ÷ 1 个有账本的日期 = ¥0.00')));
});
