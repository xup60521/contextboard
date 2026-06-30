import type { useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

type Navigate = ReturnType<typeof useNavigate>;

export function useCardLibraryActions({
	clearSelection,
	setSelectedCardIds,
	previewCardId,
	setPreviewCardId,
	navigate,
}: {
	selectedCardIds: Id<"cards">[];
	clearSelection: () => void;
	setSelectedCardIds: React.Dispatch<React.SetStateAction<Id<"cards">[]>>;
	previewCardId: Id<"cards"> | null;
	setPreviewCardId: (cardId: Id<"cards"> | null) => void;
	navigate: Navigate;
}) {
	const archiveCards = useMutation(api.cards.archiveCards);
	const appendToWhiteboard = useMutation(api.cards.appendToWhiteboard);
	const appendCardsToWhiteboard = useMutation(
		api.cards.appendCardsToWhiteboard,
	);
	const [deleteTargetIds, setDeleteTargetIds] = useState<Id<"cards">[]>([]);
	const [appendTargetCardIds, setAppendTargetCardIds] = useState<Id<"cards">[]>(
		[],
	);
	const [isAppending, setIsAppending] = useState(false);
	const [appendError, setAppendError] = useState<string | null>(null);

	const openDeleteDialog = (cardIds: Id<"cards">[]) => {
		setDeleteTargetIds(cardIds);
	};

	const openAppendDialog = (cardIds: Id<"cards">[]) => {
		setAppendTargetCardIds(cardIds);
		setAppendError(null);
	};

	const closeDeleteDialog = () => {
		setDeleteTargetIds([]);
	};

	const closeAppendDialog = () => {
		if (isAppending) return;
		setAppendTargetCardIds([]);
		setAppendError(null);
	};

	const confirmDelete = async () => {
		const targetIds = [...deleteTargetIds];
		if (targetIds.length === 0) return;

		await archiveCards({ cardIds: targetIds });
		setDeleteTargetIds([]);
		setSelectedCardIds((prev) =>
			prev.filter((cardId) => !targetIds.includes(cardId)),
		);

		if (previewCardId && targetIds.includes(previewCardId)) {
			setPreviewCardId(null);
		}
	};

	const confirmAppendToWhiteboard = async (whiteboardId: Id<"whiteboards">) => {
		if (appendTargetCardIds.length === 0 || isAppending) return;

		setIsAppending(true);
		setAppendError(null);

		try {
			if (appendTargetCardIds.length === 1) {
				const placement = await appendToWhiteboard({
					cardId: appendTargetCardIds[0],
					whiteboardId,
				});

				if (!placement?.shapeId) {
					throw new Error("Card was appended, but no shape id was returned.");
				}

				setAppendTargetCardIds([]);
				clearSelection();

				await navigate({
					to: "/whiteboard/$whiteboardId",
					params: { whiteboardId: placement.whiteboardId },
					search: { focus: placement.shapeId },
				});
				return;
			}

			const result = await appendCardsToWhiteboard({
				cardIds: appendTargetCardIds,
				whiteboardId,
			});
			setAppendTargetCardIds([]);
			clearSelection();

			await navigate({
				to: "/whiteboard/$whiteboardId",
				params: { whiteboardId: result.whiteboardId },
			});
		} catch (error) {
			setAppendError(
				error instanceof Error
					? error.message
					: "Failed to append card to whiteboard.",
			);
		} finally {
			setIsAppending(false);
		}
	};

	const appendPickerTitle =
		appendTargetCardIds.length <= 1
			? isAppending
				? "Appending..."
				: "Append to whiteboard"
			: isAppending
				? "Appending cards..."
				: `Append ${appendTargetCardIds.length} cards to whiteboard`;

	return {
		deleteTargetIds,
		appendTargetCardIds,
		isAppending,
		appendError,
		appendPickerTitle,
		openDeleteDialog,
		closeDeleteDialog,
		confirmDelete,
		openAppendDialog,
		closeAppendDialog,
		confirmAppendToWhiteboard,
	};
}
