import { useConvex } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { react as tldrawReact, type Editor, type TLShapeId } from "tldraw";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
	hydrateCardShapes,
	isMarkdownCardShape,
	type BoardItemResult,
} from "../whiteboard-canvas-helpers";

const MAX_CARD_CONTENT_BATCH = 30;

export function useVisibleCardContentHydration({
	editor,
	items,
	loadedDrawingKey,
	whiteboardKey,
	pendingEditShapeIdRef,
}: {
	editor: Editor | null;
	items: BoardItemResult[];
	loadedDrawingKey: string | null;
	whiteboardKey: string;
	pendingEditShapeIdRef: MutableRefObject<TLShapeId | null>;
}) {
	const convex = useConvex();
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

	const enterPendingEditIfReady = useCallback(() => {
		if (!editor) return;
		const shapeId = pendingEditShapeIdRef.current;
		if (!shapeId) return;

		const shape = editor.getShape(shapeId);
		if (!shape || !isMarkdownCardShape(shape) || !shape.props.contentLoaded) {
			return;
		}

		pendingEditShapeIdRef.current = null;
		editor.select(shapeId);
		editor.setEditingShape(shapeId);
	}, [editor, pendingEditShapeIdRef]);

	const collectCandidateCardIds = useCallback(() => {
		if (!editor) return [] as Id<"cards">[];

		const selected = new Set<Id<"cards">>();
		const batch: Id<"cards">[] = [];
		const editingShapeId = editor.getEditingShapeId();
		const culledShapes = editor.getCulledShapes();
		const visibleShapes = editor.getCurrentPageShapesSorted();

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

		for (const shape of visibleShapes) {
			if (culledShapes.has(shape.id)) continue;
			if (!isMarkdownCardShape(shape) || !shape.props.cardId) continue;
			if (shape.id === editingShapeId) continue;

			const cardId = shape.props.cardId as Id<"cards">;
			const serverVersion = serverVersionByCardId.get(cardId);
			const needsContent =
				shape.props.contentLoaded !== true ||
				(serverVersion !== undefined &&
					shape.props.contentVersion !== serverVersion);

			if (!needsContent) continue;
			if (maybeAdd(cardId)) return batch;
		}

		return batch;
	}, [editor, serverVersionByCardId]);

	const runHydration = useCallback(async () => {
		if (!editor || loadedDrawingKey !== whiteboardKey || runningRef.current) {
			return;
		}

		runningRef.current = true;
		try {
			while (true) {
				const cardIds = collectCandidateCardIds();
				if (cardIds.length === 0) break;

				for (const cardId of cardIds) {
					inFlightCardIdsRef.current.add(cardId);
				}
				priorityCardIdsRef.current = priorityCardIdsRef.current.filter(
					(cardId) => !cardIds.includes(cardId),
				);

				try {
					const results = await convex.query(
						api.cards.getContentsForWhiteboardItems,
						{ cardIds },
					);

					editor.run(
						() => {
							for (const result of results) {
								hydrateCardShapes(editor, result);
							}
						},
						{ history: "ignore" },
					);
					enterPendingEditIfReady();
				} finally {
					for (const cardId of cardIds) {
						inFlightCardIdsRef.current.delete(cardId);
					}
				}
			}
		} finally {
			runningRef.current = false;
		}
	}, [
		collectCandidateCardIds,
		convex,
		editor,
		enterPendingEditIfReady,
		loadedDrawingKey,
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
			pendingEditShapeIdRef.current = shapeId;
			priorityCardIdsRef.current = [
				cardId,
				...priorityCardIdsRef.current.filter((id) => id !== cardId),
			];
			scheduleHydration();
		},
		[pendingEditShapeIdRef, scheduleHydration],
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

			editor.getCulledShapes();
			editor.getEditingShapeId();
			for (const shape of editor.getCurrentPageShapesSorted()) {
				if (!isMarkdownCardShape(shape)) continue;
				shape.props.cardId;
				shape.props.contentLoaded;
				shape.props.contentVersion;
			}

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
