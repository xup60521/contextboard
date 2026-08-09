import {
	recordContextboardPerf,
	useApplicationRuntime,
} from "@contextboard/application";
import { useThrottledCallback } from "@tanstack/react-pacer";
import {
	type MutableRefObject,
	useCallback,
	useEffect,
	useMemo,
	useRef,
} from "react";
import { type Editor, type TLShapeId, react as tldrawReact } from "tldraw";
import type { CardContentStore } from "../card-content-store";
import { isCardContentDirty } from "../dirty-card-content";
import { LRUCache } from "../lru-cache";
import type { Id } from "../ids";
import {
	type BoardItemResult,
	isMarkdownCardShape,
} from "../whiteboard-canvas-helpers";

const cardContentCache = new LRUCache(100);
const MAX_CARD_CONTENT_BATCH = 30;
const SPATIAL_CELL_SIZE = 1_000;
const VIEWPORT_PREFETCH = 500;
const CAMERA_HYDRATION_INTERVAL_MS = 50;
/**
 * Above this many grid cells the walk costs more than the items themselves.
 *
 * The grid is indexed by absolute page position, so a zoomed-out viewport spans
 * thousands of cells and the nested loop grows with viewport *area* rather than
 * with board size — on every throttled camera tick during a pan.
 */
const MAX_SPATIAL_CELL_SCAN = 400;

function spatialCell(value: number) {
	return Math.floor(value / SPATIAL_CELL_SIZE);
}

