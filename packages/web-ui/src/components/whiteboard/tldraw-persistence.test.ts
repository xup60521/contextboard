// @vitest-environment jsdom

import { buildArrowRelationRecords } from "@contextboard/application/canvas";
import type { TLStoreSnapshot } from "tldraw";
import { describe, expect, test } from "vitest";
import {
	DrawingSnapshotValidationError,
	filterSnapshotForPersistence,
	isManagedWhiteboardShapeRecord,
	planCanvasReconciliation,
	resolveHydrationSnapshot,
	splitDeferredBindings,
} from "./tldraw-persistence";

const schema = { schemaVersion: 2, sequences: {} } as TLStoreSnapshot["schema"];

function snapshot(store: Record<string, unknown>): TLStoreSnapshot {
	return { store: store as TLStoreSnapshot["store"], schema };
}

function records(snapshot: TLStoreSnapshot): Record<string, unknown> {
	return snapshot.store as unknown as Record<string, unknown>;
}

describe("resolveHydrationSnapshot", () => {
	test("uses the current editor schema when record persistence has no schema", () => {
		const currentSchema = {
			schemaVersion: 2,
			sequences: { "com.tldraw.shape": 7 },
		} as TLStoreSnapshot["schema"];
		const result = resolveHydrationSnapshot({
			persistedSnapshot: {
				schema: null,
				store: {
					"shape:current": {
						id: "shape:current",
						typeName: "shape",
						type: "geo",
					},
				},
			},
			currentEmptySnapshot: {
				schema: currentSchema,
				store: {},
			} as TLStoreSnapshot,
		});

		expect(result.schema).toBe(currentSchema);
		expect(records(result)).toHaveProperty("shape:current");
	});

	test("preserves a legacy schema when one is available", () => {
		const legacySchema = {
			schemaVersion: 2,
			sequences: { "com.tldraw.shape": 1 },
		} as TLStoreSnapshot["schema"];
		const result = resolveHydrationSnapshot({
			persistedSnapshot: { schema: legacySchema, store: {} },
			currentEmptySnapshot: {
				schema: {
					schemaVersion: 2,
					sequences: { "com.tldraw.shape": 7 },
				},
				store: {},
			} as TLStoreSnapshot,
		});

		expect(result.schema).toBe(legacySchema);
	});

	test.each([
		[
			"mismatched ids",
			{
				"shape:store-key": {
					id: "shape:different",
					typeName: "shape",
				},
			},
		],
		[
			"missing record types",
			{
				"shape:missing-type": {
					id: "shape:missing-type",
				},
			},
		],
	])("rejects %s without mutating persisted data", (_label, store) => {
		expect(() =>
			resolveHydrationSnapshot({
				persistedSnapshot: { schema: null, store },
				currentEmptySnapshot: snapshot({}),
			}),
		).toThrow(DrawingSnapshotValidationError);
	});
});

