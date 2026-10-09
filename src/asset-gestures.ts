interface Point { x: number; y: number; }
export function clampAssetZoom(value: number): number { return Math.max(.1, Math.min(4, value)); }
export function zoomScrollOffset(scroll: number, anchor: number, previous: number, next: number): number { return (scroll + anchor) * next / previous - anchor; }

/** Chart-local touch gestures: no window listeners, page zoom, or persistent state. */
export function enableAssetGestures(viewport: HTMLElement, svg: SVGSVGElement, tools: HTMLElement | null, fit = false): void {
  let scale = 1, base = 0, baseHeight = 0, fitHeightLimit = 0, homeScale = 1, manuallyZoomed = false, dragged = false, suppressUntil = 0, origin: Point = { x: 0, y: 0 };
  const points = new Map<number, Point>();
  const minus = tools?.createEl("button", { cls: "ledger-button", text: "−", attr: { "aria-label": "缩小桑基图" } });
  const reset = tools?.createEl("button", { cls: "ledger-button ledger-assets-zoom-value", text: "100%", attr: { "aria-label": "重置桑基图缩放" } });
  const plus = tools?.createEl("button", { cls: "ledger-button", text: "+", attr: { "aria-label": "放大桑基图" } });
  for (const button of [minus, reset, plus]) if (button) button.type = "button";
  const measure = (): void => {
    if (base) return;
    const rect = svg.getBoundingClientRect?.();
    base = rect?.width || Math.max(viewport.clientWidth || 0, 1080);
    baseHeight = rect?.height || 0;
  };
  const zoomAt = (value: number, anchor: Point, automatic = false): void => {
    if (!automatic) manuallyZoomed = true;
    measure(); const next = automatic ? Math.max(.01, Math.min(4, value)) : fit ? Math.max(Math.min(.1, homeScale), Math.min(4, value)) : clampAssetZoom(value), x = zoomScrollOffset(viewport.scrollLeft, anchor.x, scale, next), y = zoomScrollOffset(viewport.scrollTop, anchor.y, scale, next);
    svg.style.minWidth = "0"; svg.style.width = `${base * next}px`;
    viewport.scrollLeft = x; viewport.scrollTop = y; scale = next;
    reset?.setText(`${Math.round(scale * 100)}%`); viewport.setAttribute("data-zoom", String(scale));
  };
  const fitChart = (): void => {
    if (!viewport.clientWidth) return;
    measure();
    // Use the CSS cap, not the fitted SVG's current height: observing that
    // shrinking height feeds rounding back into fit and repeatedly shrinks it.
    const cap = typeof getComputedStyle === "function" ? getComputedStyle(viewport).maxHeight : "";
    const pixels = cap.match(/[\d.]+px/g)?.map(value => parseFloat(value));
    if (pixels?.length && !cap.includes("vh")) fitHeightLimit = Math.min(...pixels);
    else if (!fitHeightLimit) fitHeightLimit = viewport.clientHeight;
    const target = Math.min(1, viewport.clientWidth / base, baseHeight && fitHeightLimit ? fitHeightLimit / baseHeight : 1);
    homeScale = target; zoomAt(target, { x: 0, y: 0 }, true); viewport.scrollLeft = viewport.scrollTop = 0;
  };
  const center = (): Point => ({ x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 });
  minus?.addEventListener("click", () => zoomAt(scale / 1.25, center()));
  plus?.addEventListener("click", () => zoomAt(scale * 1.25, center()));
  reset?.addEventListener("click", () => { manuallyZoomed = false; if (fit) { fitChart(); return; } scale = 1; base = 0; svg.style.width = ""; svg.style.minWidth = ""; viewport.scrollLeft = viewport.scrollTop = 0; reset.setText("100%"); viewport.setAttribute("data-zoom", "1"); });
  if (fit) {
    reset?.setAttribute("aria-label", "查看桑基图全图");
    fitChart();
    if (typeof ResizeObserver !== "undefined") {
      let frame = 0;
      const observer = new ResizeObserver(() => {
        // Detachment triggers a zero-size observation; release the old chart.
        if (!viewport.isConnected) { observer.disconnect(); if (frame) cancelAnimationFrame(frame); return; }
        if (manuallyZoomed || frame) return;
        // Fit changes this observed element's height; write in the next frame
        // so browser resize delivery does not report a layout feedback loop.
        if (typeof requestAnimationFrame === "function") frame = requestAnimationFrame(() => {
          frame = 0; if (viewport.isConnected && !manuallyZoomed) fitChart();
        }); else fitChart();
      }); observer.observe(viewport);
    }
  } else viewport.setAttribute("data-zoom", "1");
  viewport.setAttribute("aria-label", "资产桑基图，双指缩放，单指拖动");
  viewport.addEventListener("wheel", event => { if (event.ctrlKey || event.metaKey) { event.preventDefault(); const rect = viewport.getBoundingClientRect(); zoomAt(scale * Math.exp(-event.deltaY * .002), { x: event.clientX - rect.left, y: event.clientY - rect.top }); } }, { passive: false });
  viewport.addEventListener("pointerdown", event => {
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
    if (!points.size) { dragged = false; origin = { x: event.clientX, y: event.clientY }; }
    points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (points.size > 1) { dragged = true; for (const id of points.keys()) viewport.setPointerCapture?.(id); }
  });
  viewport.addEventListener("pointermove", event => {
    const previous = points.get(event.pointerId); if (!previous) return;
    const before = [...points.values()], next = { x: event.clientX, y: event.clientY };
    points.set(event.pointerId, next);
    if (before.length > 1) {
      const after = [...points.values()], distance = (ps: Point[]): number => Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
      const oldDistance = distance(before); if (oldDistance < 2) return;
      const oldCenter = { x: (before[0].x + before[1].x) / 2, y: (before[0].y + before[1].y) / 2 }, newCenter = { x: (after[0].x + after[1].x) / 2, y: (after[0].y + after[1].y) / 2 };
      const rect = viewport.getBoundingClientRect(); zoomAt(scale * distance(after) / oldDistance, { x: oldCenter.x - rect.left, y: oldCenter.y - rect.top });
      viewport.scrollLeft -= newCenter.x - oldCenter.x; viewport.scrollTop -= newCenter.y - oldCenter.y;
      dragged = true; event.preventDefault();
    } else {
      const dx = next.x - previous.x, dy = next.y - previous.y;
      if (dragged || Math.hypot(next.x - origin.x, next.y - origin.y) > 4) { dragged = true; viewport.setPointerCapture?.(event.pointerId); viewport.scrollLeft -= dx; viewport.scrollTop -= dy; event.preventDefault(); }
    }
  });
  const end = (event: PointerEvent): void => { if (!points.has(event.pointerId)) return; points.delete(event.pointerId); if (dragged) suppressUntil = Date.now() + 350; };
  viewport.addEventListener("pointerup", end); viewport.addEventListener("pointercancel", end);
  viewport.addEventListener("click", event => { if (Date.now() < suppressUntil) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
}
