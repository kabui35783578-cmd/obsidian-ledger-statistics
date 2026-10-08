const test = require('node:test');
const assert = require('node:assert/strict');
const { AssetFormModal } = require('../dist/asset-ui.cjs');
class Element {
  constructor(tag = 'div', opts = {}) { this.tag = tag; this.textContent = opts.text ?? ''; this.listeners = {}; this.children = []; this.attributes = {}; }
  createEl(tag, opts) { const child = new Element(tag, opts); this.children.push(child); return child; }
  createDiv(opts) { return this.createEl('div', opts); }
  setText(text) { this.textContent = text; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  addClass() {}
}
function modal(build) {
  const m = new AssetFormModal({ app: {} }, '测试', build); m.contentEl = new Element(); m.modalEl = new Element(); m.setTitle = () => {}; m.onOpen(); return m;
}
test('cancelling a mobile form invalidates pending work before the close animation calls onClose', async () => {
  let resolve, writes = 0;
  const response = new Promise(r => resolve = r);
  const m = modal((_, active) => async () => { await response; if (active()) writes++; });
  const form = m.contentEl.children[0]; form.listeners.submit({ preventDefault() {} });
  m.close(); resolve(); await new Promise(r => setImmediate(r)); assert.equal(writes, 0);
});
test('duplicate submits are blocked and failed requests visibly restore the save action', async () => {
  let reject, calls = 0;
  const response = new Promise((_, r) => reject = r);
  const m = modal(() => async () => { calls++; await response; }); const form = m.contentEl.children[0];
  const controls = form.children.at(-1), save = controls.children[0], error = form.children[0];
  form.listeners.submit({ preventDefault() {} }); form.listeners.submit({ preventDefault() {} });
  assert.equal(calls, 1); assert.equal(save.textContent, '处理中…'); assert.equal(save.disabled, true);
  reject(new Error('行情暂不可用')); await new Promise(r => setImmediate(r));
  assert.equal(error.textContent, '行情暂不可用'); assert.equal(save.disabled, false); assert.equal(save.textContent, '保存');
});
