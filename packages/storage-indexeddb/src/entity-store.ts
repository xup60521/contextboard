import {
	ContextboardDatabase,
	type ContextboardDatabaseLike,
	ensureLocalIdentity,
	type RowTable,
	runLocalCommand,
} from "@contextboard/local-db";
import {
	type EntityChange,
	HybridLogicalClock,
	type SyncEntityType,
} from "@contextboard/sync-protocol";
import Dexie from "dexie";

type Row = Record<string, unknown> & {
	id: string;
	revision: number;
	deletedAt: number | null;
};

type EntityBinding = {
	entityType: SyncEntityType;
	/** Entity writes use the backend-neutral local table contract. */
	table: (db: ContextboardDatabaseLike) => RowTable<Row>;
	/** Keeps generic writes compatible with the Web schema's indexes. */
	defaults: () => Record<string, unknown>;
	idField?: string;
};
type NormalizedWrite = {
	binding: EntityBinding;
	operation: "upsert" | "delete";
	id: string;
	value?: Record<string, unknown>;
	expectedRevision?: number;
};

/**
 * Allowlist mapping domain operation prefixes onto entity stores. It mirrors
 * `query_operation` / `command_operation` in the Rust SQLite backend so both
 * platforms accept exactly the same operations.
 */
const BINDINGS: Record<string, EntityBinding> = {
	cards: {
		entityType: "card",
		table: (db) => db.cards as RowTable<Row>,
		defaults: () => ({
			content: null,
			derivedTitle: "Untitled card",
			plainText: "",
			preview: "",
			contentVersion: 1,
			activePlacementCount: 0,
			archivedAt: null,
		}),
	},
	whiteboards: {
		entityType: "whiteboard",
		table: (db) => db.whiteboards as RowTable<Row>,
		defaults: () => ({
			title: "Untitled whiteboard",
			parentWhiteboardId: null,
			ancestorIds: [],
			depth: 0,
			sortKey: "",
			pathKey: "",
			archivedAt: null,
		}),
	},
	items: {
		entityType: "boardItem",
		table: (db) => db.boardItems as RowTable<Row>,
		defaults: () => ({
			whiteboardId: null,
			kind: "card",
			cardId: null,
			childWhiteboardId: null,
			shapeId: "",
			x: 0,
			y: 0,
			w: 0,
			h: 0,
			rotation: 0,
			zIndex: 0,
			archivedAt: null,
		}),
	},
	records: {
		entityType: "canvasRecord",
		table: (db) => db.canvasRecords as RowTable<Row>,
		defaults: () => ({
			whiteboardId: null,
			recordId: "",
			recordType: "",
			payload: null,
			clock: "",
		}),
	},
	tldrawDocuments: {
		entityType: "tldrawDocument",
		table: (db) => db.tldrawDocuments as RowTable<Row>,
		defaults: () => ({
			whiteboardId: null,
			documentVersion: 1,
			storageMode: "legacy-snapshot",
		}),
	},
	files: {
		entityType: "file",
		table: (db) => db.files as RowTable<Row>,
		defaults: () => ({ status: "active", pendingDeleteAt: null }),
	},
	fileReferences: {
		entityType: "fileReference",
		table: (db) => db.fileReferences as RowTable<Row>,
		defaults: () => ({ targetKey: "", fileId: null }),
	},
	cardReferences: {
		entityType: "cardReference",
		table: (db) => db.cardReferences as RowTable<Row>,
		defaults: () => ({ sourceCardId: null, targetCardId: null }),
	},
	cardRelations: {
		entityType: "cardRelation",
		table: (db) => db.cardRelations as RowTable<Row>,
		defaults: () => ({
			whiteboardId: null,
			sourceCardId: null,
			targetCardId: null,
			arrowShapeId: null,
			ordinal: null,
			clock: "",
		}),
	},
	cardContents: {
		entityType: "cardContent",
		table: (db) => db.cardContents as RowTable<Row>,
		defaults: () => ({
			cardId: null,
			document: null,
			contentVersion: 1,
			clock: "",
		}),
	},
	conflicts: {
		entityType: "conflict",
		table: (db) => db.conflicts as unknown as RowTable<Row>,
		idField: "conflictId",
		defaults: () => ({
			entityType: "card",
			entityId: "",
			localValue: null,
			remoteValue: null,
			resolvedAt: null,
			resolution: null,
		}),
	},
	todos: {
		entityType: "todo",
		table: (db) => db.todos as RowTable<Row>,
		defaults: () => ({ text: "", completed: false }),
	},
};

