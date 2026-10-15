const test = require('node:test');
const assert = require('node:assert/strict');
const Plugin = require('../dist/main.cjs').default;
const { TrendDateNoteModal } = require('../dist/management.cjs');

test('date notes persist independently of filters, serialize writes, delete cleanly, and survive save failures', async () => {
  const p = new Plugin();
  p.settings = structuredClone(p.settings);
  p.app = { workspace: { getLeavesOfType: () => [] } };
  p.refreshViews = () => {};
  p.checkBudget = () => {};
  let writes = 0;
  p.saveData = async data => { writes++; p.saved = structuredClone(data); };
  const assetsBefore = structuredClone(p.settings.assets);
  await Promise.all([p.updateTrendDateNote('2026-10-01', '  聚餐\n家庭  '), p.updateTrendDateNote('2026-10-02', '<b>仅文字</b>')]);
  assert.deepEqual(p.saved.trendDateNotes, { '2026-10-01': '聚餐\n家庭', '2026-10-02': '<b>仅文字</b>' });
  assert.deepEqual(p.saved.assets, assetsBefore);
  await p.updateTrendDateNote('2026-10-02', '<b>仅文字</b>');
  assert.equal(writes, 2, 'Unchanged notes do not trigger saves or redraws');
  p.saveData = async () => { throw new Error('磁盘错误'); };
  await assert.rejects(p.updateTrendDateNote('2026-10-01', '不应保存'), /磁盘错误/);
  assert.equal(p.settings.trendDateNotes['2026-10-01'], '聚餐\n家庭');
  p.saveData = async data => { p.saved = structuredClone(data); };
  await p.updateTrendDateNote('2026-10-01', '   ');
  assert.deepEqual(p.saved.trendDateNotes, { '2026-10-02': '<b>仅文字</b>' });
  await assert.rejects(p.updateTrendDateNote('2026-02-30', 'bad'), /日期无效/);
});

class Element {
  constructor(tag = 'div', options = {}) {
    this.tag = tag; this.textContent = options.text ?? ''; this.value = ''; this.children = []; this.listeners = {}; this.attributes = options.attr ?? {}; this.classes = new Set();
  }
  addClass(...classes) { classes.forEach(c => this.classes.add(c)); }
  empty() { this.children = []; }
  createEl(tag, options) { const child = new Element(tag, options); this.children.push(child); return child; }
  createDiv(options) { return this.createEl('div', options); }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  focus() { this.focused = true; }
  all() { return this.children.flatMap(child => [child, ...child.all()]); }
}

test('point editor shows date and amounts with immediate input, preserves failed drafts, and rereads saved notes', async () => {
  const modal = Object.create(TrendDateNoteModal.prototype);
  modal.point = { start: '2026-10-01', end: '2026-10-02', cents: 8000 };
  modal.dailyCents = 3000;
  modal.plugin = { settings: { trendDateNotes: { '2026-10-02': '旧备注' } } };
  let fail = true;
  modal.plugin.updateTrendDateNote = async (date, note) => { if (fail) throw Error('disk'); modal.plugin.settings.trendDateNotes[date] = note; };
  modal.contentEl = new Element(); modal.modalEl = new Element(); modal.setTitle = title => modal.title = title;
  let closed = false, details = false;
  modal.close = () => { closed = true; }; modal.showRecords = () => { details = true; };
  modal.onOpen();
  assert.match(modal.title, /2026-10-02/);
  assert.ok(modal.contentEl.all().some(el => el.textContent === '¥80.00'));
  assert.ok(modal.contentEl.all().some(el => el.textContent.includes('当日支出 ¥30.00')));
  const input = modal.contentEl.all().find(el => el.tag === 'textarea');
  assert.equal(input.value, '旧备注'); assert.equal(input.focused, true);
  input.value = '新备注\n<script>literal</script>';
  const save = modal.contentEl.all().find(el => el.textContent === '保存备注');
  await save.listeners.click();
  assert.equal(closed, false); assert.equal(save.disabled, false); assert.equal(input.disabled, false);
  assert.ok(modal.contentEl.all().some(el => el.textContent.includes('保存失败')));
  fail = false;
  await save.listeners.click();
  assert.equal(closed, true);
  modal.onOpen();
  assert.equal(modal.contentEl.all().find(el => el.tag === 'textarea').value, '新备注\n<script>literal</script>');
  modal.contentEl.all().find(el => el.textContent === '查看累计明细').listeners.click();
  assert.equal(details, true);
});
