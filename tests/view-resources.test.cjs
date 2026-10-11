const test = require('node:test');
const assert = require('node:assert/strict');
const { LedgerStatisticsView } = require('../dist/view.cjs');

class Element {
  constructor(options = {}) { this.value = options.value ?? ''; this.listeners = {}; this.children = []; this.isConnected = true; this.style = { setProperty() {} }; }
  createEl(tag, options = {}) { const node = new Element(options); node.tag = tag; this.children.push(node); return node; }
  createDiv(options) { return this.createEl('div', options); }
  createSpan(options) { return this.createEl('span', options); }
  addEventListener(type, handler) { this.listeners[type] = handler; }
  removeClass() {}
  empty() { this.children = []; }
  querySelectorAll() { return []; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  all() { return this.children.flatMap(child => [child, ...child.all()]); }
}

function fixture(run) {
  const previous = global.window, pending = new Map(), callbacks = new Map(); let sequence = 0;
  global.window = { setTimeout(callback, delay) { const id = ++sequence; pending.set(id, {callback,delay}); callbacks.set(id,callback); return id; }, clearTimeout(id) { pending.delete(id); } };
  const view = new LedgerStatisticsView({}, {repository:{files:new Map(),contentRevision:0,loaded:false},settings:{defaultView:'overview',defaultDatePreset:'month',excludedCategories:[]}});
  view.contentEl = new Element();
  try { return run(view, pending, callbacks); } finally { global.window = previous; }
}

test('search keeps its 180ms delay across redraws, uses the latest input and is cancelled on close', () => fixture((view, pending, callbacks) => {
  const first = new Element(); view.renderDetails(first);
  const search = first.all().find(node => node.tag === 'input'); search.value = 'old'; search.listeners.input();
  assert.equal(pending.get(1).delay, 180);
  view.render(); assert.equal(pending.has(1), true, 'A redraw must not shorten or discard a pending search');
  const replacement = new Element(); view.renderDetails(replacement);
  const next = replacement.all().find(node => node.tag === 'input'); next.value = 'latest'; next.listeners.input();
  assert.equal(pending.has(1), false); assert.equal(pending.get(2).delay, 180);
  callbacks.get(2)(); assert.equal(view.filter.keyword, 'latest');
  next.value = 'closed'; next.listeners.input();
  void view.onClose(); assert.equal(pending.has(3), false);
  callbacks.get(3)(); assert.equal(view.filter.keyword, 'latest');
  assert.equal(view.recordCache.length, 0);
}));

test('touch long press retains 560ms activation and is cancelled on redraw or close', () => fixture((view, pending, callbacks) => {
  const row = new Element(), record = { id:'record' }; let menus = 0;
  view.showRecordMenu = () => menus++;
  view.bindRecordInteractions(row, record);
  row.listeners.pointerdown({pointerType:'touch',clientX:10,clientY:20});
  assert.equal(pending.get(1).delay, 560); callbacks.get(1)(); assert.equal(menus, 1);
  row.listeners.pointerdown({pointerType:'touch',clientX:10,clientY:20}); row.listeners.pointercancel();
  assert.equal(pending.has(2), false); assert.equal(view.longPressTimers.size, 0);
  row.listeners.pointerdown({pointerType:'touch',clientX:10,clientY:20}); view.render();
  assert.equal(pending.has(3), false); assert.equal(view.longPressTimers.size, 0);
  row.listeners.pointerdown({pointerType:'touch',clientX:10,clientY:20}); void view.onClose();
  assert.equal(pending.has(4), false); callbacks.get(4)(); assert.equal(menus, 1);
  void view.onClose(); assert.equal(view.longPressTimers.size, 0);
}));
