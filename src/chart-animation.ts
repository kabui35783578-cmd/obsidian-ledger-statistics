const observers = new WeakMap<Element, IntersectionObserver>();
const initialized = new WeakSet<Element>();
const resources = new WeakMap<Element, () => void>();

/** Dispose chart engines and chart-local resize work with their owning subtree. */
export function registerChartCleanup(element: Element, cleanup: () => void): void {
  resources.get(element)?.();
  resources.set(element, cleanup);
  element.classList.add("ledger-chart-resource");
}

/** Play a newly rendered card and its chart marks only on its first arrival. */
export function deferChartAnimation(element: Element): void {
  if (initialized.has(element) || typeof IntersectionObserver === "undefined") return;
  if (element.ownerDocument?.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  initialized.add(element);
  element.classList.add("ledger-animation-pending");
  const observer = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.target === element && entry.isIntersecting)) return;
    element.classList.remove("ledger-animation-pending");
    observer.disconnect();
    observers.delete(element);
  }, { rootMargin: "0px 0px -24px 0px", threshold: 0 });
  observers.set(element, observer);
  observer.observe(element);
}

export function disposeChartAnimations(root: Element): void {
  const dispose = (element: Element): void => {
    const cleanup = resources.get(element);
    if (cleanup) {
      cleanup(); resources.delete(element); element.classList.remove("ledger-chart-resource");
    }
    const observer = observers.get(element);
    if (!observer) return;
    observer.disconnect();
    observers.delete(element);
    initialized.delete(element);
    element.classList.remove("ledger-animation-pending");
  };
  dispose(root);
  root.querySelectorAll(".ledger-animation-pending").forEach(dispose);
  root.querySelectorAll(".ledger-chart-resource").forEach(dispose);
}
