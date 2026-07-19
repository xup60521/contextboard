import type { Id } from "../../../convex/_generated/dataModel";

/**
 * Shared registry of cards whose local content has unsaved edits.
 *
 * Editing a markdown card writes `shape.props.content` immediately but bumps
 * `contentVersion` only once the server acknowledges the save. During that
 * window the shape's local content diverges from the server content at the same
 * version, so version-equality checks can't tell the content is dirty. The
 * hydration reactive (`collectCandidateCardIds`) and the items refresh
 * (`preserveEditingCardContent`) consult this registry to avoid overwriting —
 * and re-triggering on — freshly-edited content.
 */
const dirtyCardIds = new Set<Id<"cards">>();

export function markCardContentDirty(cardId: Id<"cards">): void {
	dirtyCardIds.add(cardId);
}

export function clearCardContentDirty(cardId: Id<"cards">): void {
	dirtyCardIds.delete(cardId);
}

export function isCardContentDirty(cardId: Id<"cards">): boolean {
	return dirtyCardIds.has(cardId);
}
