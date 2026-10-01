const test = require('node:test');
const assert = require('node:assert/strict');
const { renderSalaryWaterfall } = require('../dist/ui.cjs');
const { BalanceCalibrationNoteModal } = require('../dist/management.cjs');

class Element {
  constructor(tag = 'div', options = {}) {
    this.tag = tag;
    this.textContent = options.text ?? '';
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.classes = new Set((options.cls ?? '').split(' '));
    this.classList = { add: (...names) => names.forEach(name => this.classes.add(name)) };
  }
  addClass(name) { this.classes.add(name); }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  append(...children) { this.children.push(...children); }
  prepend(child) { this.children.unshift(child); }
  createEl(tag, options) { const child = new Element(tag, options); this.append(child); return child; }
  createDiv(options) { return this.createEl('div', options); }
  createSpan(options) { return this.createEl('span', options); }
  empty() { this.children = []; }
  all() { return [this, ...this.children.flatMap(child => child.all())]; }
}

const steps = [
  { label: '周期工资', kind: 'salary', deltaCents: 600000, fromCents: 0, toCents: 600000, categories: [] },
  { label: '餐饮', kind: 'expense', deltaCents: -10000, fromCents: 600000, toCents: 590000, categories: ['餐饮'] },
  { label: '余额校准差额', kind: 'calibration', deltaCents: -400000, fromCents: 590000, toCents: 190000, categories: [] },
  { label: '实际余额', kind: 'remaining', deltaCents: 190000, fromCents: 0, toCents: 190000, categories: [] }
];

test('desktop and mobile calibration targets open notes via click, Enter and Space', () => {
  global.document = { createElementNS: (_, tag) => new Element(tag) };
  const root = new Element();
  let opened = 0;
  let category;
  const before = structuredClone(steps);
  renderSalaryWaterfall(root, steps, { start: '2026-09-15', end: '2026-10-01' }, value => { category = value; }, () => opened++);
  const targets = root.all().filter(el => el.attributes['aria-label'] === '余额校准差额，查看备注');
  assert.equal(targets.length, 2);
  for (const target of targets) {
    assert.equal(target.attributes.role, 'button');
    assert.equal(target.attributes.tabindex, '0');
    target.listeners.click();
    for (const key of ['Enter', ' ']) {
      let prevented = false;
      target.listeners.keydown({ key, preventDefault() { prevented = true; } });
      assert.equal(prevented, true);
    }
    target.listeners.keydown({ key: 'Escape' });
  }
  assert.equal(opened, 6);
  assert.equal(targets[0].children[0].tag, 'rect');
  assert.equal(targets[0].children[0].attributes.fill, 'transparent');
  const categoryTarget = root.all().find(el => el.attributes['aria-label']?.includes('打开分类明细'));
  categoryTarget.listeners.click();
  assert.equal(category, '餐饮');
  assert.deepEqual(steps, before);
  delete global.document;
});

test('note modal displays multiline text literally, rereads edits and guides users when empty', () => {
  const modal = Object.create(BalanceCalibrationNoteModal.prototype);
  modal.plugin = { settings: { balanceCalibrationNote: '还款 2000 元\n转给家人 1000 元\n<script>alert(1)</script>' } };
  modal.contentEl = new Element();
  modal.containerEl = new Element();
  modal.modalEl = new Element();
  modal.setTitle = title => { modal.title = title; };
  modal.onOpen();
  assert.equal(modal.title, '余额校准差额备注');
  assert.ok(modal.containerEl.classes.has('ledger-balance-note-container'));
  assert.ok(modal.modalEl.classes.has('ledger-balance-note-modal'));
  assert.equal(modal.contentEl.children.length, 2);
  const content = modal.contentEl.children[0];
  assert.equal(content.textContent, modal.plugin.settings.balanceCalibrationNote);
  assert.equal(content.children.length, 0);
  modal.onClose();
  assert.equal(modal.contentEl.children[0], content, 'closing must not collapse the card before dismissal finishes');
  modal.plugin.settings.balanceCalibrationNote = '已更新的资金去向';
  modal.onOpen();
  assert.equal(modal.contentEl.children[0].textContent, '已更新的资金去向');
  assert.equal(modal.contentEl.children.length, 2, 'reopening replaces rather than duplicates content');
  modal.onClose();
  modal.plugin.settings.balanceCalibrationNote = '  \n ';
  modal.onOpen();
  assert.match(modal.contentEl.children[0].textContent, /尚未填写备注/);
  assert.equal(modal.contentEl.children.length, 1, 'empty state should not repeat the settings hint');
});
