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
});
