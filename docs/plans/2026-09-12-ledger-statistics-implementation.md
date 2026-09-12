# Ledger Statistics Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a local, read-only Obsidian ledger statistics plugin with six coordinated views for desktop and mobile.

**Architecture:** A pure TypeScript parser/statistics core converts daily Markdown entries to integer cents and explicit diagnostics. An incremental Vault API repository caches one parsed result per file and notifies a single ItemView, whose native DOM/SVG renderers share one filter state. No runtime network access or desktop-only APIs are used.

**Tech Stack:** TypeScript, Obsidian official API, esbuild, Node test runner, native SVG/CSS.

---

### Task 1: Parser and statistical core

**Files:** Create `src/core.ts`; test with `tests/core.test.cjs`.

1. Write tests for ordinary, backfilled, thousands-separated, one-decimal, full-width, blank and malformed records.
2. Implement normalized parsing into integer cents with file/line diagnostics.
3. Add date-range, scope, category, trend and comparison aggregation.
4. Verify category totals, frontmatter reconciliation, cross-month filtering and zero-base comparison.

### Task 2: Incremental Vault repository

**Files:** Create `src/repository.ts`.

1. Scan only the configured folder on load.
2. Cache parsed files by path.
3. Incrementally handle create, modify, delete and rename.
4. Dispose all registered listeners through the plugin lifecycle.

### Task 3: Six-view user interface

**Files:** Create `src/view.ts`, `src/ui.ts`, `styles.css`.

1. Add shared date preset, category and accounting-scope controls.
2. Implement overview, category, trend, calendar, detail and comparison pages.
3. Add clickable SVG/table drill-down behavior and source-note opening.
4. Add loading, empty, filtered-empty and diagnostic states.
5. Add responsive one-column/card layout with touch-sized controls.

### Task 4: Plugin lifecycle and settings

**Files:** Create `src/main.ts`, `src/settings.ts`, `manifest.json`.

1. Register the view, ribbon icon and command.
2. Add folder, default-view and excluded-category settings.
3. Rebuild the repository/view when data settings change.
4. Declare mobile support without desktop-only imports.

### Task 5: Build and verification

**Files:** Create `README.md`, generated `main.js`.

1. Run strict TypeScript checks and automated tests.
2. Audit all current ledger files without modifying them.
3. Load/reload in Obsidian and inspect runtime errors and DOM.
4. Verify desktop and narrow-screen/mobile-emulation layouts.
5. Clearly distinguish simulated narrow-screen validation from unperformed physical-device testing.
