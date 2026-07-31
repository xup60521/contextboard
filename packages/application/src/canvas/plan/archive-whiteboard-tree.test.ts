import { describe, expect, test } from "vitest";
import type { EntityRow } from "../../repository/entities";
import { planArchiveWhiteboardTree } from "./archive-whiteboard-tree";

function row(id: string, fields: Record<string, unknown> = {}): EntityRow {
	return {
		id,
		revision: 1,
		createdAt: 1,
		updatedAt: 1,
		deletedAt: null,
		...fields,
	};
}

function snapshot() {
	return {
		whiteboards: [
			row("parent", { parentWhiteboardId: null, archivedAt: null }),
			row("child", { parentWhiteboardId: "parent", archivedAt: null }),
			row("grandchild", { parentWhiteboardId: "child", archivedAt: null }),
			row("sibling", { parentWhiteboardId: "parent", archivedAt: null }),
		],
		items: [
			row("parent-link", {
				whiteboardId: null,
				kind: "subwhiteboard",
				childWhiteboardId: "parent",
				archivedAt: null,
			}),
			row("child-link", {
				whiteboardId: "parent",
				kind: "subwhiteboard",
				childWhiteboardId: "child",
				archivedAt: null,
			}),
			row("grandchild-card", {
				whiteboardId: "grandchild",
				kind: "card",
				cardId: "card-1",
				archivedAt: null,
			}),
			row("sibling-card", {
				whiteboardId: "sibling",
				kind: "card",
				cardId: "card-1",
				archivedAt: null,
			}),
		],
		cards: [
			row("card-1", {
				activePlacementCount: 2,
				archivedAt: null,
			}),
		],
		tldrawDocuments: [
			row("document-1", { whiteboardId: "child" }),
			row("document-sibling", { whiteboardId: "sibling" }),
		],
		canvasRecords: [
			row("record-1", { whiteboardId: "grandchild" }),
			row("record-sibling", { whiteboardId: "sibling" }),
		],
		fileReferences: [
			row("file-ref-1", {
				fileId: "file-1",
				targetKey: "tldrawDocument:document-1",
			}),
			row("file-ref-sibling", {
				fileId: "file-1",
				targetKey: "tldrawDocument:document-sibling",
			}),
		],
		files: [row("file-1", { refCount: 2, status: "active" })],
		cardRelations: [
			row("relation-1", { whiteboardId: "child" }),
			row("relation-sibling", { whiteboardId: "sibling" }),
		],
	};
}

describe("planArchiveWhiteboardTree", () => {
	test("archives descendants and preserves cards with placements elsewhere", () => {
		const plan = planArchiveWhiteboardTree(snapshot(), {
			whiteboardId: "child",
			deleteCards: false,
			now: 100,
		});

		expect(plan.result.whiteboardIds.sort()).toEqual(["child", "grandchild"]);
		expect(
			plan.writes
				.filter((write) => write.entity === "whiteboard")
				.map((write) => write.id),
		).toEqual(["child", "grandchild"]);
		expect(
			plan.writes
				.filter((write) => write.entity === "boardItem")
				.map((write) => write.id),
		).toEqual(["child-link", "grandchild-card"]);
		expect(plan.writes.find((write) => write.entity === "card")?.value).toEqual(
			expect.objectContaining({ activePlacementCount: 1, archivedAt: null }),
		);
		expect(
			plan.writes
				.filter((write) => write.entity === "tldrawDocument")
				.map((write) => write.id),
		).toEqual(["document-1"]);
		expect(
			plan.writes
				.filter((write) => write.entity === "canvasRecord")
				.map((write) => write.id),
		).toEqual(["record-1"]);
		expect(
			plan.writes
				.filter((write) => write.entity === "fileReference")
				.map((write) => write.id),
		).toEqual(["file-ref-1"]);
		expect(plan.writes.find((write) => write.entity === "file")?.value).toEqual(
			expect.objectContaining({ refCount: 1, status: "active" }),
		);
		expect(
			plan.writes
				.filter((write) => write.entity === "cardRelation")
				.map((write) => write.id),
		).toEqual(["relation-1"]);
		expect(plan.writes.some((write) => write.id === "parent-link")).toBe(false);
		expect(plan.writes.some((write) => write.id === "sibling-card")).toBe(false);
		expect(
			new Set(plan.writes.map((write) => `${write.entity}:${write.id}`)).size,
		).toBe(plan.writes.length);
	});

	test("keeps a card active when another placement remains", () => {
		const plan = planArchiveWhiteboardTree(snapshot(), {
			whiteboardId: "child",
			deleteCards: true,
			now: 100,
		});

		expect(plan.writes.find((write) => write.entity === "card")?.value).toEqual(
			expect.objectContaining({ activePlacementCount: 1, archivedAt: null }),
		);
	});

	test("leaves an unrelated orphan card untouched", () => {
		const data = snapshot();
		data.cards.push(row("orphan-card", { activePlacementCount: 0 }));

		const plan = planArchiveWhiteboardTree(data, {
			whiteboardId: "child",
			deleteCards: true,
			now: 100,
		});

		expect(plan.writes.some((write) => write.id === "orphan-card")).toBe(false);
	});

	test("archives a card after its final placement when requested", () => {
		const data = snapshot();
		data.items = data.items.filter((item) => item.id !== "sibling-card");
		const card = data.cards.at(0);
		if (!card) throw new Error("Expected a card fixture");
		card.activePlacementCount = 1;

		const plan = planArchiveWhiteboardTree(data, {
			whiteboardId: "child",
			deleteCards: true,
			now: 100,
		});

		expect(plan.writes.find((write) => write.entity === "card")?.value).toEqual(
			expect.objectContaining({ activePlacementCount: 0, archivedAt: 100 }),
		);
	});
});
