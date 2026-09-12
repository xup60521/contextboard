# STATUS

Project: contextboard 

Notebook: .agentflow/features/move-board-items/move-board-items.devlog.md — stream.

Current commit: stream-open only, no code commits yet.

Tests/scenarios: none.

Configuration: .agentflow/features/move-board-items/ag.json — schema v7; validated for codex this round.

Proven: the stream configuration was copied from the root configuration.

Open: none.

Next: reply to the first Ask below.

Artifacts: none.

Archived eras: none.

Streams: none.

Backlink: main notebook `.agentflow/devlog.md` (main checkout)

Feature: move-board-items — active — Move cards and whiteboards between boards

Opened by the `agf` shell shortcut on 2026-09-12, not by an agent round. The main-notebook `stream:` pointer line was deliberately NOT written — the next main-checkout session re-derives it from `.agentflow/features/*/*devlog.md`.

---

# → Ask / A-001

godev
Right now, I have no ways to drag and drop cards/whiteboards into another sub-whiteboard. And there's no way to change what a sub-whiteboard belongs to.
It seems that the same problem persists in the api layer. You might as well take that into consideration.

## [RUN-001] Event - stream opened and direct route selected (during round A-001)

- Scope: let users move cards and nested whiteboards into another sub-whiteboard, and support changing a nested whiteboard's parent through the application/API layer.
- Route: direct. The work is local, reversible, and bounded. Existing root-notebook changes, the active `a-002-card-library-selection` stream, `agentflow-skill.zip`, and `tmp/` remain untouched.
- First action: trace the persisted ownership model, commands/API, and drag/drop affordances before freezing the smallest design.

## [RUN-002] Event - design frozen for hierarchy-safe moves (during round A-001)

- T-1 complete. The smallest contract is one atomic `CanvasService.moveItem` used by same-board frame edits, ownership moves, canvas drops, and the existing agent `move_item` tool.
- A sub-whiteboard move rewrites its placement plus the moved board and all descendants. Cards cannot target the virtual root, and whiteboards cannot target themselves or descendants.
- Rejected archive-plus-create because it changes identity and placement counts, and rejected a separate reparent API because the placement and parent would gain competing write paths.
- Tracker validation: PASS. Source edits are gated on Design Go for the next exact plan commit.
