import type { TLRecord, TLStoreSnapshot } from "tldraw";
import type { PersistedDrawingSnapshot } from "./whiteboard-canvas-helpers";

type UnknownRecord = {
	id?: unknown;
	typeName?: unknown;
	type?: unknown;
	fromId?: unknown;
	toId?: unknown;
	props?: unknown;
};

export type CanvasReconciliation = {
	upserts: TLRecord[];
	removals: string[];
	deferredBindings: TLRecord[];
	nextAppliedRecordIds: Set<string>;
};

const SUPPORTED_TLDRAW_RECORD_TYPES = new Set([
	"asset",
	"binding",
	"camera",
	"document",
	"instance",
	"instance_page_state",
	"instance_presence",
	"page",
	"pointer",
	"shape",
]);

export class DrawingSnapshotValidationError extends Error {
	readonly recordId: string | null;
	readonly recordType: string | null;

	constructor(
		message: string,
		{
			recordId = null,
			recordType = null,
		}: { recordId?: string | null; recordType?: string | null } = {},
	) {
		super(message);
		this.name = "DrawingSnapshotValidationError";
		this.recordId = recordId;
		this.recordType = recordType;
	}
}

export function resolveHydrationSnapshot({
	persistedSnapshot,
	currentEmptySnapshot,
}: {
	persistedSnapshot: PersistedDrawingSnapshot | TLStoreSnapshot;
	currentEmptySnapshot: TLStoreSnapshot;
}): TLStoreSnapshot {
	if (
		!persistedSnapshot ||
		typeof persistedSnapshot !== "object" ||
		!("store" in persistedSnapshot) ||
		!persistedSnapshot.store ||
		typeof persistedSnapshot.store !== "object" ||
		Array.isArray(persistedSnapshot.store)
	) {
		throw new DrawingSnapshotValidationError(
			"Drawing snapshot is missing a valid store.",
		);
	}

	const store = persistedSnapshot.store as unknown as Record<string, unknown>;
	for (const [storeId, value] of Object.entries(store)) {
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			throw new DrawingSnapshotValidationError(
				`Drawing record "${storeId}" is not an object.`,
				{ recordId: storeId },
			);
		}
		const record = value as { id?: unknown; typeName?: unknown };
		const recordId = typeof record.id === "string" ? record.id : null;
		const recordType =
			typeof record.typeName === "string" ? record.typeName : null;
		if (!recordId || recordId !== storeId) {
			throw new DrawingSnapshotValidationError(
				`Drawing record "${storeId}" has an invalid id.`,
				{ recordId, recordType },
			);
		}
		if (
			!recordType ||
			!SUPPORTED_TLDRAW_RECORD_TYPES.has(recordType)
		) {
			throw new DrawingSnapshotValidationError(
				`Drawing record "${storeId}" has an unsupported type.`,
				{ recordId, recordType },
			);
		}
	}

	return {
		schema: persistedSnapshot.schema ?? currentEmptySnapshot.schema,
		store: store as TLStoreSnapshot["store"],
	};
}

