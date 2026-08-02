/**
 * Shared registry of card shapes whose height this session has already measured.
 *
 * A card created by an agent carries an *estimated* height
 * (`estimateCardHeight`), since the agent has no DOM to measure. The first
 * client to actually render the card can do better, so the auto-height hook is
 * allowed one measurement per shape while the card is not being edited.
 *
 * Exactly one is the whole point. The card's `ResizeObserver` stays gated on
 * `isEditing`: letting it write `h` on every frame for non-editing cards
 * re-fires the content-hydration reactive continuously and freezes the app.
 * This registry is what turns "measure when idle" from a loop into a one-shot.
 */
const measuredShapeIds = new Set<string>();

export function hasMeasuredCardHeight(shapeId: string): boolean {
	return measuredShapeIds.has(shapeId);
}

export function markCardHeightMeasured(shapeId: string): void {
	measuredShapeIds.add(shapeId);
}

export function forgetMeasuredCardHeight(shapeId: string): void {
	measuredShapeIds.delete(shapeId);
}
