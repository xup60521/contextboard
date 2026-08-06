/**
 * "Auto arrange" on the canvas: turns a selection of cards and the arrows
 * between them into a tidy tree or mindmap.
 *
 * The layout itself lives in `@contextboard/application` so the headless agent
 * server runs exactly the same algorithm. This file is only the adapter: it
 * reads the editor, hands over plain numbers, and writes the answer back.
 *
 * Two things the editor knows that a headless caller does not, and which is why
 * arranging from the UI gives a better result than arranging from an agent:
 * card heights here are the measured ones rather than estimates, and everything
 * else on the page — freehand strokes, unrelated cards — is passed down as an
 * obstacle so the arrangement lands beside it rather than on top of it.
 */

import {
	type ArrangeEdge,
	type ArrangeNode,
	type ArrangeStyle,
	arrangeRelationLayout,
} from "@contextboard/application/canvas";
import type { Editor, TLShape, TLShapePartial } from "tldraw";
import { collectDirectedCanvasCardRelations } from "./card-relations";
import { isMarkdownCardShape } from "./whiteboard-canvas-helpers";

export type AutoArrangePlan = {
	updates: TLShapePartial[];
	style: string;
	/** Selected cards left where they are, because nothing points at them. */
	skippedShapeIds: string[];
};

/** Card shapes in the current selection, in a stable order. */
function selectedCardShapes(editor: Editor): TLShape[] {
	return editor
		.getSelectedShapes()
		.filter(isMarkdownCardShape)
		.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Whether the "Auto arrange" menu item is worth offering.
 *
 * Needs at least two selected cards with an arrow between them — otherwise the
 * command has nothing to arrange and would look broken.
 */
export function canAutoArrange(editor: Editor): boolean {
	const selected = new Set<string>(
		selectedCardShapes(editor).map((shape) => shape.id),
	);
	if (selected.size < 2) return false;
	return collectDirectedCanvasCardRelations(editor).some(
		(relation) =>
			selected.has(relation.sourceShapeId) &&
			selected.has(relation.targetShapeId),
	);
}

/**
 * Works out where the selected cards should go, without touching the editor.
 *
 * Split out from `applyAutoArrange` so the interesting half can be tested
 * against a stub editor.
 */
export function buildAutoArrangePlan(
	editor: Editor,
	style: ArrangeStyle = "auto",
): AutoArrangePlan {
	const shapes = selectedCardShapes(editor);
	const selected = new Set<string>(shapes.map((shape) => shape.id));

	const nodes: ArrangeNode[] = shapes.map((shape) => {
		const props = shape.props as { w: number; h: number };
		return { id: shape.id, x: shape.x, y: shape.y, w: props.w, h: props.h };
	});

	const edges: ArrangeEdge[] = [];
	for (const relation of collectDirectedCanvasCardRelations(editor)) {
		if (!selected.has(relation.sourceShapeId)) continue;
		if (!selected.has(relation.targetShapeId)) continue;
		edges.push({
			source: relation.sourceShapeId,
			target: relation.targetShapeId,
		});
	}

	// Anything not being arranged is an obstacle, including the strokes the user
	// drew by hand. None of it moves.
	const obstacles: { x: number; y: number; w: number; h: number }[] = [];
	for (const shape of editor.getCurrentPageShapes()) {
		if (selected.has(shape.id)) continue;
		if (shape.type === "arrow") continue;
		const bounds = editor.getShapePageBounds(shape.id);
		if (!bounds) continue;
		obstacles.push({ x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h });
	}

	const result = arrangeRelationLayout(nodes, edges, { style, obstacles });
	const updates: TLShapePartial[] = [];
	for (const shape of shapes) {
		const position = result.positions.get(shape.id);
		if (!position) continue;
		updates.push({
			id: shape.id,
			type: shape.type,
			x: position.x,
			y: position.y,
		});
	}

	return {
		updates,
		style: result.style,
		skippedShapeIds: result.skippedIds,
	};
}

/**
 * Arranges the current selection.
 *
 * The shapes are moved through the normal editor API, so `useStoreListener`
 * picks the change up and `useFrameSync` persists the new `boardItems` frames —
 * no separate write path. One history mark up front makes the whole arrange a
 * single undo.
 */
export function applyAutoArrange(
	editor: Editor,
	style: ArrangeStyle = "auto",
): AutoArrangePlan {
	const plan = buildAutoArrangePlan(editor, style);
	if (plan.updates.length === 0) return plan;
	editor.markHistoryStoppingPoint("auto-arrange");
	editor.run(() => editor.updateShapes(plan.updates));
	return plan;
}
