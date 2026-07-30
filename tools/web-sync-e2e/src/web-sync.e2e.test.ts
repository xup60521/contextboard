import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { HttpSyncTransport, SyncCoordinator } from "@contextboard/client-core";
import {
	createRepositoryCanvasService,
	createRepositoryCardsService,
	createRepositoryWhiteboardsService,
	fileSrc,
} from "@contextboard/application";
import {
	adoptWorkspaceId,
	ContextboardDatabase,
	ensureLocalIdentity,
	getLocalBlob,
	getPendingBatches,
} from "@contextboard/local-db";
import { IndexedDbWorkspaceRepository } from "@contextboard/storage-indexeddb";
import { conflictCopyCardId } from "@contextboard/sync-protocol";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSyncApp } from "../../../apps/sync-server/src/app";
import { SyncStore } from "../../../apps/sync-server/src/store";
import { localMutation } from "../../../apps/web/src/integrations/local/operations";
import {
	bootstrapLatestCheckpoint,
	maybeCreateCheckpoint,
} from "../../../apps/web/src/integrations/sync/checkpoint";

const databases: ContextboardDatabase[] = [];
const originalFetch = globalThis.fetch;
let temporaryRoot = "";
let store: SyncStore;
let app: ReturnType<typeof createSyncApp>;
let serverOnline = true;

function makeDatabase(label: string) {
	const db = new ContextboardDatabase(
		`contextboard-web-sync-e2e-${label}-${crypto.randomUUID()}`,
	);
	databases.push(db);
	return db;
}

function repository(db: ContextboardDatabase) {
	return new IndexedDbWorkspaceRepository(db);
}

