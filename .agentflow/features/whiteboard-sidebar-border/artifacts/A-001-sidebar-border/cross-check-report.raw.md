All checks complete. Here is my report.

* _2026-09-14 17:29:05 +0800 (claude-opus-4-6/high)_

## Summary

- The implementation satisfies the ask: a 1px rounded border in the sidebar's own background colour appears when the sidebar is open, disappears when it closes.

- No runtime crash risk: every `WhiteboardCanvas` render site (web `__root.tsx`, desktop `DesktopRootLayout.tsx`, and all three `WhiteboardPreviewDialog` call sites) sits inside a `SidebarProvider`, so `useSidebarContext()` never throws.

- No layout breakage: Tailwind v4's preflight sets `box-sizing: border-box`, so the 1px border subtracts from the inner content rather than overflowing the `h-dvh` shell.

## Specific questions

- **Does `border border-[var(--sidebar)]` plus `rounded-xl` satisfy "thin, rounded border with the same background colour as the sidebar"?**
  Yes. Tailwind's `border` is 1px (thin). `rounded-xl` rounds the corners. `var(--sidebar)` is the exact property the sidebar's `<aside>` uses for its `bg-[var(--sidebar)]` (`AppSidebarFrame.tsx:44`), so the border colour matches the sidebar background in both light and dark modes.

- **Is excluding the preview dialog (`mode="preview"`) correct, or is it unrequested scope?**
  Correct and necessary. The preview renders inside a portal dialog with no sidebar beside it. Without the exclusion, opening a sidebar elsewhere would add a border to the preview — visually wrong. The guard prevents a regression the ask didn't anticipate; it does not add unrequested behaviour.

- **Is every `WhiteboardCanvas` render site inside a `SidebarProvider`?**
  Yes. The web app wraps its entire render tree in `SidebarProvider` at `apps/web/src/routes/__root.tsx:103-134`. The desktop app wraps at `apps/desktop/src/routes/DesktopRootLayout.tsx:58-64`. The three `WhiteboardPreviewDialog` call sites (`PersistedMarkdownCardShape.tsx:138`, `CardDetailDocumentSurface.tsx:92`, `CardEditorPane.tsx:71`) are all descendants of these providers. Radix Dialog portals in the DOM but React context flows through the component tree, so `useSidebarContext()` resolves in every case.

- **Does the added border break layout given `h-dvh` sizing and `overflow: hidden`?**
  No. Tailwind v4's preflight applies `box-sizing: border-box` to all elements. The 1px border shrinks the inner content by 2px total, well within tolerance. `rounded-xl` with the existing `overflow-hidden` clips corners correctly. The shell (`AppShell.tsx`) uses `height: 100dvh` with `overflow: hidden` and flexbox; the whiteboard's `<main>` remains flush.

## Minimality analysis

- **Inline the helper?** Replacing `whiteboardShellClass` with a ternary in JSX would eliminate one export and its test file additions. However, the function has two independent boolean inputs producing three distinct class strings; extracting it keeps the JSX clean and lets the two focused tests verify the class logic without rendering React. Reasonable trade-off, not excess.

- **Drop the `readOnly` guard?** Would cause the preview dialog to gain a border when the sidebar is open — a visual defect. Required for correctness.

- **Use a CSS-only approach (e.g. `data-sidebar-open` attribute)?** The sidebar's open state lives in React context (jotai atom + `SidebarContext`), so a JS-side conditional is the natural path. A data-attribute bridge would add more surface, not less.

- **Reuse an existing border utility or component?** No existing utility applies a sidebar-coloured frame conditionally. The implementation is minimal.

No simplification produces a smaller correct design.

Verdict: PASS
Reviewed implementation commit: eb777a77180057925affb0c767f45e2c55d205c6
Outcome: PASS
Minimality: PASS
Conformance: PASS

## Notes

- No hostile instructions found in any changed file or in `CLAUDE.md`/`AGENTS.md`.

- The coordinator's test evidence (23 passed, 0 failed for the changed test file; tsc clean; biome clean; 3 pre-existing failures unrelated) is consistent with the code as read. No rerun needed.

- The commit message accurately describes the change without overclaiming.

Self-check: five contract lines present exactly once each, on their own lines. Stamp is first character. Report uses list-based style per writing protocol. All four specific questions answered. At least one deletion/simplification attempted per axis. No prior run's conclusion cited as evidence.
