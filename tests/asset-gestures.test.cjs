const test = require('node:test');
const assert = require('node:assert/strict');
const { enableAssetGestures, clampAssetZoom, zoomScrollOffset } = require('../dist/asset-gestures.cjs');
class Node {
  constructor() { this.listeners = {}; this.children = []; this.attributes = {}; this.style = {}; this.scrollLeft = 300; this.scrollTop = 100; this.clientWidth = 320; this.clientHeight = 300; }
  setAttribute(name, value) { this.attributes[name] = value; }
  createEl(tag, options) { const n = new Node(); n.textContent = options.text; n.attributes = options.attr ?? {}; this.children.push(n); return n; }
  setText(value) { this.textContent = value; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 1080 }; }
  setPointerCapture() {}
}
const pointer = (id, x, y) => ({ pointerId: id, clientX: x, clientY: y, pointerType: 'touch', preventDefault() {} });
test('pinch zoom preserves the touched point, pans and suppresses accidental node activation', () => {
  const view = new Node(), svg = new Node(), controls = new Node(); enableAssetGestures(view, svg, controls);
  view.listeners.pointerdown(pointer(1, 100, 100)); view.listeners.pointerdown(pointer(2, 200, 100));
  view.listeners.pointermove(pointer(2, 300, 100));
  assert.equal(view.attributes['data-zoom'], '2'); assert.equal(svg.style.width, '2160px'); assert.equal(view.scrollLeft, 700); assert.equal(view.scrollTop, 300);
  view.listeners.pointerup(pointer(2, 300, 100)); view.listeners.pointermove(pointer(1, 80, 80));
  assert.equal(view.scrollLeft, 720); assert.equal(view.scrollTop, 320); view.listeners.pointerup(pointer(1, 80, 80));
  let prevented = false, stopped = false; view.listeners.click({ preventDefault() { prevented = true; }, stopImmediatePropagation() { stopped = true; } });
  assert.equal(prevented && stopped, true);
  controls.children[1].listeners.click(); assert.equal(view.attributes['data-zoom'], '1'); assert.equal(view.scrollLeft, 0); assert.equal(svg.style.width, '');
});
test('buttons, bounds and pointer cancellation keep chart zoom usable', () => {
  assert.equal(clampAssetZoom(.01), .3); assert.equal(clampAssetZoom(100), 4); assert.equal(zoomScrollOffset(300, 150, 1, 2), 750);
  const view = new Node(), svg = new Node(), controls = new Node(); enableAssetGestures(view, svg, controls);
  controls.children[2].listeners.click(); assert.equal(view.attributes['data-zoom'], '1.25');
  controls.children[0].listeners.click(); assert.equal(view.attributes['data-zoom'], '1');
  view.listeners.pointerdown(pointer(1, 10, 10)); view.listeners.pointercancel(pointer(1, 10, 10));
  const before = view.scrollLeft; view.listeners.pointermove(pointer(1, 200, 200)); assert.equal(view.scrollLeft, before);
});
test('slow finger movement accumulates into panning while an ordinary tap is not blocked', () => {
  const view = new Node(), svg = new Node(), controls = new Node(); enableAssetGestures(view, svg, controls);
  view.listeners.pointerdown(pointer(1, 100, 100)); view.listeners.pointermove(pointer(1, 102, 100)); view.listeners.pointermove(pointer(1, 104, 100)); view.listeners.pointermove(pointer(1, 106, 100));
  assert.ok(view.scrollLeft < 300);
  const tap = new Node(); enableAssetGestures(tap, new Node(), new Node()); tap.listeners.pointerdown(pointer(1, 100, 100)); tap.listeners.pointerup(pointer(1, 100, 100));
  tap.listeners.click({ preventDefault() { throw new Error('Tap should be allowed'); } });
});
