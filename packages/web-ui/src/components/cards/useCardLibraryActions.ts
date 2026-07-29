import { useApplicationRuntime } from "@contextboard/application";
import { useState } from "react";

export function useCardLibraryActions({
	clearSelection,
	setSelectedCardIds,
	previewCardId,
	setPreviewCardId,
}: {
	selectedCardIds: string[];
	clearSelection: () => void;
	setSelectedCardIds: React.Dispatch<React.SetStateAction<string[]>>;
	previewCardId: string | null;
	setPreviewCardId: (cardId: string | null) => void;
}) {
	const { cards, navigation } = useApplicationRuntime();
	const [deleteTargetIds, setDeleteTargetIds] = useState<string[]>([]);
	const [appendTargetCardIds, setAppendTargetCardIds] = useState<string[]>([]);
	const [isAppending, setIsAppending] = useState(false);
	const [appendError, setAppendError] = useState<string | null>(null);

	const closeDeleteDialog = () => setDeleteTargetIds([]);
	const closeAppendDialog = () => {
		if (!isAppending) {
			setAppendTargetCardIds([]);
			setAppendError(null);
		}
	};
	const confirmDelete = async () => {
		const ids = [...deleteTargetIds];
		if (ids.length === 0) return;
		await cards.deleteMany(ids);
		setDeleteTargetIds([]);
		setSelectedCardIds((current) => current.filter((id) => !ids.includes(id)));
		if (previewCardId && ids.includes(previewCardId)) setPreviewCardId(null);
	};
	const confirmAppendToWhiteboard = async (whiteboardId: string) => {
		if (appendTargetCardIds.length === 0 || isAppending) return;
		setIsAppending(true);
		setAppendError(null);
		try {
			if (appendTargetCardIds.length === 1) {
				const placement = await cards.appendToWhiteboard({
					cardId: appendTargetCardIds[0],
					whiteboardId,
				});
				if (!placement?.shapeId)
					throw new Error("Card was appended, but no shape id was returned.");
				setAppendTargetCardIds([]);
				clearSelection();
				navigation.navigate(
					navigation.whiteboardHref(whiteboardId, {
						focus: placement.shapeId,
					}),
				);
			} else {
				await cards.appendManyToWhiteboard({
					cardIds: appendTargetCardIds,
					whiteboardId,
				});
				setAppendTargetCardIds([]);
				clearSelection();
				navigation.navigate(navigation.whiteboardHref(whiteboardId));
			}
		} catch (reason) {
			setAppendError(
				reason instanceof Error
					? reason.message
					: "Failed to append card to whiteboard.",
			);
		} finally {
			setIsAppending(false);
		}
	};

	return {
		deleteTargetIds,
		appendTargetCardIds,
		isAppending,
		appendError,
		appendPickerTitle:
			appendTargetCardIds.length <= 1
				? isAppending
					? "Appending..."
					: "Append to whiteboard"
				: isAppending
					? "Appending cards..."
					: `Append ${appendTargetCardIds.length} cards to whiteboard`,
		openDeleteDialog: setDeleteTargetIds,
		closeDeleteDialog,
		confirmDelete,
		openAppendDialog: (ids: string[]) => {
			setAppendTargetCardIds(ids);
			setAppendError(null);
		},
		closeAppendDialog,
		confirmAppendToWhiteboard,
	};
}
