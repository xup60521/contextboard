import { describe, expect, test } from "vitest";
import { planArchiveCard, planArchiveCards } from "./archive-card";

describe("planArchiveCard", () => {
	test("archives active placements and their card with optimistic revisions", () => {
		const plan = planArchiveCard(
			{
				card: {
					id: "card-1",
					revision: 5,
					activePlacementCount: 2,
					archivedAt: null,
				},
				placements: [
					{ id: "item-1", revision: 2, archivedAt: null },
					{ id: "item-2", revision: 4, archivedAt: null },
				],
			},
			{ now: 100 },
		);

		expect(plan.writes).toEqual([
			expect.objectContaining({
				entity: "boardItem",
				id: "item-1",
				expectedRevision: 2,
				value: expect.objectContaining({ archivedAt: 100 }),
			}),
			expect.objectContaining({
				entity: "boardItem",
				id: "item-2",
				expectedRevision: 4,
				value: expect.objectContaining({ archivedAt: 100 }),
			}),
			expect.objectContaining({
				entity: "card",
				id: "card-1",
				expectedRevision: 5,
				value: expect.objectContaining({
					activePlacementCount: 0,
					archivedAt: 100,
				}),
			}),
		]);
	});

	test("combines independent card plans in input order", () => {
		const plan = planArchiveCards(
			[
				{
					card: {
						id: "card-1",
						revision: 1,
						activePlacementCount: 0,
						archivedAt: null,
					},
					placements: [],
				},
				{
					card: {
						id: "card-2",
						revision: 3,
						activePlacementCount: 0,
						archivedAt: null,
					},
					placements: [],
				},
			],
			{ now: 100 },
		);

		expect(plan.writes.map((write) => write.id)).toEqual(["card-1", "card-2"]);
	});
});
