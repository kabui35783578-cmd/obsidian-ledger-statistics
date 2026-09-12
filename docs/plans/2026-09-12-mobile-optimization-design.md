# Mobile Optimization Design

## Goal

Make the six-view ledger dashboard genuinely readable and efficient on a phone without changing parsing, filtering, accounting scope, source-note navigation, or the Lieflat monochrome identity.

## Interaction design

- Replace the permanently expanded filter block with an accessible `details` panel. It starts collapsed on Obsidian mobile and open on desktop, then remembers its state while the view rerenders.
- Keep the active date range, accounting scope, and category visible in the collapsed summary so the user never loses statistical context.
- Present start and end dates as one joined range control with two equal columns instead of two vertically separated pills.
- Use a six-cell segmented view switcher on narrow screens so every destination remains visible without horizontal scrolling.
- Preserve 44 px minimum touch targets and visible focus states. No mobile interaction depends on hover.

## Responsive information design

- Use compact two-column metric cards to reduce first-screen scrolling.
- Do not scale desktop charts down. Tick rows, trend plots, and period comparisons receive dedicated mobile renderings with larger type, shorter labels, fewer axis marks, and taller tap rows.
- Keep exact amounts in visible text. Decorative ticks and paths remain secondary encodings.
- Retain the existing mobile detail cards and one-column calendar, while tightening generic section controls and card spacing.

## Verification

- Run TypeScript checks, all parser/statistics tests, and the production build.
- Reload the real plugin in Obsidian and verify mobile emulation at phone width in light and dark themes.
- Inspect collapsed and expanded filters, all six view tabs, chart readability, date range editing, touch target sizes, overflow, and runtime console errors.
- Report narrow-screen simulation separately from real-device testing.
