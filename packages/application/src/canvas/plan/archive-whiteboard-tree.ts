import { type EntityRow, isActiveRow } from "../../repository/entities";
import type { EntityWrite } from "../../workspace";
import { type Plan, tombstoneWrite, upsertWrite } from "../planner";

export type ArchiveWhiteboardTreeSnapshot = {
	whiteboards: EntityRow[];
	items: EntityRow[];
	cards: EntityRow[];
	tldrawDocuments: EntityRow[];
	canvasRecords: EntityRow[];
	fileReferences: EntityRow[];
	files: EntityRow[];
	cardRelations: EntityRow[];
};

export type ArchiveWhiteboardTreeInput = {
	whiteboardId: string;
	deleteCards: boolean;
	now: number;
};

function stringField(row: EntityRow, field: string): string | null {
	const value = row[field];
	return typeof value === "string" ? value : null;
}

function collectBoardIds(whiteboards: EntityRow[], rootId: string) {
	const activeBoards = whiteboards.filter(isActiveRow);
	const boardIds = new Set<string>();
	if (!activeBoards.some((board) => board.id === rootId)) return boardIds;

	boardIds.add(rootId);
	let changed = true;
	while (changed) {
		changed = false;
		for (const board of activeBoards) {
			const parentId = stringField(board, "parentWhiteboardId");
			if (parentId && boardIds.has(parentId) && !boardIds.has(board.id)) {
				boardIds.add(board.id);
				changed = true;
			}
		}
	}
	return boardIds;
}

export function planArchiveWhiteboardTree(
	snapshot: ArchiveWhiteboardTreeSnapshot,
	input: ArchiveWhiteboardTreeInput,
): Plan<{ whiteboardIds: string[] }> {
	const boardIds = collectBoardIds(snapshot.whiteboards, input.whiteboardId);
	if (boardIds.size === 0) return { writes: [], result: { whiteboardIds: [] } };

	const activeItems = snapshot.items.filter(isActiveRow);
	const affectedItems = activeItems.filter((item) => {
		const ownerId = stringField(item, "whiteboardId");
		const childId = stringField(item, "childWhiteboardId");
		return (
			(ownerId !== null && boardIds.has(ownerId)) ||
			(childId !== null && boardIds.has(childId))
		);
	});
	const affectedItemIds = new Set(affectedItems.map((item) => item.id));
	const activeCards = snapshot.cards.filter(isActiveRow);
	const activeItemsByCardId = new Map<string, EntityRow[]>();
	for (const item of activeItems) {
		const cardId = stringField(item, "cardId");
		if (!cardId) continue;
		const placements = activeItemsByCardId.get(cardId) ?? [];
		placements.push(item);
		activeItemsByCardId.set(cardId, placements);
	}

	const writes: EntityWrite[] = [];
	for (const board of snapshot.whiteboards) {
		if (boardIds.has(board.id) && isActiveRow(board))
			writes.push(tombstoneWrite("whiteboard", board));
	}
	for (const item of affectedItems)
		writes.push(tombstoneWrite("boardItem", item));

	for (const card of activeCards) {
		const placements = activeItemsByCardId.get(card.id) ?? [];
		const removedPlacements = placements.filter((item) =>
			affectedItemIds.has(item.id),
		).length;
		if (removedPlacements === 0) continue;

		const activePlacementCount = Math.max(
			0,
			placements.length - removedPlacements,
		);
		writes.push(
			upsertWrite(
				"card",
				{
					...card,
					activePlacementCount,
					archivedAt:
						input.deleteCards && activePlacementCount === 0
							? input.now
							: (card.archivedAt ?? null),
				},
				card.revision,
			),
		);
	}

	const deletedDocumentIds = new Set<string>();
	for (const document of snapshot.tldrawDocuments) {
		if (
			isActiveRow(document) &&
			boardIds.has(stringField(document, "whiteboardId") ?? "")
		) {
			writes.push(tombstoneWrite("tldrawDocument", document));
			deletedDocumentIds.add(document.id);
		}
	}
	for (const record of snapshot.canvasRecords) {
		if (
			isActiveRow(record) &&
			boardIds.has(stringField(record, "whiteboardId") ?? "")
		)
			writes.push(tombstoneWrite("canvasRecord", record));
	}
	for (const relation of snapshot.cardRelations) {
		if (
			isActiveRow(relation) &&
			boardIds.has(stringField(relation, "whiteboardId") ?? "")
		)
			writes.push(tombstoneWrite("cardRelation", relation));
	}

	const activeFileReferences = snapshot.fileReferences.filter(isActiveRow);
	const removedFileReferences = activeFileReferences.filter((reference) => {
		const targetKey = stringField(reference, "targetKey");
		return (
			targetKey?.startsWith("tldrawDocument:") === true &&
			deletedDocumentIds.has(targetKey.slice("tldrawDocument:".length))
		);
	});
	for (const reference of removedFileReferences)
		writes.push(tombstoneWrite("fileReference", reference));

	const removedReferenceIds = new Set(
		removedFileReferences.map((reference) => reference.id),
	);
	const affectedFileIds = new Set(
		removedFileReferences
			.map((reference) => stringField(reference, "fileId"))
			.filter((fileId): fileId is string => fileId !== null),
	);
	const remainingReferencesByFileId = new Map<string, number>();
	for (const reference of activeFileReferences) {
		const fileId = stringField(reference, "fileId");
		if (fileId === null || removedReferenceIds.has(reference.id)) continue;
		remainingReferencesByFileId.set(
			fileId,
			(remainingReferencesByFileId.get(fileId) ?? 0) + 1,
		);
	}
	for (const file of snapshot.files) {
		if (!isActiveRow(file) || !affectedFileIds.has(file.id)) continue;
		const refCount = remainingReferencesByFileId.get(file.id) ?? 0;
		writes.push(
			upsertWrite(
				"file",
				{
					...file,
					refCount,
					status: refCount > 0 ? "active" : "pending_delete",
					pendingDeleteAt: refCount > 0 ? null : input.now,
				},
				file.revision,
			),
		);
	}

	return {
		writes,
		result: { whiteboardIds: [...boardIds] },
	};
}
