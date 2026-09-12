# Lieflat Charts Visual Redesign

## Scope

Restyle the existing read-only Obsidian ledger plugin without changing parsing, accounting scope, source files, filters, or incremental refresh behavior. Preserve the six-view information architecture and desktop/mobile behavior.

## Candidate audit and template lock

### Category ranking

- Selected: **F5 Tick Rows**, `templates/basics-gallery.html`, card title “Six teams, shipped and counted”.
- F1 Rung Bars was rejected because vertical columns leave too little room for Chinese category labels and narrow screens.
- L2 Dot Cascade was rejected because its stacked count metaphor is better for discrete events than exact currency.
- Adaptation: use a shared, labelled currency unit; full ticks encode complete units and a shorter final tick encodes the remainder. Exact amounts remain printed at row ends.

### Category composition

- Selected: **F4 Tick Donut**, `templates/basics-gallery.html`, card title “Where the traffic comes from”.
- L14 Hundred Field was rejected because the current ledger has 12 categories, beyond its intended six-category small-data range.
- G4 Dot Waffle was rejected because Lupi Basics already provides an honest template, so Glance fallback is not permitted.
- Adaptation: 100 ticks encode rounded percentage points using largest-remainder allocation; exact shares remain in the legend.

### Trend

- Selected line: **F2 Hairline Line**, `templates/basics-gallery.html`, card title “Thirty days of sign-ups”.
- Selected column: **F3 Hairline Area**, same gallery, card title “Concurrent users, filled with days”.
- L3 Barcode Lollipop remains reserved for long, approximately 90-day editorial sequences; it is too dense for the plugin’s default month view.
- Adaptation: one dot/hairline is one displayed time bucket. Peak labels and a calendar floor remain visible.

### Period comparison

- Selected: **F12 Dumbbell Queue**, `templates/basics-gallery.html`, card title “Onboarding, before and after the redesign”.
- F6 Paired Rungs was rejected because it emphasizes two absolute ladders rather than change direction.
- F9 Waterfall was rejected because categories are parallel comparisons, not a sequential bridge from gross to net.
- Adaptation: hollow dot is the base period, solid dot is the current period, and beads between them show direction and magnitude on a shared currency axis.

## Mono system

- Paper `#F0EFEB`, ink `#1C1C1A`, and the official seven-step grey ladder only.
- Inter-first local font stack with no remote font request.
- Cards use 24px radius, no borders, gradients, transparency effects, or shadows.
- Each chart card has a conclusion title, explanatory subtitle, visual, and uppercase source line.
- Important values receive darker ink; secondary series use lighter ladder values.
- Entrance motion uses fast-in/slow-stop CSS, with `prefers-reduced-motion` disabling it.
- Dark Obsidian theme inverts paper and ink while retaining the same monochrome ladder.

## Interaction boundary

Chart clicks continue to drill into records because this is the plugin’s primary interaction contract. The gallery’s click-to-replay behavior is therefore not copied; animation replays whenever the view is rendered, and all meaningful SVG elements retain keyboard activation and accessible labels.
