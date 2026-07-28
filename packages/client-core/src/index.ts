import { syncVersionHeaders } from "@contextboard/sync-protocol";
import type {
	BlobDescriptor,
	ChangeBatch,
	CheckpointDescriptor,
	ClaimWorkspaceRequest,
	ClaimWorkspaceResponse,
	ListWorkspacesResponse,
	PersistedSyncState,
	PullChangesRequest,
	PullChangesResponse,
	PushChangesRequest,
	PushChangesResponse,
	SyncStatus,
	SyncTransport,
} from "@contextboard/sync-protocol";

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
export type WorkspaceChangeListener = () => void;
export type Unsubscribe = () => void;
export type ApplyResult = { applied: number; conflicts: number };
export type LocalBlob = { descriptor: BlobDescriptor; blob: Blob };

export interface WorkspaceRepository {
	query<T>(query: DomainQuery<T>): Promise<T>;
	execute<T>(command: DomainCommand<T>): Promise<T>;
	subscribe(listener: WorkspaceChangeListener): Unsubscribe;
	getPendingBatches(limit: number): Promise<ChangeBatch[]>;
	acknowledge(changeIds: string[]): Promise<void>;
	applyRemote(
		batches: ChangeBatch[],
		peerId: string,
		nextCursor: string,
	): Promise<ApplyResult>;
	getSyncState(peerId: string): Promise<PersistedSyncState>;
	getLocalBlob?(hash: string): Promise<LocalBlob | null>;
	getMissingBlobs?(): Promise<BlobDescriptor[]>;
	storeRemoteBlob?(descriptor: BlobDescriptor, blob: Blob): Promise<void>;
}

export class HttpSyncError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "HttpSyncError";
	}
}

export class HttpSyncTransport implements SyncTransport {
	constructor(private readonly baseURL = "") {}
	private async request<T>(
		path: string,
		init: RequestInit,
		signal?: AbortSignal,
	): Promise<T> {
		const response = await fetch(`${this.baseURL}${path}`, {
			credentials: "include",
			...init,
			headers: {
				...syncVersionHeaders(),
				...Object.fromEntries(new Headers(init.headers).entries()),
			},
			signal,
		});
		if (!response.ok) {
			const body = await response.text().catch(() => "");
			let message = body;
			try {
				const parsed = JSON.parse(body) as { error?: unknown };
				if (typeof parsed.error === "string") message = parsed.error;
			} catch {
				// Keep a non-JSON upstream error as-is.
			}
			throw new HttpSyncError(
				response.status,
				message || `Sync request failed (${response.status})`,
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
			`${this.baseURL}/api/sync/v1/blobs/${descriptor.hash}`,
			{
				credentials: "include",
				headers: {
					...syncVersionHeaders(),
					"x-contextboard-workspace": workspaceId,
				},
				signal,
			},
		);
		if (!response.ok)
			throw new HttpSyncError(response.status, await response.text());
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
			const pending = await this.repository.getPendingBatches(100);
			if (pending.length) {
				const pushed = await this.transport.push(
					{
						workspaceId: this.workspaceId,
						batches: pending,
						cursor: this.#cursor,
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
			}
			let hasMore = true;
			while (hasMore) {
				const pulled = await this.transport.pull(
					{
						workspaceId: this.workspaceId,
						cursor: this.#cursor,
						limit: 500,
					},
					signal,
				);
				signal.throwIfAborted();
				await this.repository.applyRemote(
					pulled.batches,
					this.peerId,
					pulled.cursor,
				);
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
	async #downloadMissingBlobs(
		batches: ChangeBatch[],
		signal: AbortSignal,
	) {
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
