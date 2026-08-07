import type { WorkspaceRepository } from "@contextboard/client-core";
import type { EntityWrite } from "../workspace";

/**
 * A row as materialized by every backend's generic entity store. Backends own
 * persistence, revisions and the pending batch; every derived field is owned by
 * this package so both platforms agree.
 */
export type EntityRow = Record<string, unknown> & {
	id: string;
	revision: number;
	createdAt: number;
	updatedAt: number;
	deletedAt: number | null;
	archivedAt?: number | null;
};

/** Optional predicates for collection reads that can be answered by storage. */
type BaseEntityListFilter = {
	ids?: readonly string[];
};

type SummaryProjection = { projection?: "full" | "summary" };

export type EntityListFilterByCollection = {
	cards: BaseEntityListFilter &
		SummaryProjection & { searchTerm?: string; limit?: number };
	cardContents: BaseEntityListFilter & { cardIds?: readonly string[] };
	items: BaseEntityListFilter & {
		whiteboardId?: string | null;
		whiteboardIds?: readonly (string | null)[];
		cardIds?: readonly string[];
		childWhiteboardIds?: readonly string[];
	};
	whiteboards: BaseEntityListFilter & {
		parentWhiteboardIds?: readonly (string | null)[];
		searchTerm?: string;
		limit?: number;
	};
	cardReferences: BaseEntityListFilter & {
		sourceCardIds?: readonly string[];
		targetCardIds?: readonly string[];
	};
	fileReferences: BaseEntityListFilter & {
		targetKeys?: readonly string[];
		fileIds?: readonly string[];
	};
	cardRelations: BaseEntityListFilter & {
		whiteboardId?: string | null;
		whiteboardIds?: readonly (string | null)[];
		cardIds?: readonly string[];
	};
	records: BaseEntityListFilter & {
		whiteboardId?: string | null;
		whiteboardIds?: readonly (string | null)[];
	};
	tldrawDocuments: BaseEntityListFilter & {
		whiteboardId?: string | null;
		whiteboardIds?: readonly (string | null)[];
	};
	files: BaseEntityListFilter & SummaryProjection;
	conflicts: BaseEntityListFilter;
	todos: BaseEntityListFilter;
};
export type EntityCollection = keyof EntityListFilterByCollection;
export type EntityListFilter = EntityListFilterByCollection[EntityCollection];

/** Rows that are neither tombstoned nor archived. */
export function isActiveRow(row: {
	deletedAt: number | null;
	archivedAt?: number | null;
}) {
	return (
		row.deletedAt === null &&
		(row.archivedAt === undefined || row.archivedAt === null)
	);
}

function normalizeRow(value: unknown): EntityRow | null {
	if (!value || typeof value !== "object") return null;
	const row = value as Partial<EntityRow>;
	if (typeof row.id !== "string") return null;
	return {
		...(value as Record<string, unknown>),
		id: row.id,
		revision: typeof row.revision === "number" ? row.revision : 1,
		createdAt: typeof row.createdAt === "number" ? row.createdAt : 0,
		updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : 0,
		deletedAt: typeof row.deletedAt === "number" ? row.deletedAt : null,
		archivedAt: typeof row.archivedAt === "number" ? row.archivedAt : null,
	};
}

/** Reads every row of one domain collection (e.g. `"items"`). */
export async function listRows<K extends EntityCollection>(
	repository: WorkspaceRepository,
	collection: K,
	filter: EntityListFilterByCollection[K] = {} as EntityListFilterByCollection[K],
): Promise<EntityRow[]> {
	const raw = await repository.query<unknown>({
		type: `${collection}.list`,
		input: filter,
	});
	return (Array.isArray(raw) ? raw : [])
		.map(normalizeRow)
		.filter((row): row is EntityRow => row !== null);
}

/** Reads every *active* row of one domain collection. */
export async function listActiveRows(
	repository: WorkspaceRepository,
	collection: EntityCollection,
): Promise<EntityRow[]> {
	return (await listRows(repository, collection)).filter(isActiveRow);
}

export async function getRow(
	repository: WorkspaceRepository,
	collection: EntityCollection,
	id: string,
): Promise<EntityRow | null> {
	return normalizeRow(
		await repository.query<unknown>({
			type: `${collection}.get`,
			input: { id },
		}),
	);
}

/**
 * Submits a planner's writes as a single atomic multi-entity command. Empty
 * plans never reach the backend, because the multi-write contract rejects a
 * command with zero writes.
 */
export async function applyWrites(
	repository: WorkspaceRepository,
	type: string,
	writes: EntityWrite[],
): Promise<void> {
	if (writes.length === 0) return;
	await repository.execute({ type, input: { writes } });
}
