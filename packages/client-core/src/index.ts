import type {
	BlobDescriptor,
	ChangeBatch,
	CheckpointDescriptor,
	ClaimWorkspaceRequest,
	ClaimWorkspaceResponse,
	EntityChange,
	ListWorkspacesResponse,
	PersistedSyncState,
	PullChangesRequest,
	PullChangesResponse,
	PushChangesRequest,
	PushChangesResponse,
	SyncEntityType,
	SyncStatus,
	SyncTransport,
	WorkspaceMembership,
} from "@contextboard/sync-protocol";
import {
	MAX_SYNC_JSON_BODY_BYTES,
	syncVersionHeaders,
} from "@contextboard/sync-protocol";

export type ContextboardPerfMetric =
	| "repository.query"
	| "repository.command"
	| "repository.rows"
	| "repository.notification.emitted"
	| "repository.notification.delivered"
	| "canvas.items.reload"
	| "canvas.document.reload"
	| "canvas.document.patch"
	| "canvas.document.recovery"
	| "canvas.shape.created"
	| "canvas.shape.deleted"
	| "canvas.relation.reconcile"
	| "card.content.write"
	| "canvas.frame.write"
	| "canvas.hydration.candidate"
	| "canvas.hydration.cache-hit";

export type ContextboardPerfSnapshot = {
	enabled: true;
	startedAt: number;
	counters: Record<string, number>;
	events: ReadonlyArray<{
		metric: ContextboardPerfMetric;
		value: number;
		detail?: string;
		at: number;
	}>;
};

type MutablePerfState = {
	startedAt: number;
	counters: Record<string, number>;
	events: Array<{
		metric: ContextboardPerfMetric;
		value: number;
		detail?: string;
		at: number;
	}>;
};

declare global {
	interface Window {
		__contextboardPerf?: {
			snapshot(): ContextboardPerfSnapshot;
			reset(): void;
		};
	}
}

let perfState: MutablePerfState | null = null;

function perfRequested() {
	if (typeof window === "undefined") return false;
	return new URLSearchParams(window.location.search).get("perf") === "1";
}

function newPerfState(): MutablePerfState {
	return { startedAt: Date.now(), counters: {}, events: [] };
}

function ensurePerfState() {
	if (!perfRequested()) {
		perfState = null;
		if (typeof window !== "undefined") delete window.__contextboardPerf;
		return null;
	}
	perfState ??= newPerfState();
	if (!window.__contextboardPerf) {
		window.__contextboardPerf = {
			snapshot: () => ({
				enabled: true,
				startedAt: perfState?.startedAt ?? Date.now(),
				counters: { ...(perfState?.counters ?? {}) },
				events: [...(perfState?.events ?? [])],
			}),
			reset: () => {
				perfState = newPerfState();
			},
		};
	}
	return perfState;
}

/** Records opt-in, browser-local diagnostics when the page has `?perf=1`. */
export function recordContextboardPerf(
	metric: ContextboardPerfMetric,
	options: { value?: number; detail?: string } = {},
) {
	const state = ensurePerfState();
	if (!state) return;
	const value = options.value ?? 1;
	state.counters[metric] = (state.counters[metric] ?? 0) + value;
	if (options.detail) {
		const detailKey = `${metric}:${options.detail}`;
		state.counters[detailKey] = (state.counters[detailKey] ?? 0) + value;
	}
	state.events.push({ metric, value, detail: options.detail, at: Date.now() });
	if (state.events.length > 2_000) state.events.splice(0, 500);
}

export type DomainQuery<T> = {
	type: string;
	input: unknown;
	readonly __result?: T;
};
export type DomainCommand<T> = {
	type: string;
	input: unknown;
	readonly __result?: T;
};
export type WorkspaceChangeOrigin = "local" | "remote";
export type WorkspaceEntityChange = {
	entityType: SyncEntityType;
	entityId: string;
	operation: "upsert" | "delete";
	whiteboardId?: string | null;
	cardId?: string | null;
	parentWhiteboardId?: string | null;
};
export type WorkspaceChange = {
	origin: WorkspaceChangeOrigin;
	changes: readonly WorkspaceEntityChange[];
};
export type WorkspaceChangeFilter = {
	entityTypes?: readonly SyncEntityType[];
	entityIds?: readonly string[];
	whiteboardIds?: readonly (string | null)[];
	cardIds?: readonly string[];
};
export type WorkspaceChangeListener = (change: WorkspaceChange) => void;
export type Unsubscribe = () => void;
export type ApplyResult = {
	applied: number;
	conflicts: number;
	/** Remote entity changes that were actually materialized. */
	materializedChanges?: readonly EntityChange[];
};
export type LocalBlob = { descriptor: BlobDescriptor; blob: Blob };

