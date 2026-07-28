import type { HttpSyncTransport } from "@contextboard/client-core";
import {
	type ContextboardDatabase,
	checkpointThresholdReached,
	exportCheckpointEntities,
	importCheckpointEntities,
	markCheckpointCreated,
} from "@contextboard/local-db";
import type {
	BlobDescriptor,
	CheckpointDescriptor,
	WorkspaceCheckpoint,
} from "@contextboard/sync-protocol";
import { gunzipSync, gzipSync, strFromU8, strToU8 } from "fflate";

async function sha256(blob: Blob) {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		await blob.arrayBuffer(),
	);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

async function verifiedDownload(
	transport: HttpSyncTransport,
	workspaceId: string,
	descriptor: BlobDescriptor,
) {
	const blob = await transport.downloadBlob(workspaceId, descriptor);
	if (blob.size !== descriptor.size || (await sha256(blob)) !== descriptor.hash)
		throw new Error("Checkpoint blob failed SHA-256 verification");
	return blob;
}

export async function bootstrapLatestCheckpoint(
	db: ContextboardDatabase,
	transport: HttpSyncTransport,
	workspaceId: string,
) {
	const descriptor = await transport.getLatestCheckpoint(workspaceId);
	if (!descriptor) return false;
	try {
		const blob = await verifiedDownload(
			transport,
			workspaceId,
			descriptor.blob,
		);
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
			db,
			workspaceId,
			payload.entities,
			payload.coveredCursor,
		);
		return true;
	} catch {
		// A checkpoint is only an optimization. Corruption, interruption, or an
		// IndexedDB transaction failure must leave the cursor untouched so the
		// coordinator can fall back to the append-only change log.
		return false;
	}
}

export async function maybeCreateCheckpoint(
	db: ContextboardDatabase,
	transport: HttpSyncTransport,
	workspaceId: string,
	cursor: string | null,
) {
	if (!cursor || !(await checkpointThresholdReached(db))) return null;
	const payload: WorkspaceCheckpoint = {
		workspaceId,
		coveredCursor: cursor,
		createdAt: Date.now(),
		entities: await exportCheckpointEntities(db),
	};
	const compressed = gzipSync(strToU8(JSON.stringify(payload)), { level: 6 });
	const blob = new Blob([compressed], { type: "application/gzip" });
	const descriptor: BlobDescriptor = {
		hash: await sha256(blob),
		contentType: blob.type,
		size: blob.size,
	};
	await transport.uploadBlob(workspaceId, descriptor, blob);
	const checkpoint: CheckpointDescriptor = {
		checkpointId: crypto.randomUUID(),
		workspaceId,
		coveredCursor: cursor,
		blob: descriptor,
		createdAt: payload.createdAt,
	};
	await transport.registerCheckpoint(checkpoint);
	await markCheckpointCreated(db, cursor);
	return checkpoint;
}
