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

/** Projects native tldraw arrow bindings into undirected card relations. */
export function collectCanvasCardRelations(
	editor: Editor,
): CanvasCardRelation[] {
	const relations: CanvasCardRelation[] = [];
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
		const startCardId = cardIdForShape(editor, start.toId);
		const endCardId = cardIdForShape(editor, end.toId);
		if (!startCardId || !endCardId || startCardId === endCardId) continue;
		const cardIds: [string, string] =
			startCardId.localeCompare(endCardId) <= 0
				? [startCardId, endCardId]
				: [endCardId, startCardId];
		relations.push({ arrowShapeId: shape.id, cardIds });
	}
	return relations;
}
