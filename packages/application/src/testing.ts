import type {
	ApplyResult,
	DomainCommand,
	DomainQuery,
	WorkspaceRepository,
} from "@contextboard/client-core";
import { type EntityWrite, WorkspaceConflictError } from "./workspace";

type Entity = Record<string, unknown> & {
	id: string;
	revision: number;
	deletedAt: number | null;
};

const ENTITY_TYPES: Record<string, string> = {
	cards: "card",
	whiteboards: "whiteboard",
	items: "boardItem",
	records: "canvasRecord",
	tldrawDocuments: "tldrawDocument",
	files: "file",
	fileReferences: "fileReference",
	cardReferences: "cardReference",
	cardRelations: "cardRelation",
};

/**
 * In-memory stand-in for a generic entity store, mirroring the SQLite command
 * allowlist and materialization rules. Test-only: it lets shared UI and the
 * repository-backed capabilities be exercised without a platform backend.
 */
export function createMemoryWorkspaceRepository(
	options: { now?: () => number } = {},
): WorkspaceRepository & { pendingCommands: string[] } {
	const now = options.now ?? (() => Date.now());
	const store = new Map<string, Map<string, Entity>>();
	const listeners = new Set<() => void>();
	const pendingCommands: string[] = [];

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
		async query<T>(query: DomainQuery<T>): Promise<T> {
			const { entityType, action } = split(query.type);
			const input = (query.input ?? {}) as { id?: string };
			const rows = table(entityType);
			if (action === "get") {
				if (!input.id) throw new Error("A valid entity ID is required");
				const row = rows.get(input.id);
				return (row && row.deletedAt === null ? row : null) as T;
			}
			if (action !== "list")
				throw new Error("The requested domain operation is not supported");
			return [...rows.values()]
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
				const materialized: Record<string, unknown>[] = [];
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
				for (const listener of listeners) listener();
				return materialized as T;
			}

			if (!["create", "put", "update", "upsert", "delete"].includes(action ?? ""))
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
			for (const listener of listeners) listener();
			return (action === "create" ? value.id : materialized) as T;
		},
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		async getPendingBatches() {
			return [];
		},
		async acknowledge() {},
		async applyRemote(): Promise<ApplyResult> {
			return { applied: 0, conflicts: 0 };
		},
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
