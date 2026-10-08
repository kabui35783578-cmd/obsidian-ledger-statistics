const test = require('node:test');
const assert = require('node:assert/strict');
class Element {
  constructor(tag = 'div', options = {}) { this.tag = tag; this.children = []; this.listeners = {}; this.style = {}; this.attributes = {}; this.value = options.value ?? ''; this.textContent = options.text ?? ''; this.disabled = false; }
  createEl(tag, options) { const child = new Element(tag, options); this.children.push(child); child.parentElement = this; return child; }
  createDiv(options) { return this.createEl('div', options); }
  createSpan(options) { return this.createEl('span', options); }
  setAttribute(key, value) { this.attributes[key] = value; }
  setText(text) { this.textContent = text; }
  addClass() {}
  empty() { this.children = []; }
  addEventListener(key, handler) { this.listeners[key] = handler; }
  querySelector(tag) { return this.all().find(e => e.tag === tag); }
  all() { return [this, ...this.children.flatMap(e => e.all())]; }
}
class Modal {
  constructor() { this.modalEl = new Element(); this.contentEl = new Element(); Modal.last = this; }
  setTitle(title) { this.title = title; }
  open() { this.onOpen(); }
  close() { this.closed = true; this.onClose(); }
}
global.__ledgerTestModal = Modal;
const { AssetPanel } = require('../dist/asset-ui.cjs');
const a = require('../dist/assets.cjs');
function plugin() {
  const state = a.emptyAssets();
  state.accounts.push({ id: 'i', name: '投资', kind: 'investment', balanceCents: 0, baselineAt: new Date().toISOString(), includedEventIds: [], includedRecordIds: [] });
  return { settings: { assets: state }, repository: { files: new Map() }, updateAssets: async change => change(state), assetSnapshot: () => a.buildAssetSnapshot(state, []), refreshAssetQuotes: async () => {}, lookupAssetQuote: async (kind, code) => ({ key: a.quoteKey(kind,code), name: '测试基金', price: '1.25', asOf: new Date().toISOString(), fetchedAt: new Date().toISOString() }) };
}
function field(modal, name) { return modal.contentEl.all().find(e => e.attributes['aria-label'] === name); }
async function submit(modal) { modal.contentEl.querySelector('form').listeners.submit({ preventDefault() {} }); await new Promise(resolve => setImmediate(resolve)); }
test('holding form needs only code and current value and derives name and shares from quote', async () => {
  const p = plugin(); p.refreshAssetQuotes = () => new Promise(() => {});
  new AssetPanel(p).holdingForm(); const modal = Modal.last;
  field(modal, '类型').value = 'fund'; field(modal, '代码').value = '000001'; field(modal, '当前金额（元）').value = '123.45';
  const fields = modal.contentEl.all().filter(e => e.tag === 'input');
  assert.equal(fields.length, 2);
  await submit(modal);
  assert.equal(modal.closed, true); assert.equal(p.settings.assets.holdings.length, 1);
  assert.equal(p.assetSnapshot().accounts[0].cents, 12345); assert.equal(p.settings.assets.holdings[0].name, '测试基金'); assert.equal(p.settings.assets.holdings[0].quantity, '98.76');
});
test('investment account creation and subsequent balance edits change totals immediately', async () => {
  const p = plugin(), panel = new AssetPanel(p);
  panel.accountForm(); let modal = Modal.last;
  field(modal, '账户名称').value = '证券账户'; field(modal, '类别').value = 'investment'; field(modal, '当前金额（元）').value = '500';
  await submit(modal);
  assert.equal(modal.closed, true); const account = p.settings.assets.accounts[1];
  assert.equal(account.balanceCents, 50000); assert.equal(a.assetTotals(p.assetSnapshot()).assetsCents, 50000);
  panel.accountForm(account); modal = Modal.last;
  field(modal, '类别').value = 'investment'; field(modal, '待分配金额（元）').value = '800';
  await submit(modal); assert.equal(account.balanceCents, 80000);
});
test('save failure remains visible and allows retry without claiming success', async () => {
  const p = plugin(); let fail = true;
  p.updateAssets = async change => { if (fail) throw new Error('磁盘写入失败'); change(p.settings.assets); };
  new AssetPanel(p).holdingForm(); const modal = Modal.last;
  field(modal, '类型').value = 'fund'; field(modal, '代码').value = '000001'; field(modal, '当前金额（元）').value = '100';
  await submit(modal);
  assert.ok(!modal.closed); assert.equal(p.settings.assets.holdings.length, 0);
  assert.ok(modal.contentEl.all().some(e => e.textContent === '磁盘写入失败'));
  const save = modal.contentEl.all().find(e => e.tag === 'button' && e.type === 'submit');
  assert.equal(save.disabled, false); assert.equal(save.textContent, '添加');
  fail = false; await submit(modal); assert.equal(modal.closed, true);
});
