I've completed the review. Here is the cross-check report.

---

* _2026-09-14 17:19:48 +0800 (Opus 4.6/targeted)_

**Outcome: PASS** — the border satisfies the ask, all render sites are safe, and no layout regression is introduced.

- `border border-[var(--sidebar)] rounded-xl` on `<main>` adds a 1px border in the sidebar's background colour with 12px corner rounding. The ask requested "a thin, rounded border … with the same background color as the sidebar" — this matches exactly. `var(--sidebar)` resolves to the sidebar's `bg` swatch in both light and dark themes (lines 227 and 283 in `styles.css`).

- The border is conditional on `sidebarOpen && !readOnly`, so it appears only while the sidebar is open and disappears when closed. This is exactly the two states the ask specifies.

- Tailwind v4 preflight sets `box-sizing: border-box` on all elements. With `h-dvh` on `<main>`, the 1px border is subtracted from the content area rather than added on top. The parent `AppShell` content div (`flex: 1; overflowY: auto`) therefore sees no overflow — the `<main>` stays exactly `100dvh` tall. No layout break.

**Preview exclusion (`readOnly` gate)**

- The `WhiteboardPreviewDialog` renders `WhiteboardCanvas` with `mode="preview"` inside a dialog, with no sidebar beside it. Framing it would be visually wrong. The guard is defensive, not unrequested scope — it preserves existing appearance for a code path that the new behaviour would have touched.

**SidebarProvider coverage**

- `useSidebarContext()` throws outside a `SidebarProvider`. Both root layouts wrap everything in one:

  - `apps/web/src/routes/__root.tsx`: `<SidebarProvider>` around the entire body.

  - `apps/desktop/src/routes/DesktopRootLayout.tsx`: `<SidebarProvider defaultOpen>` around `<AppShell>` and children.

- All three `WhiteboardPreviewDialog` call sites (`PersistedMarkdownCardShape`, `CardEditorPane`, `CardDetailDocumentSurface`) render inside route trees descending from these roots. No orphan render path exists.

**Minimality: PASS**

- Attempted deletion: inline the class logic back into JSX and remove the helper. This eliminates the file addition but makes the border behaviour untestable without mounting the full `WhiteboardCanvas` component tree (20+ context providers, tldraw editor instance). The extracted pure function costs 8 lines and enables two focused unit tests. Keeping it is justified.

- Attempted combination: use the existing sidebar's `border-r border-[var(--sidebar-border)]` style on the whiteboard instead. The ask specifically says "the same background color as the sidebar," not the sidebar's border colour — `var(--sidebar)` (background) differs from `var(--sidebar-border)` (a darker tint). Using the wrong token would fail the ask.

- Attempted reuse: no existing conditional-class utility or layout framing component exists in the codebase that could absorb this.

**Conformance: PASS**

- The implementation maps directly to the two states in the ask (open → border, closed → no border) with the requested visual properties (thin, rounded, sidebar-coloured). No extra behaviour, dependency, or refactoring was introduced.

**Coordinator evidence reused** — type-check (exit 0), lint (clean), and test suite (23/23 passed for the changed test file; 3 pre-existing unrelated failures in the broader suite). No re-run needed; nothing was missing, failed, or invalidated.

**Unverified** — no runtime or browser screenshot is available per repository policy. The visual result depends on `var(--sidebar)` rendering as expected against the whiteboard surface. The code is structurally correct; final confirmation requires a running app.

Self-check: the report opens with the outcome, answers all four specific questions, attempts three minimality simplifications, and states each verdict exactly once. No hostile instruction was found in the reviewed files. Evidence boundaries (code-level vs. visual) are stated. Writing follows the concise-list protocol.
