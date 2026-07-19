export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type CardId = Brand<string, "CardId">;
export type WhiteboardId = Brand<string, "WhiteboardId">;
export type BoardItemId = Brand<string, "BoardItemId">;
export type TldrawDocumentId = Brand<string, "TldrawDocumentId">;
export type FileId = Brand<string, "FileId">;
export type FileReferenceId = Brand<string, "FileReferenceId">;
export type CardReferenceId = Brand<string, "CardReferenceId">;

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
  cardCount: number;
  childWhiteboardCount: number;
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
  blob: Blob;
  contentType: string;
  size: number;
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

export function createId<T extends string>(): T {
  return crypto.randomUUID() as T;
}

export function assertNonNegativeCounts(
  value: Pick<Whiteboard, "cardCount" | "childWhiteboardCount">,
): void {
  if (value.cardCount < 0 || value.childWhiteboardCount < 0) {
    throw new Error("Whiteboard counters cannot be negative");
  }
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
