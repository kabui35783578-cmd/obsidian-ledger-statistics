# Asset style alignment and mobile scroll tail

Reference: the existing `2026-09-12-lieflat-visual-redesign.md` and Lieflat Charts Mono tokens. This is a restyle of the existing asset renderer, with the lavender overview explicitly retained by user request. All other surfaces and chart colors inherit the ledger's established Mono variables, including dark mode; no remote fonts or chart dependencies.

## Chart reference

The retained aggregate Sankey matches **G22 Aggregate Sankey**, `templates/glance-gallery.html`, with cubic closed ribbons, cumulative source/destination offsets and width proportional to value. L5 Radial Convergence encodes ownership without aggregate widths; L12 Type Colonnade is a list-like ownership encoding; F13 Nested Treemap uses area and would remove the requested Sankey. The explicit Sankey requirement and aggregate currency widths justify G22. Apply its grey shading and 0.5 ribbon opacity to the existing three-stage assets/categories/accounts structure, without changing amounts, ratios, interactions or historical snapshots.

## Reproduced scroll issue

At a 390px emulated mobile leaf, the ancestor-container mobile rule did not apply to the root scroll area's padding: computed bottom padding was 18px. The last account row ended at 825.6px while the floating navigation began at 760px. Unlike other pages, assets has neither trailing diagnostics nor a next-view pull hint. Do not rely on those incidental sections for clearance.

The asset grid now includes 96px plus `env(safe-area-inset-bottom)` as an in-flow tail. Both Obsidian's `.is-mobile` class and a narrow viewport fallback enable it; desktop spacing is unchanged. At 375/390px the final cards end about 30px above navigation, with zero page overflow and 44px zoom buttons. Confirmed pinch from 1.0 to 1.6 and back to 0.6 with emulated touch events. These are simulation results, not physical iPhone verification.