export interface WorkspaceRepository {
	query<T>(query: DomainQuery<T>): Promise<T>;
	execute<T>(command: DomainCommand<T>): Promise<T>;
	subscribe(
		listener: WorkspaceChangeListener,
		filter?: WorkspaceChangeFilter,
	): Unsubscribe;
	getPendingBatches(limit: number): Promise<ChangeBatch[]>;
	acknowledge(changeIds: string[]): Promise<void>;
	applyRemote(
		batches: ChangeBatch[],
		peerId: string,
		nextCursor: string,
	): Promise<ApplyResult>;
	updateSyncCursor(peerId: string, cursor: string): Promise<void>;
	getSyncState(peerId: string): Promise<PersistedSyncState>;
	getLocalBlob?(hash: string): Promise<LocalBlob | null>;
	getMissingBlobs?(): Promise<BlobDescriptor[]>;
	storeRemoteBlob?(descriptor: BlobDescriptor, blob: Blob): Promise<void>;
}

const OPERATION_ENTITY_TYPES: Record<string, SyncEntityType> = {
	cards: "card",
	cardContents: "cardContent",
	whiteboards: "whiteboard",
	items: "boardItem",
	records: "canvasRecord",
	tldrawDocuments: "tldrawDocument",
	files: "file",
	fileReferences: "fileReference",
	cardReferences: "cardReference",
	whiteboardReferences: "whiteboardReference",
	cardRelations: "cardRelation",
	conflicts: "conflict",
	todos: "todo",
};

function scopeFromValue(value: unknown) {
	const row =
		value && typeof value === "object"
			? (value as Record<string, unknown>)
			: {};
	return {
		...(Object.hasOwn(row, "whiteboardId") &&
		(row.whiteboardId === null || typeof row.whiteboardId === "string")
			? { whiteboardId: row.whiteboardId as string | null }
			: {}),
		...(Object.hasOwn(row, "cardId") &&
		(row.cardId === null || typeof row.cardId === "string")
			? { cardId: row.cardId as string | null }
			: {}),
		...(Object.hasOwn(row, "parentWhiteboardId") &&
		(row.parentWhiteboardId === null ||
			typeof row.parentWhiteboardId === "string")
			? { parentWhiteboardId: row.parentWhiteboardId as string | null }
			: {}),
	};
}

export function describeDomainCommand(
	command: DomainCommand<unknown>,
	result?: unknown,
) {
	const input =
		command.input && typeof command.input === "object"
			? (command.input as Record<string, unknown>)
			: {};
	const writes = Array.isArray(input.writes) ? input.writes : null;
	if (writes) {
		const materialized = Array.isArray(result) ? result : [];
		return writes.flatMap((candidate, index): WorkspaceEntityChange[] => {
			if (!candidate || typeof candidate !== "object") return [];
			const write = candidate as Record<string, unknown>;
			if (typeof write.entity !== "string" || typeof write.id !== "string")
				return [];
			return [
				{
					entityType: write.entity as SyncEntityType,
					entityId: write.id,
					operation: write.operation === "delete" ? "delete" : "upsert",
					// Deletes intentionally omit a value from the command contract. Both
					// stores return their materialized tombstone in matching write order,
					// which preserves scope metadata for filtered invalidations.
					...scopeFromValue(write.value ?? materialized[index]),
				},
			];
		});
	}
	const prefix = command.type.split(".")[0] ?? "";
	const entityType = OPERATION_ENTITY_TYPES[prefix];
	const value = input.value ?? input;
	const row =
		value && typeof value === "object"
			? (value as Record<string, unknown>)
			: input;
	const id = row.id ?? row.conflictId ?? result;
	return entityType && typeof id === "string"
		? [
				{
					entityType,
					entityId: id,
					operation: "upsert" as const,
					...scopeFromValue(value),
				},
			]
		: [];
}

export function describeRemoteBatches(batches: readonly ChangeBatch[]) {
	return describeRemoteChanges(batches.flatMap((batch) => batch.changes));
}

export function describeRemoteChanges(changes: readonly EntityChange[]) {
	return changes.map((change) => ({
		entityType: change.entityType,
		entityId: change.entityId,
		operation: change.operation,
		...scopeFromValue(change.value),
	}));
}

