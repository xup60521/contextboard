import type { TLShapeId, TLStoreSnapshot } from "tldraw";

type UnknownRecord = {
	id?: unknown;
	typeName?: unknown;
	type?: unknown;
	fromId?: unknown;
	toId?: unknown;
	props?: unknown;
};

export function isManagedWhiteboardShapeRecord(record: unknown): boolean {
	return (
		isRecordObject(record) &&
		record.typeName === "shape" &&
		(record.type === "markdown-card" || record.type === "subwhiteboard-link")
	);
}

export function filterSnapshotForPersistence(
	snapshot: TLStoreSnapshot,
): TLStoreSnapshot {
	const removedShapeIds = new Set<TLShapeId>();
	const store = snapshot.store as unknown as Record<string, unknown>;
	const storeWithoutManagedShapes: Record<string, unknown> = {};

	for (const [id, record] of Object.entries(store)) {
		if (isManagedWhiteboardShapeRecord(record)) {
			removedShapeIds.add(id as TLShapeId);
			continue;
		}

		storeWithoutManagedShapes[id] = record;
	}

	const referencedAssetIds = new Set<string>();
	for (const record of Object.values(storeWithoutManagedShapes)) {
		if (!isRecordObject(record) || record.typeName !== "shape") continue;

		for (const assetId of collectAssetIds(record.props)) {
			referencedAssetIds.add(assetId);
		}
	}

	const filteredStore: Record<string, unknown> = {};
	for (const [id, record] of Object.entries(storeWithoutManagedShapes)) {
		if (isBindingTouchingRemovedShape(record, removedShapeIds)) continue;
		if (isUnreferencedAsset(record, referencedAssetIds)) continue;

		filteredStore[id] = record;
	}

	return {
		...snapshot,
		store: filteredStore as TLStoreSnapshot["store"],
	};
}

function isBindingTouchingRemovedShape(
	record: unknown,
	removedShapeIds: Set<TLShapeId>,
) {
	return (
		isRecordObject(record) &&
		record.typeName === "binding" &&
		((typeof record.fromId === "string" &&
			removedShapeIds.has(record.fromId as TLShapeId)) ||
			(typeof record.toId === "string" &&
				removedShapeIds.has(record.toId as TLShapeId)))
	);
}

function isUnreferencedAsset(record: unknown, referencedAssetIds: Set<string>) {
	return (
		isRecordObject(record) &&
		record.typeName === "asset" &&
		typeof record.id === "string" &&
		!referencedAssetIds.has(record.id)
	);
}

function collectAssetIds(value: unknown): string[] {
	const assetIds: string[] = [];
	collectAssetIdsInto(value, assetIds);
	return assetIds;
}

function collectAssetIdsInto(value: unknown, assetIds: string[]) {
	if (!value || typeof value !== "object") return;

	if (Array.isArray(value)) {
		for (const item of value) {
			collectAssetIdsInto(item, assetIds);
		}
		return;
	}

	for (const [key, child] of Object.entries(value)) {
		if (key === "assetId" && typeof child === "string") {
			assetIds.push(child);
			continue;
		}

		collectAssetIdsInto(child, assetIds);
	}
}

function isRecordObject(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null;
}
