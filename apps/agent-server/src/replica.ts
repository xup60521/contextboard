import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
	type DomainCommand,
	type DomainQuery,
	HttpSyncTransport,
	type LocalBlob,
	SyncCoordinator,
	type WorkspaceRepository,
} from "@contextboard/client-core";
import {
	adoptWorkspaceId,
	type ContextboardDatabaseLike,
	ensureLocalIdentity,
	hasWorkspaceData,
	importCheckpointEntities,
	rebindWorkspaceId,
} from "@contextboard/local-db";
import { createSqliteContextboardDatabase } from "@contextboard/local-db/sqlite";
import { SqliteWorkspaceRepository } from "@contextboard/storage-indexeddb";
import type {
	BlobDescriptor,
	ChangeBatch,
	WorkspaceCheckpoint,
} from "@contextboard/sync-protocol";
import { gunzipSync, strFromU8 } from "fflate";
import type { AgentCredentials } from "./credentials";
import { loadAgentCredentials } from "./credentials";

export const REPLICA_FILENAME = "replica.sqlite";
export const DEVICE_FILENAME = "device.json";

export function replicaPath(home = homedir()) {
	return join(home, ".contextboard", REPLICA_FILENAME);
}

export function devicePath(home = homedir()) {
	return join(home, ".contextboard", DEVICE_FILENAME);
}

async function readDeviceId(path: string) {
	try {
		const parsed = JSON.parse(await readFile(path, "utf8")) as {
			deviceId?: unknown;
		};
		return typeof parsed.deviceId === "string" && parsed.deviceId.trim()
			? parsed.deviceId.trim()
			: null;
	} catch {
		return null;
	}
}

/** Loads the same device id on every agent-server invocation on the remote box. */
export async function loadOrCreateDeviceId(
	options: { home?: string; path?: string; fallbackDeviceId?: string } = {},
) {
	const path = options.path ?? devicePath(options.home);
	const existing = await readDeviceId(path);
	if (existing) return existing;

	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const deviceId = options.fallbackDeviceId?.trim() || crypto.randomUUID();
	try {
		await writeFile(path, `${JSON.stringify({ deviceId }, null, 2)}\n`, {
			encoding: "utf8",
			mode: 0o600,
			flag: "wx",
		});
	} catch {
		// Another process may have initialized the box between the read and the
		// exclusive create. Reuse its id rather than creating a second device.
		const raced = await readDeviceId(path);
		if (raced) return raced;
		throw new Error(`Unable to initialize stable agent device at ${path}`);
	}
	await chmod(path, 0o600).catch(() => undefined);
	return deviceId;
}

async function sha256(blob: Blob) {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		await blob.arrayBuffer(),
	);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

async function bootstrapLatestCheckpoint(
	database: ContextboardDatabaseLike,
	transport: HttpSyncTransport,
	workspaceId: string,
) {
	const descriptor = await transport.getLatestCheckpoint(workspaceId);
	if (!descriptor) return false;
	try {
		const blob = await transport.downloadBlob(workspaceId, descriptor.blob);
		if (
			blob.size !== descriptor.blob.size ||
			(await sha256(blob)) !== descriptor.blob.hash
		)
			throw new Error("Checkpoint blob failed SHA-256 verification");
		const payload = JSON.parse(
			strFromU8(gunzipSync(new Uint8Array(await blob.arrayBuffer()))),
		) as WorkspaceCheckpoint;
		if (
			payload.workspaceId !== workspaceId ||
			payload.coveredCursor !== descriptor.coveredCursor ||
			!payload.entities ||
			typeof payload.entities !== "object"
		)
			throw new Error("Checkpoint payload does not match its descriptor");
		await importCheckpointEntities(
			database,
			workspaceId,
			payload.entities,
			payload.coveredCursor,
		);
		return true;
	} catch {
		// Checkpoints only reduce the pull cost. A bad or interrupted checkpoint
		// must leave the append-only cursor untouched so normal pull can recover.
		return false;
	}
}

async function selectReplicaWorkspace(
	database: ContextboardDatabaseLike,
	transport: HttpSyncTransport,
	deviceId: string,
	env: Record<string, string | undefined>,
) {
	const currentValue = (await database.settings.get("workspaceId"))?.value;
	const currentWorkspaceId =
		typeof currentValue === "string" ? currentValue : crypto.randomUUID();
	const explicit = env.CONTEXTBOARD_WORKSPACE_ID?.trim() || null;
	const hasData = await hasWorkspaceData(database);
	const listing = await transport.listWorkspaces();
	const redirect = listing.redirects.find(
		(item) => item.fromWorkspaceId === currentWorkspaceId,
	);
	let workspaceId = currentWorkspaceId;

	if (redirect) {
		if (hasData)
			await rebindWorkspaceId(
				database,
				currentWorkspaceId,
				redirect.toWorkspaceId,
			);
		else await adoptWorkspaceId(database, redirect.toWorkspaceId);
		workspaceId = redirect.toWorkspaceId;
	} else if (explicit && explicit !== currentWorkspaceId) {
		if (hasData)
			throw new Error(
				"CONTEXTBOARD_WORKSPACE_ID differs from the non-empty replica; refuse to rebind local data",
			);
		if (!listing.workspaces.some((item) => item.workspaceId === explicit))
			throw new Error("CONTEXTBOARD_WORKSPACE_ID is not an account workspace");
		await adoptWorkspaceId(database, explicit);
		workspaceId = explicit;
	}

	const membership = listing.workspaces.find(
		(item) => item.workspaceId === (explicit ?? workspaceId),
	);
	if (!membership) {
		if (hasData)
			throw new Error(
				"The replica workspace is not linked to this account; set CONTEXTBOARD_WORKSPACE_ID on an empty replica",
			);
		if (explicit)
			throw new Error("CONTEXTBOARD_WORKSPACE_ID is not an account workspace");
		const defaultWorkspace =
			listing.workspaces.find((item) => item.isDefault) ??
			listing.workspaces[0];
		if (defaultWorkspace) {
			await adoptWorkspaceId(database, defaultWorkspace.workspaceId);
			workspaceId = defaultWorkspace.workspaceId;
		}
	}

	// This is idempotent and registers the stable device row on the server.
	await transport.claimWorkspace({ workspaceId, deviceId });
	return workspaceId;
}

