import {
	type CanvasItem,
	type CanvasRecordPatch,
	fileSrc,
	recordContextboardPerf,
	useApplicationRuntime,
	type WhiteboardBreadcrumb,
	type WhiteboardDetail,
} from "@contextboard/application";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Id } from "../ids";
import type {
	BoardItemResult,
	TldrawDocumentResult,
} from "../whiteboard-canvas-helpers";

function toBoardItem(item: CanvasItem, workspaceId: string): BoardItemResult {
	return {
		_id: item.id,
		workspaceId,
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
	const [itemsData, setItemsData] = useState<
		{ key: string; value: CanvasItem[] } | undefined
	>();
	const [documentData, setDocumentData] = useState<
		{ key: string; value: TldrawDocumentResult } | undefined
	>();
	const [documentPatches, setDocumentPatches] = useState<{
		key: string;
		value: CanvasRecordPatch[];
	}>({ key: canvasKey, value: [] });
	const [documentReloadGeneration, setDocumentReloadGeneration] = useState(0);
	const reloadDocument = useCallback(
		() => setDocumentReloadGeneration((value) => value + 1),
		[],
	);
	const items = itemsData?.key === canvasKey ? itemsData.value : undefined;
	const tldrawDocument =
		documentData?.key === canvasKey ? documentData.value : undefined;
	const itemCardIds = useMemo(
		() => (items ?? []).flatMap((item) => (item.cardId ? [item.cardId] : [])),
		[items],
	);
	const itemCardIdsKey = itemCardIds.join("\0");
	const loadedItemsKeyRef = useRef<string | null>(null);

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
		const unsubscribe = whiteboards.subscribe(() => void load(), {
			whiteboardIds: [whiteboardId],
		});
		return () => {
			active = false;
			unsubscribe();
		};
	}, [whiteboardId, whiteboards]);

	useEffect(() => {
		if (!canvas) return;
		let active = true;
		let running = false;
		let dirty = false;
		const load = async () => {
			dirty = true;
			if (running) return;
			running = true;
			do {
				dirty = false;
				recordContextboardPerf("canvas.items.reload", { detail: canvasKey });
				const nextItems = await canvas.listItems(whiteboardId ?? null);
				if (active) {
					loadedItemsKeyRef.current = canvasKey;
					setItemsData({ key: canvasKey, value: nextItems });
				}
			} while (active && dirty);
			running = false;
		};
		if (loadedItemsKeyRef.current !== canvasKey) void load();
		const unsubscribe = canvas.subscribeItems(
			whiteboardId ?? null,
			() => void load(),
			{ cardIds: itemCardIdsKey ? itemCardIdsKey.split("\0") : [] },
		);
		return () => {
			active = false;
			unsubscribe();
		};
	}, [canvas, canvasKey, itemCardIdsKey, whiteboardId]);

	useEffect(() => {
		if (!canvas) return;
		// An explicit recovery request restarts this load/subscription effect.
		void documentReloadGeneration;
		let active = true;
		let running = false;
		let dirty = false;
		const load = async () => {
			dirty = true;
			if (running) return;
			running = true;
			do {
				dirty = false;
				recordContextboardPerf("canvas.document.reload", {
					detail: canvasKey,
				});
				const next = await canvas.getDocument(whiteboardId ?? null);
				if (active)
					setDocumentData({
						key: canvasKey,
						value: next
							? ({
									whiteboardId: next.whiteboardId,
									snapshot: next.snapshot,
									revision: next.revision,
									canvasRecordVersions: next.canvasRecordVersions,
								} as NonNullable<TldrawDocumentResult>)
							: null,
					});
			} while (active && dirty);
			running = false;
		};
		void load();
		setDocumentPatches({ key: canvasKey, value: [] });
		const unsubscribe = canvas.subscribeDocument(
			whiteboardId ?? null,
			(change) => {
				if (change.kind === "reload") {
					recordContextboardPerf("canvas.document.recovery", {
						detail: canvasKey,
					});
					void load();
					return;
				}
				setDocumentPatches((current) => ({
					key: canvasKey,
					value:
						current.key === canvasKey ? [...current.value, change] : [change],
				}));
			},
		);
		return () => {
			active = false;
			unsubscribe();
		};
	}, [canvas, canvasKey, documentReloadGeneration, whiteboardId]);

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
	const updateItemFrames = useCallback(
		(input: Parameters<Canvas["updateItemFrames"]>[0]) =>
			requireCanvas().updateItemFrames(input),
		[requireCanvas],
	);
	const archiveItem = useCallback(
		(input: Parameters<Canvas["archiveItem"]>[0]) =>
			requireCanvas().archiveItem(input),
		[requireCanvas],
	);
	const archiveWhiteboard = useCallback(
		(input: { whiteboardId: string; deleteCards: boolean }) => {
			if (!whiteboards)
				throw new Error("This platform has no whiteboard capability");
			return whiteboards.archive(input.whiteboardId, {
				deleteCards: input.deleteCards,
			});
		},
		[whiteboards],
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

	useEffect(() => {
		const metadataReady =
			whiteboardId === null ||
			(whiteboard !== undefined && breadcrumbs !== undefined);
		if (items === undefined || tldrawDocument === undefined || !metadataReady)
			return;
		try {
			if (typeof performance !== "undefined")
				performance.mark("contextboard:whiteboard-data-ready");
		} catch {
			// Performance marks are diagnostics only.
		}
	}, [breadcrumbs, items, tldrawDocument, whiteboard, whiteboardId]);

	const boardItems = useMemo(
		() => (items ?? []).map((item) => toBoardItem(item, runtime.workspaceId)),
		[items, runtime.workspaceId],
	);

	return {
		workspaceId: runtime.workspaceId,
		whiteboard,
		breadcrumbs: breadcrumbs?.map((crumb) => ({
			_id: crumb.id as Id<"whiteboards">,
			title: crumb.title,
		})),
		itemQuery,
		items: boardItems,
		itemsReady: items !== undefined,
		tldrawDocument,
		documentPatches:
			documentPatches.key === canvasKey ? documentPatches.value : [],
		reloadDocument,
		createCardItem,
		createSubwhiteboardItem,
		updateItemFrame,
		updateItemFrames,
		archiveItem,
		archiveWhiteboard,
		archiveCardsGlobally,
		restoreOrAdoptCardItem,
		applyCanvasRecordChanges,
		generateUploadUrl,
		finalizeUpload,
	};
}
