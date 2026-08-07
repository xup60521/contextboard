# ContextBoard performance reference

Reference date: 2026-08-06
Reference machine: Windows, local Google Chrome, Playwright headless
Fixture: 200 cards, 50 arrows, five child boards, representative TipTap documents

## Reproduction

The deterministic fixture and assertions live in `apps/web/e2e/performance-fixture.ts` and `apps/web/e2e/performance.spec.ts`. Diagnostics are enabled only with `?perf=1`; reset and snapshot operations are available from `window.__contextboardPerf`.

For machines without Playwright's bundled Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to a local Chrome executable before running the web Playwright test.

## Recorded results

The post-remediation smoke run populated all 200 cards, 50 arrows, and five child boards, then observed a settled board for three seconds. It recorded zero repository notifications, zero item reloads, zero drawing reloads, and zero managed-shape creates or deletes during the observation window. The 10,000-row pending-log fixture cardinality test also passed.

The full 60-second idle scenario is selected by `CONTEXTBOARD_FULL_PERF=1`. The short default exists for ordinary CI; it applies the same zero-work assertions after board settlement.

The pre-remediation baseline is the source-traced F0 cascade in `docs/perf-audit.md`: each two-second sync state transition recreated web capability objects, cleared same-board item state, deleted managed shapes, and hydrated them again. No fabricated timing number is attached to that historical source trace.

Typing, panning, search, and main-thread long-task budgets remain browser acceptance gates. Their lower-level counters and deterministic data are checked by package tests; a documented reference-machine trace should be captured before declaring Release B complete.