export const SUPPORTED_ENTITY_TYPES = Object.freeze(
	Object.values(BINDINGS)
		.map((binding) => binding.entityType)
		.sort(),
);

const QUERY_ACTIONS = new Set(["list", "get"]);
const COMMAND_ACTIONS: Record<string, "upsert" | "delete"> = {
	create: "upsert",
	put: "upsert",
	update: "upsert",
	upsert: "upsert",
	delete: "delete",
};

export class UnknownDomainOperationError extends Error {
	constructor(operation: string) {
		super(`The domain operation "${operation}" is not supported`);
		this.name = "UNKNOWN_DOMAIN_OPERATION";
	}
}

export class InvalidDomainArgumentError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "INVALID_ARGUMENT";
	}
}

export class EntityConflictError extends Error {
	readonly code = "CONFLICT";
	constructor(message: string) {
		super(message);
		this.name = "CONFLICT";
	}
}

function resolve(operation: unknown) {
	const [prefix, action] = String(operation ?? "").split(".");
	const binding = BINDINGS[prefix ?? ""];
	if (!binding || !action)
		throw new UnknownDomainOperationError(String(operation));
	return { binding, action };
}

const isActive = (row: Row | undefined): row is Row =>
	!!row && row.deletedAt === null;

type ListQueryInput = {
	ids?: string[];
	whiteboardId?: string | null;
	whiteboardIds?: Array<string | null>;
	cardIds?: string[];
	childWhiteboardIds?: string[];
	parentWhiteboardIds?: Array<string | null>;
	sourceCardIds?: string[];
	targetCardIds?: string[];
	targetKeys?: string[];
	fileIds?: string[];
	searchTerm?: string;
	limit?: number;
	projection?: "full" | "summary";
};

const FILTERS_BY_ENTITY: Record<string, ReadonlySet<keyof ListQueryInput>> = {
	card: new Set(["ids", "searchTerm", "limit", "projection"]),
	cardContent: new Set(["ids", "cardIds"]),
	boardItem: new Set([
		"ids",
		"whiteboardId",
		"whiteboardIds",
		"cardIds",
		"childWhiteboardIds",
	]),
	whiteboard: new Set(["ids", "parentWhiteboardIds", "searchTerm", "limit"]),
	cardReference: new Set(["ids", "sourceCardIds", "targetCardIds"]),
	fileReference: new Set(["ids", "targetKeys", "fileIds"]),
	cardRelation: new Set(["ids", "whiteboardId", "whiteboardIds", "cardIds"]),
	canvasRecord: new Set(["ids", "whiteboardId", "whiteboardIds"]),
	tldrawDocument: new Set(["ids", "whiteboardId", "whiteboardIds"]),
	file: new Set(["ids", "projection"]),
	conflict: new Set(["ids"]),
	todo: new Set(["ids"]),
};

function parseListQueryInput(
	input: unknown,
	entityType: string,
): ListQueryInput {
	if (input === undefined || input === null) return {};
	if (typeof input !== "object" || Array.isArray(input))
		throw new InvalidDomainArgumentError("List input must be an object");

	const value = input as Record<string, unknown>;
	const allowed = FILTERS_BY_ENTITY[entityType] ?? new Set(["ids"] as const);
	const result: ListQueryInput = {};
	for (const [key, raw] of Object.entries(value)) {
		if (!allowed.has(key as keyof ListQueryInput))
			throw new InvalidDomainArgumentError(
				`${key} filtering is not supported for ${entityType}`,
			);
		if (key === "searchTerm") {
			if (typeof raw !== "string")
				throw new InvalidDomainArgumentError("searchTerm must be a string");
			result.searchTerm = raw.trim().toLocaleLowerCase();
			continue;
		}
		if (key === "limit") {
			if (
				typeof raw !== "number" ||
				!Number.isSafeInteger(raw) ||
				raw < 1 ||
				raw > 100
			)
				throw new InvalidDomainArgumentError(
					"limit must be an integer between 1 and 100",
				);
			result.limit = raw;
			continue;
		}
		if (key === "projection") {
			if (raw !== "full" && raw !== "summary")
				throw new InvalidDomainArgumentError(
					"projection must be full or summary",
				);
			result.projection = raw;
			continue;
		}
		if (key === "whiteboardId") {
			if (raw !== null && typeof raw !== "string")
				throw new InvalidDomainArgumentError(
					"whiteboardId must be a string or null",
				);
			result.whiteboardId = raw as string | null;
			continue;
		}
		if (!Array.isArray(raw))
			throw new InvalidDomainArgumentError(`${key} must be an array`);
		const allowsNull = key === "whiteboardIds" || key === "parentWhiteboardIds";
		if (
			raw.some(
				(item) =>
					!(typeof item === "string" && item.length > 0) &&
					!(allowsNull && item === null),
			)
		)
			throw new InvalidDomainArgumentError(
				`${key} must contain non-empty strings${allowsNull ? " or null" : ""}`,
			);
		(result as Record<string, unknown>)[key] = [...new Set(raw)];
	}
	return result;
}

