import {
	type ContextboardDatabase,
	ensureLocalIdentity,
	runLocalCommand,
} from "@contextboard/local-db";
import {
	type EntityChange,
	HybridLogicalClock,
	type SyncEntityType,
} from "@contextboard/sync-protocol";
import type { Table } from "dexie";

type Row = Record<string, unknown> & {
	id: string;
	revision: number;
	deletedAt: number | null;
};

type EntityBinding = {
	entityType: SyncEntityType;
	/** Dexie tables are entity-typed; generic writes go through a Row view. */
	table: (db: ContextboardDatabase) => Table<Row, string>;
	/** Keeps generic writes compatible with the Web schema's indexes. */
	defaults: () => Record<string, unknown>;
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
		table: (db) => db.cards as unknown as Table<Row, string>,
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
		table: (db) => db.whiteboards as unknown as Table<Row, string>,
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
		table: (db) => db.boardItems as unknown as Table<Row, string>,
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
		table: (db) => db.canvasRecords as unknown as Table<Row, string>,
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
		table: (db) => db.tldrawDocuments as unknown as Table<Row, string>,
		defaults: () => ({ whiteboardId: null, documentVersion: 1 }),
	},
	files: {
		entityType: "file",
		table: (db) => db.files as unknown as Table<Row, string>,
		defaults: () => ({ status: "pending", pendingDeleteAt: null }),
	},
	fileReferences: {
		entityType: "fileReference",
		table: (db) => db.fileReferences as unknown as Table<Row, string>,
		defaults: () => ({ targetKey: "", fileId: null }),
	},
	cardReferences: {
		entityType: "cardReference",
		table: (db) => db.cardReferences as unknown as Table<Row, string>,
		defaults: () => ({ sourceCardId: null, targetCardId: null }),
	},
	cardRelations: {
		entityType: "cardRelation",
		table: (db) => db.cardRelations as unknown as Table<Row, string>,
		defaults: () => ({
			whiteboardId: null,
			sourceCardId: null,
			targetCardId: null,
			arrowShapeId: null,
			ordinal: null,
			clock: "",
		}),
	},
};

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

export async function queryEntities(
	database: ContextboardDatabase,
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
	const rows = (await table.toArray()) as Row[];
	return rows.filter(isActive).sort((a, b) => a.id.localeCompare(b.id));
}

const clocks = new Map<string, HybridLogicalClock>();

export async function executeEntityCommand(
	database: ContextboardDatabase,
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
