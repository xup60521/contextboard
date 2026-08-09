/** A card the `@` picker can insert, mirroring the backend suggestion shape. */
export type CardReferenceSuggestion = {
	kind?: "card";
	id: string;
	title: string;
	preview: string;
	boardWhiteboardId: string | null;
	shapeId: string | null;
};
export type WhiteboardReferenceSuggestion = {
	kind: "whiteboard";
	id: string;
	title: string;
	preview: string;
};
export type ReferenceSuggestion =
	| CardReferenceSuggestion
	| WhiteboardReferenceSuggestion;

/**
 * The Convex-connected behavior the generic `RichTextEditor` needs to support
 * card references. Supplied by the card editor wrappers; absent on the
 * standalone/local editors so they stay free of Convex dependencies.
 */
export type CardReferenceSupport = {
	/** Searches cards for the `@` picker. `signal` aborts a superseded search. */
	search: (
		query: string,
		signal: AbortSignal,
	) => Promise<ReferenceSuggestion[]>;
	/** Opens the card preview modal for a referenced card (modifier-click). */
	onOpenPreview: (cardId: string) => void;
	onOpenWhiteboard?: (whiteboardId: string) => void;
};