function hasWhiteboardId(row: Row, whiteboardId: string | null) {
	return (row.whiteboardId ?? null) === whiteboardId;
}

function rowMatchesFilter(row: Row, filter: ListQueryInput) {
	if (filter.searchTerm) {
		const text =
			row.derivedTitle !== undefined
				? `${String(row.derivedTitle)} ${String(row.plainText ?? "")} ${String(row.preview ?? "")}`
				: String(row.title ?? "");
		if (!text.toLocaleLowerCase().includes(filter.searchTerm)) return false;
	}
	if (
		filter.whiteboardId !== undefined &&
		!hasWhiteboardId(row, filter.whiteboardId)
	)
		return false;
	if (
		filter.whiteboardIds &&
		!filter.whiteboardIds.includes((row.whiteboardId ?? null) as string | null)
	)
		return false;
	if (
		filter.cardIds &&
		!filter.cardIds.includes(String(row.cardId ?? "")) &&
		!filter.cardIds.includes(String(row.sourceCardId ?? "")) &&
		!filter.cardIds.includes(String(row.targetCardId ?? ""))
	)
		return false;
	if (
		filter.childWhiteboardIds &&
		!filter.childWhiteboardIds.includes(String(row.childWhiteboardId ?? ""))
	)
		return false;
	if (
		filter.parentWhiteboardIds &&
		!filter.parentWhiteboardIds.includes(
			(row.parentWhiteboardId ?? null) as string | null,
		)
	)
		return false;
	if (
		filter.sourceCardIds &&
		!filter.sourceCardIds.includes(String(row.sourceCardId ?? ""))
	)
		return false;
	if (
		filter.targetCardIds &&
		!filter.targetCardIds.includes(String(row.targetCardId ?? ""))
	)
		return false;
	if (
		filter.targetKeys &&
		!filter.targetKeys.includes(String(row.targetKey ?? ""))
	)
		return false;
	if (filter.fileIds && !filter.fileIds.includes(String(row.fileId ?? "")))
		return false;
	return true;
}

async function rowsForValues(
	table: RowTable<Row>,
	index: string,
	values: readonly (string | null)[],
) {
	if (values.length === 0) return [];
	if (values.includes(null))
		return (await table.toArray()).filter((row) =>
			values.includes((row[index] ?? null) as string | null),
		);
	let rows: Row[][];
	try {
		rows = await Promise.all(
			values.map((value) => table.where(index).equals(value).toArray()),
		);
	} catch (error) {
		throw new InvalidDomainArgumentError(
			`Invalid indexed filter ${index}: ${JSON.stringify(values)} (${error instanceof Error ? error.message : String(error)})`,
		);
	}
	return [...new Map(rows.flat().map((row) => [row.id, row])).values()];
}