export function useVisibleCardContentHydration({
	editor,
	items,
	loadedDrawingKey,
	whiteboardKey,
	pendingEditShapeIdRef,
	contentStore,
}: {
	editor: Editor | null;
	items: BoardItemResult[];
	loadedDrawingKey: string | null;
	whiteboardKey: string;
	pendingEditShapeIdRef: MutableRefObject<TLShapeId | null>;
	contentStore: CardContentStore;
}) {
	const { cards } = useApplicationRuntime();
	const inFlightCardIdsRef = useRef(new Set<Id<"cards">>());
	const priorityCardIdsRef = useRef<Id<"cards">[]>([]);
	const runningRef = useRef(false);

	const serverVersionByCardId = useMemo(() => {
		const versions = new Map<Id<"cards">, number>();
		for (const item of items) {
			if (!item.cardId || !item.card) continue;
			versions.set(item.cardId, item.card.version);
		}
		return versions;
	}, [items]);
	const itemSpatialIndex = useMemo(() => {
		const index = new Map<string, BoardItemResult[]>();
		for (const item of items) {
			if (!item.cardId) continue;
			const minX = spatialCell(item.x);
			const maxX = spatialCell(item.x + item.w);
			const minY = spatialCell(item.y);
			const maxY = spatialCell(item.y + item.h);
			for (let x = minX; x <= maxX; x++) {
				for (let y = minY; y <= maxY; y++) {
					const key = `${x}:${y}`;
					const bucket = index.get(key);
					if (bucket) bucket.push(item);
					else index.set(key, [item]);
				}
			}
		}
		return index;
	}, [items]);

	const enterPendingEditIfReady = useCallback(() => {
		if (!editor) return;
		const shapeId = pendingEditShapeIdRef.current;
		if (!shapeId) return;

		const shape = editor.getShape(shapeId);
		if (
			!shape ||
			!isMarkdownCardShape(shape) ||
			!shape.props.cardId ||
			contentStore.getSnapshot(shape.props.cardId).status !== "ready"
		) {
			return;
		}

		pendingEditShapeIdRef.current = null;
		editor.select(shapeId);
		editor.setEditingShape(shapeId);
	}, [contentStore, editor, pendingEditShapeIdRef]);

	const collectCandidateCardIds = useCallback(() => {
		if (!editor) return [] as Id<"cards">[];

		const selected = new Set<Id<"cards">>();
		const batch: Id<"cards">[] = [];
		const editingShapeId = editor.getEditingShapeId();
		const viewport = editor.getViewportPageBounds();
		const minX = spatialCell(viewport.x - VIEWPORT_PREFETCH);
		const maxX = spatialCell(viewport.x + viewport.w + VIEWPORT_PREFETCH);
		const minY = spatialCell(viewport.y - VIEWPORT_PREFETCH);
		const maxY = spatialCell(viewport.y + viewport.h + VIEWPORT_PREFETCH);
		const candidateItems = new Map<string, BoardItemResult>();

		if ((maxX - minX + 1) * (maxY - minY + 1) > MAX_SPATIAL_CELL_SCAN) {
			// Zoomed far enough out that the grid is the slow path; test the items
			// directly against the viewport instead.
			const left = viewport.x - VIEWPORT_PREFETCH;
			const right = viewport.x + viewport.w + VIEWPORT_PREFETCH;
			const top = viewport.y - VIEWPORT_PREFETCH;
			const bottom = viewport.y + viewport.h + VIEWPORT_PREFETCH;
			for (const item of items) {
				if (!item.cardId) continue;
				if (
					item.x > right ||
					item.x + item.w < left ||
					item.y > bottom ||
					item.y + item.h < top
				) {
					continue;
				}
				candidateItems.set(item.shapeId, item);
			}
		} else {
			for (let x = minX; x <= maxX; x++) {
				for (let y = minY; y <= maxY; y++) {
					for (const item of itemSpatialIndex.get(`${x}:${y}`) ?? [])
						candidateItems.set(item.shapeId, item);
				}
			}
		}

		const maybeAdd = (cardId: Id<"cards"> | undefined) => {
			if (!cardId) return false;
			if (selected.has(cardId) || inFlightCardIdsRef.current.has(cardId)) {
				return false;
			}
			selected.add(cardId);
			batch.push(cardId);
			return batch.length >= MAX_CARD_CONTENT_BATCH;
		};

		for (const cardId of priorityCardIdsRef.current) {
			if (maybeAdd(cardId)) return batch;
		}

		for (const item of candidateItems.values()) {
			const shape = editor.getShape(item.shapeId as TLShapeId);
			if (!shape || !isMarkdownCardShape(shape) || !shape.props.cardId)
				continue;
			if (shape.id === editingShapeId) continue;

			const cardId = shape.props.cardId as Id<"cards">;
			// Never re-hydrate a card with unsaved local edits: hydrating would
			// overwrite the freshly-edited content and, because the write re-fires
			// this reactive, keep rescheduling.
			if (isCardContentDirty(cardId)) continue;
			const serverVersion = serverVersionByCardId.get(cardId);
			const contentEntry = contentStore.getSnapshot(cardId);
			const needsContent =
				contentEntry.status !== "ready" ||
				(serverVersion !== undefined &&
					contentEntry.persistedVersion !== serverVersion);

			if (!needsContent) continue;
			if (maybeAdd(cardId)) return batch;
		}

		return batch;
	}, [contentStore, editor, items, itemSpatialIndex, serverVersionByCardId]);

	const runHydration = useCallback(async () => {
		if (!editor || loadedDrawingKey !== whiteboardKey || runningRef.current) {
			return;
		}

		runningRef.current = true;
		try {
			while (true) {
				const cardIds = collectCandidateCardIds();
				if (cardIds.length === 0) break;
				recordContextboardPerf("canvas.hydration.candidate", {
					value: cardIds.length,
				});

				const hits: Array<{
					cardId: Id<"cards">;
					content: unknown;
					version: number;
				}> = [];
				const missIds: Id<"cards">[] = [];

				for (const cardId of cardIds) {
					const version = serverVersionByCardId.get(cardId);
					if (version === undefined) {
						missIds.push(cardId);
						continue;
					}
					const cached = cardContentCache.get(`${cardId}:${version}`);
					if (cached !== undefined) {
						hits.push({ cardId, content: cached, version });
					} else {
						missIds.push(cardId);
					}
				}

				if (hits.length > 0) {
					recordContextboardPerf("canvas.hydration.cache-hit", {
						value: hits.length,
					});
					for (const result of hits)
						contentStore.setPersisted(
							result.cardId,
							result.content,
							result.version,
						);
					enterPendingEditIfReady();
				}

				if (missIds.length > 0) {
					for (const cardId of missIds) {
						inFlightCardIdsRef.current.add(cardId);
						contentStore.markLoading(cardId);
					}
					priorityCardIdsRef.current = priorityCardIdsRef.current.filter(
						(id) => !missIds.includes(id),
					);

					try {
						const details = await cards.getMany(missIds);
						const results = details
							.filter((detail) => detail !== null)
							.map((detail) => ({
								cardId: detail.id,
								content: detail.content,
								version: detail.version,
							}));

						for (const result of results) {
							cardContentCache.set(
								`${result.cardId}:${result.version}`,
								result.content,
							);
							contentStore.setPersisted(
								result.cardId,
								result.content,
								result.version,
							);
						}
						enterPendingEditIfReady();
					} catch (error) {
						const failure =
							error instanceof Error ? error : new Error(String(error));
						for (const cardId of missIds)
							contentStore.setError(cardId, failure);
					} finally {
						for (const cardId of missIds) {
							inFlightCardIdsRef.current.delete(cardId);
						}
					}
				} else {
					priorityCardIdsRef.current = priorityCardIdsRef.current.filter(
						(id) => !cardIds.includes(id),
					);
				}
			}
		} finally {
			runningRef.current = false;
		}
	}, [
		collectCandidateCardIds,
		cards,
		contentStore,
		editor,
		enterPendingEditIfReady,
		loadedDrawingKey,
		serverVersionByCardId,
		whiteboardKey,
	]);

	// Camera signals can arrive once per pointer event. Keep hydration responsive
	// on the leading edge while bounding spatial-index walks during a long pan.
	const scheduleHydration = useThrottledCallback(
		() => {
			if (editor) void runHydration();
		},
		{
			wait: CAMERA_HYDRATION_INTERVAL_MS,
			leading: true,
			trailing: true,
		},
	);

	const prioritizeCardContent = useCallback(
		(shapeId: TLShapeId, cardId: Id<"cards">) => {
			if (contentStore.getSnapshot(cardId).status === "ready" && editor) {
				pendingEditShapeIdRef.current = null;
				editor.select(shapeId);
				editor.setEditingShape(shapeId);
				return;
			}
			pendingEditShapeIdRef.current = shapeId;
			priorityCardIdsRef.current = [
				cardId,
				...priorityCardIdsRef.current.filter((id) => id !== cardId),
			];
			scheduleHydration();
		},
		[contentStore, editor, pendingEditShapeIdRef, scheduleHydration],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: reset when the board identity changes
	useEffect(() => {
		inFlightCardIdsRef.current = new Set();
		priorityCardIdsRef.current = [];
		pendingEditShapeIdRef.current = null;
	}, [pendingEditShapeIdRef, whiteboardKey]);

	useEffect(() => {
		if (!editor) return;
		return tldrawReact("hydrate visible whiteboard card content", () => {
			if (loadedDrawingKey !== whiteboardKey) return;

			editor.getViewportPageBounds();
			editor.getEditingShapeId();

			scheduleHydration();
		});
	}, [editor, loadedDrawingKey, scheduleHydration, whiteboardKey]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: server versions invalidate cached hydration work
	useEffect(() => {
		scheduleHydration();
	}, [scheduleHydration, serverVersionByCardId]);

	return {
		prioritizeCardContent,
		scheduleVisibleCardHydration: scheduleHydration,
	};
}
