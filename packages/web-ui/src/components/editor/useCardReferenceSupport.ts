import { useApplicationRuntime } from "@contextboard/application";
import type { CardReferenceSupport } from "@contextboard/editor";
import { useCallback, useMemo, useState } from "react";

type CardReferenceSupportOptions = {
	onOpenPreview?: (cardId: string) => void;
};

/**
 * Connects a card editor to card references. Provides the `@` picker search
 * (global by default, recent cards from `whiteboardId` on an empty query) and
 * owns the modifier-click preview state so the wrapper can render the dialog.
 */
export function useCardReferenceSupport(
	whiteboardId: string | null | undefined,
	options?: CardReferenceSupportOptions,
): {
	support: CardReferenceSupport;
	previewCardId: string | null;
	closePreview: () => void;
} {
	const { cards } = useApplicationRuntime();
	const [previewCardId, setPreviewCardId] = useState<string | null>(null);

	const search = useCallback(
		async (query: string) =>
			await cards.search({
				query: query.trim(),
				whiteboardId: whiteboardId ?? undefined,
			}),
		[cards, whiteboardId],
	);

	const onOpenPreview = useCallback(
		(cardId: string) => {
			if (options?.onOpenPreview) {
				options.onOpenPreview(cardId);
				return;
			}
			setPreviewCardId(cardId);
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
