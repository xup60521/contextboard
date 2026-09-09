* _2026-09-09 16:46:43 (claude-opus-4-6/high)_

Reviewed implementation commit: f13cec5aa73d1ba95d222dd33f41d29865e0ccd0

## Findings

**Point 1 — Is normalize_report acceptable evidence handling?**

The coordinator's position holds. The function trims only what precedes the first stamp line — a chat-style preamble injected by the CLI, not the worker's actual review content. Three safeguards make this defensible: (a) `preamble_trimmed_bytes` is recorded alongside `stdout_bytes`, so the edit is arithmetically verifiable against the raw output; (b) a stampless report (stamp index <= 0) is returned byte-identical, so a quota error or crash is never mangled; (c) the content from the stamp line onward is preserved verbatim, so no finding, verdict, or self-check is altered. The opposite case — that normalization constitutes evidence tampering — would require the preamble to carry substantive review content, which contradicts the report format contract that puts all substance after the stamp.

**Point 2 — Could a body-internal stamp-shaped line cause incorrect truncation?**

The risk is negligible. The pattern requires `^` and `$` anchors and a specific `* _YYYY-MM-DD HH:MM:SS (model/effort)_` shape, so a stamp mentioned inline in prose (e.g. "the stamp `* _2026-...` was wrong") will not match — it won't occupy the full line. A standalone stamp-shaped line in the body before the real stamp would require a review to quote another report's opening stamp verbatim on its own line, ahead of its own stamp — an arrangement the report format contract does not produce. Even if it occurred, `findIndex` finds the first match, so the trim would be too small (less preamble removed) rather than too large, and `preamble_trimmed_bytes` would flag the anomaly. Bounding the search to the first N lines would introduce a fragile magic number and would fail if a particularly verbose CLI preamble exceeded that bound.

**Point 3 — Should either duplicated pattern have been shared instead?**

The reasoning holds for both. The per-family flag spellings (`family_model_flags`) are duplicated from `looper.js:1148–1154`, and the stamp pattern (`REPORT_STAMP_PATTERN`) is duplicated from `round-linter.js:12`. Neither source module exports the relevant symbols. Modifying `looper.js` to export `configured_worker_args` would trigger the mandatory WSL live gate per `references/looper.md`, which the Ask does not justify. Modifying `round-linter.js` to export `artifact_opening_stamp_pattern` would be a smaller change, but it still expands the change set beyond the three identified defects into a module with its own test surface. The scope discipline instruction — "do not refactor... unless the Ask requires it" — applies equally to both. Both duplications are small (one regex, one two-branch conditional), marked with comments noting the source, and pinned by unit tests that would catch divergence.

**Point 4 — Do the ten tests actually pin the three defects?**

Yes. For defect 1 (effort not passed): the "worker invocation passes the configured effort for each supported family" test asserts the exact argument array including `-c model_reasoning_effort=high` for codex and `--effort high` for claude. The old code `[...selected.args, '--model', selected.model, ...worker_args, brief_text]` omitted both, so the deepEqual assertions would fail. For defect 2 (active_host in wrong argument): the "reviewer selection honours cli-provider off" test creates a codex-first config with cli-provider off (default), calls `select_reviewer`, and asserts the result is claude-default. If `active_host` were still in the second argument, `resolve_worker_tier` would not perform family filtering (confirmed by reading `ag-settings.js:371` where `family_for_host(options.active_host ...)` reads from `validation_options`), codex would win by priority, and the assertion would fail. The complementary "still crosses families when cli-provider is on" test confirms the mechanism. For defect 3 (preamble fails gate): the "drops a chat preamble" test asserts the stamp lands on line one and the trimmed bytes are correct; the "leaves a stampless report untouched" test asserts error output is not mangled. None of these tests could pass against the pre-fix code.

**Point 5 — Is select_reviewer's rest-parameter spread safe?**

The spread `{ role = 'cross-check', active_host = 'claude', ...validation }` forwards unrecognized options (such as `executables`, `cli_provider`) into `validation_options`. This is acceptably loose for an internal helper that is not a trust boundary. All forwarded options reach `resolve_worker_tier`, which already validates its inputs — it throws on `worker_kind`, for example, and `assert_valid_config` validates the config against the options. The current callers are `main()` in dispatch-review.js (passing only `role`) and the test file (passing `role` and `executables`). A hypothetical misuse where someone passes `tier` would have `tier` land in `validation_options` rather than `role_or_options`, so it would be silently ignored rather than misapplied — a no-op, not a hazard. The alternative — enumerating every validation option — would couple `select_reviewer` to the `resolve_worker_tier` signature and require updating both when a new validation option is added.

Outcome: PASS
All three defects are correctly addressed. The effort flag is now spelled per family, active_host reaches validation_options through the third argument, and normalize_report strips CLI preambles while preserving auditability. No regression was introduced.

Minimality: PASS
Changes are confined to dispatch-review.js and its test file. Three focused extractions (select_reviewer, worker_invocation, normalize_report) address exactly the three reported defects. No adjacent modules were modified, no dependencies added, no unrelated behavior changed.

Conformance: PASS
The two commits address only the defects identified and authorized by the owner. The duplication tradeoff respects scope discipline by not expanding into looper.js or round-linter.js. Test coverage is proportional to the fixes.

Verdict: PASS

Self-check: I read the cumulative diff, both individual commits, the full dispatch-review.js and its test file, the resolve_worker_tier signature and its callers in ag-settings.test.js, the stamp pattern in round-linter.js, and the per-family flag spellings in looper.js; I did not run the tests myself.