/** Adds the replica's flush-on-write guarantee without changing agent tools. */
export class FlushOnWriteWorkspaceRepository implements WorkspaceRepository {
	constructor(
		private readonly inner: WorkspaceRepository,
		private readonly flush: () => Promise<void>,
	) {}

	query<T>(query: DomainQuery<T>) {
		return this.inner.query<T>(query);
	}

	async execute<T>(command: DomainCommand<T>) {
		const result = await this.inner.execute<T>(command);
		await this.flush();
		return result;
	}

	subscribe(listener: () => void) {
		return this.inner.subscribe(listener);
	}

	getPendingBatches(limit: number) {
		return this.inner.getPendingBatches(limit);
	}

	acknowledge(changeIds: string[]) {
		return this.inner.acknowledge(changeIds);
	}

	applyRemote(batches: ChangeBatch[], peerId: string, nextCursor: string) {
		return this.inner.applyRemote(batches, peerId, nextCursor);
	}

	getSyncState(peerId: string) {
		return this.inner.getSyncState(peerId);
	}

	getLocalBlob(hash: string): Promise<LocalBlob | null> {
		if (!this.inner.getLocalBlob) return Promise.resolve(null);
		return this.inner.getLocalBlob(hash);
	}

	getMissingBlobs(): Promise<BlobDescriptor[]> {
		if (!this.inner.getMissingBlobs) return Promise.resolve([]);
		return this.inner.getMissingBlobs();
	}

	storeRemoteBlob(descriptor: BlobDescriptor, blob: Blob) {
		if (!this.inner.storeRemoteBlob) return Promise.resolve();
		return this.inner.storeRemoteBlob(descriptor, blob);
	}
}

export type ReplicaRuntime = {
	database: ReturnType<typeof createSqliteContextboardDatabase>;
	repository: WorkspaceRepository;
	coordinator: SyncCoordinator;
	workspaceId: string;
	deviceId: string;
	flush(): Promise<void>;
	close(): Promise<void>;
};

export async function createReplicaRuntime(
	options: {
		env?: Record<string, string | undefined>;
		home?: string;
		credentials?: AgentCredentials;
		databasePath?: string;
	} = {},
): Promise<ReplicaRuntime> {
	const env = options.env ?? process.env;
	const credentials =
		options.credentials ??
		(await loadAgentCredentials({ env, home: options.home }));
	if (!credentials)
		throw new Error(
			"Replica mode requires CONTEXTBOARD_AGENT_TOKEN or ~/.contextboard/credentials.json",
		);

	const databasePath =
		options.databasePath ??
		env.CONTEXTBOARD_REPLICA_PATH ??
		replicaPath(options.home);
	await mkdir(dirname(databasePath), { recursive: true, mode: 0o700 });
	const database = createSqliteContextboardDatabase(databasePath);
	try {
		const persistedDevice = (await database.settings.get("deviceId"))?.value;
		const hadData = await hasWorkspaceData(database);
		const deviceId = await loadOrCreateDeviceId({
			home: options.home,
			fallbackDeviceId:
				typeof persistedDevice === "string" ? persistedDevice : undefined,
		});
		const localIdentity = await ensureLocalIdentity(database);
		if (localIdentity.deviceId !== deviceId) {
			if (hadData)
				throw new Error(
					"~/.contextboard/device.json does not match the non-empty replica; refuse to change device identity",
				);
			await database.settings.put({ key: "deviceId", value: deviceId });
		}
		const identity = { ...localIdentity, deviceId };
		const transport = new HttpSyncTransport({
			baseURL: credentials.serverUrl,
			credentials: "omit",
			getAuthHeaders: () => ({
				authorization: `Bearer ${credentials.token}`,
			}),
		});
		const workspaceId = await selectReplicaWorkspace(
			database,
			transport,
			identity.deviceId,
			env,
		);

		if (!hadData && !(await hasWorkspaceData(database)))
			await bootstrapLatestCheckpoint(database, transport, workspaceId);

		const baseRepository = new SqliteWorkspaceRepository(database);
		const coordinator = new SyncCoordinator(
			workspaceId,
			baseRepository,
			transport,
		);
		const flush = async () => {
			// SyncCoordinator sends at most 100 pending batches per run. A loop is
			// important after an interrupted box has accumulated a backlog: a write
			// is not considered flushed while an older batch still strands the queue.
			for (;;) {
				await coordinator.syncNow();
				if (!(await baseRepository.getPendingBatches(1)).length) return;
			}
		};
		// The first sync is awaited before the repository is handed to the agent
		// tools. No tool can observe a stale cold-start replica.
		await flush();
		const repository = new FlushOnWriteWorkspaceRepository(
			baseRepository,
			flush,
		);

		return {
			database,
			repository,
			coordinator,
			workspaceId,
			deviceId: identity.deviceId,
			flush,
			close: async () => {
				try {
					await flush();
				} finally {
					coordinator.stop();
					database.close();
				}
			},
		};
	} catch (error) {
		database.close();
		throw error;
	}
}
