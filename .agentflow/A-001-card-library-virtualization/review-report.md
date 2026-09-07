Reviewed `a2a10a5` read-only. `scripts/lint-board.ts` was correctly excluded: parent and commit both reference blob `0427b39…`; it remains modified only in the worktree.

Trust boundaries: allowlist enforcement remains on session and one-time-token verification; agent discovery now uniformly rejects non-empty bodies; desktop IPC carries an explicit workspace ID; blob downloads use shared HTTP error handling. No authorization weakening found. Direct checks passed: sync-server 63/63, agent guard 8/8, agent-tools 50/50, client-core 11/11.

Deleted web UI wrappers have live `@contextboard/web-ui` exports; no dangling imports. `lib/theme` maps to the package export; `lib/constants` was unused before deletion. No dependency changes or whitespace errors.

Commands:
- `bun run check`: 32/32 tasks passed.
- `bun run test`: reproduced the two unrelated `arrange-relations` 5-second timeouts.
- `packages/application: bun run test -- arrange-relations`: 17/17 passed in 8.11s, confirming contention timeouts rather than a regression.
- `apps/desktop: bun run test`: 2 failures found.

Blocking issue: [DesktopRuntimeProvider.test.tsx](D:\code\side_project\contextboard\apps\desktop\src\runtime\DesktopRuntimeProvider.test.tsx:123) expects `workspace_query` without `input: {}`, though its click at line 35 sends it. The same commit’s storage-desktop contract expects `{ type: "cards.list", input: {} }`. Both workspace-switch variants fail, so the committed desktop suite is red.

Scope note: the commit includes broad cleanup/refactoring and test-pruning across runtime, repository, editor, and UI code; this is consistent with the explicit “commit all except board linter” staging direction, but is not a narrow housekeeping commit.

Outcome: BLOCKING
Minimality: PASS
Conformance: BLOCKING