describe("tldraw persistence", () => {
	test("identifies managed whiteboard shape records", () => {
		expect(
			isManagedWhiteboardShapeRecord({
				id: "shape:card",
				typeName: "shape",
				type: "markdown-card",
			}),
		).toBe(true);
		expect(
			isManagedWhiteboardShapeRecord({
				id: "shape:sub",
				typeName: "shape",
				type: "subwhiteboard-link",
			}),
		).toBe(true);
		expect(
			isManagedWhiteboardShapeRecord({
				id: "shape:draw",
				typeName: "shape",
				type: "draw",
			}),
		).toBe(false);
	});

	test("removes managed shapes and keeps unmanaged drawing shapes", () => {
		const filtered = filterSnapshotForPersistence(
			snapshot({
				"shape:card": {
					id: "shape:card",
					typeName: "shape",
					type: "markdown-card",
					props: {},
				},
				"shape:sub": {
					id: "shape:sub",
					typeName: "shape",
					type: "subwhiteboard-link",
					props: {},
				},
				"shape:draw": {
					id: "shape:draw",
					typeName: "shape",
					type: "draw",
					props: {},
				},
				"shape:text": {
					id: "shape:text",
					typeName: "shape",
					type: "text",
					props: {},
				},
			}),
		);

		const store = records(filtered);
		expect(store["shape:card"]).toBeUndefined();
		expect(store["shape:sub"]).toBeUndefined();
		expect(store["shape:draw"]).toBeDefined();
		expect(store["shape:text"]).toBeDefined();
	});

	test("keeps bindings touching managed shapes so connections persist", () => {
		const filtered = filterSnapshotForPersistence(
			snapshot({
				"shape:card": {
					id: "shape:card",
					typeName: "shape",
					type: "markdown-card",
					props: {},
				},
				"shape:a": {
					id: "shape:a",
					typeName: "shape",
					type: "geo",
					props: {},
				},
				"shape:b": {
					id: "shape:b",
					typeName: "shape",
					type: "geo",
					props: {},
				},
				"binding:toCard": {
					id: "binding:toCard",
					typeName: "binding",
					type: "arrow",
					fromId: "shape:a",
					toId: "shape:card",
					props: {},
				},
				"binding:keep": {
					id: "binding:keep",
					typeName: "binding",
					type: "arrow",
					fromId: "shape:a",
					toId: "shape:b",
					props: {},
				},
			}),
		);

		const store = records(filtered);
		// The managed card shape is still excluded...
		expect(store["shape:card"]).toBeUndefined();
		// ...but the binding to it is preserved (re-attached on load once the
		// card is hydrated), alongside bindings between unmanaged shapes.
		expect(store["binding:toCard"]).toBeDefined();
		expect(store["binding:keep"]).toBeDefined();
	});

	test("defers bindings whose endpoints are absent from the snapshot", () => {
		const { snapshot: loadable, deferredBindings } = splitDeferredBindings(
			snapshot({
				"shape:a": {
					id: "shape:a",
					typeName: "shape",
					type: "geo",
					props: {},
				},
				"shape:b": {
					id: "shape:b",
					typeName: "shape",
					type: "geo",
					props: {},
				},
				// Target card shape is not present (hydrated separately on load).
				"binding:toCard": {
					id: "binding:toCard",
					typeName: "binding",
					type: "arrow",
					fromId: "shape:a",
					toId: "shape:card",
					props: {},
				},
				"binding:present": {
					id: "binding:present",
					typeName: "binding",
					type: "arrow",
					fromId: "shape:a",
					toId: "shape:b",
					props: {},
				},
			}),
		);

		const store = records(loadable);
		// Binding between present shapes stays in the loadable snapshot.
		expect(store["binding:present"]).toBeDefined();
		// Binding to an absent shape is removed from the loadable snapshot...
		expect(store["binding:toCard"]).toBeUndefined();
		// ...and surfaced for re-attachment after hydration.
		expect(deferredBindings).toHaveLength(1);
		expect((deferredBindings[0] as { id: string }).id).toBe("binding:toCard");
	});

	test("drops unreferenced assets and keeps referenced assets", () => {
		const filtered = filterSnapshotForPersistence(
			snapshot({
				"shape:image": {
					id: "shape:image",
					typeName: "shape",
					type: "image",
					props: { assetId: "asset:keep" },
				},
				"asset:keep": {
					id: "asset:keep",
					typeName: "asset",
					type: "image",
					props: {},
				},
				"asset:drop": {
					id: "asset:drop",
					typeName: "asset",
					type: "image",
					props: {},
				},
			}),
		);

		const store = records(filtered);
		expect(store["asset:keep"]).toBeDefined();
		expect(store["asset:drop"]).toBeUndefined();
	});

	test("keeps unrelated document and page records", () => {
		const filtered = filterSnapshotForPersistence(
			snapshot({
				"document:document": {
					id: "document:document",
					typeName: "document",
					name: "",
				},
				"page:page": {
					id: "page:page",
					typeName: "page",
					name: "Page 1",
				},
			}),
		);

		const store = records(filtered);
		expect(store["document:document"]).toBeDefined();
		expect(store["page:page"]).toBeDefined();
	});

	test("plans native record additions, updates, and prior-record removals", () => {
		const result = planCanvasReconciliation({
			persistedStore: {
				"shape:new": {
					id: "shape:new",
					typeName: "shape",
					type: "arrow",
					x: 10,
				},
				"shape:update": {
					id: "shape:update",
					typeName: "shape",
					type: "geo",
					x: 20,
				},
			},
			editorStore: {
				"shape:update": {
					id: "shape:update",
					typeName: "shape",
					type: "geo",
					x: 1,
				},
				"shape:remove": {
					id: "shape:remove",
					typeName: "shape",
					type: "draw",
				},
				"shape:unsaved": {
					id: "shape:unsaved",
					typeName: "shape",
					type: "text",
				},
				"page:page": { id: "page:page", typeName: "page" },
			},
			previouslyAppliedRecordIds: new Set(["shape:update", "shape:remove"]),
			availableShapeIds: new Set(),
		});

		expect(result.upserts.map((record) => record.id)).toEqual([
			"shape:new",
			"shape:update",
		]);
		expect(result.removals).toEqual(["shape:remove"]);
		expect(result.removals).not.toContain("shape:unsaved");
		expect(result.removals).not.toContain("page:page");
	});

	test("defers bindings until endpoints exist and applies shapes first", () => {
		const binding = {
			id: "binding:arrow",
			typeName: "binding",
			type: "arrow",
			fromId: "shape:arrow",
			toId: "shape:card",
			props: {},
		};
		const persistedStore = {
			"binding:arrow": binding,
			"shape:arrow": {
				id: "shape:arrow",
				typeName: "shape",
				type: "arrow",
			},
			"shape:managed": {
				id: "shape:managed",
				typeName: "shape",
				type: "markdown-card",
			},
		};
		const deferred = planCanvasReconciliation({
			persistedStore,
			editorStore: {},
			previouslyAppliedRecordIds: new Set(),
			availableShapeIds: new Set(),
		});
		expect(deferred.upserts.map((record) => record.id)).toEqual([
			"shape:arrow",
		]);
		expect(deferred.deferredBindings.map((record) => record.id)).toEqual([
			"binding:arrow",
		]);
		expect(deferred.nextAppliedRecordIds.has("shape:managed")).toBe(false);

		const ready = planCanvasReconciliation({
			persistedStore,
			editorStore: {},
			previouslyAppliedRecordIds: new Set(),
			availableShapeIds: new Set(["shape:card"]),
		});
		expect(ready.upserts.map((record) => record.id)).toEqual([
			"shape:arrow",
			"binding:arrow",
		]);
	});

	test("is idempotent when editor and persistence match", () => {
		const record = {
			id: "shape:same",
			typeName: "shape",
			type: "geo",
			x: 1,
		};
		const result = planCanvasReconciliation({
			persistedStore: { [record.id]: record },
			editorStore: { [record.id]: structuredClone(record) },
			previouslyAppliedRecordIds: new Set([record.id]),
			availableShapeIds: new Set([record.id]),
		});
		expect(result.upserts).toEqual([]);
		expect(result.removals).toEqual([]);
		expect(result.deferredBindings).toEqual([]);
	});
});

