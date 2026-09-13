Outcome: PASS — New links default to 480×256 in all three creators; hydration preserves stored `w`/`h`. The flexible title row removes the one-sided void. At 320×152, it has 90px above the 20px footer, centering the 44px badge with 23px above and below. At 480px wide, the title text has about 366px usable width, enough for “Untitled whiteboard.”

Minimality: PASS — The change contains only the requested default size, proportional title/badge sizing, resize floor, layout adjustment, and route notebook entry.

Conformance: PASS — `git diff --check` is clean. Coordinator typecheck/test evidence remains applicable; the package-only UI test could not run because `vitest` is absent in this checkout, an environment failure rather than a reproduced regression.
