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
    this.classList = { toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name) };
    this.ownerDocument = { defaultView: null };
    this.style = { setProperty: (name, value) => { this.style[name] = value; } };
  }
  addClass(...classes) { classes.forEach(c => this.classes.add(c)); }
  empty() { this.children = []; }
  createEl(tag, options) { const child = new Element(tag, options); this.children.push(child); return child; }
  createDiv(options) { return this.createEl('div', options); }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  focus() { this.focused = true; }
  blur() { this.focused = false; }
  all() { return this.children.flatMap(child => [child, ...child.all()]); }
}

function noteModal() {
  const modal = Object.create(TrendDateNoteModal.prototype);
  modal.date = '2026-10-02';
  modal.plugin = { settings: { trendDateNotes: { '2026-10-02': '旧备注' } } };
  modal.contentEl = new Element(); modal.modalEl = new Element(); modal.containerEl = new Element(); modal.setTitle = title => modal.title = title;
  modal.close = () => assert.fail('Completing a note should leave the readable card open');
  return modal;
}

test('date card opens on the note without a keyboard or amounts; Done dismisses input, preserves failed drafts, and shows saved text', async () => {
  const modal = noteModal();
  let fail = true;
  let input;
  modal.plugin.updateTrendDateNote = async (date, note) => {
    assert.equal(input.focused, false, 'Dismiss the keyboard before awaiting storage');
    if (fail) throw Error('disk');
    modal.plugin.settings.trendDateNotes[date] = note;
  };
  let details = false;
  modal.showRecords = () => { details = true; };
  modal.onOpen();
  assert.equal(modal.title, '2026-10-02 · 备注');
  assert.ok(!modal.contentEl.all().some(el => /¥|累计|至/.test(el.textContent)));
  input = modal.contentEl.all().find(el => el.tag === 'textarea');
  const note = modal.contentEl.all().find(el => el.textContent === '旧备注');
  const button = text => modal.contentEl.all().find(el => el.tag === 'button' && el.textContent === text);
  assert.equal(input.value, '旧备注'); assert.equal(input.hidden, true); assert.ok(!input.focused);
  assert.equal(note.hidden, false);
  button('编辑').listeners.click();
  assert.equal(input.hidden, false); assert.equal(input.focused, true);
  input.value = '新备注\n<script>literal</script>';
  const save = button('完成');
  assert.equal(save.hidden, false);
  await save.listeners.click();
  assert.equal(save.disabled, false); assert.equal(input.disabled, false); assert.equal(input.hidden, false);
  assert.equal(input.value, '新备注\n<script>literal</script>');
  assert.ok(modal.contentEl.all().some(el => el.textContent.includes('保存失败')));
  fail = false;
  await save.listeners.click();
  assert.equal(input.hidden, true); assert.equal(note.hidden, false);
  assert.equal(note.textContent, '新备注\n<script>literal</script>');
  modal.onOpen();
  assert.equal(modal.contentEl.all().find(el => el.tag === 'textarea').value, '新备注\n<script>literal</script>');
  button('明细').listeners.click();
  assert.equal(details, true);
});

test('cancel returns to the saved note, empty notes can be edited, and closing detaches viewport listeners', () => {
  const modal = noteModal();
  const listeners = {};
  const viewport = { height: 360, offsetTop: 200, addEventListener: (name, fn) => { listeners[name] = fn; }, removeEventListener: name => { delete listeners[name]; } };
  modal.contentEl.ownerDocument.defaultView = { visualViewport: viewport };
  modal.onOpen();
  assert.equal(modal.containerEl.style['--ledger-note-viewport-height'], '360px');
  viewport.height = 320; viewport.offsetTop = 240; listeners.resize();
  assert.equal(modal.containerEl.style['--ledger-note-viewport-height'], '320px');
  assert.equal(modal.containerEl.style['--ledger-note-viewport-top'], '240px');
  const button = text => modal.contentEl.all().find(el => el.textContent === text);
  const input = modal.contentEl.all().find(el => el.tag === 'textarea');
  button('编辑').listeners.click(); input.value = '放弃的修改';
  button('取消').listeners.click();
  assert.equal(input.hidden, true); assert.equal(input.focused, false); assert.equal(input.value, '旧备注');
  delete modal.plugin.settings.trendDateNotes[modal.date];
  modal.onOpen();
  assert.ok(modal.contentEl.all().some(el => el.textContent.includes('还没有备注')));
  button('编辑').listeners.click();
  modal.onClose();
  assert.deepEqual(listeners, {});
  assert.equal(modal.contentEl.all().find(el => el.tag === 'textarea').focused, false);
});