export async function queryEntities(
	database: ContextboardDatabaseLike,
	request: { type: string; input?: unknown },
): Promise<unknown> {
	const { binding, action } = resolve(request.type);
	if (!QUERY_ACTIONS.has(action))
		throw new UnknownDomainOperationError(request.type);
	const table = binding.table(database);
	if (action === "get") {
		const id = (request.input as { id?: unknown } | undefined)?.id;
		if (typeof id !== "string" || !id)
			throw new InvalidDomainArgumentError("A valid entity ID is required");
		const row = (await table.get(id)) as Row | undefined;
		return isActive(row) ? row : null;
	}
	const filter = parseListQueryInput(request.input, binding.entityType);
	if (
		filter.ids?.length === 0 ||
		filter.whiteboardIds?.length === 0 ||
		filter.cardIds?.length === 0 ||
		filter.childWhiteboardIds?.length === 0 ||
		filter.parentWhiteboardIds?.length === 0 ||
		filter.sourceCardIds?.length === 0 ||
		filter.targetCardIds?.length === 0 ||
		filter.targetKeys?.length === 0 ||
		filter.fileIds?.length === 0
	)
		return [];

	if (
		binding.entityType === "file" &&
		filter.projection === "summary" &&
		filter.ids &&
		database instanceof ContextboardDatabase
	) {
		const metadata = await Promise.all(
			filter.ids.map(async (id) => {
				const key = (await database.files
					.where("[id+revision]")
					.between([id, Dexie.minKey], [id, Dexie.maxKey])
					.firstKey()) as [string, number] | undefined;
				return key ? { id: key[0], revision: key[1] } : null;
			}),
		);
		return metadata.filter((row) => row !== null);
	}

	const indexedFilter = filter.whiteboardIds?.every(
		(id): id is string => id !== null,
	)
		? (["whiteboardId", filter.whiteboardIds] as const)
		: filter.cardIds && binding.entityType !== "cardRelation"
			? (["cardId", filter.cardIds] as const)
			: filter.childWhiteboardIds
				? (["childWhiteboardId", filter.childWhiteboardIds] as const)
				: filter.parentWhiteboardIds?.every((id): id is string => id !== null)
					? (["parentWhiteboardId", filter.parentWhiteboardIds] as const)
					: filter.sourceCardIds
						? (["sourceCardId", filter.sourceCardIds] as const)
						: filter.targetCardIds
							? (["targetCardId", filter.targetCardIds] as const)
							: filter.targetKeys
								? (["targetKey", filter.targetKeys] as const)
								: filter.fileIds
									? (["fileId", filter.fileIds] as const)
									: null;
	const rows = filter.ids
		? ((await table.bulkGet(filter.ids)).filter(
				(row): row is Row => !!row,
			) as Row[])
		: filter.cardIds && binding.entityType === "cardRelation"
			? [
					...new Map(
						(
							await Promise.all([
								rowsForValues(table, "sourceCardId", filter.cardIds),
								rowsForValues(table, "targetCardId", filter.cardIds),
							])
						)
							.flat()
							.map((row) => [row.id, row]),
					).values(),
				]
			: indexedFilter
				? await rowsForValues(table, indexedFilter[0], indexedFilter[1])
				: typeof filter.whiteboardId === "string"
					? ((await table
							.where("whiteboardId")
							.equals(filter.whiteboardId)
							.toArray()) as Row[])
					: filter.searchTerm && filter.limit
						? ((await table
								.orderBy("updatedAt")
								.reverse()
								.filter(
									(row) =>
										isActive(row as Row) &&
										rowMatchesFilter(row as Row, filter),
								)
								.limit(filter.limit)
								.toArray()) as Row[])
						: ((await table.toArray()) as Row[]);
	// Bound to a local so the closure below keeps the narrowed type.
	const scopedRows = rows.filter((row) => rowMatchesFilter(row, filter));
	const active = scopedRows.filter(isActive);
	if (filter.searchTerm)
		active.sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0));
	else active.sort((a, b) => a.id.localeCompare(b.id));
	const limited = filter.limit ? active.slice(0, filter.limit) : active;
	if (filter.projection === "summary" && binding.entityType === "card")
		return limited.map(({ content: _content, ...summary }) => summary);
	if (filter.projection === "summary" && binding.entityType === "file")
		return limited.map(({ blob: _blob, ...summary }) => summary);
	return limited;
}

const clocks = new Map<string, HybridLogicalClock>();

