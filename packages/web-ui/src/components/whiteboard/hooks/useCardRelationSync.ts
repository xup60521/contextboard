import {
	recordContextboardPerf,
	useApplicationRuntime,
} from "@contextboard/application";
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
	interactionActiveRef,
}: {
	editor: Editor | null;
	whiteboardId: Id<"whiteboards"> | null;
	whiteboardKey: string;
	loadedDrawingKey: string | null;
	reconciliationGeneration: number;
	hydratingRef: MutableRefObject<boolean>;
	interactionActiveRef: MutableRefObject<boolean>;
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
		recordContextboardPerf("canvas.relation.reconcile", {
			detail: whiteboardId,
		});
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
				if (interactionActiveRef.current) {
					schedule();
					return;
				}
				reconcile();
			}, RECONCILE_DELAY_MS);
		};
		schedule();
		const removeListener = editor.store.listen(({ changes }) => {
			if (!hasRelationAffectingChange(changes)) return;
			schedule();
		}, {
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
		interactionActiveRef,
		reconcile,
		reconciliationGeneration,
		whiteboardId,
		whiteboardKey,
	]);
}

function isArrowOrArrowBinding(record: unknown) {
	if (!record || typeof record !== "object") return false;
	const value = record as { typeName?: unknown; type?: unknown };
	return (
		(value.typeName === "shape" && value.type === "arrow") ||
		(value.typeName === "binding" && value.type === "arrow")
	);
}

function isManagedCard(record: unknown) {
	if (!record || typeof record !== "object") return false;
	const value = record as { typeName?: unknown; type?: unknown };
	return value.typeName === "shape" && value.type === "markdown-card";
}

export function hasRelationAffectingChange(changes: {
	added: Record<string, unknown>;
	updated: Record<string, [unknown, unknown]>;
	removed: Record<string, unknown>;
}) {
	return (
		Object.values(changes.added).some(
			(record) => isArrowOrArrowBinding(record) || isManagedCard(record),
		) ||
		Object.values(changes.removed).some(
			(record) => isArrowOrArrowBinding(record) || isManagedCard(record),
		) ||
		Object.values(changes.updated).some(([before, after]) =>
			isArrowOrArrowBinding(before) || isArrowOrArrowBinding(after),
		)
	);
}