async function sha256(blob: Blob) {
	const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

function transport() {
	return new HttpSyncTransport("http://sync.test");
}

function restartServer() {
	store.close();
	store = new SyncStore(
		join(temporaryRoot, "sync.sqlite"),
		join(temporaryRoot, "blobs"),
	);
	app = createSyncApp(store);
}

beforeAll(() => {
	temporaryRoot = mkdtempSync(join(tmpdir(), "contextboard-web-sync-e2e-"));
	store = new SyncStore(
		join(temporaryRoot, "sync.sqlite"),
		join(temporaryRoot, "blobs"),
	);
	app = createSyncApp(store);
	globalThis.fetch = (async (
		input: string | URL | Request,
		init?: RequestInit,
	) => {
		const request =
			input instanceof Request ? input : new Request(String(input), init);
		if (new URL(request.url).hostname !== "sync.test")
			return originalFetch(request);
		if (!serverOnline) throw new TypeError("Simulated offline sync server");
		return app.fetch(request);
	}) as typeof fetch;
});

afterAll(async () => {
	globalThis.fetch = originalFetch;
	await Promise.all(databases.splice(0).map((db) => db.delete()));
	store.close();
	for (let attempt = 0; attempt < 10; attempt++) {
		try {
			rmSync(temporaryRoot, { recursive: true, force: true });
			break;
		} catch (error) {
			if (
				!(error instanceof Error) ||
				!("code" in error) ||
				error.code !== "EBUSY" ||
				attempt === 9
			)
				throw error;
			Bun.gc(true);
			await Bun.sleep(25 * (attempt + 1));
		}
	}
});

describe("Web to Web vertical sync", () => {
	test(
		"converges offline entities, records, conflicts, blobs, checkpoints, and restart recovery",
		async () => {
			const browserA = makeDatabase("a");
			const identityA = await ensureLocalIdentity(browserA);
			const repositoryA = repository(browserA);
			const whiteboardsA = createRepositoryWhiteboardsService(repositoryA, {
				deviceId: identityA.deviceId,
			});
			const canvasA = createRepositoryCanvasService(repositoryA, {
				deviceId: identityA.deviceId,
			});
			const cardsA = createRepositoryCardsService(repositoryA, {
				deviceId: identityA.deviceId,
			});
			const syncA = new SyncCoordinator(
				identityA.workspaceId,
				repositoryA,
				transport(),
			);

			const board = await whiteboardsA.createSubwhiteboard({
					parentWhiteboardId: null,
					shapeId: "shape:board",
					x: 0,
					y: 0,
				});
			const linkedCard = await canvasA.createCardItem({
					whiteboardId: board.childWhiteboardId,
				shapeId: "shape:linked",
				x: 40,
				y: 40,
				content: {
					type: "doc",
					content: [{ type: "paragraph", content: [{ type: "text", text: "Source" }] }],
				},
				});
			const mainCard = await canvasA.createCardItem({
				whiteboardId: board.childWhiteboardId,
				shapeId: "shape:main",
				x: 120,
				y: 160,
				});
			const image = new Blob(["verified-image"], { type: "image/png" });
			const uploaded = { fileId: await sha256(image) };
			await repositoryA.execute({
				type: "files.upsert",
				input: {
					writes: [{
						entity: "file",
						operation: "upsert",
						id: uploaded.fileId,
						expectedRevision: 0,
						value: {
							id: uploaded.fileId,
							sha256: uploaded.fileId,
							hash: uploaded.fileId,
							contentType: image.type,
							size: image.size,
							refCount: 0,
							status: "active",
							pendingDeleteAt: null,
							deletedAt: null,
						},
					}],
				},
			});
			await repositoryA.storeRemoteBlob(
				{ hash: uploaded.fileId, contentType: image.type, size: image.size },
				image,
			);
		const initialContent = {
			type: "doc",
			content: [
				{
					type: "heading",
					attrs: { level: 1 },
					content: [{ type: "text", text: "Offline research" }],
				},
				{
					type: "paragraph",
					content: [
						{
							type: "mention",
							attrs: { cardId: linkedCard.cardId, label: "Source" },
						},
						{
							type: "image",
							attrs: {
								fileId: uploaded.fileId,
								src: fileSrc(uploaded.fileId),
								alt: "verified",
							},
						},
					],
				},
			],
		};
			await cardsA.updateContent({
					cardId: mainCard.cardId,
					expectedVersion: 1,
					content: initialContent,
				});
			await canvasA.applyRecordChanges({
				whiteboardId: board.childWhiteboardId,
				added: [
					{
						id: "shape:arrow",
						typeName: "shape",
						type: "arrow",
						x: 180,
						y: 200,
						props: { start: mainCard.cardId, end: linkedCard.cardId },
					},
				],
				updated: [],
				removed: [],
				});

		expect(await browserA.changeLog.count()).toBeGreaterThan(0);
		expect(await browserA.cardReferences.count()).toBe(1);
		expect(await browserA.fileReferences.count()).toBe(1);
		await syncA.syncNow();
		expect(await browserA.changeLog.count()).toBe(0);
		expect(syncA.status.state).toBe("idle");

		await browserA.settings.put({
			key: "checkpointChangeCount",
			value: 1_000,
		});
		const checkpoint = await maybeCreateCheckpoint(
			browserA,
			transport(),
			identityA.workspaceId,
			syncA.status.cursor,
		);
		expect(checkpoint).not.toBeNull();

			const browserB = makeDatabase("b");
			const identityB = await ensureLocalIdentity(browserB);
		await adoptWorkspaceId(browserB, identityA.workspaceId);
		expect(
			await bootstrapLatestCheckpoint(
				browserB,
				transport(),
				identityA.workspaceId,
			),
		).toBe(true);
			const repositoryB = repository(browserB);
			const canvasB = createRepositoryCanvasService(repositoryB, {
				deviceId: identityB.deviceId,
			});
			const cardsB = createRepositoryCardsService(repositoryB, {
				deviceId: identityB.deviceId,
			});
			const syncB = new SyncCoordinator(
				identityA.workspaceId,
				repositoryB,
			transport(),
		);
		await syncB.syncNow();

		expect((await browserB.cards.get(mainCard.cardId))?.content).toEqual(
			initialContent,
		);
		expect(await browserB.cardReferences.count()).toBe(1);
		expect(await browserB.fileReferences.count()).toBe(1);
		expect(
			await browserB.canvasRecords
				.filter((record) => record.recordId === "shape:arrow")
				.count(),
		).toBe(1);
		const remoteImage = await getLocalBlob(
			browserB,
			checkpoint?.blob.hash ?? "",
		);
		expect(remoteImage).toBeNull();
		const contentImage = await browserB.files.get(uploaded.fileId);
		expect(contentImage?.blob).not.toBeNull();
		expect(await contentImage?.blob?.text()).toBe("verified-image");

			await canvasB.updateItemFrame({
				itemId: mainCard.itemId,
				x: 420,
				y: 360,
				w: 576,
				h: 220,
				rotation: 0,
				zIndex: 10,
				});
		await syncB.syncNow();
		await syncA.syncNow();
		expect(await browserA.boardItems.get(mainCard.itemId)).toMatchObject({
			x: 420,
			y: 360,
		});

		const versionA = (await browserA.cards.get(mainCard.cardId))?.contentVersion;
		const versionB = (await browserB.cards.get(mainCard.cardId))?.contentVersion;
			await cardsA.updateContent({
				cardId: mainCard.cardId,
				expectedVersion: versionA,
				content: {
					type: "doc",
					content: [{ type: "paragraph", content: [{ type: "text", text: "Edit A" }] }],
				},
				});
			await cardsB.updateContent({
				cardId: mainCard.cardId,
				expectedVersion: versionB,
				content: {
					type: "doc",
					content: [{ type: "paragraph", content: [{ type: "text", text: "Edit B" }] }],
				},
				});
		await syncA.syncNow();
		await syncB.syncNow();
		await syncA.syncNow();

		const conflictA = await browserA.conflicts.toCollection().first();
		const conflictB = await browserB.conflicts.toCollection().first();
		expect(conflictA?.conflictId).toBe(conflictB?.conflictId);
		expect(conflictA?.resolvedAt).toBeNull();
		expect(
			await browserA.cards.get(conflictCopyCardId(conflictA?.conflictId ?? "")),
		).toBeDefined();

		await localMutation(
			browserA,
			identityA.deviceId,
			"conflicts.resolve",
			{ conflictId: conflictA?.conflictId, resolution: "keep-both" },
		);
		const pendingResolution = await getPendingBatches(browserA, 10);
		const resolutionBatch = pendingResolution.find(
			(batch) => batch.command === "conflicts.resolve",
		);
		expect(
			resolutionBatch?.changes.some(
				(change) =>
					change.entityType === "card" &&
					change.entityId === mainCard.cardId,
			),
		).toBe(true);
		await syncA.syncNow();
		await syncB.syncNow();
		expect(
			(await browserB.conflicts.get(conflictA?.conflictId ?? ""))?.resolution,
		).toBe("keep-both");
		expect(await browserB.cards.get(mainCard.cardId)).toEqual(
			await browserA.cards.get(mainCard.cardId),
		);
		expect(
			await browserB.cards.get(conflictCopyCardId(conflictA?.conflictId ?? "")),
		).toEqual(
			await browserA.cards.get(conflictCopyCardId(conflictA?.conflictId ?? "")),
		);

		restartServer();
		await syncA.syncNow();
		await syncB.syncNow();
		expect(syncA.status.cursor).toBe(syncB.status.cursor);

		serverOnline = false;
			await whiteboardsA.rename({
				whiteboardId: board.childWhiteboardId,
				title: "Offline title",
			});
		await expect(syncA.syncNow()).rejects.toThrow();
		expect(await browserA.changeLog.count()).toBe(1);
		serverOnline = true;
		await syncA.syncNow();
		await syncB.syncNow();
		expect(
			(await browserB.whiteboards.get(board.childWhiteboardId))?.title,
		).toBe("Offline title");
		expect(await browserA.changeLog.count()).toBe(0);

		const payloads = store.db
			.query("SELECT payload FROM change_batches ORDER BY cursor")
			.all() as Array<{ payload: string }>;
		expect(payloads.some(({ payload }) => payload.includes('"snapshot"'))).toBe(
			false,
		);
		expect(
			payloads.some(({ payload }) => payload.includes("TLStoreSnapshot")),
		).toBe(false);
		},
		30_000,
	);
});