export async function executeEntityCommand(
	database: ContextboardDatabaseLike,
	request: { type: string; input?: unknown },
): Promise<unknown> {
	const input = request.input as
		| {
				value?: Record<string, unknown>;
				writes?: Array<{
					entity?: unknown;
					operation?: unknown;
					id?: unknown;
					value?: unknown;
					expectedRevision?: unknown;
				}>;
		  }
		| undefined;
	const multiWrite = Array.isArray(input?.writes);
	const legacyResolved = multiWrite ? null : resolve(request.type);
	const legacyBinding = legacyResolved?.binding ?? BINDINGS.cards;
	const action =
		legacyResolved?.action ?? request.type.split(".")[1] ?? "execute";
	const legacyOperation = multiWrite ? "upsert" : COMMAND_ACTIONS[action];
	if (!legacyOperation) throw new UnknownDomainOperationError(request.type);
	if (
		request.type.length > 64 ||
		!/^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/.test(request.type)
	)
		throw new InvalidDomainArgumentError("Invalid command type");
	const byEntity = new Map(
		Object.values(BINDINGS).map((candidate) => [
			candidate.entityType,
			candidate,
		]),
	);
	const writes: NormalizedWrite[] = input?.writes
		? input.writes.map((write) => {
				const binding = byEntity.get(write.entity as SyncEntityType);
				if (!binding)
					throw new InvalidDomainArgumentError("Invalid entity type");
				if (write.operation !== "upsert" && write.operation !== "delete")
					throw new InvalidDomainArgumentError("Invalid write operation");
				if (typeof write.id !== "string" || !write.id)
					throw new InvalidDomainArgumentError("A valid entity ID is required");
				if (write.operation === "upsert" && !write.value)
					throw new InvalidDomainArgumentError("Upserts require a value");
				if (write.operation === "delete" && write.value !== undefined)
					throw new InvalidDomainArgumentError(
						"Deletes cannot include a value",
					);
				if (
					write.expectedRevision !== undefined &&
					(typeof write.expectedRevision !== "number" ||
						!Number.isSafeInteger(write.expectedRevision))
				)
					throw new InvalidDomainArgumentError(
						"expectedRevision must be an integer",
					);
				return {
					binding,
					operation: write.operation,
					id: write.id,
					value: write.value as Record<string, unknown> | undefined,
					expectedRevision: write.expectedRevision as number | undefined,
				};
			})
		: [
				{
					binding: legacyBinding,
					operation: legacyOperation,
					id: String(input?.value?.id ?? ""),
					value: input?.value,
					expectedRevision: undefined,
				},
			];
	if (writes.length < 1)
		throw new InvalidDomainArgumentError(
			"writes must contain at least 1 entry",
		);
	const keys = new Set<string>();
	for (const write of writes) {
		if (!write.id)
			throw new InvalidDomainArgumentError("A valid entity ID is required");
		const key = `${write.binding.entityType}\0${write.id}`;
		if (keys.has(key))
			throw new InvalidDomainArgumentError(
				"A command cannot write the same entity twice",
			);
		keys.add(key);
	}

	const identity = await ensureLocalIdentity(database);
	let clock = clocks.get(identity.deviceId);
	if (!clock) {
		clock = new HybridLogicalClock(identity.deviceId);
		clocks.set(identity.deviceId, clock);
	}
	const tables = [
		...new Set(writes.map((write) => write.binding.table(database))),
	];

	return runLocalCommand(
		database,
		{ ...identity, clock },
		request.type,
		tables,
		async () => {
			const now = Date.now();
			const changes: EntityChange[] = [];
			let result: unknown = null;
			for (const write of writes) {
				const table = write.binding.table(database);
				const existing = (await table.get(write.id)) as Row | undefined;
				if (
					write.expectedRevision !== undefined &&
					write.expectedRevision !== (existing?.revision ?? 0)
				)
					throw new EntityConflictError(
						`Revision conflict for ${write.binding.entityType}:${write.id}`,
					);
				const revision = (existing?.revision ?? 0) + 1;
				const materialized = {
					...write.binding.defaults(),
					...existing,
					...(write.value ?? {}),
					id: write.id,
					...(write.binding.idField
						? { [write.binding.idField]: write.id }
						: {}),
					createdAt:
						typeof existing?.createdAt === "number"
							? existing.createdAt
							: typeof write.value?.createdAt === "number"
								? write.value.createdAt
								: now,
					revision,
					updatedAt: now,
					updatedByDeviceId: identity.deviceId,
					deletedAt: write.operation === "delete" ? now : null,
				} as Row;
				await table.put(materialized);
				changes.push({
					entityType: write.binding.entityType,
					entityId: materialized.id,
					baseRevision: existing?.revision ?? null,
					revision,
					operation: write.operation,
					clock: "",
					value: materialized,
				});
				result = materialized;
			}
			return {
				result:
					!input?.writes && action === "create"
						? writes[0]?.id
						: input?.writes
							? changes.map((change) => change.value)
							: result,
				changes,
			};
		},
	);
}
