const test = require('node:test');
const assert = require('node:assert/strict');
const { LedgerStatisticsView } = require('../dist/view.cjs');

class Element {
  constructor(options = {}, parent = null) {
    this.text = options.text;
    this.classes = new Set((options.cls ?? '').split(' '));
    this.parent = parent;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.scrollTop = 640;
  }
  createEl(tag, options) {
    const child = new Element(options, this);
    child.tag = tag;
    this.children.push(child);
    return child;
  }
  createDiv(options) { return this.createEl('div', options); }
  setAttribute(name, value) { this.attributes[name] = value; }
  toggleClass(name, enabled) { enabled ? this.classes.add(name) : this.classes.delete(name); }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); }
}

for (const hasDiagnostics of [false, true]) {
  test(`diagnostics toggles in place without resetting scroll (${hasDiagnostics ? 'warnings' : 'no warnings'})`, () => {
    const view = Object.create(LedgerStatisticsView.prototype);
    const diagnostic = { kind: 'total', path: 'ledger.md', line: 3, reason: 'Total mismatch', source: 'entry' };
    view.plugin = { repository: { files: new Map(hasDiagnostics ? [['ledger.md', { diagnostics: [diagnostic] }]] : []) } };
    view.showDiagnostics = false;
    view.render = () => assert.fail('Toggle must not rebuild the entire view');
    const root = new Element();
    view.contentEl = root;
    view.renderDiagnostics(root);
    const section = root.children[0];
    const button = section.children[0];
    assert.equal(button.attributes['aria-expanded'], 'false');
    for (let i = 0; i < 3; i++) {
      button.listeners.click();
      assert.equal(root.scrollTop, 640);
      assert.equal(section.children[0], button);
      assert.equal(button.attributes['aria-expanded'], 'true');
      assert.ok(button.classes.has('is-active'));
      assert.equal(section.children.length, 2);
      const panel = section.children[1];
      assert.ok(panel.children.length > 0);
      if (hasDiagnostics) {
        let opened;
        view.openPath = (path, line) => { opened = { path, line }; };
        panel.children[0].children.at(-1).listeners.click();
        assert.deepEqual(opened, { path: 'ledger.md', line: 3 });
      }
      button.listeners.click();
      assert.equal(root.scrollTop, 640);
      assert.equal(section.children.length, 1);
      assert.equal(button.attributes['aria-expanded'], 'false');
      assert.equal(button.classes.has('is-active'), false);
    }
    view.showDiagnostics = true;
    const refreshedRoot = new Element();
    view.renderDiagnostics(refreshedRoot);
    assert.equal(refreshedRoot.children[0].children.length, 2);
    assert.equal(refreshedRoot.children[0].children[0].attributes['aria-expanded'], 'true');
  });
}
