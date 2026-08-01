export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type CardId = Brand<string, "CardId">;
export type WhiteboardId = Brand<string, "WhiteboardId">;
export type BoardItemId = Brand<string, "BoardItemId">;
export type TldrawDocumentId = Brand<string, "TldrawDocumentId">;
export type FileId = Brand<string, "FileId">;
export type FileReferenceId = Brand<string, "FileReferenceId">;
export type CardReferenceId = Brand<string, "CardReferenceId">;
export type CardRelationId = Brand<string, "CardRelationId">;
export type CanvasRecordId = Brand<string, "CanvasRecordId">;

export type SyncMetadata = {
	revision: number;
	updatedAt: number;
	updatedByDeviceId: string;
	deletedAt: number | null;
};

export type EntityBase<Id extends string> = SyncMetadata & {
	id: Id;
	createdAt: number;
};

export type Whiteboard = EntityBase<WhiteboardId> & {
	title: string;
	parentWhiteboardId: WhiteboardId | null;
	ancestorIds: WhiteboardId[];
	depth: number;
	sortKey: string;
	pathKey: string;
	archivedAt: number | null;
};

export type Card = EntityBase<CardId> & {
	content: unknown;
	derivedTitle: string;
	plainText: string;
	preview: string;
	contentVersion: number;
	activePlacementCount: number;
	archivedAt: number | null;
};

export type BoardItem = EntityBase<BoardItemId> & {
	whiteboardId: WhiteboardId | null;
	kind: "card" | "subwhiteboard";
	cardId: CardId | null;
	childWhiteboardId: WhiteboardId | null;
	shapeId: string;
	x: number;
	y: number;
	w: number;
	h: number;
	rotation: number;
	zIndex: number;
	archivedAt: number | null;
};

export type TldrawDocument = EntityBase<TldrawDocumentId> & {
	whiteboardId: WhiteboardId | null;
	snapshot: unknown;
	documentVersion: number;
};

export type LocalFile = EntityBase<FileId> & {
	sha256: string;
	/** Null until a remote content-addressed blob has been downloaded. */
	blob: Blob | null;
	contentType: string;
	size: number;
	refCount: number;
	status: "active" | "pending_delete";
	pendingDeleteAt: number | null;
};

export type FileReference = EntityBase<FileReferenceId> & {
	fileId: FileId;
	targetKey: string;
	targetType: "card" | "tldrawDocument";
};

export type CardReference = EntityBase<CardReferenceId> & {
	sourceCardId: CardId;
	targetCardId: CardId;
};

/**
 * The relation kinds a `cardRelation` may carry.
 *
 * Single source of truth: the application service and the local command layer
 * both validate against this, so a kind can never be accepted by one write path
 * and rejected by another.
 */
export const CARD_RELATION_KINDS = [
	"related",
	"next",
	"explains",
	"supports",
	"cites",
	"summarizes",
] as const;

export type CardRelationKind = (typeof CARD_RELATION_KINDS)[number];

export function isCardRelationKind(value: unknown): value is CardRelationKind {
	return (
		typeof value === "string" &&
		(CARD_RELATION_KINDS as readonly string[]).includes(value)
	);
}

/** A semantic knowledge-graph edge, distinct from a link embedded in TipTap. */
export type CardRelation = EntityBase<CardRelationId> & {
	whiteboardId: WhiteboardId;
	sourceCardId: CardId;
	targetCardId: CardId;
	relation: CardRelationKind;
	ordinal: number | null;
	/** The native tldraw arrow that owns this relation, or null for semantic edges. */
	arrowShapeId: string | null;
	clock: string;
};

/** A non-managed tldraw record. Cards and sub-whiteboards remain domain entities. */
export type CanvasRecord = EntityBase<CanvasRecordId> & {
	whiteboardId: WhiteboardId;
	recordId: string;
	recordType: string;
	payload: unknown;
	clock: string;
};

export type BlobDescriptor = {
	hash: string;
	contentType: string;
	size: number;
};

export function createId<T extends string>(): T {
	return crypto.randomUUID() as T;
}

export function hasHierarchyCycle(
	whiteboardId: WhiteboardId,
	parentId: WhiteboardId | null,
	byId: ReadonlyMap<WhiteboardId, Pick<Whiteboard, "parentWhiteboardId">>,
): boolean {
	const visited = new Set<WhiteboardId>([whiteboardId]);
	let current = parentId;
	while (current) {
		if (visited.has(current)) return true;
		visited.add(current);
		current = byId.get(current)?.parentWhiteboardId ?? null;
	}
	return false;
}