export function workspaceChangeMatches(
	change: WorkspaceChange,
	filter?: WorkspaceChangeFilter,
) {
	if (!filter) return true;
	return change.changes.some((entity) => {
		if (filter.entityTypes && !filter.entityTypes.includes(entity.entityType))
			return false;
		if (filter.entityIds && !filter.entityIds.includes(entity.entityId))
			return false;
		if (filter.cardIds) {
			if (typeof entity.cardId !== "string") return false;
			if (!filter.cardIds.includes(entity.cardId)) return false;
		}
		if (filter.whiteboardIds) {
			const scopes = [entity.whiteboardId, entity.parentWhiteboardId].filter(
				(value): value is string | null => value !== undefined,
			);
			if (scopes.length === 0) return false;
			if (!scopes.some((id) => filter.whiteboardIds?.includes(id)))
				return false;
		}
		return true;
	});
}

const textEncoder = new TextEncoder();

function jsonByteLength(value: unknown) {
	return textEncoder.encode(JSON.stringify(value)).byteLength;
}

/**
 * Keep each push below the public gateway's JSON limit. The repository still
 * returns at most 100 batches per run, but a run may send several bounded
 * requests so an accumulated offline queue can make progress immediately.
 */
function takePushBatches(
	workspaceId: string,
	cursor: string | null,
	pending: ChangeBatch[],
) {
	const emptyRequest: PushChangesRequest = {
		workspaceId,
		batches: [],
		cursor,
		capabilities: ["card-content-v1"],
	};
	let requestBytes = jsonByteLength(emptyRequest);
	const batches: ChangeBatch[] = [];
	for (const batch of pending) {
		const batchBytes = jsonByteLength(batch) + (batches.length ? 1 : 0);
		if (requestBytes + batchBytes > MAX_SYNC_JSON_BODY_BYTES) {
			if (batches.length === 0) {
				throw new Error(
					`Pending sync batch ${batch.changeId} exceeds the ${MAX_SYNC_JSON_BODY_BYTES}-byte gateway limit`,
				);
			}
			break;
		}
		batches.push(batch);
		requestBytes += batchBytes;
	}
	return batches;
}

export class HttpSyncError extends Error {
	constructor(
		readonly status: number,
		message: string,
		readonly redirectWorkspaceId?: string,
	) {
		super(message);
		this.name = "HttpSyncError";
	}
}

export type HttpSyncTransportOptions = {
	/** Absolute origin of the sync server. Same-origin clients omit it. */
	baseURL?: string;
	/**
	 * Extra headers resolved per request. Clients without a cookie jar (the
	 * desktop shell) return an `authorization` header here.
	 */
	getAuthHeaders?: () =>
		| Promise<HeadersInit | undefined>
		| HeadersInit
		| undefined;
	/**
	 * Cookie mode. Same-origin clients keep the default `include` to send the
	 * session cookie. Cross-origin bearer clients must pass `omit`: the server
	 * does not send `Access-Control-Allow-Credentials`, so a credentialed
	 * request would have its response blocked by the browser before any code
	 * sees it, which surfaces only as an opaque network failure.
	 */
	credentials?: RequestCredentials;
};

export class HttpSyncTransport implements SyncTransport {
	readonly #baseURL: string;
	readonly #getAuthHeaders: HttpSyncTransportOptions["getAuthHeaders"];
	readonly #credentials: RequestCredentials;

	constructor(options: string | HttpSyncTransportOptions = "") {
		const resolved =
			typeof options === "string" ? { baseURL: options } : options;
		this.#baseURL = resolved.baseURL ?? "";
		this.#getAuthHeaders = resolved.getAuthHeaders;
		this.#credentials = resolved.credentials ?? "include";
	}

	async #headers(extra?: HeadersInit): Promise<Record<string, string>> {
		const auth = (await this.#getAuthHeaders?.()) ?? {};
		return {
			...syncVersionHeaders(),
			...Object.fromEntries(new Headers(auth).entries()),
			...Object.fromEntries(new Headers(extra).entries()),
		};
	}

