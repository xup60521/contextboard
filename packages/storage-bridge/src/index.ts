import type {
	ApplyResult,
	DomainCommand,
	DomainQuery,
	WorkspaceChangeListener,
	WorkspaceRepository,
} from "@contextboard/client-core";
import type {
	BlobDescriptor,
	ChangeBatch,
	PersistedSyncState,
} from "@contextboard/sync-protocol";

export const DEFAULT_BRIDGE_PORT = 8787;
export const BRIDGE_ENDPOINT = "/bridge/v1";

/** Raised when the bridge is unreachable, or answers with an error envelope. */
export class BridgeError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly status?: number,
	) {
		super(message);
		this.name = "BridgeError";
	}
}

export type BridgeStatus = {
	workspaceId: string;
	version: string;
	protocol: number;
};

type BridgeEnvelope<T> =
	| { ok: true; result: T }
	| { ok: false; error: { code: string; message: string } };

export type BridgeClientOptions = {
	port?: number;
	fetch?: typeof globalThis.fetch;
	/** Milliseconds before a request is abandoned. */
	timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Speaks the desktop app's loopback bridge protocol.
 *
 * The bridge is the same allowlisted domain surface the desktop renderer uses,
 * so this client can issue semantic operations but never SQL or file paths.
 */
export class BridgeClient {
	readonly #baseUrl: string;
	readonly #fetch: typeof globalThis.fetch;
	readonly #timeoutMs: number;

	constructor(options: BridgeClientOptions = {}) {
		const port = options.port ?? DEFAULT_BRIDGE_PORT;
		this.#baseUrl = `http://127.0.0.1:${port}${BRIDGE_ENDPOINT}`;
		this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
		this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	}

	async send<T>(body: Record<string, unknown>): Promise<T> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
		let response: Response;
		try {
			response = await this.#fetch(this.#baseUrl, {
				method: "POST",
				// The bridge requires this content type: it is not a CORS-simple
				// value, which is what keeps web pages from reaching localhost.
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
				signal: controller.signal,
			});
		} catch {
			// A closed app and a disabled bridge are indistinguishable from here,
			// and the fix is the same either way, so say both.
			throw new BridgeError(
				"BRIDGE_UNREACHABLE",
				"Cannot reach ContextBoard. Make sure the desktop app is running and the agent bridge is enabled in its settings.",
			);
		} finally {
			clearTimeout(timeout);
		}

		let envelope: BridgeEnvelope<T>;
		try {
			envelope = (await response.json()) as BridgeEnvelope<T>;
		} catch {
			throw new BridgeError(
				"BRIDGE_PROTOCOL",
				`The agent bridge returned a non-JSON response (HTTP ${response.status}).`,
				response.status,
			);
		}
		if (!envelope.ok) {
			throw new BridgeError(
				envelope.error.code,
				envelope.error.message,
				response.status,
			);
		}
		return envelope.result;
	}

	/** The app's active workspace, so an agent never has to be told which one. */
	status(): Promise<BridgeStatus> {
		return this.send<BridgeStatus>({ op: "status" });
	}
}

/**
 * A `WorkspaceRepository` backed by the running desktop app.
 *
 * Reads and writes go to the desktop's own SQLite store, which means the
 * desktop keeps ownership of authentication and synchronization: a write here
 * is pushed to the sync server by the app's existing coordinator. The sync
 * methods of the interface are therefore intentionally unimplemented — a second
 * pusher for the same store would duplicate change batches.
 */
export class BridgeWorkspaceRepository implements WorkspaceRepository {
	#listeners = new Set<WorkspaceChangeListener>();

	constructor(
		private readonly workspaceId: string,
		private readonly client: BridgeClient,
	) {
		if (!workspaceId) throw new Error("workspaceId is required");
	}

	query<T>(query: DomainQuery<T>): Promise<T> {
		return this.client.send<T>({
			op: "query",
			workspaceId: this.workspaceId,
			payload: query,
		});
	}

	async execute<T>(command: DomainCommand<T>): Promise<T> {
		const result = await this.client.send<T>({
			op: "execute",
			workspaceId: this.workspaceId,
			payload: command,
		});
		for (const listener of this.#listeners) listener();
		return result;
	}

	subscribe(listener: WorkspaceChangeListener): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	getPendingBatches(_limit: number): Promise<ChangeBatch[]> {
		return Promise.reject(this.#syncUnsupported());
	}

	acknowledge(_changeIds: string[]): Promise<void> {
		return Promise.reject(this.#syncUnsupported());
	}

	applyRemote(
		_batches: ChangeBatch[],
		_peerId: string,
		_nextCursor: string,
	): Promise<ApplyResult> {
		return Promise.reject(this.#syncUnsupported());
	}

	getSyncState(_peerId: string): Promise<PersistedSyncState> {
		return Promise.reject(this.#syncUnsupported());
	}

	getLocalBlob(_hash: string): Promise<never> {
		return Promise.reject(this.#blobsUnsupported());
	}

	getMissingBlobs(): Promise<BlobDescriptor[]> {
		return Promise.reject(this.#blobsUnsupported());
	}

	storeRemoteBlob(_descriptor: BlobDescriptor, _blob: Blob): Promise<void> {
		return Promise.reject(this.#blobsUnsupported());
	}

	#syncUnsupported() {
		return new BridgeError(
			"SYNC_NOT_SUPPORTED",
			"The desktop app owns synchronization for this workspace; the bridge must not push or pull.",
		);
	}

	#blobsUnsupported() {
		return new BridgeError(
			"BLOBS_NOT_SUPPORTED",
			"The agent bridge does not transfer blobs.",
		);
	}
}

/** Resolves the active workspace from the app, then binds a repository to it. */
export async function connectBridgeRepository(
	options: BridgeClientOptions = {},
): Promise<{
	repository: BridgeWorkspaceRepository;
	client: BridgeClient;
	status: BridgeStatus;
}> {
	const client = new BridgeClient(options);
	const status = await client.status();
	return {
		client,
		status,
		repository: new BridgeWorkspaceRepository(status.workspaceId, client),
	};
}
