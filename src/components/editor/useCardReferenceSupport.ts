import { useConvex } from "convex/react";
import { useCallback, useMemo, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { CardReferenceSupport } from "./card-reference/types";

type CardReferenceSupportOptions = {
	onOpenPreview?: (cardId: Id<"cards">) => void;
};

/**
 * Connects a card editor to card references. Provides the `@` picker search
 * (global by default, recent cards from `whiteboardId` on an empty query) and
 * owns the modifier-click preview state so the wrapper can render the dialog.
 */
export function useCardReferenceSupport(
	whiteboardId: Id<"whiteboards"> | null | undefined,
	options?: CardReferenceSupportOptions,
): {
	support: CardReferenceSupport;
	previewCardId: Id<"cards"> | null;
	closePreview: () => void;
} {
	const convex = useConvex();
	const [previewCardId, setPreviewCardId] = useState<Id<"cards"> | null>(null);

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
			if (options?.onOpenPreview) {
				options.onOpenPreview(cardId as Id<"cards">);
				return;
			}
			setPreviewCardId(cardId as Id<"cards">);
		},
		[options],
	);

	const support = useMemo<CardReferenceSupport>(
		() => ({ search, onOpenPreview }),
		[search, onOpenPreview],
	);

	const closePreview = useCallback(() => setPreviewCardId(null), []);

	return { support, previewCardId, closePreview };
}
