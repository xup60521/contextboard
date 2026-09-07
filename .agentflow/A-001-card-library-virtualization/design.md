# Card Library: virtualization with whole-set marquee selection

Ask (A-001): "in card library, it is not virtualized. but I also want the mouse
框選 functionality to do bulk operation. carefully draft a plan of how to do it"

## 1. Current state (verified by reading)

- `packages/web-ui/src/components/cards/CardLibraryPage.tsx` loads **every** row
  via `cards.list(...)` into `rows`. `canLoadMore` is hardcoded `false`, so the
  card count is unbounded and every card mounts a DOM tile.
- `CardGrid.tsx` renders one `<ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">`
  with a `<li data-card-tile="true">` per card.
- Marquee selection **already exists** in `useCardLibrarySelection.ts`. It works by
  registering every tile node into `cardElementByIdRef` and, on each pointermove,
  looping that map calling `getBoundingClientRect()` per tile.
- Scroll happens in the app shell, not the page: `packages/ui/src/AppShell.tsx`
  renders `<div data-app-scroll-host="true" style={{overflowY:"auto",position:"relative"}}>`.
  The library page itself is `min-h-full overflow-hidden relative`.
- No virtualization dependency exists in the repo (`@tanstack/react-virtual` is
  not installed; `@tanstack/react-pacer` is unrelated).

## 2. The core conflict

Virtualization unmounts off-screen tiles. Today's hit test reads DOM rects, so
an unmounted card is invisible to the marquee. Naively virtualizing would make
框選 silently select only what happens to be on screen — the exact opposite of
what a bulk operation needs.

Note this also rules out the cheaper-looking alternative of **data pagination**
("Load more"): you cannot marquee across cards that were never fetched.
Virtualization is render-windowing over a fully-loaded set, which is precisely
what preserves whole-set selection.

## 3. Key decision: derive geometry, don't measure it

Make tile height a constant and compute column count in JS. Then every card's
box is a pure function of its index:

```
col = i % cols
row = (i / cols) | 0
x   = gridLeft + col * (colWidth + gap)
y   = gridTop  + row * (rowHeight + gap)
```

Consequences, all of them good:

- Marquee hit-testing stops touching the DOM entirely. Off-screen cards are
  selectable because their positions are **computed**, not measured. Selection
  becomes *more* correct than today, not less.
- Windowing becomes trivial arithmetic over the same function — one source of
  truth shared by rendering and hit-testing, so the two cannot drift.
- Per-frame DOM reads drop from O(cards) to O(1).

### 3a. Fixed tile height

Tile content is already fully clamped: `line-clamp-2` title + `line-clamp-4`
preview + footer + `p-4`, which maxes out around 166px. The loading skeleton in
`CardGrid.tsx` already uses `h-[170px]`. Pin the tile to that constant.

**Accepted tradeoff to confirm with the owner:** rows whose cards are all short
(brief title, no preview) will no longer shrink; they render at full height.
Within a row this is already the behaviour today, because `h-full` stretches
every tile to the tallest one in its row. The change is only visible on rows
where *every* card is short.

### 3b. Replace `auto-fill` with a JS-computed column count

Keep CSS Grid for layout but stop letting the browser decide the track count.
Render `gridTemplateColumns: repeat(<cols>, minmax(0, 1fr))` where

```
cols     = max(1, floor((width + gap) / (MIN_TILE + gap)))   // MIN_TILE=200, gap=12
colWidth = (width - (cols - 1) * gap) / cols
```

This reproduces `repeat(auto-fill, minmax(200px, 1fr))` exactly, but now JS is
the single source of truth, so there is zero chance of the hit-test math
disagreeing with browser layout (subpixel rounding, scrollbar width, etc.).

## 4. Coordinate system: content space

Today the drag anchor is stored in client (viewport) coordinates. Once the list
virtualizes we need auto-scroll during drag, and client coordinates become wrong
the moment the container scrolls.

Switch everything to **content space** — surface-relative, scroll-invariant:

```
toContent = (clientX, clientY) => {
  const r = surfaceRef.current.getBoundingClientRect();  // r.top moves with scroll
  return { x: clientX - r.left, y: clientY - r.top };
};
```

- Anchor is captured once at pointerdown, in content space.
- The moving point is recomputed in content space on every pointermove *and* on
  every auto-scroll frame.
- The marquee overlay is already `position:absolute` inside the `relative`
  surface, so content coordinates feed its style directly with no conversion.
- Card boxes are computed in the same space, using the grid element's offset
  within the surface, re-read once per frame (`gridRect.top - surfaceRect.top`).
  Reading it per frame instead of caching avoids a whole class of staleness bugs
  — the toolbar changes height when the error banner appears — and costs one
  `getBoundingClientRect` per frame.

One coordinate system for the anchor, the overlay, and the hit test. This is a
simplification over the current mixed client/surface handling.

## 5. Auto-scroll during drag

Without it the marquee cannot reach past one viewport, which defeats the purpose
on a long list. When the pointer sits within ~48px of the scroll host's top or
bottom edge during a drag, run a `requestAnimationFrame` loop that scrolls at a
speed proportional to the overshoot, and re-runs the hit test each frame using
the stored content-space anchor. Cancel on pointerup/pointercancel/unmount.

## 6. Windowing: hand-rolled, not a library

With uniform rows the whole windowing calculation is:

```
rowStride = TILE_HEIGHT + gap
firstRow  = clamp(floor((scrollTop - gridTop) / rowStride) - OVERSCAN)
lastRow   = clamp(floor((scrollTop + viewportH - gridTop) / rowStride) + OVERSCAN)
```

Render only `cards.slice(firstRow*cols, (lastRow+1)*cols)` inside the same
`<ul className="grid">`, and reserve the missing space with padding:

```
paddingTop    = firstRow * rowStride
paddingBottom = (rowCount - 1 - lastRow) * rowStride
```

Total height then equals `rowCount*h + (rowCount-1)*gap` exactly, and because we
always window by **whole rows**, CSS Grid auto-placement keeps column alignment
without any absolute positioning.

`@tanstack/react-virtual` is not recommended here. Its value is dynamic
measurement, which we deliberately do not want — we already need our own
geometry function for hit-testing, and a virtualizer's independent estimates
could disagree with it. A ~40-line `useUniformGridWindow` hook sharing the
geometry module is the smaller and safer change. Revisit the library only if
variable row heights ever become a requirement.

**Degenerate-case guard (important):** if the measured viewport height or grid
width is `0` — jsdom, SSR, or a page rendered outside the app shell — fall back
to rendering all rows. This one guard keeps the existing 1227-line jsdom test
file working and is correct behaviour anyway.

## 7. Scroll host resolution

`selectionSurfaceRef.current?.closest("[data-app-scroll-host]")`, which both the
web and desktop apps already provide through the shared `AppShell`. Fall back to
`document.scrollingElement`, then to the all-rows path from section 6.

## 8. The bug this plan must not ship

`useCardLibrarySelection` prunes `selectedCardIds` against `visibleCardIds`.
Today `visibleCardIds` means *all filtered rows* — it exists to drop selections
when the query or filter changes.

After virtualization, **`visibleCardIds` must keep receiving every row id, never
the windowed slice.** Passing the window would wipe the selection on every
scroll. This is the single most likely mistake in the whole change and deserves
a comment at the call site plus a regression test.

## 9. Files touched

| File | Change |
|---|---|
| `cards/cardGridGeometry.ts` *(new)* | Pure module: `getColumns`, `getCardBox`, `hitTest`. No DOM, no React. |
| `cards/useUniformGridWindow.ts` *(new)* | Scroll-host measurement + visible row range. |
| `cards/useCardLibrarySelection.ts` | Hit test via geometry; content-space anchor; auto-scroll; delete `cardElementByIdRef`. |
| `cards/CardGrid.tsx` | Fixed tile height, explicit `gridTemplateColumns`, windowed slice, padding spacers; drop `registerCardElement` prop. |
| `cards/CardLibraryPage.tsx` | Wire the window hook; drop `registerCardElement`; comment the section 8 invariant. |
| `cards/CardLibraryPage.test.tsx` | Replace `setCardRects` with a grid-box stub; port marquee cases. |

`data-card-tile="true"` stays — `handleSelectionPointerDown` uses it to avoid
starting a marquee on top of a card.

## 10. Sequencing

Each phase is independently shippable and verifiable.

1. **Geometry first, no virtualization.** Extract `cardGridGeometry.ts`, fix tile
   height, compute columns in JS, and switch the marquee hit test to arithmetic.
   The grid still renders every card. This retires all the geometry risk while
   the DOM is still fully present, so parity is directly provable against the
   existing marquee tests.
2. **Add windowing.** `useUniformGridWindow` + padding spacers, reusing the same
   geometry. Marquee selection needs no further change — that is the payoff of
   phase 1.
3. **Auto-scroll during drag.**
4. *(Needs owner go-ahead — out of scope as written.)* Bulk-selection
   affordances that a long virtualized list makes worth having: `Ctrl/Cmd+A` to
   select all filtered results, `Shift+click` for range select (moving the
   current toggle behaviour to `Ctrl/Cmd+click`), additive marquee when a
   modifier is held, and a "select all N results" control in the toolbar. All
   are cheap now that ids are known without touching the DOM.

## 11. Testing

Deliberately narrow, per repo convention.

- **`cardGridGeometry` unit tests.** Pure functions, no jsdom layout needed:
  column count across a range of widths, box-from-index, hit-test including
  a rect that lands entirely in a gutter. This is where the real coverage goes.
- **Ported marquee tests.** Swap the per-tile `setCardRects` helper for a single
  grid-box + surface-rect stub; the existing assertions should hold unchanged.
- **Two new cases:** (a) with N cards and a bounded viewport, only the expected
  row range is in the DOM; (b) a marquee spanning an off-screen band selects
  those ids anyway — this is the feature.
- **One regression case for section 8:** scrolling does not shrink the selection.
- **Real-app check:** phases 2 and 3 need a browser pass. `getBoundingClientRect`
  and pointer capture behaviour under Tauri on Windows is not something jsdom
  can vouch for.

## 12. Risks

1. Fixed tile height changes density on all-short rows (3a) — needs owner sign-off.
2. JS column count must match the browser at every width — covered by unit tests
   plus one real-browser check.
3. Coupling to `data-app-scroll-host` — the attribute already exists and both
   apps route through `AppShell`, but it is now load-bearing.
4. Auto-scroll interacting with pointer capture — browser verification only.
5. The marquee section of a 1227-line test file needs rewriting.
