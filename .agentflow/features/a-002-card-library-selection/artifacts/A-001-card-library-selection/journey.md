# Card library journey

Implementation commit: `cf098b5`.

Normal path:

1. Open the card library with enough cards to scroll.
2. Scroll through the card grid. The toolbar stays pinned at the top.
3. Drag a marquee across visible and off-screen rows.
4. The app scrolls near the viewport edge and keeps off-screen cards in the selection.

Owner evidence: "I test it manually. it works."

Automated evidence: the focused card-library and geometry run passes 34 of 34, including bounded DOM rows, off-screen selection, scroll persistence, auto-scroll, and the sticky toolbar boundary.