	private async request<T>(
		path: string,
		init: RequestInit,
		signal?: AbortSignal,
	): Promise<T> {
		const response = await fetch(`${this.#baseURL}${path}`, {
			credentials: this.#credentials,
			...init,
			headers: await this.#headers(init.headers),
			signal,
		});
		if (!response.ok) {
			const body = await response.text().catch(() => "");
			let message = body;
			let redirectWorkspaceId: string | undefined;
			try {
				const parsed = JSON.parse(body) as {
					error?: unknown;
					redirectWorkspaceId?: unknown;
				};
				if (typeof parsed.error === "string") message = parsed.error;
				if (typeof parsed.redirectWorkspaceId === "string")
					redirectWorkspaceId = parsed.redirectWorkspaceId;
			} catch {
				// Keep a non-JSON upstream error as-is.
			}
			throw new HttpSyncError(
				response.status,
				message || `Sync request failed (${response.status})`,
				redirectWorkspaceId,
			);
		}
		if (response.status === 204) return null as T;
		return response.json() as Promise<T>;
	}
	private async post<T>(
		path: string,
		body: unknown,
		signal?: AbortSignal,
	): Promise<T> {
		return this.request<T>(
			path,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			},
			signal,
		);
	}
	push(request: PushChangesRequest, signal?: AbortSignal) {
		return this.post<PushChangesResponse>("/api/sync/v1/push", request, signal);
	}
	pull(request: PullChangesRequest, signal?: AbortSignal) {
		return this.post<PullChangesResponse>("/api/sync/v1/pull", request, signal);
	}
	listWorkspaces(signal?: AbortSignal) {
		return this.request<ListWorkspacesResponse>(
			"/api/sync/v1/workspaces",
			{ method: "GET" },
			signal,
		);
	}
	claimWorkspace(request: ClaimWorkspaceRequest, signal?: AbortSignal) {
		return this.post<ClaimWorkspaceResponse>(
			"/api/sync/v1/workspaces/claim",
			request,
			signal,
		);
	}
	selectWorkspace(workspaceId: string, signal?: AbortSignal) {
		return this.post<WorkspaceMembership>(
			"/api/sync/v1/workspaces/select",
			{ workspaceId },
			signal,
		);
	}
	async uploadBlob(
		workspaceId: string,
		descriptor: BlobDescriptor,
		blob: Blob,
		signal?: AbortSignal,
	) {
		await this.request<null>(
			`/api/sync/v1/blobs/${descriptor.hash}`,
			{
				method: "PUT",
				headers: {
					"content-type": descriptor.contentType,
					"x-contextboard-workspace": workspaceId,
					"x-contextboard-blob-size": String(descriptor.size),
				},
				body: blob,
			},
			signal,
		);
	}
	async downloadBlob(
		workspaceId: string,
		descriptor: BlobDescriptor,
		signal?: AbortSignal,
	) {
		const response = await fetch(
			`${this.#baseURL}/api/sync/v1/blobs/${descriptor.hash}`,
			{
				credentials: this.#credentials,
				headers: await this.#headers({
					"x-contextboard-workspace": workspaceId,
				}),
				signal,
			},
		);
		if (!response.ok) {
			const body = await response.text().catch(() => "");
			let message = body;
			let redirectWorkspaceId: string | undefined;
			try {
				const parsed = JSON.parse(body) as {
					error?: unknown;
					redirectWorkspaceId?: unknown;
				};
				if (typeof parsed.error === "string") message = parsed.error;
				if (typeof parsed.redirectWorkspaceId === "string")
					redirectWorkspaceId = parsed.redirectWorkspaceId;
			} catch {
				// Keep a non-JSON upstream error as-is.
			}
			throw new HttpSyncError(
				response.status,
				message || `Sync request failed (${response.status})`,
				redirectWorkspaceId,
			);
		}
		return response.blob();
	}
	getLatestCheckpoint(workspaceId: string, signal?: AbortSignal) {
		return this.request<CheckpointDescriptor | null>(
			`/api/sync/v1/checkpoints/latest?workspaceId=${encodeURIComponent(workspaceId)}`,
			{ method: "GET" },
			signal,
		);
	}
	registerCheckpoint(checkpoint: CheckpointDescriptor, signal?: AbortSignal) {
		return this.post<null>("/api/sync/v1/checkpoints", checkpoint, signal);
	}
}

export class SyncCoordinator {
	#cursor: string | null = null;
	#initialized = false;
	#running: Promise<void> | null = null;
	#controller: AbortController | null = null;
	#stopped = false;
	#failures = 0;
	#status: SyncStatus = { state: "idle", cursor: null };
	#listeners = new Set<(status: SyncStatus) => void>();

	constructor(
		private readonly workspaceId: string,
		private readonly repository: WorkspaceRepository,
		private readonly transport: SyncTransport,
		private readonly peerId = "contextboard-cloud",
	) {}

