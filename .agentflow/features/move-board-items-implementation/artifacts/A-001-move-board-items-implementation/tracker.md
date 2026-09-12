# Tracker

## Identity

- **Work key:** A-001-move-board-items-implementation.

- **Active Ask:** A-001.

- **Goal:** Implement the hierarchy-safe card and whiteboard move design merged in PR #34.

- **Last update:** 2026-09-12 17:17:42 Asia/Taipei.

- **Evidence commit:** uncommitted.

## Overall state

- **State:** active.

- **Reason:** A second hierarchy concurrency finding was corrected; the final allowed exact-commit review, Result Go, and PR delivery remain.

- **Total:** 3.

- **Completed:** 2.

- **Remaining:** 1.

## Accepted task checklist

- [x] **T-1:** Add one atomic application service operation that moves a card placement or nested whiteboard, preserves omitted frame fields, rewrites descendant hierarchy metadata, rejects invalid targets and cycles, and leaves unrelated rows unchanged. Scope excludes arbitrary tldraw records. Proof: failing-first planner and service tests plus the complete application suite. Source: A-001 and `.agentflow/features/move-board-items/artifacts/A-001-move-board-items/design.md`.

- [x] **T-2:** Extend the existing agent `move_item` API with a destination whiteboard and add canvas drag/drop onto an unselected sub-whiteboard tile, with a restrained receiving state and no pointer-move persistence. Scope excludes moving drawings or inventing a second reparent API. Proof: failing-first agent-tool and UI helper/hook tests plus package typecheck. Source: A-001 and merged design PR #34.

- [ ] **T-3:** Run focused tests, relevant package suites, typecheck, lint, commit and push the implementation, obtain a targeted cross-check PASS for the exact commit, then prepare a non-draft implementation PR. Runtime/browser verification remains owner-supplied under AGENTS.md. Proof: direct command output and review report. Source: A-001.

## Accepted scope changes

- None.

## Current recovery

- **Current item:** T-3.

- **Last proven result:** Reciprocal-move and concurrent-create regressions pass; complete application, agent-tool, and web-ui suites pass (180, 51, and 281 tests), and all three package typechecks pass.

- **Active blocker or running process:** None.

- **Next safe action:** Commit the parent revision guard, refresh frozen facts, and run the third and final allowed exact-commit cross-check.

- **Expected changed files:** `.agentflow/features/move-board-items-implementation/**`, `packages/application/src/{runtime.ts,canvas/**}`, `packages/agent-tools/src/{index.ts,index.test.ts}`, `packages/web-ui/src/components/whiteboard/**`.

## Completion proof

- **All accepted tasks checked:** no.

- **Blocking accepted decision:** none.

- **Operation running:** no.

- **Next action remaining:** T-3.

- **Evidence status:** current.

- **Judgment:** active.

## Update meaning

- Saving this tracker is a recovery checkpoint, not a stop signal.

- Work continues with the next unfinished item unless an independent stop condition applies.
