import { useAtomValue, useSetAtom } from "jotai";
import { memo, useCallback } from "react";
import { CardPreviewDialog } from "#/components/search/CardPreviewDialog";
import { whiteboardPreviewCardIdAtom } from "#/lib/atoms";
import type { Id } from "../../../convex/_generated/dataModel";

type WhiteboardCardPreviewLayerProps = {
	currentWhiteboardId: Id<"whiteboards"> | null;
};

export const WhiteboardCardPreviewLayer = memo(
	function WhiteboardCardPreviewLayer({
		currentWhiteboardId,
	}: WhiteboardCardPreviewLayerProps) {
		const cardId = useAtomValue(whiteboardPreviewCardIdAtom);
		const setCardId = useSetAtom(whiteboardPreviewCardIdAtom);
		const handleClose = useCallback(() => {
			setCardId(null);
		}, [setCardId]);

		return (
			<CardPreviewDialog
				cardId={cardId}
				currentWhiteboardId={currentWhiteboardId}
				onClose={handleClose}
			/>
		);
	},
);
