import type { Id } from "../_generated/dataModel";

export function makeCardShapeId(cardId: Id<"cards">): string {
	return `shape:card-${cardId}`;
}

export function isTldrawShapeId(shapeId: string): boolean {
	return shapeId.startsWith("shape:");
}

export function assertValidTldrawShapeId(shapeId: string): void {
	if (!shapeId.startsWith("shape:")) {
		throw new Error(`Invalid tldraw shape id: "${shapeId}" must start with "shape:"`);
	}
}