	get status() {
		return this.#status;
	}
	subscribe(listener: (status: SyncStatus) => void) {
		this.#listeners.add(listener);
		listener(this.#status);
		return () => this.#listeners.delete(listener);
	}
	#set(status: SyncStatus) {
		this.#status = status;
		for (const listener of this.#listeners) listener(status);
	}
	syncNow() {
		if (this.#stopped) return Promise.resolve();
		this.#running ??= this.#run().finally(() => {
			this.#running = null;
			this.#controller = null;
		});
		return this.#running;
	}
	stop() {
		this.#stopped = true;
		this.#controller?.abort();
		this.#set({ state: "local-only", cursor: this.#cursor });
	}
	async #run() {
		const controller = new AbortController();
		this.#controller = controller;
		try {
			await this.#sync(controller.signal);
		} catch (error) {
			if (controller.signal.aborted) return;
			throw error;
		}
	}
	async #sync(signal: AbortSignal) {
		if (!this.#initialized) {
			const persisted = await this.repository.getSyncState(this.peerId);
			signal.throwIfAborted();
			this.#cursor = persisted.cursor;
			this.#initialized = true;
		}
		this.#set({ state: "syncing", cursor: this.#cursor });
		try {
			let pending = await this.repository.getPendingBatches(100);
			while (pending.length) {
				const batches = takePushBatches(
					this.workspaceId,
					this.#cursor,
					pending,
				);
				const pushed = await this.transport.push(
					{
						workspaceId: this.workspaceId,
						batches,
						cursor: this.#cursor,
						capabilities: ["card-content-v1"],
					},
					signal,
				);
				if (this.transport.uploadBlob && this.repository.getLocalBlob) {
					for (const hash of pushed.missingBlobHashes) {
						signal.throwIfAborted();
						const local = await this.repository.getLocalBlob(hash);
						if (local)
							await this.transport.uploadBlob(
								this.workspaceId,
								local.descriptor,
								local.blob,
								signal,
							);
					}
				}
				signal.throwIfAborted();
				await this.repository.acknowledge(pushed.acknowledgedChangeIds);
				pending = pending.slice(batches.length);
			}
			let hasMore = true;
			while (hasMore) {
				const pulled = await this.transport.pull(
					{
						workspaceId: this.workspaceId,
						cursor: this.#cursor,
						limit: 500,
						capabilities: ["card-content-v1"],
					},
					signal,
				);
				signal.throwIfAborted();
				if (pulled.batches.length > 0) {
					await this.repository.applyRemote(
						pulled.batches,
						this.peerId,
						pulled.cursor,
					);
				} else if (pulled.cursor !== this.#cursor) {
					await this.repository.updateSyncCursor(this.peerId, pulled.cursor);
				}
				await this.#downloadMissingBlobs(pulled.batches, signal);
				this.#cursor = pulled.cursor;
				hasMore = pulled.hasMore;
			}
			this.#failures = 0;
			this.#set({ state: "idle", cursor: this.#cursor });
		} catch (error) {
			if (signal.aborted) throw error;
			this.#failures++;
			this.#set({
				state: "error",
				cursor: this.#cursor,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}
	async #downloadMissingBlobs(batches: ChangeBatch[], signal: AbortSignal) {
		if (
			!this.transport.downloadBlob ||
			!this.repository.getLocalBlob ||
			!this.repository.storeRemoteBlob
		)
			return;
		const descriptors = new Map<string, BlobDescriptor>();
		for (const batch of batches) {
			for (const change of batch.changes) {
				if (
					change.entityType !== "file" ||
					!change.value ||
					typeof change.value !== "object"
				)
					continue;
				const value = change.value as Record<string, unknown>;
				const hash = value.hash;
				const size = value.size;
				if (
					typeof hash === "string" &&
					typeof size === "number" &&
					Number.isSafeInteger(size)
				)
					descriptors.set(hash, {
						hash,
						size,
						contentType:
							typeof value.contentType === "string"
								? value.contentType
								: "application/octet-stream",
					});
			}
		}
		if (this.repository.getMissingBlobs) {
			for (const descriptor of await this.repository.getMissingBlobs())
				descriptors.set(descriptor.hash, descriptor);
		}
		for (const descriptor of descriptors.values()) {
			signal.throwIfAborted();
			if (await this.repository.getLocalBlob(descriptor.hash)) continue;
			const blob = await this.transport.downloadBlob(
				this.workspaceId,
				descriptor,
				signal,
			);
			if (blob.size !== descriptor.size)
				throw new Error(
					`Downloaded blob ${descriptor.hash} has an invalid size`,
				);
			const digest = await crypto.subtle.digest(
				"SHA-256",
				await blob.arrayBuffer(),
			);
			const hash = [...new Uint8Array(digest)]
				.map((byte) => byte.toString(16).padStart(2, "0"))
				.join("");
			if (hash !== descriptor.hash)
				throw new Error(
					`Downloaded blob ${descriptor.hash} failed verification`,
				);
			await this.repository.storeRemoteBlob(descriptor, blob);
		}
	}
	retryDelay() {
		return Math.min(60_000, 1_000 * 2 ** Math.min(this.#failures, 6));
	}
}
