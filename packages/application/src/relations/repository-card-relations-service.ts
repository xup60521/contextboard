import type { WorkspaceRepository } from "@contextboard/client-core";
import { HybridLogicalClock } from "@contextboard/sync-protocol";
import { applyWrites, isActiveRow, listRows } from "../repository/entities";
import type {
	CardRelationKind,
	CardRelationSummary,
	CardRelationsService,
} from "../runtime";
import type { EntityWrite } from "../workspace";
import { withRetry } from "../workspace";

type ServiceOptions = { now?: () => number; deviceId?: string };

const RELATION_KINDS = new Set<CardRelationKind>([
	"related",
	"next",
	"explains",
	"supports",
	"cites",
	"summarizes",
]);

function normalizePair(cardIds: readonly [string, string]): [string, string] {
	return cardIds[0].localeCompare(cardIds[1]) <= 0
		? [cardIds[0], cardIds[1]]
		: [cardIds[1], cardIds[0]];
}

function toSummary(row: Record<string, unknown>): CardRelationSummary | null {
	if (
		typeof row.id !== "string" ||
		typeof row.whiteboardId !== "string" ||
		typeof row.sourceCardId !== "string" ||
		typeof row.targetCardId !== "string" ||
		typeof row.relation !== "string" ||
		!RELATION_KINDS.has(row.relation as CardRelationKind)
	)
		return null;
	return {
		id: row.id,
		whiteboardId: row.whiteboardId,
		sourceCardId: row.sourceCardId,
		targetCardId: row.targetCardId,
		relation: row.relation as CardRelationKind,
		ordinal: typeof row.ordinal === "number" ? row.ordinal : null,
		arrowShapeId:
			typeof row.arrowShapeId === "string" ? row.arrowShapeId : null,
		revision: typeof row.revision === "number" ? row.revision : 1,
		createdAt: typeof row.createdAt === "number" ? row.createdAt : 0,
		updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : 0,
	};
}

export function createRepositoryCardRelationsService(
	repository: WorkspaceRepository,
	options: ServiceOptions = {},
): CardRelationsService {
	const now = options.now ?? (() => Date.now());
	const clock = new HybridLogicalClock(options.deviceId || "local");

	return {
		async list(input = {}) {
			const rows = await listRows(repository, "cardRelations");
			return rows
				.filter(isActiveRow)
				.map(toSummary)
				.filter((row): row is CardRelationSummary => row !== null)
				.filter(
					(row) =>
						!input.whiteboardId || row.whiteboardId === input.whiteboardId,
				)
				.filter(
					(row) =>
						!input.cardId ||
						row.sourceCardId === input.cardId ||
						row.targetCardId === input.cardId,
				);
		},

		async reconcileCanvasRelations(input) {
			await withRetry(async () => {
				const [boards, cards, relationRows] = await Promise.all([
					listRows(repository, "whiteboards"),
					listRows(repository, "cards"),
					listRows(repository, "cardRelations"),
				]);
				if (
					!boards.some(
						(row) => row.id === input.whiteboardId && isActiveRow(row),
					)
				)
					return;
				const activeCards = new Set(
					cards.filter(isActiveRow).map((row) => row.id),
				);
				const desired = new Map<string, [string, string]>();
				for (const relation of input.relations) {
					const pair = normalizePair(relation.cardIds);
					if (
						!relation.arrowShapeId ||
						pair[0] === pair[1] ||
						!activeCards.has(pair[0]) ||
						!activeCards.has(pair[1])
					)
						continue;
					desired.set(relation.arrowShapeId, pair);
				}

				const existing = relationRows.filter(
					(row) =>
						row.whiteboardId === input.whiteboardId &&
						row.relation === "related" &&
						typeof row.arrowShapeId === "string",
				);
				const existingByArrow = new Map(
					existing.map((row) => [String(row.arrowShapeId), row]),
				);
				const timestamp = now();
				const writes: EntityWrite[] = [];
				for (const [arrowShapeId, [sourceCardId, targetCardId]] of desired) {
					const id = `card-relation:${input.whiteboardId}:${arrowShapeId}`;
					const row = existingByArrow.get(arrowShapeId);
					if (row && row.id !== id) {
						writes.push({
							entity: "cardRelation",
							operation: "delete",
							id: row.id,
							expectedRevision: row.revision,
						});
					}
					if (
						row?.id === id &&
						isActiveRow(row) &&
						row.sourceCardId === sourceCardId &&
						row.targetCardId === targetCardId
					)
						continue;
					const current = relationRows.find((candidate) => candidate.id === id);
					writes.push({
						entity: "cardRelation",
						operation: "upsert",
						id,
						...(current ? { expectedRevision: current.revision } : {}),
						value: {
							id,
							whiteboardId: input.whiteboardId,
							sourceCardId,
							targetCardId,
							relation: "related",
							ordinal: null,
							arrowShapeId,
							clock: clock.tick(timestamp),
							createdAt: current?.createdAt ?? timestamp,
							updatedAt: timestamp,
							deletedAt: null,
						},
					});
				}
				for (const row of existing) {
					if (isActiveRow(row) && !desired.has(String(row.arrowShapeId))) {
						writes.push({
							entity: "cardRelation",
							operation: "delete",
							id: row.id,
							expectedRevision: row.revision,
						});
					}
				}
				await applyWrites(repository, "cardRelations.reconcileCanvas", writes);
			});
		},

		subscribe(listener) {
			return repository.subscribe(listener);
		},
	};
}
