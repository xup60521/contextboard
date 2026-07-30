import {
	fileSrc,
	type CanvasItem,
	type WhiteboardBreadcrumb,
	type WhiteboardDetail,
	useApplicationRuntime,
} from "@contextboard/application";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Id } from "../ids";
import type {
	BoardItemResult,
	TldrawDocumentResult,
} from "../whiteboard-canvas-helpers";

function toBoardItem(item: CanvasItem): BoardItemResult {
	return {
		_id: item.id,
		kind: item.kind,
		cardId: item.cardId,
		childWhiteboardId: item.childWhiteboardId,
		shapeId: item.shapeId,
		x: item.x,
		y: item.y,
		w: item.w,
		h: item.h,
		rotation: item.rotation,
		zIndex: item.zIndex,
		card: item.card
			? {
					_id: item.card.id,
					derivedTitle: item.card.title,
					preview: item.card.preview,
					version: item.card.version,
				}
			: null,
		childWhiteboard: item.childWhiteboard
			? {
					_id: item.childWhiteboard.id,
					title: item.childWhiteboard.title,
					depth: item.childWhiteboard.depth,
					cardCount: item.childWhiteboard.cardCount,
					childWhiteboardCount: item.childWhiteboard.childWhiteboardCount,
				}
			: null,
	};
}

/**
 * Backs the shared canvas with the platform's canvas capability.
 *
 * The returned shape deliberately mirrors what the Web query hooks produced,
 * so every canvas hook downstream stays untouched: `undefined` means "still
 * loading", `null` means "not found", and the mutations keep their original
 * argument objects.
 */
export function useWhiteboardData(whiteboardId: Id<"whiteboards"> | null) {
	const runtime = useApplicationRuntime();
	const { canvas, whiteboards, files, cards } = runtime;

	const [whiteboard, setWhiteboard] = useState<
		WhiteboardDetail | null | undefined
	>();
	const [breadcrumbs, setBreadcrumbs] = useState<
		WhiteboardBreadcrumb[] | undefined
	>();
	const canvasKey = whiteboardId ?? "__root__";
	const [canvasData, setCanvasData] = useState<
		| {
				key: string;
				items: CanvasItem[];
				document: TldrawDocumentResult;
		  }
		| undefined
	>();
	const activeCanvasData =
		canvasData?.key === canvasKey ? canvasData : undefined;
	const items = activeCanvasData?.items;
	const tldrawDocument = activeCanvasData?.document;

	useEffect(() => {
		if (!whiteboardId || !whiteboards) {
			setWhiteboard(null);
			setBreadcrumbs([]);
			return;
		}
		let active = true;
		setWhiteboard(undefined);
		const load = async () => {
			const detail = await whiteboards.get(whiteboardId);
			if (!active) return;
			setWhiteboard(detail);
			setBreadcrumbs(detail?.breadcrumbs ?? []);
		};
		void load();
		const unsubscribe = whiteboards.subscribe(() => void load());
		return () => {
			active = false;
			unsubscribe();
		};
	}, [whiteboardId, whiteboards]);

	useEffect(() => {
		if (!canvas) return;
		let active = true;
		setCanvasData(undefined);
		const load = async () => {
			const [nextItems, nextDocument] = await Promise.all([
				canvas.listItems(whiteboardId ?? null),
				canvas.getDocument(whiteboardId ?? null),
			]);
			if (!active) return;
			setCanvasData({
				key: canvasKey,
				items: nextItems,
				document: nextDocument
					? ({
							whiteboardId: nextDocument.whiteboardId,
							snapshot: nextDocument.snapshot,
							revision: nextDocument.revision,
							canvasRecordVersions: nextDocument.canvasRecordVersions,
						} as NonNullable<TldrawDocumentResult>)
					: null,
			});
		};
		void load();
		const unsubscribe = canvas.subscribe(() => void load());
		return () => {
			active = false;
			unsubscribe();
		};
	}, [canvas, canvasKey, whiteboardId]);

	const requireCanvas = useCallback(() => {
		if (!canvas) throw new Error("This platform has no canvas capability");
		return canvas;
	}, [canvas]);

	type Canvas = NonNullable<typeof canvas>;
	const createCardItem = useCallback(
		(input: Parameters<Canvas["createCardItem"]>[0]) =>
			requireCanvas().createCardItem(input),
		[requireCanvas],
	);
	const createSubwhiteboardItem = useCallback(
		(input: Parameters<Canvas["createSubwhiteboardItem"]>[0]) =>
			requireCanvas().createSubwhiteboardItem(input),
		[requireCanvas],
	);
	const updateItemFrame = useCallback(
		(input: Parameters<Canvas["updateItemFrame"]>[0]) =>
			requireCanvas().updateItemFrame(input),
		[requireCanvas],
	);
	const archiveItem = useCallback(
		(input: Parameters<Canvas["archiveItem"]>[0]) =>
			requireCanvas().archiveItem(input),
		[requireCanvas],
	);
	const restoreOrAdoptCardItem = useCallback(
		(input: Parameters<Canvas["restoreOrAdoptCardItem"]>[0]) =>
			requireCanvas().restoreOrAdoptCardItem(input),
		[requireCanvas],
	);
	const applyCanvasRecordChanges = useCallback(
		(input: Parameters<Canvas["applyRecordChanges"]>[0]) =>
			requireCanvas().applyRecordChanges(input),
		[requireCanvas],
	);
	const archiveCardsGlobally = useCallback(
		async ({ cardIds }: { cardIds: string[] }) => {
			await cards.deleteMany(cardIds);
		},
		[cards],
	);

	// The shared asset store speaks the Web upload protocol. A platform whose
	// blobs live behind FileRuntime has no pre-signed URL, so this sentinel
	// tells the uploader to hand the File straight to `finalizeUpload`.
	const generateUploadUrl = useCallback(async () => "contextboard-local:", []);
	const finalizeUpload = useCallback(
		async ({ file }: { storageId: Id<"_storage">; file?: File }) => {
			if (!files || !file) throw new Error("This platform cannot store files");
			const descriptor = await files.upload(file);
			return {
				fileId: descriptor.fileId as Id<"files">,
				storageId: descriptor.fileId as Id<"_storage">,
				url: fileSrc(descriptor.fileId),
			};
		},
		[files],
	);

	// `usePaginatedQuery` semantics without the pagination: the repository
	// backends answer with the whole board at once.
	const itemQuery = useMemo(
		() => ({
			status: (items === undefined
				? "LoadingFirstPage"
				: "Exhausted") as string,
			results: items ?? [],
			loadMore: (_count: number) => undefined,
		}),
		[items],
	);

	const boardItems = useMemo(
		() => (items ?? []).map(toBoardItem),
		[items],
	);

	return {
		whiteboard,
		breadcrumbs: breadcrumbs?.map((crumb) => ({
			_id: crumb.id as Id<"whiteboards">,
			title: crumb.title,
		})),
		itemQuery,
		items: boardItems,
		tldrawDocument,
		createCardItem,
		createSubwhiteboardItem,
		updateItemFrame,
		archiveItem,
		archiveCardsGlobally,
		restoreOrAdoptCardItem,
		applyCanvasRecordChanges,
		generateUploadUrl,
		finalizeUpload,
	};
}
