import type { TLStoreSnapshot } from "tldraw";
import { describe, expect, test } from "vitest";
import {
	filterSnapshotForPersistence,
	isManagedWhiteboardShapeRecord,
} from "./tldraw-persistence";

const schema = { schemaVersion: 2, sequences: {} } as TLStoreSnapshot["schema"];

function snapshot(store: TLStoreSnapshot["store"]): TLStoreSnapshot {
	return { store, schema };
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
			} as TLStoreSnapshot["store"]),
		);

		expect(filtered.store["shape:card"]).toBeUndefined();
		expect(filtered.store["shape:sub"]).toBeUndefined();
		expect(filtered.store["shape:draw"]).toBeDefined();
		expect(filtered.store["shape:text"]).toBeDefined();
	});

	test("drops bindings touching managed shapes and keeps unmanaged bindings", () => {
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
				"binding:drop": {
					id: "binding:drop",
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
			} as TLStoreSnapshot["store"]),
		);

		expect(filtered.store["binding:drop"]).toBeUndefined();
		expect(filtered.store["binding:keep"]).toBeDefined();
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
			} as TLStoreSnapshot["store"]),
		);

		expect(filtered.store["asset:keep"]).toBeDefined();
		expect(filtered.store["asset:drop"]).toBeUndefined();
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
			} as TLStoreSnapshot["store"]),
		);

		expect(filtered.store["document:document"]).toBeDefined();
		expect(filtered.store["page:page"]).toBeDefined();
	});
});
