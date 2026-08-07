import {
	recordContextboardPerf,
	useApplicationRuntime,
} from "@contextboard/application";
import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { react as tldrawReact, type Editor, type TLShapeId } from "tldraw";
import type { Id } from "../ids";
import { isCardContentDirty } from "../dirty-card-content";
import type { CardContentStore } from "../card-content-store";
import {
	isMarkdownCardShape,
	type BoardItemResult,
} from "../whiteboard-canvas-helpers";

class LRUCache {
	private readonly map = new Map<string, unknown>();
	constructor(private readonly capacity: number) {}

	get(key: string): unknown | undefined {
		if (!this.map.has(key)) return undefined;
		const value = this.map.get(key);
		this.map.delete(key);
		this.map.set(key, value);
		return value;
	}

	set(key: string, value: unknown): void {
		if (this.map.has(key)) {
			this.map.delete(key);
		} else if (this.map.size >= this.capacity) {
			this.map.delete(this.map.keys().next().value!);
		}
		this.map.set(key, value);
	}
}

const cardContentCache = new LRUCache(100);
const MAX_CARD_CONTENT_BATCH = 30;
const SPATIAL_CELL_SIZE = 1_000;
const VIEWPORT_PREFETCH = 500;

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
	const flushTimerRef = useRef<number | null>(null);
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
		const candidateItems = new Map<string, BoardItemResult>();
		for (
			let x = spatialCell(viewport.x - VIEWPORT_PREFETCH);
			x <= spatialCell(viewport.x + viewport.w + VIEWPORT_PREFETCH);
			x++
		) {
			for (
				let y = spatialCell(viewport.y - VIEWPORT_PREFETCH);
				y <= spatialCell(viewport.y + viewport.h + VIEWPORT_PREFETCH);
				y++
			) {
				for (const item of itemSpatialIndex.get(`${x}:${y}`) ?? [])
					candidateItems.set(item.shapeId, item);
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
			if (!shape || !isMarkdownCardShape(shape) || !shape.props.cardId) continue;
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
	}, [contentStore, editor, itemSpatialIndex, serverVersionByCardId]);

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

	const scheduleHydration = useCallback(() => {
		if (!editor || flushTimerRef.current !== null) return;
		flushTimerRef.current = window.setTimeout(() => {
			flushTimerRef.current = null;
			void runHydration();
		}, 0);
	}, [editor, runHydration]);

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

	useEffect(() => {
		scheduleHydration();
	}, [scheduleHydration, serverVersionByCardId]);

	useEffect(() => {
		return () => {
			if (flushTimerRef.current !== null) {
				window.clearTimeout(flushTimerRef.current);
				flushTimerRef.current = null;
			}
		};
	}, []);

	return {
		prioritizeCardContent,
		scheduleVisibleCardHydration: scheduleHydration,
	};
}
