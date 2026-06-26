import { useConvex } from "convex/react";
import { useCallback, useMemo, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { CardReferenceSupport } from "./card-reference/types";

type ExternalPreviewState = {
	previewCardId: Id<"cards"> | null;
	setPreviewCardId: (id: Id<"cards"> | null) => void;
};

/**
 * Connects a card editor to card references. Provides the `@` picker search
 * (global by default, recent cards from `whiteboardId` on an empty query) and
 * owns the modifier-click preview state so the wrapper can render the dialog.
 *
 * Pass `externalPreviewState` to share preview state with a parent component
 * (e.g. when the dialog is rendered outside the tldraw shape tree).
 */
export function useCardReferenceSupport(
	whiteboardId: Id<"whiteboards"> | null | undefined,
	externalPreviewState?: ExternalPreviewState,
): {
	support: CardReferenceSupport;
	previewCardId: Id<"cards"> | null;
	closePreview: () => void;
} {
	const convex = useConvex();
	const [localPreviewCardId, localSetPreviewCardId] = useState<Id<"cards"> | null>(null);

	const previewCardId = externalPreviewState?.previewCardId ?? localPreviewCardId;
	const setPreviewCardId = externalPreviewState?.setPreviewCardId ?? localSetPreviewCardId;

	const search = useCallback(
		async (query: string) => {
			const term = query.trim();
			return await convex.query(
				api.search.searchCardsForReference,
				whiteboardId ? { term, whiteboardId } : { term },
			);
		},
		[convex, whiteboardId],
	);

	const onOpenPreview = useCallback(
		(cardId: string) => {
			setPreviewCardId(cardId as Id<"cards">);
		},
		[setPreviewCardId],
	);

	const support = useMemo<CardReferenceSupport>(
		() => ({ search, onOpenPreview }),
		[search, onOpenPreview],
	);

	const closePreview = useCallback(
		() => setPreviewCardId(null),
		[setPreviewCardId],
	);

	return { support, previewCardId, closePreview };
}
