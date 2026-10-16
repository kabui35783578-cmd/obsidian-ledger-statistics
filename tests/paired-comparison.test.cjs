const test = require('node:test');
const assert = require('node:assert/strict');
const { renderPairedRungs } = require('../dist/ui.cjs');

class Element {
  constructor(tag, options = {}) {
    this.tag = tag; this.textContent = options.text ?? ''; this.attributes = options.attr ?? {};
    this.children = []; this.listeners = {}; this.style = {};
    const classes = new Set((options.cls ?? '').split(' '));
    this.classList = { add: (...names) => names.forEach(n => classes.add(n)), contains: n => classes.has(n) };
  }
  setAttribute(name, value) { this.attributes[name] = value; if (name === 'class') value.split(' ').forEach(c => this.classList.add(c)); }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  append(...children) { this.children.push(...children); }
  createEl(tag, options) { const child = new Element(tag, options); this.append(child); return child; }
  createDiv(options) { return this.createEl('div', options); }
  all() { return this.children.flatMap(child => [child, ...child.all()]); }
}

test('paired columns share an exact currency scale, preserve partial units and expose every category', () => {
  const before = global.document;
  global.document = { createElementNS: (_, tag) => new Element(tag) };
  try {
    const data = [
      { category: '餐饮', currentCents: 12345, previousCents: 6000 },
      { category: '很长的分类名称/保留完整路径', currentCents: 0, previousCents: 57 }
    ];
    const saved = structuredClone(data), root = new Element('div'), clicked = [];
    renderPairedRungs(root, data, '本期', '基期', category => clicked.push(category));
    const groups = root.all().filter(e => e.classList.contains('ledger-paired-group'));
    assert.equal(groups.length, data.length);
    for (let i = 0; i < groups.length; i++) {
      assert.ok(groups[i].attributes['aria-label'].startsWith(data[i].category));
      for (const current of [true, false]) {
        const lines = groups[i].all().filter(e => e.tag === 'line' && e.attributes['data-current'] === String(current));
        const amount = data[i][current ? 'currentCents' : 'previousCents'];
        const encoded = lines.reduce((sum, e) => sum + Number(e.attributes['data-unit-cents']) * Number(e.attributes['data-fraction']), 0);
        assert.ok(Math.abs(encoded - amount) < 1e-8, 'Do not round away cents or invent a rung for a zero value');
        if (amount) assert.equal(Number(lines.at(-1).attributes.y1), 302 - amount / 12345 * 250, 'Both periods must use the same zero and maximum');
      }
    }
    groups[0].listeners.click();
    let prevented = false;
    groups[1].listeners.keydown({ key: 'Enter', preventDefault() { prevented = true; } });
    assert.deepEqual(clicked, data.map(d => d.category));
    assert.equal(prevented, true);
    assert.deepEqual(data, saved, 'Rendering must preserve the input ordering and financial data');
    assert.ok(root.all().some(e => e.textContent === '¥123.45'));
    assert.ok(root.all().some(e => e.textContent === '¥0.57'));
  } finally { global.document = before; }
});
