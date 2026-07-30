import "fake-indexeddb/auto";
import { createContextboardDatabase } from "@contextboard/local-db";
import { afterEach, describe, expect, test, vi } from "vitest";
import { getWebWorkspaceRepository } from "./repository";

const databases: ReturnType<typeof createContextboardDatabase>[] = [];

afterEach(async () => {
	await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe("Web workspace repository cache", () => {
	test("shares one instance per database and isolates local notifications", async () => {
		const first = createContextboardDatabase(crypto.randomUUID());
		const second = createContextboardDatabase(crypto.randomUUID());
		databases.push(first, second);
		const repository = getWebWorkspaceRepository(first);
		expect(getWebWorkspaceRepository(first)).toBe(repository);
		expect(getWebWorkspaceRepository(second)).not.toBe(repository);

		const localListener = vi.fn();
		const listener = vi.fn();
		repository.subscribeLocal(localListener);
		repository.subscribe(listener);
		await repository.execute({
			type: "cards.create",
			input: { value: { id: "card-1" } },
		});
		expect(localListener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledTimes(1);
	});
});
