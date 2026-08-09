import { describe, expect, test } from "vitest";
import { planReferences } from "./references";

describe("planReferences", () => {
	test("uses explicit tombstones and conditionally updates file counts", () => {
		const plan = planReferences(
			{
				targetFileReferences: [
					{
						id: "card:card-1:old",
						revision: 2,
						fileId: "old",
						targetKey: "card:card-1",
					},
				],
				allFileReferences: [
					{
						id: "card:card-1:old",
						revision: 2,
						fileId: "old",
						targetKey: "card:card-1",
					},
				],
				cardReferences: [],
				whiteboardReferences: [],
				files: [{ id: "old", revision: 4 }],
			},
			{
				targetType: "card",
				targetId: "card-1",
				content: { type: "doc", content: [] },
			},
			{ now: 100, deviceId: "device" },
		);
		expect(plan.writes).toEqual([
			expect.objectContaining({
				entity: "fileReference",
				operation: "delete",
				expectedRevision: 2,
			}),
			expect.objectContaining({
				entity: "file",
				expectedRevision: 4,
				value: expect.objectContaining({
					refCount: 0,
					status: "pending_delete",
				}),
			}),
		]);
	});

	test("adds, preserves, and removes whiteboard references from card content", () => {
		const content = {
			type: "doc",
			content: [{ type: "text", marks: [{ type: "link", attrs: { whiteboardRefId: "board-1" } }] }],
		};
		const snapshot = {
			targetFileReferences: [],
			allFileReferences: [],
			cardReferences: [],
			whiteboardReferences: [],
			files: [],
		};
		const added = planReferences(snapshot, { targetType: "card", targetId: "card-1", content }, { now: 100, deviceId: "device" });
		expect(added.writes).toContainEqual(expect.objectContaining({ entity: "whiteboardReference", operation: "upsert", id: "card-1:board-1" }));

		const existing = [{ id: "card-1:board-1", revision: 2, targetWhiteboardId: "board-1" }];
		expect(planReferences({ ...snapshot, whiteboardReferences: existing }, { targetType: "card", targetId: "card-1", content }, { now: 100, deviceId: "device" }).writes).toEqual([]);
		expect(planReferences({ ...snapshot, whiteboardReferences: existing }, { targetType: "card", targetId: "card-1", content: { type: "doc" } }, { now: 100, deviceId: "device" }).writes).toContainEqual(expect.objectContaining({ entity: "whiteboardReference", operation: "delete", expectedRevision: 2 }));
	});

	test("does not derive whiteboard references for tldraw documents", () => {
		const plan = planReferences(
			{ targetFileReferences: [], allFileReferences: [], cardReferences: [], whiteboardReferences: [], files: [] },
			{ targetType: "tldrawDocument", targetId: "doc-1", content: { whiteboardRefId: "board-1" } },
			{ now: 100, deviceId: "device" },
		);
		expect(plan.writes).toEqual([]);
	});
});
