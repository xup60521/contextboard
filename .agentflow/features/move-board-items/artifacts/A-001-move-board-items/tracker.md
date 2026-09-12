# Tracker

## Identity

- **Work key:** A-001-move-board-items.

- **Active Ask:** A-001.

- **Goal:** Let users and API clients move card placements and nested whiteboards to another whiteboard without corrupting the whiteboard hierarchy.

- **Last update:** 2026-09-12 13:22:00 Asia/Taipei.

- **Evidence commit:** uncommitted.

## Overall state

- **State:** active.

- **Reason:** Design approval and implementation remain.

- **Total:** 4.

- **Completed:** 1.

- **Remaining:** 3.

## Accepted task checklist

- [x] **T-1:** Trace the board-item ownership model, nested-whiteboard hierarchy fields, canvas interaction hooks, and agent tool behavior. Keep unrelated streams and main-checkout files untouched. Proof: exact source inspection recorded in design.md. Source: A-001.

- [ ] **T-2:** Add one atomic application service operation that moves a card placement or sub-whiteboard placement, preserves unspecified frame fields, updates all descendant hierarchy metadata, rejects invalid targets and cycles, and leaves unrelated rows unchanged. Proof: focused planner/service tests cover card moves, subtree moves, root moves, cycles, missing targets, and atomic writes. Source: A-001.

- [ ] **T-3:** Make `move_item` accept a destination whiteboard and make a canvas drop onto a sub-whiteboard invoke the same service operation, with a clear drop-target state and no per-pointer-move persistence. Proof: focused agent-tool and UI helper/hook tests. Source: A-001.

- [ ] **T-4:** Run the focused tests, relevant package suites, typecheck, lint, and required targeted cross-check for the exact implementation commit. Runtime/browser verification remains owner-supplied under AGENTS.md. Proof: command output and PASS review report. Source: A-001.

## Accepted scope changes

- None.

## Current recovery

- **Current item:** T-2.

- **Last proven result:** T-1 source inspection found that `boardItem.whiteboardId` owns placements, while a sub-whiteboard move also requires rewriting `whiteboard.parentWhiteboardId`, `ancestorIds`, `depth`, and `pathKey` for its subtree. The existing `move_item` tool only updates frame fields.

- **Active blocker or running process:** Consequential-work Design Go is required for the plan commit before source edits.

- **Next safe action:** Save and commit design.md plus this tracker, then request Design Go for that exact commit.

- **Expected changed files:** `.agentflow/features/move-board-items/artifacts/A-001-move-board-items/{design.md,tracker.md}`, `packages/application/src/{runtime.ts,canvas/**}`, `packages/agent-tools/src/{index.ts,index.test.ts}`, `packages/web-ui/src/components/whiteboard/**`.

## Completion proof

- **All accepted tasks checked:** no.

- **Blocking accepted decision:** Design Go for the exact plan commit.

- **Operation running:** no.

- **Next action remaining:** T-2.

- **Evidence status:** current.

- **Judgment:** active.

## Update meaning

- Saving this tracker is a recovery checkpoint, not a stop signal.

- Work continues with the next unfinished item unless an independent stop condition applies.
