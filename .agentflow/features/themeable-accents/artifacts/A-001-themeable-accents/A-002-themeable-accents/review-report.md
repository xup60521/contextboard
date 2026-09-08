* _2026-09-07 12:40:44 (claude-opus-4-6/high)_

## Evidence from my own runs

**`bun install`**: 554 packages installed in 9.81s. Clean.

**`bun run test`** (from clone root, no cache):
- Turbo: 16 of 25 tasks successful, 1 failed.
- The single failure: `packages/application/src/canvas/plan/arrange-relations.test.ts > keeps a dense 200-card graph compact, local, deterministic, and clear` — 5000 ms timeout. This matches the coordinator's documented pre-existing failure and is in an unchanged file outside the accent diff. No accent-related tests failed.
- `@contextboard/web-ui:test` passed, including `accent-contrast.test.ts` (9 tests, 14 ms) and the theme/accent unit tests.

**`bun run check`** (from clone root, no cache):
- Turbo: 30 of 32 tasks successful, 1 failed.
- The failure: `@contextboard/desktop#check` — `src/DesktopApp.test.tsx(31,41): error TS2307: Cannot find module '@contextboard/editor'`. This file is **not** in the accent diff and is not touched by any of the 12 changed files. The coordinator reports 32/32 on main; the discrepancy is an environment-specific Windows module resolution issue in this disposable clone, not a regression from the accent changes. Marked `SKIP` below.

## Specific questions

### 1. accent-contrast.test.ts — are the thresholds real?

Yes. The test reads the *actual* CSS rules from `styles.css` and resolves each `--brand-text-{appearance}` to its Tailwind oklch value from `tailwindcss/theme.css`. It then converts oklch → OKLab → linear sRGB using Ottosson's published inverse matrices, computes WCAG 2.x relative luminance on the linear channels (no extra gamma step needed), and asserts `contrastRatio >= 4.5` — the WCAG AA threshold for body text, which is the correct standard for link and label text.

The test is not trivially true. Changing a light-mode accent from `-600` to `-400` would drop the ratio well below 4.5 and fail. The companion test `"every accent declares both appearances"` ensures a newly added accent name without a CSS block won't silently fall back to the `:root` defaults.

### 2. Selection colour after `selection:bg-[...]` removal

The hardcoded `selection:bg-[rgba(99,102,241,0.24)]` on `<body>` in both `index.html` and `__root.tsx` is replaced by a global rule in `styles.css:271–273`:

```css
::selection {
  background: color-mix(in oklab, var(--lagoon) 24%, transparent);
}
```

`--lagoon` resolves to `--brand-fill-light` in `:root` and `--brand-fill-dark` in `.dark`, which in turn resolve to the active accent's fill step. Selection is genuinely themeable — same 24% opacity, now driven by the accent palette instead of hardcoded indigo.

### 3. LEGACY_ACCENT_KEY migration

The migration is correct and necessary.

- Commit `f8a6c3d` introduced a single `theme-accent` key. Commit `83decd9` split it to `theme-accent-light` / `theme-accent-dark`. Anyone who set an accent between those two states needs the fallback.
- `readAccent()` in `theme.ts:49–55` checks the per-appearance key first, falls back to the legacy key, then to `"indigo"`. The SSR init script in `__root.tsx:31` mirrors this logic: `localStorage.getItem('theme-accent-light') || legacy || 'indigo'`.
- The migration is read-only — it never writes the new per-appearance keys. This means the legacy key is re-read on every call until the user explicitly changes an accent (at which point `setAccent` writes the new key, and subsequent reads hit the new key before reaching the fallback). This is correct and avoids silently touching the user's localStorage.
- The test `"a single legacy accent migrates to both appearances"` exercises this path.

### 4. Flash-of-wrong-accent on hydration

No flash in either shell.

