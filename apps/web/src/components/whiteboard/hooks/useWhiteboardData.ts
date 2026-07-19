import { useMutation, usePaginatedQuery, useQuery } from "#/integrations/local/react";
import { api } from "#/integrations/local/api";
import type { Id } from "#/integrations/local/types";
import type {
	BoardItemResult,
	TldrawDocumentResult,
} from "../whiteboard-canvas-helpers";

export function useWhiteboardData(
	whiteboardId: Id<"whiteboards"> | null,
) {
	const whiteboard = useQuery(
		api.whiteboards.get,
		whiteboardId ? { whiteboardId } : "skip",
	);
	const breadcrumbs = useQuery(
		api.whiteboards.getBreadcrumbs,
		whiteboardId ? { whiteboardId } : "skip",
	);
	const itemQuery = usePaginatedQuery(
		api.canvas.listItems,
		{ whiteboardId },
		{ initialNumItems: 200 },
	);
	const tldrawDocument = useQuery(api.tldrawDocuments.get, {
		whiteboardId,
	}) as TldrawDocumentResult | undefined;

	const createCardItem = useMutation(api.canvas.createCardItem);
	const createSubwhiteboardItem = useMutation(
		api.canvas.createSubwhiteboardItem,
	);
	const updateItemFrame = useMutation(api.canvas.updateItemFrame);
	const archiveItem = useMutation(api.canvas.archiveItem);
	const archiveCardsGlobally = useMutation(api.cards.archiveCards);
	const restoreOrAdoptCardItem = useMutation(api.canvas.restoreOrAdoptCardItem);
	const saveTldrawDocument = useMutation(api.tldrawDocuments.save);
	const generateUploadUrl = useMutation(api.files.generateUploadUrl);
	const finalizeUpload = useMutation(api.files.finalizeUpload);

	const items = (itemQuery.results ?? []) as BoardItemResult[];

	return {
		whiteboard,
		breadcrumbs,
		itemQuery,
		items,
		tldrawDocument,
		createCardItem,
		createSubwhiteboardItem,
		updateItemFrame,
		archiveItem,
		archiveCardsGlobally,
		restoreOrAdoptCardItem,
		saveTldrawDocument,
		generateUploadUrl,
		finalizeUpload,
	};
}
