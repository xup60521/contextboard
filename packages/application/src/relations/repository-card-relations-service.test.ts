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

describe("card relation writes", () => {
	function setup(start = 300) {
		let now = start;
		const repository = createMemoryWorkspaceRepository({ now: () => ++now });
		const relations = createRepositoryCardRelationsService(repository, {
			now: () => ++now,
			deviceId: "test",
		});
		return { repository, relations };
	}

	async function seedBoard(
		repository: ReturnType<typeof createMemoryWorkspaceRepository>,
	) {
		await seed(repository, "whiteboard", { id: "board", archivedAt: null });
		await seed(repository, "card", { id: "card-a", archivedAt: null });
		await seed(repository, "card", { id: "card-b", archivedAt: null });
	}

	test("normalizes endpoints of an undirected related edge", async () => {
		const { repository, relations } = setup();
		await seedBoard(repository);

		const created = await relations.create({
			whiteboardId: "board",
			sourceCardId: "card-b",
			targetCardId: "card-a",
		});

		expect(created).toMatchObject({
			sourceCardId: "card-a",
			targetCardId: "card-b",
			relation: "related",
			arrowShapeId: null,
		});
	});

	test("uses the reconcile id when the caller owns an arrow", async () => {
		const { repository, relations } = setup();
		await seedBoard(repository);

		const created = await relations.create({
			whiteboardId: "board",
			sourceCardId: "card-a",
			targetCardId: "card-b",
			arrowShapeId: "shape:arrow",
		});

		expect(created.id).toBe("card-relation:board:shape:arrow");

		// A later reconcile of the same arrow must agree rather than duplicate.
		await relations.reconcileCanvasRelations({
			whiteboardId: "board",
			relations: [
				{ arrowShapeId: "shape:arrow", cardIds: ["card-a", "card-b"] },
			],
		});

		const rows = await relations.list({ whiteboardId: "board" });
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			id: "card-relation:board:shape:arrow",
			sourceCardId: "card-a",
			targetCardId: "card-b",
			relation: "related",
		});
	});

	test("returns the existing row instead of duplicating an edge", async () => {
		const { repository, relations } = setup();
		await seedBoard(repository);

		const first = await relations.create({
			whiteboardId: "board",
			sourceCardId: "card-a",
			targetCardId: "card-b",
		});
		// Reversed, because `related` is undirected.
		const second = await relations.create({
			whiteboardId: "board",
			sourceCardId: "card-b",
			targetCardId: "card-a",
		});

		expect(second.id).toBe(first.id);
		expect(await relations.list({ whiteboardId: "board" })).toHaveLength(1);
	});

	test("keeps distinct relation kinds side by side", async () => {
		const { repository, relations } = setup();
		await seedBoard(repository);

		await relations.create({
			whiteboardId: "board",
			sourceCardId: "card-a",
			targetCardId: "card-b",
		});
		await relations.create({
			whiteboardId: "board",
			sourceCardId: "card-a",
			targetCardId: "card-b",
			relation: "supports",
		});

		expect(await relations.list({ whiteboardId: "board" })).toHaveLength(2);
	});

	test("preserves direction for a semantic relation", async () => {
		const { repository, relations } = setup();
		await seedBoard(repository);

		const created = await relations.create({
			whiteboardId: "board",
			sourceCardId: "card-b",
			targetCardId: "card-a",
			relation: "supports",
		});

		expect(created).toMatchObject({
			sourceCardId: "card-b",
			targetCardId: "card-a",
		});
	});

	test("rejects a self relation, unknown kinds and missing rows", async () => {
		const { repository, relations } = setup();
		await seedBoard(repository);

		await expect(
			relations.create({
				whiteboardId: "board",
				sourceCardId: "card-a",
				targetCardId: "card-a",
			}),
		).rejects.toThrow(/cannot relate to itself/);

		await expect(
			relations.create({
				whiteboardId: "board",
				sourceCardId: "card-a",
				targetCardId: "card-b",
				relation: "endorses" as never,
			}),
		).rejects.toThrow(/Unknown relation kind/);

		await expect(
			relations.create({
				whiteboardId: "missing",
				sourceCardId: "card-a",
				targetCardId: "card-b",
			}),
		).rejects.toThrow(/Whiteboard not found/);

		await expect(
			relations.create({
				whiteboardId: "board",
				sourceCardId: "card-a",
				targetCardId: "card-missing",
			}),
		).rejects.toThrow(/Card not found/);
	});

	test("archives a relation and tolerates repeat calls", async () => {
		const { repository, relations } = setup();
		await seedBoard(repository);
		const created = await relations.create({
			whiteboardId: "board",
			sourceCardId: "card-a",
			targetCardId: "card-b",
		});

		await relations.archive({ relationId: created.id });
		expect(await relations.list({ whiteboardId: "board" })).toEqual([]);

		await expect(
			relations.archive({ relationId: created.id }),
		).resolves.toBeUndefined();
	});

	test("re-creates an edge that was archived earlier", async () => {
		const { repository, relations } = setup();
		await seedBoard(repository);
		const first = await relations.create({
			whiteboardId: "board",
			sourceCardId: "card-a",
			targetCardId: "card-b",
			arrowShapeId: "shape:arrow",
		});
		await relations.archive({ relationId: first.id });

		const second = await relations.create({
			whiteboardId: "board",
			sourceCardId: "card-a",
			targetCardId: "card-b",
			arrowShapeId: "shape:arrow",
		});

		expect(second.id).toBe(first.id);
		expect(await relations.list({ whiteboardId: "board" })).toHaveLength(1);
	});
});
