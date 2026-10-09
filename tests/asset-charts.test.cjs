const test = require('node:test');
const assert = require('node:assert/strict');
const { renderAssetSankey } = require('../dist/asset-charts.cjs');
const { AssetPanel } = require('../dist/asset-ui.cjs');
const { emptyAssets } = require('../dist/assets.cjs');

class Element {
  constructor(tag = 'div', options = {}) { this.tag = tag; this.textContent = options.text ?? ''; this.children = []; this.attributes = {}; this.listeners = {}; this.style = {}; }
  addClass() {}
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  appendChild(child) { this.children.push(child); return child; }
  createEl(tag, options) { return this.appendChild(new Element(tag, options)); }
  createDiv(options) { return this.createEl('div', options); }
  all() { return [this, ...this.children.flatMap(child => child.all())]; }
  createSpan(options) { return this.createEl('span', options); }
}
function snapshot() {
  return { date: '2026-10-08', savedAt: '2026-10-08T10:00:00Z', pending: [], accounts: [
    { id: 'cash', name: '银行卡', kind: 'cash', cents: 99999999, missing: false, holdings: [] },
    { id: 'i', name: '长名称投资账户', kind: 'investment', cents: 1, missing: false, holdings: [{ id: 'h', name: '小额基金', valueCents: 1 }] },
    { id: 'debt', name: '房贷', kind: 'liability', cents: 500, missing: false, holdings: [] }
  ] };
}
function withDocument(action) { global.document = { createElementNS: (_, tag) => new Element(tag) }; try { action(); } finally { delete global.document; } }

test('Sankey keeps real proportions for small values and provides touch and keyboard targets', () => withDocument(() => {
  const root = new Element(), expanded = []; renderAssetSankey(root, snapshot(), false, false, (id, holdingId) => expanded.push([id, holdingId]));
  const nodes = root.all(), rectangles = nodes.filter(n => n.tag === 'rect' && n.attributes.x === '945');
  assert.ok(+rectangles[1].attributes.height > 0); assert.equal(+rectangles[0].attributes.height / +rectangles[1].attributes.height, 99999999);
  const target = nodes.find(n => n.attributes['aria-label']?.startsWith('小额基金，'));
  assert.equal(target.children[0].attributes.height, '44'); target.listeners.click(); target.listeners.keydown({ key: 'Enter', preventDefault() {} });
  assert.deepEqual(expanded, [['i','h'], ['i','h']]);
  const expandedRoot = new Element(); renderAssetSankey(expandedRoot, snapshot(), false, false, () => {});
  assert.ok(expandedRoot.all().some(n => n.textContent.includes('小额基金')));
}));

test('Sankey hides numeric text including accessible names and retains negative gaps without negative shapes', () => withDocument(() => {
  const root = new Element(), snap = snapshot(); snap.accounts[0].cents = -123456; snap.accounts[2].cents = 500000;
  renderAssetSankey(root, snap, false, true, () => {});
  const nodes = root.all();
  assert.ok(nodes.some(n => n.textContent.includes('缺口')));
  assert.ok(nodes.every(n => n.tag !== 'rect' || +n.attributes.height >= 0));
  const text = nodes.map(n => `${n.textContent} ${n.attributes['aria-label'] ?? ''}`).join(' ');
  assert.ok(!text.includes('1,234.56')); assert.ok(!text.includes('5,000')); assert.ok(text.includes('••••'));
}));

test('asset panel works with an empty ledger and zero assets independently of spending reports', () => withDocument(() => {
  const state = emptyAssets(), root = new Element(), panel = new AssetPanel({ settings: { assets: state }, repository: { files: new Map() }, assetSnapshot: () => ({ date: '2026-10-08', savedAt: '', accounts: [], pending: [] }) });
  panel.render(root); const text = root.all().map(n => n.textContent).join(' ');
  assert.match(text, /总资产/); assert.match(text, /0.00/); assert.match(text, /暂无可比记录/); assert.match(text, /添加持仓/);
}));

test('compact allocation hides values and percentages when privacy is enabled', () => withDocument(() => {
  const { renderAssetAllocation } = require('../dist/asset-charts.cjs');
  const root = new Element(); renderAssetAllocation(root, snapshot(), false, true);
  const nodes = root.all(), text = nodes.map(n => `${n.textContent} ${n.attributes['aria-label'] ?? ''}`).join(' ');
  assert.ok(text.includes('••••')); assert.ok(!text.includes('%')); assert.ok(!text.includes('999,999'));
  assert.equal(nodes.filter(n => n.tag === 'circle').length, 1);
}));
test('investment Sankey shows holdings immediately and retains account cash alongside them', () => withDocument(() => {
  const snap = snapshot(); snap.accounts[1].cents = 101;
  const root = new Element(); renderAssetSankey(root, snap, false, false, () => {});
  const nodes = root.all(), bars = nodes.filter(n => n.tag === 'rect' && n.attributes.x === '945');
  assert.equal(bars.length, 3);
  assert.equal(+bars[2].attributes.height / +bars[1].attributes.height, 100);
  assert.ok(nodes.some(n => n.textContent.includes('长名称投资账户')));
}));


test('account balances and multiple holdings are siblings without an intermediate investment account node', () => withDocument(() => {
  const snap = snapshot(); snap.accounts[1] = {id:'i',name:'同花顺',kind:'investment',cents:60000,unallocatedCents:10000,missing:false,holdings:[{id:'h1',name:'基金甲',valueCents:20000},{id:'h2',name:'基金乙',valueCents:30000}]};
  const root=new Element(); renderAssetSankey(root,snap,false,false,()=>{});
  const nodes=root.all(),investmentLeaves=nodes.filter(n=>n.tag==='g' && /基金甲|基金乙|同花顺/.test(n.attributes['aria-label'] ?? ''));
  assert.equal(investmentLeaves.length,3);
  assert.ok(investmentLeaves.some(n=>n.attributes['aria-label'].includes('来自同花顺')));
  const bars=nodes.filter(n=>n.tag==='rect' && n.attributes.x==='945');
  assert.equal(+bars[2].attributes.height/+bars[1].attributes.height,1.5);
  assert.equal(+bars[3].attributes.height/+bars[1].attributes.height,.5);
  assert.ok(nodes.every(n=>!n.textContent.includes(' ›')));
}));
