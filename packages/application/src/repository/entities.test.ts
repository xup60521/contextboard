import { describe, expect, test } from "vitest";
import { createMemoryWorkspaceRepository } from "../testing";
import { listRows } from "./entities";

describe("filtered entity list reads", () => {
	test("honors board, root, id and deleted-row filters", async () => {
		const repository = createMemoryWorkspaceRepository();
		for (const value of [
			{ id: "item-a", whiteboardId: "board-a" },
			{ id: "item-b", whiteboardId: "board-b" },
			{ id: "item-root", whiteboardId: null },
		]) {
			await repository.execute({
				type: "items.create",
				input: { value },
			});
		}
		await repository.execute({
			type: "items.delete",
			input: { value: { id: "item-b" } },
		});

		expect(
			(await listRows(repository, "items", { whiteboardId: "board-a" })).map(
				(row) => row.id,
			),
		).toEqual(["item-a"]);
		expect(
			(await listRows(repository, "items", { whiteboardId: null })).map(
				(row) => row.id,
			),
		).toEqual(["item-root"]);
		expect(
			(
				await listRows(repository, "items", {
					ids: ["item-root", "item-a", "missing", "item-a"],
				})
			).map((row) => row.id),
		).toEqual(["item-a", "item-root"]);
		expect(await listRows(repository, "items", { ids: [] })).toEqual([]);
	});

	test("handles a large id predicate without changing its semantics", async () => {
		const repository = createMemoryWorkspaceRepository();
		await repository.execute({
			type: "items.create",
			input: { value: { id: "target", whiteboardId: "board-a" } },
		});
		const ids = [
			...Array.from({ length: 1_200 }, (_, index) => `missing-${index}`),
			"target",
		];
		expect(
			(await listRows(repository, "items", { ids })).map((row) => row.id),
		).toEqual(["target"]);
	});
});
