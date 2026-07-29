import "fake-indexeddb/auto";
import { cardsServiceConformance } from "@contextboard/application/cards";
import {
	createContextboardDatabase,
	ensureLocalIdentity,
} from "@contextboard/local-db";
import { afterEach, describe, test } from "vitest";
import { createWebCardsService } from "./webCardsService";

const databases: ReturnType<typeof createContextboardDatabase>[] = [];

afterEach(async () => {
	await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe("Web domain CardsService conformance", () => {
	for (const conformanceCase of cardsServiceConformance) {
		test(conformanceCase.name, async () => {
			const database = createContextboardDatabase(crypto.randomUUID());
			databases.push(database);
			const identity = await ensureLocalIdentity(database);
			await conformanceCase.run(
				createWebCardsService(database, identity.deviceId),
			);
		});
	}
});