export function planCanvasReconciliation({
	persistedStore,
	editorStore,
	previouslyAppliedRecordIds,
	previouslyAppliedRecordVersions,
	persistedRecordVersions,
	availableShapeIds,
}: {
	persistedStore: Record<string, unknown>;
	editorStore: Record<string, unknown>;
	previouslyAppliedRecordIds: ReadonlySet<string>;
	previouslyAppliedRecordVersions?: Readonly<Record<string, number>>;
	persistedRecordVersions?: Readonly<Record<string, number>>;
	availableShapeIds: ReadonlySet<string>;
}): CanvasReconciliation {
	const nextRecords = new Map<string, TLRecord>();
	for (const id of Object.keys(persistedStore).sort()) {
		const record = persistedStore[id];
		if (
			!isRecordObject(record) ||
			typeof record.id !== "string" ||
			isManagedWhiteboardShapeRecord(record)
		)
			continue;
		nextRecords.set(id, record as TLRecord);
	}

	const nextAppliedRecordIds = new Set(nextRecords.keys());
	const removals = [...previouslyAppliedRecordIds]
		.filter((id) => !nextAppliedRecordIds.has(id))
		.sort((a, b) => {
			const aBinding = isBindingRecord(editorStore[a]);
			const bBinding = isBindingRecord(editorStore[b]);
			return Number(bBinding) - Number(aBinding) || a.localeCompare(b);
		});
	const deferredBindings: TLRecord[] = [];
	const upserts: TLRecord[] = [];
	const nextAvailableShapeIds = new Set(availableShapeIds);

	for (const record of nextRecords.values()) {
		if (record.typeName === "shape") nextAvailableShapeIds.add(record.id);
	}
	for (const record of nextRecords.values()) {
		if (
			isBindingRecord(record) &&
			(!nextAvailableShapeIds.has(record.fromId) ||
				!nextAvailableShapeIds.has(record.toId))
		) {
			deferredBindings.push(record);
			continue;
		}
		const previousVersion = previouslyAppliedRecordVersions?.[record.id];
		const persistedVersion = persistedRecordVersions?.[record.id];
		if (
			previousVersion !== undefined &&
			persistedVersion !== undefined &&
			previousVersion === persistedVersion
		)
			continue;
		if (!recordsEqual(editorStore[record.id], record)) upserts.push(record);
	}
	upserts.sort(
		(a, b) =>
			recordApplyRank(a) - recordApplyRank(b) || a.id.localeCompare(b.id),
	);

	return {
		upserts,
		removals,
		deferredBindings,
		nextAppliedRecordIds,
	};
}

function recordsEqual(left: unknown, right: unknown) {
	return JSON.stringify(left) === JSON.stringify(right);
}

function isBindingRecord(
	record: unknown,
): record is TLRecord & { fromId: string; toId: string } {
	return (
		isRecordObject(record) &&
		record.typeName === "binding" &&
		typeof record.fromId === "string" &&
		typeof record.toId === "string"
	);
}

function recordApplyRank(record: TLRecord) {
	if (record.typeName === "asset") return 0;
	if (record.typeName === "shape") return 1;
	if (record.typeName === "binding") return 2;
	return 0;
}

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
	const store = snapshot.store as unknown as Record<string, unknown>;
	const storeWithoutManagedShapes: Record<string, unknown> = {};

	for (const [id, record] of Object.entries(store)) {
		if (isManagedWhiteboardShapeRecord(record)) {
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
		if (isUnreferencedAsset(record, referencedAssetIds)) continue;

		filteredStore[id] = record;
	}

	return {
		...snapshot,
		store: filteredStore as TLStoreSnapshot["store"],
	};
}

/**
 * Splits a snapshot into one that is safe to feed to `editor.loadSnapshot`
 * plus the binding records that reference shapes not present in the snapshot.
 *
 * Managed card shapes are excluded from the persisted snapshot (their source of
 * truth is Convex `boardItems`), so a binding linking an arrow to a card points
 * at a shape that does not exist at load time. `loadSnapshot` would prune such
 * orphaned bindings, severing the connection. We instead defer those bindings so
 * the caller can re-apply them once the cards have been hydrated. Bindings whose
 * endpoint never reappears (e.g. the card was deleted) are simply never
 * re-applied, which self-heals on the next save.
 */
export function splitDeferredBindings(snapshot: TLStoreSnapshot): {
	snapshot: TLStoreSnapshot;
	deferredBindings: unknown[];
} {
	const store = snapshot.store as unknown as Record<string, unknown>;
	const presentShapeIds = new Set<string>();
	for (const [id, record] of Object.entries(store)) {
		if (isRecordObject(record) && record.typeName === "shape") {
			presentShapeIds.add(id);
		}
	}

	const loadableStore: Record<string, unknown> = {};
	const deferredBindings: unknown[] = [];
	for (const [id, record] of Object.entries(store)) {
		if (isBindingWithAbsentEndpoint(record, presentShapeIds)) {
			deferredBindings.push(record);
			continue;
		}

		loadableStore[id] = record;
	}

	return {
		snapshot: {
			...snapshot,
			store: loadableStore as TLStoreSnapshot["store"],
		},
		deferredBindings,
	};
}

function isBindingWithAbsentEndpoint(
	record: unknown,
	presentShapeIds: Set<string>,
) {
	return (
		isRecordObject(record) &&
		record.typeName === "binding" &&
		((typeof record.fromId === "string" &&
			!presentShapeIds.has(record.fromId)) ||
			(typeof record.toId === "string" && !presentShapeIds.has(record.toId)))
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
