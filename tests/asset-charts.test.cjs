const test = require('node:test');
const assert = require('node:assert/strict');
const { renderAssetOverviewSankey, renderAssetSankey } = require('../dist/asset-charts.cjs');
const { AssetPanel } = require('../dist/asset-ui.cjs');
const { emptyAssets } = require('../dist/assets.cjs');

class Element {
  constructor(tag = 'div', options = {}) { this.tag = tag; this.className = options.cls ?? ''; this.textContent = options.text ?? ''; this.children = []; this.attributes = {}; this.listeners = {}; this.style = {}; }
  addClass() {}
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  appendChild(child) { if (child.parentElement) child.parentElement.children = child.parentElement.children.filter(e => e !== child); this.children.push(child); child.parentElement = this; return child; }
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

test('home hierarchy embeds daily comparisons in the summary and keeps changes truthful and private', () => withDocument(() => {
  const state = emptyAssets(), current = snapshot();
  state.snapshots = [{ ...snapshot(), date: '2026-10-07', accounts: snapshot().accounts.map(a => ({ ...a, cents: a.kind === 'cash' ? a.cents - 500 : a.cents })) }];
  const p = { settings: { assets: state }, repository: { files: new Map() }, assetSnapshot: () => current };
  let root = new Element(); new AssetPanel(p).render(root);
  const hero = root.all().find(n => n.className.includes('ledger-assets-hero'));
  assert.ok(hero.all().some(n => n.className === 'ledger-assets-comparison'));
  assert.equal(hero.all().filter(n => n.className === 'ledger-assets-change-column').length, 5);
  assert.ok(hero.all().some(n => n.textContent === '↑5.00' && n.className.includes('is-up')));
  assert.ok(hero.all().some(n => n.textContent === '相比前一天'));
  current.accounts[0].cents -= 1000;
  root = new Element(); new AssetPanel(p).render(root);
  assert.ok(root.all().some(n => n.textContent === '↓5.00' && n.className.includes('is-down')));
  current.accounts[0].cents += 500;
  root = new Element(); new AssetPanel(p).render(root);
  assert.ok(root.all().some(n => n.textContent === '没有变化'));
  assert.ok(!root.all().some(n => /^[↑↓]/.test(n.textContent)));
  state.hideAmounts = true;
  root = new Element(); new AssetPanel(p).render(root);
  assert.ok(!root.all().some(n => /^[↑↓]/.test(n.textContent)));
  assert.ok(root.all().filter(n => n.className.includes('ledger-assets-change-fill')).every(n => n.style.height === '0%'));
}));

test('home Sankey preserves category proportions, includes actual holdings and installs gestures directly', () => withDocument(() => {
  const snap = snapshot(); snap.accounts[0].cents = 60000; snap.accounts[1].cents = 30000; snap.accounts[2].cents = 10000;
  const root = new Element(); let opened = 0;
  renderAssetOverviewSankey(root, snap, false, true, () => opened++);
  const bars = root.all().filter(n => n.tag === 'rect' && n.attributes.x === '620');
  assert.equal(+bars[0].attributes.height / +bars[1].attributes.height, 2);
  const target = root.all().find(n => n.attributes['aria-label']?.startsWith('银行卡，'));
  assert.ok(target.attributes['aria-label'].includes('••••'));
  target.listeners.keydown({ key: 'Enter', preventDefault() {} }); assert.equal(opened, 1);
  const viewport = root.all().find(n=>n.className.includes('ledger-assets-overview-scroll'));
  assert.ok(viewport.listeners.touchstart && viewport.listeners.touchmove && viewport.listeners.pointermove);
  assert.ok(root.all().some(n=>n.attributes['aria-label']?.startsWith('小额基金，')));
}));

test('home overdraft uses the reference names and renders net assets plus debt as sources', () => withDocument(() => {
  const snap = snapshot(); snap.accounts[0].cents=-23000;snap.accounts[1].cents=650000;snap.accounts[2].cents=0;
  const root=new Element();renderAssetOverviewSankey(root,snap,false,false,()=>{});
  const text=root.all().map(n=>n.textContent).join(' ');
  assert.ok(text.includes('总资产')&&text.includes('净资产')&&text.includes('负债'));
  assert.ok(!/已估值|正资产|缺口/.test(text));
  const sources=root.all().filter(n=>n.tag==='rect'&&n.attributes.x==='125');
  assert.equal(sources.length,2);assert.ok(+sources[0].attributes.height>0);assert.ok(+sources[1].attributes.height>0);
}));

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
  assert.ok(nodes.some(n => n.textContent.includes('净资产')));
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