// The local agent server writes arrow records without a live Editor. A mistake there
// would not surface until someone opened the board, so assert the records it
// builds survive the hydration path.
describe("agent-authored arrow records", () => {
	test("hydrate and defer their bindings until the cards exist", () => {
		const built = buildArrowRelationRecords({
			sourceShapeId: "shape:card-a",
			targetShapeId: "shape:card-b",
			records: [
				{ id: "page:page", typeName: "page", name: "Page", index: "a1" },
			],
		});
		const store: Record<string, unknown> = {
			"page:page": {
				id: "page:page",
				typeName: "page",
				name: "Page",
				index: "a1",
			},
		};
		for (const record of built.records) {
			store[(record as { id: string }).id] = record;
		}

		// Managed card shapes are hydrated separately, so they are absent here —
		// exactly the situation the agent writes into.
		const resolved = resolveHydrationSnapshot({
			persistedSnapshot: { store } as unknown as TLStoreSnapshot,
			currentEmptySnapshot: snapshot({}),
		});
		const { snapshot: loadable, deferredBindings } =
			splitDeferredBindings(resolved);

		// The arrow loads; its two bindings wait for the cards.
		expect(records(loadable)[built.arrowShapeId]).toBeDefined();
		expect(deferredBindings).toHaveLength(2);
		expect(
			(deferredBindings as Array<{ toId: string }>)
				.map((binding) => binding.toId)
				.sort(),
		).toEqual(["shape:card-a", "shape:card-b"]);
	});
});
