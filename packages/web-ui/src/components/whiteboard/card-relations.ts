import type { Editor, TLShapeId } from "tldraw";

export type CanvasCardRelation = {
	arrowShapeId: string;
	cardIds: [string, string];
};

type ArrowBinding = {
	toId: string;
	props?: { terminal?: "start" | "end" };
};

function cardIdForShape(editor: Editor, shapeId: string): string | null {
	const shape = editor.getShape(shapeId as TLShapeId);
	if (!shape || shape.type !== "markdown-card") return null;
	const cardId = (shape.props as { cardId?: unknown }).cardId;
	return typeof cardId === "string" && cardId.length > 0 ? cardId : null;
}

/** An arrow between two cards, with the direction the user drew it in. */
export type DirectedCanvasCardRelation = {
	arrowShapeId: string;
	/** Card at the arrow's tail. */
	sourceCardId: string;
	/** Card at the arrow's head. */
	targetCardId: string;
	/** Shape id at the arrow's tail. */
	sourceShapeId: string;
	/** Shape id at the arrow's head. */
	targetShapeId: string;
};

/**
 * Reads the arrows on the page as directed card relations.
 *
 * Direction is only meaningful to layout, which needs to know which card is the
 * parent. Everything else on this board treats a relation as undirected, so it
 * goes through `collectCanvasCardRelations` below instead.
 */
export function collectDirectedCanvasCardRelations(
	editor: Editor,
): DirectedCanvasCardRelation[] {
	const relations: DirectedCanvasCardRelation[] = [];
	for (const shape of editor.getCurrentPageShapes()) {
		if (shape.type !== "arrow") continue;
		const bindings = editor.getBindingsFromShape(
			shape.id,
			"arrow",
		) as ArrowBinding[];
		const start = bindings.find(
			(binding) => binding.props?.terminal === "start",
		);
		const end = bindings.find((binding) => binding.props?.terminal === "end");
		if (!start || !end) continue;
		const sourceCardId = cardIdForShape(editor, start.toId);
		const targetCardId = cardIdForShape(editor, end.toId);
		if (!sourceCardId || !targetCardId || sourceCardId === targetCardId) {
			continue;
		}
		relations.push({
			arrowShapeId: shape.id,
			sourceCardId,
			targetCardId,
			sourceShapeId: start.toId,
			targetShapeId: end.toId,
		});
	}
	return relations;
}

/** Projects native tldraw arrow bindings into undirected card relations. */
export function collectCanvasCardRelations(
	editor: Editor,
): CanvasCardRelation[] {
	return collectDirectedCanvasCardRelations(editor).map((relation) => {
		const cardIds: [string, string] =
			relation.sourceCardId.localeCompare(relation.targetCardId) <= 0
				? [relation.sourceCardId, relation.targetCardId]
				: [relation.targetCardId, relation.sourceCardId];
		return { arrowShapeId: relation.arrowShapeId, cardIds };
	});
}