- **Web (SSR)**: `THEME_INIT_SCRIPT` runs inline before React hydrates. It sets `data-accent-light` and `data-accent-dark` on `<html>` from localStorage (with legacy fallback). The CSS rules in `styles.css` activate immediately. React's `useAccents` starts at `{ light: "indigo", dark: "indigo" }`, but this only governs the Settings panel's selected-swatch indicator — the visual accent is driven by the data attributes, which are already correct. The `useEffect` syncs React state on mount.
- **Desktop**: `initTheme()` is called before `createRoot()` in `main.tsx:20`, so attributes are set before React mounts. No flash possible.
- **Invalid localStorage values**: If someone stored `"chartreuse"`, the SSR script sets `data-accent-light="chartreuse"`, which matches no CSS rule, so `:root` defaults (indigo) apply visually. After hydration, `getAccents()` validates via `isAccent()`, returns `"indigo"`, and `applyAccents()` corrects the attribute. Visual result: indigo throughout, no flash.

One minor note: the SSR init script does not validate accent names against the `ACCENTS` list (it uses `||` chaining, not an explicit membership check). An invalid stored value temporarily produces a non-matching data attribute that has no visual effect (`:root` defaults cover it). This is harmless but is a difference from `readAccent()` which validates explicitly.

## Added concepts and their owners

| Concept | Owner | Status |
|---------|-------|--------|
| `ACCENTS` array, `Accent` type, `DEFAULT_ACCENT` | `theme.ts` | Outcome delivered |
| `Accents` type (per-appearance record) | `theme.ts` | Outcome delivered |
| `ACCENT_KEYS`, `LEGACY_ACCENT_KEY` (storage keys) | `theme.ts` | Supports persistence + migration |
| `readAccent`, `isAccent` (read + validate) | `theme.ts` | Internal helpers, tested via public API |
| `getAccents`, `applyAccents`, `setAccent` (CRUD) | `theme.ts` | Public API, tested in `theme.test.ts` |
| `initTheme` (combined mode + accent init) | `theme.ts` | Used by desktop shell, tested |
| `useAccents` hook | `useAccents.ts` | React binding, used by `AppearanceSection` |
| `SettingsSwatches` component | `SettingsPrimitives.tsx` | UI for swatch selection |
| `accentOptions` | `AppearanceSection.tsx` | Options derived from `ACCENTS` |
| 16 `[data-accent-*]` CSS rules + `:root` defaults | `styles.css` | Per-accent palette wiring |
| `::selection` rule | `styles.css` | Replaces hardcoded selection colour |
| `color-mix` for hero gradient | `styles.css` | Replaces hardcoded rgba |
| SSR accent bootstrap in `THEME_INIT_SCRIPT` | `__root.tsx` | Prevents flash |
| `initTheme()` call in desktop entry | `main.tsx` | Prevents flash |
| Body class contract test | `desktop-css-contract.test.ts` | Guards removal of `selection:bg-[...]` |
| `accent-contrast.test.ts` (9 assertions) | New test file | WCAG contrast guardrail |
| `theme.test.ts` (4 assertions) | New test file | Per-appearance CRUD + migration |
| `index.ts` alphabetical reorder | `index.ts` | Cosmetic, no API change, no exports dropped |

All concepts directly serve the two requested features. The `index.ts` reorder is cosmetic but harmless — verified that no exports were removed.

## Verdicts

Reviewed implementation commit: 4ccd44255b6309cb34715b4955d9d80798b8cd05

Verdict: PASS

Outcome: PASS

Both requests are delivered: accent is changeable (8 palettes × 2 appearances), and each pair is held to WCAG AA 4.5:1 contrast by a real test.

Minimality: PASS

Every added concept serves one of the two asked features. The `index.ts` alphabetical reorder is the only thing beyond strict scope; it changes no API and introduces no risk.

Conformance: PASS

The implementation matches the owner's two-sentence ask. No trust-boundary crossings. No broad or consequential changes outside the accent feature.

## SKIP items

- `@contextboard/desktop#check` failure (`TS2307: Cannot find module '@contextboard/editor'` in `DesktopApp.test.tsx:31`): **SKIP — environment-specific**. The file is not in the diff. The coordinator reports 32/32 on the same codebase. The failure is a Windows module resolution issue in this disposable clone.

Self-check: Three verdicts emitted (Outcome: PASS, Minimality: PASS, Conformance: PASS). Two suites run (`bun run test`: 1 pre-existing failure in unchanged file; `bun run check`: 1 environment-specific failure in unchanged file, marked SKIP). Four specific review questions answered with evidence. No repository files modified (only `node_modules` from `bun install`).
