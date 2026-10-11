const test = require('node:test');
const assert = require('node:assert/strict');
const { deferChartAnimation, disposeChartAnimations } = require('../dist/chart-animation.cjs');

function element(children = [], reducedMotion = false) {
  const classes = new Set();
  return {
    classList: {
      add: value => classes.add(value),
      remove: value => classes.delete(value),
      contains: value => classes.has(value)
    },
    ownerDocument: { defaultView: { matchMedia: () => ({ matches: reducedMotion }) } },
    querySelectorAll: () => children.flatMap(child => [
      ...(child.classList.contains('ledger-animation-pending') ? [child] : []),
      ...child.querySelectorAll()
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
