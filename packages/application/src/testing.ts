import type {
	ApplyResult,
	DomainCommand,
	DomainQuery,
	WorkspaceChangeFilter,
	WorkspaceChangeListener,
	WorkspaceRepository,
} from "@contextboard/client-core";
import {
	describeDomainCommand,
	workspaceChangeMatches,
} from "@contextboard/client-core";
import { type EntityWrite, WorkspaceConflictError } from "./workspace";

type Entity = Record<string, unknown> & {
	id: string;
	revision: number;
	deletedAt: number | null;
};

const ENTITY_TYPES: Record<string, string> = {
	cards: "card",
	cardContents: "cardContent",
	whiteboards: "whiteboard",
	items: "boardItem",
	records: "canvasRecord",
	tldrawDocuments: "tldrawDocument",
	files: "file",
	fileReferences: "fileReference",
	cardReferences: "cardReference",
	cardRelations: "cardRelation",
	conflicts: "conflict",
	todos: "todo",
};

/**
 * In-memory stand-in for a generic entity store, mirroring the SQLite command
 * allowlist and materialization rules. Test-only: it lets shared UI and the
 * repository-backed capabilities be exercised without a platform backend.
 */
export function createMemoryWorkspaceRepository(
	options: { now?: () => number } = {},
): WorkspaceRepository & {
	pendingCommands: string[];
	queryLog: DomainQuery<unknown>[];
} {
	const now = options.now ?? (() => Date.now());
	const store = new Map<string, Map<string, Entity>>();
	const listeners = new Set<{
		listener: WorkspaceChangeListener;
		filter?: WorkspaceChangeFilter;
	}>();
	const emit = (command: DomainCommand<unknown>) => {
		const change = { origin: "local" as const, changes: describeDomainCommand(command) };
		for (const subscription of listeners)
			if (workspaceChangeMatches(change, subscription.filter))
				subscription.listener(change);
	};
	const pendingCommands: string[] = [];
	/**
	 * Every read this repository served, in order. Backends that cross a process
	 * boundary pay per read — and pay again per row returned — so tests assert
	 * both that batch APIs stay O(1) in reads rather than O(n) in the ids they
	 * are given, and that they scope their reads instead of pulling whole tables.
	 */
	const queryLog: DomainQuery<unknown>[] = [];

	const split = (type: string) => {
		const [prefix, action] = type.split(".");
		const entityType = ENTITY_TYPES[prefix ?? ""];
		if (!entityType)
			throw new Error("The requested domain operation is not supported");
		return { entityType, action };
	};

	const table = (entityType: string) => {
		let rows = store.get(entityType);
		if (!rows) {
			rows = new Map();
			store.set(entityType, rows);
		}
		return rows;
	};

	return {
		pendingCommands,
		queryLog,
		async query<T>(query: DomainQuery<T>): Promise<T> {
			queryLog.push(query as DomainQuery<unknown>);
			const { entityType, action } = split(query.type);
			const input = (query.input ?? {}) as Record<string, unknown> & {
				id?: string;
				ids?: unknown;
				whiteboardId?: unknown;
			};
			const rows = table(entityType);
			if (action === "get") {
				if (!input.id) throw new Error("A valid entity ID is required");
				const row = rows.get(input.id);
				return (row && row.deletedAt === null ? row : null) as T;
			}
			if (action !== "list")
				throw new Error("The requested domain operation is not supported");
			if ("ids" in input) {
				if (!Array.isArray(input.ids)) throw new Error("ids must be an array");
				if (input.ids.some((id) => typeof id !== "string" || id.length === 0))
					throw new Error("ids must contain non-empty strings");
			}
			const whiteboardFilterSupported = new Set([
				"boardItem",
				"canvasRecord",
				"tldrawDocument",
				"cardRelation",
			]);
			if ("whiteboardId" in input && !whiteboardFilterSupported.has(entityType))
				throw new Error(
					`whiteboardId filtering is not supported for ${entityType}`,
				);
			if (
				"whiteboardId" in input &&
				input.whiteboardId !== null &&
				typeof input.whiteboardId !== "string"
			)
				throw new Error("whiteboardId must be a string or null");

			const ids = "ids" in input ? [...new Set(input.ids as string[])] : null;
			const idSet = ids ? new Set(ids) : null;
			const whiteboardId = input.whiteboardId as string | null | undefined;
			const includes = (key: string, value: unknown) =>
				!(key in input) || (input[key] as unknown[]).includes(value);
			return [...rows.values()]
				.filter((row) => (idSet ? idSet.has(row.id) : true))
				.filter((row) =>
					"whiteboardId" in input
						? (row.whiteboardId ?? null) === whiteboardId
						: true,
				)
				.filter((row) => includes("whiteboardIds", row.whiteboardId ?? null))
				.filter((row) =>
					!("cardIds" in input) ||
					includes("cardIds", row.cardId) ||
					includes("cardIds", row.sourceCardId) ||
					includes("cardIds", row.targetCardId),
				)
				.filter((row) => includes("childWhiteboardIds", row.childWhiteboardId))
				.filter((row) => includes("parentWhiteboardIds", row.parentWhiteboardId ?? null))
				.filter((row) => includes("sourceCardIds", row.sourceCardId))
				.filter((row) => includes("targetCardIds", row.targetCardId))
				.filter((row) => includes("targetKeys", row.targetKey))
				.filter((row) => includes("fileIds", row.fileId))
				.filter((row) => row.deletedAt === null)
				.sort((a, b) => a.id.localeCompare(b.id)) as T;
		},
		async execute<T>(command: DomainCommand<T>): Promise<T> {
			const { entityType, action } = split(command.type);
			const input = (command.input ?? {}) as {
				value?: Record<string, unknown>;
				writes?: EntityWrite[];
			};

			// Multi-entity atomic form: the command type is only a label, every
			// write names its own entity and may assert an expected revision.
			if (input.writes) {
				if (!input.writes.length)
					throw new Error("writes must contain at least 1 entry");
				for (const write of input.writes) {
					const rows = table(write.entity);
					const existing = rows.get(write.id);
					if (
						write.expectedRevision !== undefined &&
						write.expectedRevision !== (existing?.revision ?? 0)
					)
						throw new WorkspaceConflictError(
							`CONFLICT: revision mismatch for ${write.entity}:${write.id}`,
						);
				}
				const materialized: Record<string, unknown>[] = [];
				for (const write of input.writes) {
					const rows = table(write.entity);
					const existing = rows.get(write.id);
					const timestamp = now();
					const deleted = write.operation === "delete";
					const next = {
						...(deleted ? existing : (write.value as Record<string, unknown>)),
						id: write.id,
						revision: (existing?.revision ?? 0) + 1,
						updatedAt: timestamp,
						deletedAt: deleted ? timestamp : null,
					} as Entity;
					rows.set(write.id, next);
					materialized.push(next);
				}
				pendingCommands.push(command.type);
				emit(command);
				return materialized as T;
			}

			if (
				!["create", "put", "update", "upsert", "delete"].includes(action ?? "")
			)
				throw new Error("The requested domain operation is not supported");
			const value = input.value;
			if (!value || typeof value.id !== "string")
				throw new Error("A valid entity ID is required");
			const rows = table(entityType);
			const existing = rows.get(value.id);
			const timestamp = now();
			const deleted = action === "delete";
			const materialized = {
				...value,
				id: value.id,
				revision: (existing?.revision ?? 0) + 1,
				updatedAt: timestamp,
				deletedAt: deleted ? timestamp : null,
			} as Entity;
			rows.set(value.id, materialized);
			pendingCommands.push(command.type);
			emit(command);
			return (action === "create" ? value.id : materialized) as T;
		},
		subscribe(listener, filter) {
			const subscription = { listener, filter };
			listeners.add(subscription);
			return () => listeners.delete(subscription);
		},
		async getPendingBatches() {
			return [];
		},
		async acknowledge() {},
		async applyRemote(): Promise<ApplyResult> {
			return { applied: 0, conflicts: 0 };
		},
		async updateSyncCursor() {},
		async getSyncState() {
			return {
				peerId: "memory",
				cursor: null,
				enabled: false,
				updatedAt: 0,
				lastSyncedAt: null,
			};
		},
	};
}
