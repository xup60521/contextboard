import type { WorkspaceRepository } from "@contextboard/client-core";
import { isCardRelationKind } from "@contextboard/domain";
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

/** The id `reconcileCanvasRelations` derives for an arrow-owned relation. */
export function arrowRelationId(
	whiteboardId: string,
	arrowShapeId: string,
): string {
	return `card-relation:${whiteboardId}:${arrowShapeId}`;
}

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
		!isCardRelationKind(row.relation)
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

		async create(input) {
			const relation: CardRelationKind = input.relation ?? "related";
			if (!isCardRelationKind(relation))
				throw new Error(`Unknown relation kind: ${String(input.relation)}`);
			if (input.sourceCardId === input.targetCardId)
				throw new Error("A card cannot relate to itself");
			const ordinal = input.ordinal ?? null;
			if (ordinal !== null && (!Number.isSafeInteger(ordinal) || ordinal < 0))
				throw new Error("ordinal must be a non-negative integer or null");

			return withRetry(async () => {
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
					throw new Error(`Whiteboard not found: ${input.whiteboardId}`);
				const activeCards = new Set(
					cards.filter(isActiveRow).map((row) => row.id),
				);
				for (const cardId of [input.sourceCardId, input.targetCardId]) {
					if (!activeCards.has(cardId))
						throw new Error(`Card not found: ${cardId}`);
				}

				// `related` carries no direction, so its endpoints are stored in a
				// canonical order and A→B is the same row as B→A.
				const [sourceCardId, targetCardId] =
					relation === "related"
						? normalizePair([input.sourceCardId, input.targetCardId])
						: [input.sourceCardId, input.targetCardId];

				const arrowShapeId = input.arrowShapeId ?? null;
				const id = arrowShapeId
					? arrowRelationId(input.whiteboardId, arrowShapeId)
					: `card-relation:${input.whiteboardId}:${crypto.randomUUID()}`;

				// Idempotent: the same edge asked for twice returns the existing row
				// rather than accumulating duplicates.
				const duplicate = relationRows
					.filter(isActiveRow)
					.find(
						(row) =>
							row.id === id ||
							(row.whiteboardId === input.whiteboardId &&
								row.relation === relation &&
								row.sourceCardId === sourceCardId &&
								row.targetCardId === targetCardId),
					);
				if (duplicate) {
					const summary = toSummary(duplicate);
					if (summary) return summary;
				}

				const timestamp = now();
				const value = {
					id,
					whiteboardId: input.whiteboardId,
					sourceCardId,
					targetCardId,
					relation,
					ordinal,
					arrowShapeId,
					clock: clock.tick(timestamp),
					createdAt: timestamp,
					updatedAt: timestamp,
					deletedAt: null,
				};
				// A tombstoned row at this id has to be revived rather than added.
				const tombstone = relationRows.find((row) => row.id === id);
				await applyWrites(repository, "cardRelations.create", [
					{
						entity: "cardRelation",
						operation: "upsert",
						id,
						...(tombstone ? { expectedRevision: tombstone.revision } : {}),
						value: tombstone
							? { ...value, createdAt: tombstone.createdAt ?? timestamp }
							: value,
					},
				]);
				return {
					id,
					whiteboardId: input.whiteboardId,
					sourceCardId,
					targetCardId,
					relation,
					ordinal,
					arrowShapeId,
					revision: (tombstone?.revision ?? 0) + 1,
					createdAt: (tombstone?.createdAt as number) ?? timestamp,
					updatedAt: timestamp,
				};
			});
		},

		async archive(input) {
			await withRetry(async () => {
				const rows = await listRows(repository, "cardRelations");
				const row = rows.find((candidate) => candidate.id === input.relationId);
				if (!row || !isActiveRow(row)) return;
				await applyWrites(repository, "cardRelations.archive", [
					{
						entity: "cardRelation",
						operation: "delete",
						id: row.id,
						expectedRevision: input.expectedRevision ?? row.revision,
					},
				]);
			});
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
					const id = arrowRelationId(input.whiteboardId, arrowShapeId);
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
