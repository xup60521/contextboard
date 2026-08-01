import { createTLSchema } from "@tldraw/tlschema";
import { describe, expect, it } from "vitest";
import {
	buildArrowRelationRecords,
	collectArrowRelationRecordIds,
} from "./arrow-records";

// The real tldraw schema, so a malformed payload fails here rather than when
// someone opens the board.
const schema = createTLSchema();

function validate(record: unknown) {
	const typeName = (record as { typeName: string }).typeName;
	const type = schema.types[typeName as keyof typeof schema.types];
	if (!type) throw new Error(`Unknown record type ${typeName}`);
	return type.validate(record);
}

const page = { id: "page:page", typeName: "page", name: "Page", index: "a1" };

function cardShape(id: string, index: string) {
	return {
		id,
		typeName: "shape",
		type: "geo",
		parentId: "page:page",
		index,
		x: 0,
		y: 0,
		rotation: 0,
		isLocked: false,
		opacity: 1,
		meta: {},
		props: {},
	};
}

describe("buildArrowRelationRecords", () => {
	it("emits an arrow and two bindings that satisfy the tldraw schema", () => {
		const built = buildArrowRelationRecords({
			sourceShapeId: "shape:a",
			targetShapeId: "shape:b",
			records: [page],
		});

		expect(built.records).toHaveLength(3);
		for (const record of built.records)
			expect(() => validate(record)).not.toThrow();
	});

	it("binds start to the source card and end to the target card", () => {
		const built = buildArrowRelationRecords({
			sourceShapeId: "shape:source",
			targetShapeId: "shape:target",
			records: [page],
		});
		const [arrow, start, end] = built.records as Array<{
			id: string;
			type: string;
			fromId?: string;
			toId?: string;
			props: { terminal?: string };
		}>;

		expect(arrow.id).toBe(built.arrowShapeId);
		expect(arrow.type).toBe("arrow");
		expect(start.props.terminal).toBe("start");
		expect(start.toId).toBe("shape:source");
		expect(end.props.terminal).toBe("end");
		expect(end.toId).toBe("shape:target");
		// Both bindings hang off the arrow, which is what makes the arrow
		// discoverable from either card.
		expect(start.fromId).toBe(built.arrowShapeId);
		expect(end.fromId).toBe(built.arrowShapeId);
	});

	it("sorts the arrow above every shape already on the page", () => {
		const built = buildArrowRelationRecords({
			sourceShapeId: "shape:a",
			targetShapeId: "shape:b",
			records: [page, cardShape("shape:a", "a1"), cardShape("shape:b", "a5")],
		});
		const arrow = built.records[0] as { index: string; parentId: string };

		expect(arrow.index > "a5").toBe(true);
		expect(arrow.parentId).toBe("page:page");
	});

	it("adopts the board's page when it is not the default one", () => {
		const built = buildArrowRelationRecords({
			sourceShapeId: "shape:a",
			targetShapeId: "shape:b",
			records: [
				{ id: "page:custom", typeName: "page", name: "P", index: "a1" },
			],
		});

		expect((built.records[0] as { parentId: string }).parentId).toBe(
			"page:custom",
		);
	});

	it("falls back to the default page when the board has no page record", () => {
		const built = buildArrowRelationRecords({
			sourceShapeId: "shape:a",
			targetShapeId: "shape:b",
			records: [],
		});
		const arrow = built.records[0];

		expect((arrow as { parentId: string }).parentId).toBe("page:page");
		expect(() => validate(arrow)).not.toThrow();
	});

	it("rejects an arrow from a shape to itself", () => {
		expect(() =>
			buildArrowRelationRecords({
				sourceShapeId: "shape:a",
				targetShapeId: "shape:a",
			}),
		).toThrow(/two different shapes/);
	});

	it("mints unique ids across calls", () => {
		const first = buildArrowRelationRecords({
			sourceShapeId: "shape:a",
			targetShapeId: "shape:b",
		});
		const second = buildArrowRelationRecords({
			sourceShapeId: "shape:a",
			targetShapeId: "shape:b",
		});

		expect(first.arrowShapeId).not.toBe(second.arrowShapeId);
		expect(first.startBindingId).not.toBe(second.startBindingId);
	});
});

describe("collectArrowRelationRecordIds", () => {
	it("collects the arrow and every binding hanging off it", () => {
		const built = buildArrowRelationRecords({
			sourceShapeId: "shape:a",
			targetShapeId: "shape:b",
			records: [page],
		});
		const other = buildArrowRelationRecords({
			sourceShapeId: "shape:a",
			targetShapeId: "shape:c",
			records: [page],
		});

		const ids = collectArrowRelationRecordIds(built.arrowShapeId, [
			...built.records,
			...other.records,
		]);

		expect(ids.sort()).toEqual(
			[built.arrowShapeId, built.startBindingId, built.endBindingId].sort(),
		);
	});

	it("returns just the arrow when its bindings are already gone", () => {
		expect(collectArrowRelationRecordIds("shape:arrow", [])).toEqual([
			"shape:arrow",
		]);
	});
});
