const test = require('node:test');
const assert = require('node:assert/strict');
const { LedgerStatisticsView } = require('../dist/view.cjs');

function fixture(navbar = null) {
  const leaf = {}, calls = [];
  const v = new LedgerStatisticsView(leaf, { settings: { defaultView: 'overview', defaultDatePreset: 'month', excludedCategories: [] } });
  v.leaf = leaf;
  v.app = { workspace: { activeLeaf: leaf }, mobileNavbar: navbar };
  v.contentEl = { scrollTop: 0 };
  v.containerEl = { addClass() {} };
  v.render = () => {};
  v.registerDomEvent = (element, name, listener, options) => calls.push({ element, name, listener, options });
  return { v, calls };
}

test('all five pages report only their own active page scroll through one passive native listener', async () => {
  const positions = [];
  const native = { onScroll(element, position) { assert.equal(this, native); positions.push({ element, position }); } };
  const { v, calls } = fixture(native);
  await v.onOpen();
  const registrations = calls.filter(call => call.name === 'scroll');
  assert.equal(registrations.length, 1);
  assert.deepEqual(registrations[0].options, { passive: true });
  const scroll = registrations[0].listener;
  for (const view of ['insights', 'overview', 'calendar', 'report', 'assets']) {
    v.activeView = view;
    for (const top of [0, 160, 320, 240, 0, -12]) {
      v.contentEl.scrollTop = top;
      scroll({ target: v.contentEl });
    }
  }
  assert.deepEqual(positions.map(p => p.position), Array(5).fill([0, 10, 20, 15, 0, 0]).flat());
  assert.ok(positions.every(p => p.element === v.contentEl));
  // Horizontal chart scrolling and background refreshes must never control
  // the foreground view's native toolbar.
  const before = positions.length;
  scroll({ target: { scrollTop: 160 } });
  v.app.workspace.activeLeaf = {};
  scroll({ target: v.contentEl });
  v.app.workspace.activeLeaf = v.leaf;
  v.closed = true;
  scroll({ target: v.contentEl });
  assert.equal(positions.length, before);
});

test('desktop and hosts without the internal native hook remain usable', async () => {
  for (const navbar of [null, {}, { onScroll: 'unsupported' }]) {
    const { v, calls } = fixture(navbar);
    await v.onOpen();
    v.contentEl.scrollTop = 160;
    assert.doesNotThrow(() => calls.find(call => call.name === 'scroll').listener({ target: v.contentEl }));
  }
});
