import type { TLStoreSnapshot } from "tldraw";
import { describe, expect, test } from "vitest";
import {
	filterSnapshotForPersistence,
	isManagedWhiteboardShapeRecord,
	splitDeferredBindings,
} from "./tldraw-persistence";

const schema = { schemaVersion: 2, sequences: {} } as TLStoreSnapshot["schema"];

function snapshot(store: Record<string, unknown>): TLStoreSnapshot {
	return { store: store as TLStoreSnapshot["store"], schema };
}

function records(snapshot: TLStoreSnapshot): Record<string, unknown> {
	return snapshot.store as unknown as Record<string, unknown>;
}

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
});
