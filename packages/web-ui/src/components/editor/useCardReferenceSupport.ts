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
	previewWhiteboardId: string | null;
	closeWhiteboardPreview: () => void;
} {
	const { cards, whiteboards } = useApplicationRuntime();
	const [previewCardId, setPreviewCardId] = useState<string | null>(null);
	const [previewWhiteboardId, setPreviewWhiteboardId] = useState<string | null>(
		null,
	);

	const search = useCallback(
		async (query: string) => {
			const trimmed = query.trim();
			const [cardResults, whiteboardResults, allBoards] = await Promise.all([
				cards.search({
					query: trimmed,
					whiteboardId: whiteboardId ?? undefined,
					limit: 8,
				}),
				whiteboards?.search({ query: trimmed, limit: 5 }) ??
					Promise.resolve([]),
				whiteboards?.list() ?? Promise.resolve([]),
			]);
			const titles = new Map(allBoards.map((board) => [board.id, board.title]));
			return [
				...cardResults.map((card) => ({ ...card, kind: "card" as const })),
				...whiteboardResults.map((board) => ({
					kind: "whiteboard" as const,
					id: board.id,
					title: board.title,
					preview: board.ancestorIds
						.map((id) => titles.get(id))
						.filter(Boolean)
						.join(" / "),
				})),
			];
		},
		[cards, whiteboardId, whiteboards],
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
		() => ({
			search,
			onOpenPreview,
			onOpenWhiteboard: setPreviewWhiteboardId,
		}),
		[search, onOpenPreview],
	);

	const closePreview = useCallback(() => setPreviewCardId(null), []);
	const closeWhiteboardPreview = useCallback(
		() => setPreviewWhiteboardId(null),
		[],
	);

	return {
		support,
		previewCardId,
		closePreview,
		previewWhiteboardId,
		closeWhiteboardPreview,
	};
}
