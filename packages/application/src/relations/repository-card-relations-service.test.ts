import { describe, expect, test } from "vitest";
import { createMemoryWorkspaceRepository } from "../testing";
import { createRepositoryCardRelationsService } from "./repository-card-relations-service";

async function seed(
	repository: ReturnType<typeof createMemoryWorkspaceRepository>,
	entity: "whiteboard" | "card" | "cardRelation",
	value: Record<string, unknown> & { id: string },
) {
	await repository.execute({
		type: "cardRelations.seed",
		input: { writes: [{ entity, operation: "upsert", id: value.id, value }] },
	});
}

describe("repository card relations capability", () => {
	test("reconciles bound arrows as normalized undirected related edges", async () => {
		let now = 100;
		const repository = createMemoryWorkspaceRepository({ now: () => ++now });
		const relations = createRepositoryCardRelationsService(repository, {
			now: () => ++now,
			deviceId: "test",
		});
		await seed(repository, "whiteboard", { id: "board", archivedAt: null });
		await seed(repository, "card", { id: "card-a", archivedAt: null });
		await seed(repository, "card", { id: "card-b", archivedAt: null });

		await relations.reconcileCanvasRelations({
			whiteboardId: "board",
			relations: [
				{ arrowShapeId: "shape:arrow", cardIds: ["card-b", "card-a"] },
			],
		});

		expect(await relations.list({ whiteboardId: "board" })).toEqual([
			expect.objectContaining({
				id: "card-relation:board:shape:arrow",
				sourceCardId: "card-a",
				targetCardId: "card-b",
				relation: "related",
				ordinal: null,
				arrowShapeId: "shape:arrow",
			}),
		]);
	});

	test("removes stale arrow edges without touching semantic relations", async () => {
		let now = 200;
		const repository = createMemoryWorkspaceRepository({ now: () => ++now });
		const relations = createRepositoryCardRelationsService(repository, {
			now: () => ++now,
		});
		await seed(repository, "whiteboard", { id: "board", archivedAt: null });
		await seed(repository, "card", { id: "card-a", archivedAt: null });
		await seed(repository, "card", { id: "card-b", archivedAt: null });
		await seed(repository, "cardRelation", {
			id: "semantic",
			whiteboardId: "board",
			sourceCardId: "card-a",
			targetCardId: "card-b",
			relation: "supports",
			ordinal: null,
			arrowShapeId: null,
		});
		await relations.reconcileCanvasRelations({
			whiteboardId: "board",
			relations: [{ arrowShapeId: "arrow", cardIds: ["card-a", "card-b"] }],
		});
		await relations.reconcileCanvasRelations({
			whiteboardId: "board",
			relations: [],
		});

		expect((await relations.list()).map((row) => row.id)).toEqual(["semantic"]);
	});
});
