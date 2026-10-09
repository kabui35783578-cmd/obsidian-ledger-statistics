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

test('inline chart permits page scrolling at fit, owns diagonal drags after zoom, and restores page scrolling on reset', () => {
  const view = new Node(), svg = new Node(), controls = new Node();
  enableAssetGestures(view, svg, controls, true, true);
  assert.equal(view.style.touchAction, 'pan-y');
  let stopped = 0, prevented = 0;
  const touch = { touches: [{}], cancelable: true, stopPropagation() { stopped++; }, preventDefault() { prevented++; } };
  view.listeners.touchstart(touch); view.listeners.touchmove(touch);
  assert.equal(stopped, 0, 'fitted chart leaves page scrolling alone');
  controls.children[2].listeners.click();
  assert.equal(view.style.touchAction, 'none');
  view.listeners.touchstart(touch); view.listeners.touchmove(touch);
  assert.equal(stopped, 2, 'zoomed chart does not trigger host swipe navigation');
  assert.equal(prevented, 1);
  view.listeners.touchend({ ...touch, touches: [] });
  const before = view.scrollLeft;
  view.listeners.pointerdown(pointer(1, 100, 100));
  view.listeners.pointermove(pointer(1, 98, 101));
  view.listeners.pointermove(pointer(1, 92, 104));
  assert.equal(view.scrollLeft, before + 8, 'first drag includes movement below the threshold');
  view.listeners.pointerup(pointer(1, 92, 104));
  controls.children[1].listeners.click();
  assert.equal(view.style.touchAction, 'pan-y');
  assert.equal(view.scrollLeft, 0);
});

test('expanded chart supports fitting, pinch zoom and panning without zoom buttons', () => {
  const view = new Node(), svg = new Node();
  enableAssetGestures(view, svg, null, true);
  assert.equal(svg.style.width, '320px');
  const initialScale = Number(view.attributes['data-zoom']);
  view.listeners.pointerdown(pointer(1, 100, 100));
  view.listeners.pointerdown(pointer(2, 200, 100));
  view.listeners.pointermove(pointer(2, 300, 100));
  assert.equal(Number(view.attributes['data-zoom']), initialScale * 2);
  assert.equal(svg.style.width, '640px');
  view.listeners.pointerup(pointer(2, 300, 100));
  const before = view.scrollLeft;
  view.listeners.pointermove(pointer(1, 80, 100));
  assert.equal(view.scrollLeft, before + 20);
});
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
  assert.equal(clampAssetZoom(.01), .1); assert.equal(clampAssetZoom(100), 4); assert.equal(zoomScrollOffset(300, 150, 1, 2), 750);
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


test('initial fit shows the whole diagram in both dimensions and reset restores global view', () => {
  const view = new Node(), svg = new Node(), controls = new Node();
  view.clientWidth=270; view.clientHeight=300;
  svg.getBoundingClientRect=()=>({left:0,top:0,width:1080,height:1800});
  enableAssetGestures(view,svg,controls,true);
  assert.equal(+view.attributes['data-zoom'],1/6);
  assert.equal(parseFloat(svg.style.width),180);
  assert.equal(view.scrollLeft,0);assert.equal(view.scrollTop,0);
  controls.children[2].listeners.click(); assert.ok(+view.attributes['data-zoom']>1/6);
  controls.children[1].listeners.click(); assert.equal(+view.attributes['data-zoom'],1/6);
});

test('automatic fit handles resize, preserves manual zoom and disconnects after chart removal', () => {
  let callback,disconnected=false;
  global.ResizeObserver=class { constructor(cb){callback=cb;} observe(){} disconnect(){disconnected=true;} };
  try {
    const view=new Node(),svg=new Node(),controls=new Node(); view.isConnected=true;
    enableAssetGestures(view,svg,controls,true);
    view.clientWidth=500; callback();assert.equal(parseFloat(svg.style.width),500);
    controls.children[2].listeners.click(); const width=svg.style.width;
    view.clientWidth=600;callback();assert.equal(svg.style.width,width);
    controls.children[1].listeners.click();assert.equal(parseFloat(svg.style.width),600);
    view.isConnected=false;callback();assert.equal(disconnected,true);
  } finally {delete global.ResizeObserver;}
});


test('resize observations do not feed the already fitted height back into global zoom', () => {
  let callback;global.ResizeObserver=class {constructor(cb){callback=cb;}observe(){}disconnect(){}};
  try {
    const view=new Node(),svg=new Node(),controls=new Node();view.isConnected=true;view.clientWidth=320;view.clientHeight=340;
    svg.getBoundingClientRect=()=>({left:0,top:0,width:1080,height:700});
    enableAssetGestures(view,svg,controls,true);const scale=view.attributes['data-zoom'];
    view.clientHeight=207;callback();view.clientHeight=206;callback();
    assert.equal(view.attributes['data-zoom'],scale);
  } finally {delete global.ResizeObserver;}
});


test('browser resize fitting is deferred to the next frame and cancelled on removal', () => {
  let callback,frameCallback,cancelled=false,requests=0;
  global.ResizeObserver=class {constructor(cb){callback=cb;}observe(){}disconnect(){}};
  global.requestAnimationFrame=cb=>{frameCallback=cb;requests++;return 1;};global.cancelAnimationFrame=()=>cancelled=true;
  try {
    const view=new Node(),svg=new Node(),controls=new Node();view.isConnected=true;
    enableAssetGestures(view,svg,controls,true);const width=svg.style.width;
    view.clientWidth=500;callback();callback();assert.equal(svg.style.width,width);assert.equal(requests,1);
    frameCallback();assert.equal(parseFloat(svg.style.width),500);
    view.clientWidth=600;callback();view.isConnected=false;callback();assert.equal(cancelled,true);
  } finally {delete global.ResizeObserver;delete global.requestAnimationFrame;delete global.cancelAnimationFrame;}
});
