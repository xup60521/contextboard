# Move cards and whiteboards between boards

## Original Ask

> Right now, I have no ways to drag and drop cards/whiteboards into another sub-whiteboard. And there's no way to change what a sub-whiteboard belongs to.
> It seems that the same problem persists in the api layer. You might as well take that into consideration.

## Normal journey

1. A user selects one or more managed canvas shapes and drags them over a sub-whiteboard tile.
2. The tile shows that it will receive the shapes. Releasing moves every eligible placement into that child whiteboard.
3. The source board removes the moved shapes after the application service commits. Opening the destination shows them at their final frames.
4. An API client gets the same outcome by calling `move_item` with the source `whiteboardId`, `itemId`, and a `targetWhiteboardId`. Omitted frame fields keep their current values.
5. Moving a nested whiteboard changes its parent and updates ancestry metadata for its full subtree. Attempts to move it into itself or a descendant fail without writes.

## Smallest design

Add `CanvasService.moveItem`. It accepts one item id, a target whiteboard id or null, and optional frame fields. Cards require a real target board. Sub-whiteboards may target the virtual root. The method reads the current item and active whiteboards, plans every affected row, and applies one optimistic repository command.

For cards, the plan updates only the placement row. For sub-whiteboards, it updates the placement row, the child whiteboard, and every descendant whiteboard. The moved board receives a new sibling sort key under its destination. Descendants keep their sort keys while their `parentWhiteboardId`, `ancestorIds`, `depth`, and `pathKey` are derived from the newly updated parent chain.

The existing `move_item` agent tool gains optional `targetWhiteboardId` and calls `CanvasService.moveItem` for both same-board frame edits and ownership changes. Its existing `whiteboardId` remains the source-board guard, so stale callers cannot move an item they did not inspect.

The canvas adds a focused drag-to-subwhiteboard interaction hook. It finds an unselected sub-whiteboard beneath the released pointer, shows a receiving state during the drag, and sends the selected managed item ids through the service after release. The hook removes moved shapes under the hydration guard only after each move succeeds, so the normal deletion listener cannot archive them. Persistence stays paused during the pointer gesture.

## Required rules

- The destination must exist and be active, except for the virtual root used only by sub-whiteboards.
- A card cannot move to the virtual root.
- A sub-whiteboard cannot become its own parent or a descendant of itself.
- A no-op destination is allowed and behaves as a frame update.
- Unspecified frame fields keep their stored values.
- The move is one repository command so a stale revision cannot partially rewrite a subtree.
- Moving an item does not duplicate it, archive it, change card placement counts, or move arbitrary tldraw drawing records.
- Canvas drop handles only managed card and sub-whiteboard shapes. Freehand drawings and other records stay on the source board.

## Necessary added concepts

`CanvasService.moveItem` is necessary because `updateItemFrame` cannot express an ownership change, and combining archive plus create would change identity and can partially fail. A small pure move planner is necessary to make subtree rewrites testable and atomic across storage backends.

The transient drop-target state is necessary to tell the user which nested board will receive the selection. It reuses the existing sub-whiteboard tile and theme variables rather than introducing a new visual system.

## Rejected smaller alternatives

- Updating only `boardItem.whiteboardId` was rejected. It would make a moved sub-whiteboard's placement disagree with its `parentWhiteboardId`, breadcrumbs, depth, and path.
- Archiving the source placement and creating a destination placement was rejected. It changes the item and shape ids, changes card placement counts, and cannot atomically reparent a whiteboard subtree.
- Adding a separate `reparentWhiteboard` API was rejected. A sub-whiteboard's parent is represented by its placement, so one item-move contract covers cards, whiteboards, canvas drag/drop, and agent calls without two sources of truth.
- Moving arbitrary tldraw records with a card was rejected. The request concerns cards and whiteboards, while arrows, bindings, notes, and drawings have board-scoped persistence and unclear transfer semantics.

## Verification

Start with failing tests for the planner/service contract and agent tool destination field. Add small pure tests for drop-target selection and the successful handoff behavior. Then run the focused package tests, relevant complete package suites, typecheck, lint, and a targeted independent cross-check against the exact implementation commit. Per AGENTS.md, do not start a dev server; runtime/browser evidence can only come from the laptop owner.
