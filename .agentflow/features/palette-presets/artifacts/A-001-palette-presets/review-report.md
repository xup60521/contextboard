* _2026-09-09 17:36:18 (claude-opus-4-6/high)_

Reviewed implementation commit: 51b0422

## Findings

The unified choice correctly means one selected hue with appearance-specific shades. That preserves legibility and matches how established systems map accent aliases by color mode. [Radix guidance](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale) supports that approach.

The replacement hues are defensible, but contrast tests cannot establish that adjacent indigo, violet, and purple swatches read distinctly. Owner visual review remains necessary, since no browser check was performed.

Migration has a functional hole. The old implementation retained `theme-accent`; this commit now treats that same key as authoritative before consulting `theme-accent-light`. Users who later changed either per-appearance value can therefore receive a stale pre-split accent, not their selected light value. A deterministic light-side migration is acceptable, but it must take precedence over the obsolete global key during migration.

Custom colours are not safe to ship. `applyAccent` assigns the chosen hex to both fill and text variables in both modes. A white custom colour makes light-mode links disappear; a black one makes dark-mode links disappear. More fundamentally, a single text colour cannot meet 4.5:1 against both the white and dark surfaces here. Presets avoid this through separate appearance-specific text steps, so custom needs the same safeguard.

Loosening `SettingsSwatches.value` to `string` only weakens selected-state checking. Its options and change callback remain generic, and this component has no other callers, so this is not a material type-safety defect.

The root route also includes unrelated import reordering and reindentation from formatting. The stated scope explicitly excludes reformatting.

Outcome: BLOCKING
The custom-colour path guarantees inaccessible text in at least one appearance, and migration can restore a stale accent.

Minimality: BLOCKING
Unrelated formatting changes were included despite the scope instruction against reformatting.

Conformance: BLOCKING
The custom option does not provide a usable, accessible customization path across both themes.

Verdict: BLOCKING

Self-check: I reviewed the commit and range diffs, source, CSS contrast test, migration behavior, and public palette guidance; package tests could not start because this checkout lacks Vitest and TypeScript, and no browser was run.
