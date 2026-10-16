const test = require('node:test');
const assert = require('node:assert/strict');
const { deferChartAnimation, disposeChartAnimations, registerChartCleanup } = require('../dist/chart-animation.cjs');

function element(children = [], reducedMotion = false) {
  const classes = new Set();
  return {
    classList: {
      add: value => classes.add(value),
      remove: value => classes.delete(value),
      contains: value => classes.has(value)
    },
    ownerDocument: { defaultView: { matchMedia: () => ({ matches: reducedMotion }) } },
    querySelectorAll: (selector = '.ledger-animation-pending') => children.flatMap(child => [
      ...(child.classList.contains(selector.slice(1)) ? [child] : []),
      ...child.querySelectorAll(selector)
    ])
  };
}

function withObservers(run) {
  const previous = global.IntersectionObserver;
  const observers = [];
  global.IntersectionObserver = class {
    constructor(callback, options) {
      this.callback = callback;
      this.options = options;
      this.disconnected = false;
      observers.push(this);
    }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
    intersect(target, isIntersecting) { this.callback([{ target, isIntersecting }]); }
  };
  try { run(observers); } finally { global.IntersectionObserver = previous; }
}

test('offscreen charts stay paused until their own first visible entry', () => withObservers(observers => {
  const chart = element();
  deferChartAnimation(chart);
  assert.equal(chart.classList.contains('ledger-animation-pending'), true);
  const observer = observers[0];
  assert.equal(observer.target, chart);
  assert.deepEqual(observer.options, { rootMargin: '0px 0px -24px 0px', threshold: 0 });
  observer.intersect(chart, false);
  observer.intersect(element(), true);
  assert.equal(chart.classList.contains('ledger-animation-pending'), true);
  assert.equal(observer.disconnected, false);
  observer.intersect(chart, true);
  assert.equal(chart.classList.contains('ledger-animation-pending'), false);
  assert.equal(observer.disconnected, true);
}));

test('scrolling away and back does not rearm an already played chart', () => withObservers(observers => {
  const chart = element();
  deferChartAnimation(chart);
  observers[0].intersect(chart, true);
  deferChartAnimation(chart);
  assert.equal(observers.length, 1);
  assert.equal(chart.classList.contains('ledger-animation-pending'), false);
  const replacement = element();
  deferChartAnimation(replacement);
  assert.equal(observers.length, 2);
  assert.equal(replacement.classList.contains('ledger-animation-pending'), true);
}));

test('refresh and close clean up only observers within the removed subtree', () => withObservers(observers => {
  const nested = element();
  const parent = element([element([nested])]);
  const sibling = element();
  [parent, nested, sibling].forEach(deferChartAnimation);
  disposeChartAnimations(parent);
  assert.deepEqual(observers.map(observer => observer.disconnected), [true, true, false]);
  assert.equal(parent.classList.contains('ledger-animation-pending'), false);
  assert.equal(nested.classList.contains('ledger-animation-pending'), false);
  assert.equal(sibling.classList.contains('ledger-animation-pending'), true);
}));

test('reduced motion and unavailable observers leave chart content visible', () => {
  withObservers(observers => {
    const chart = element([], true);
    deferChartAnimation(chart);
    assert.equal(observers.length, 0);
    assert.equal(chart.classList.contains('ledger-animation-pending'), false);
  });
  const previous = global.IntersectionObserver;
  global.IntersectionObserver = undefined;
  try {
    const chart = element();
    deferChartAnimation(chart);
    assert.equal(chart.classList.contains('ledger-animation-pending'), false);
  } finally { global.IntersectionObserver = previous; }
});

test('chart engines and resize work are disposed exactly once with their owning subtree', () => {
  const nested = element(), sibling = element(), parent = element([nested]);
  let removed = 0, retained = 0;
  registerChartCleanup(nested, () => removed++);
  registerChartCleanup(sibling, () => retained++);
  disposeChartAnimations(parent);
  disposeChartAnimations(parent);
  assert.equal(removed, 1);
  assert.equal(retained, 0);
  disposeChartAnimations(sibling);
  assert.equal(retained, 1);
});
