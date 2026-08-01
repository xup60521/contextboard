import { useApplicationRuntime } from "@contextboard/application";
import { type MutableRefObject, useCallback, useEffect, useRef } from "react";
import type { Editor } from "tldraw";
import { collectCanvasCardRelations } from "../card-relations";
import type { Id } from "../ids";

const RECONCILE_DELAY_MS = 60;

export function useCardRelationSync({
	editor,
	whiteboardId,
	whiteboardKey,
	loadedDrawingKey,
	reconciliationGeneration,
	hydratingRef,
}: {
	editor: Editor | null;
	whiteboardId: Id<"whiteboards"> | null;
	whiteboardKey: string;
	loadedDrawingKey: string | null;
	reconciliationGeneration: number;
	hydratingRef: MutableRefObject<boolean>;
}) {
	const { relations } = useApplicationRuntime();
	const timerRef = useRef<number | null>(null);
	const chainRef = useRef(Promise.resolve());

	const reconcile = useCallback(() => {
		if (
			!editor ||
			!whiteboardId ||
			loadedDrawingKey !== whiteboardKey ||
			hydratingRef.current
		)
			return;
		const projection = collectCanvasCardRelations(editor);
		chainRef.current = chainRef.current
			.catch(() => undefined)
			.then(() =>
				relations.reconcileCanvasRelations({
					whiteboardId,
					relations: projection,
				}),
			)
			.catch((error) =>
				console.warn("Failed to reconcile canvas card relations", error),
			);
	}, [
		editor,
		hydratingRef,
		loadedDrawingKey,
		relations,
		whiteboardId,
		whiteboardKey,
	]);

	useEffect(() => {
		void reconciliationGeneration;
		if (!editor || !whiteboardId || loadedDrawingKey !== whiteboardKey) return;
		const schedule = () => {
			if (timerRef.current !== null) window.clearTimeout(timerRef.current);
			timerRef.current = window.setTimeout(() => {
				timerRef.current = null;
				reconcile();
			}, RECONCILE_DELAY_MS);
		};
		schedule();
		const removeListener = editor.store.listen(schedule, {
			source: "user",
			scope: "document",
		});
		return () => {
			removeListener();
			if (timerRef.current !== null) window.clearTimeout(timerRef.current);
			timerRef.current = null;
		};
	}, [
		editor,
		loadedDrawingKey,
		reconcile,
		reconciliationGeneration,
		whiteboardId,
		whiteboardKey,
	]);
}
