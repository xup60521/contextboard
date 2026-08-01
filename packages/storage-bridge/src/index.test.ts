import "fake-indexeddb/auto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
	cardsServiceConformance,
	createRepositoryCardsService,
} from "@contextboard/application/cards";
import {
	createContextboardDatabase,
	IndexedDbWorkspaceRepository,
} from "@contextboard/storage-indexeddb";
import { afterEach, describe, expect, test } from "vitest";
import {
	BridgeClient,
	BridgeError,
	BridgeWorkspaceRepository,
	connectBridgeRepository,
} from "./index";

/**
 * The Rust bridge is covered by `apps/desktop/src-tauri/src/bridge.rs` tests,
 * which exercise the real allowlist and the real access guard. What is left to
 * prove on this side is that the client speaks a wire format that guard
 * accepts, and that the repository it produces honours the same
 * `WorkspaceRepository` contract every other backend does.
 *
 * So this stub stands in for the Rust server only at the transport seam: it
 * records the request head it received (asserted against the guard's rules) and
 * delegates the domain operation to a real repository implementation.
 */
type RequestHead = {
	method: string;
	url: string;
	contentType: string | undefined;
	origin: string | undefined;
};

type Harness = {
	port: number;
	heads: RequestHead[];
	failNext: (error: { status: number; code: string; message: string }) => void;
};

const servers: Server[] = [];
const databases: Array<ReturnType<typeof createContextboardDatabase>> = [];

async function startBridge(
	workspaceId = "workspace-under-test",
): Promise<Harness & { backing: IndexedDbWorkspaceRepository }> {
	const database = createContextboardDatabase(crypto.randomUUID());
	databases.push(database);
	const backing = new IndexedDbWorkspaceRepository(database);
	const heads: RequestHead[] = [];
	let pendingFailure:
		| { status: number; code: string; message: string }
		| undefined;

	const server = createServer((request, response) => {
		const chunks: Buffer[] = [];
		request.on("data", (chunk: Buffer) => chunks.push(chunk));
		request.on("end", () => {
			heads.push({
				method: request.method ?? "",
				url: request.url ?? "",
				contentType: request.headers["content-type"],
				origin: request.headers.origin,
			});
			const reply = (status: number, payload: unknown) => {
				response.writeHead(status, { "content-type": "application/json" });
				response.end(JSON.stringify(payload));
			};
			if (pendingFailure) {
				const failure = pendingFailure;
				pendingFailure = undefined;
				reply(failure.status, {
					ok: false,
					error: { code: failure.code, message: failure.message },
				});
				return;
			}
			void (async () => {
				const body = JSON.parse(Buffer.concat(chunks).toString());
				try {
					if (body.op === "status") {
						reply(200, {
							ok: true,
							result: { workspaceId, version: "0.0.0", protocol: 1 },
						});
						return;
					}
					const result =
						body.op === "query"
							? await backing.query(body.payload)
							: await backing.execute(body.payload);
					reply(200, { ok: true, result: result ?? null });
				} catch (error) {
					reply(400, {
						ok: false,
						error: {
							code: "INVALID_ARGUMENT",
							message: error instanceof Error ? error.message : "failed",
						},
					});
				}
			})();
		});
	});
	servers.push(server);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	return {
		backing,
		heads,
		port: (server.address() as AddressInfo).port,
		failNext: (error) => {
			pendingFailure = error;
		},
	};
}

afterEach(async () => {
	await Promise.all(
		servers.splice(0).map(
			(server) =>
				new Promise<void>((resolve) => {
					server.close(() => resolve());
				}),
		),
	);
	await Promise.all(databases.splice(0).map((database) => database.delete()));
});

async function makeCards() {
	const harness = await startBridge();
	const { repository } = await connectBridgeRepository({ port: harness.port });
	return {
		harness,
		repository,
		cards: createRepositoryCardsService(repository),
	};
}

describe("bridge card conformance", () => {
	for (const scenario of cardsServiceConformance) {
		test(scenario.name, async () => {
			const { cards } = await makeCards();
			await scenario.run(cards);
		});
	}
});

describe("bridge client", () => {
	// The Rust guard rejects anything that is not a loopback POST of
	// application/json with no Origin. If the client ever stops sending exactly
	// that, every tool breaks at once with an opaque 403/415.
	test("speaks a request shape the desktop guard accepts", async () => {
		const { harness, cards } = await makeCards();
		await cards.create();
		expect(harness.heads.length).toBeGreaterThan(0);
		for (const head of harness.heads) {
			expect(head.method).toBe("POST");
			expect(head.url).toBe("/bridge/v1");
			expect(head.contentType).toBe("application/json");
			expect(head.origin).toBeUndefined();
		}
	});

	test("adopts the workspace the desktop app reports", async () => {
		const harness = await startBridge("workspace-from-server");
		const { status, repository } = await connectBridgeRepository({
			port: harness.port,
		});
		expect(status.workspaceId).toBe("workspace-from-server");
		expect(repository).toBeInstanceOf(BridgeWorkspaceRepository);
	});

	// A closed desktop app is the most likely failure in normal use, so it must
	// name its own fix rather than surfacing a bare fetch error.
	test("explains an unreachable bridge instead of leaking a network error", async () => {
		const client = new BridgeClient({ port: 1, timeoutMs: 500 });
		await expect(client.status()).rejects.toThrow(BridgeError);
		await expect(client.status()).rejects.toThrow(
			/desktop app is running and the agent bridge is enabled/,
		);
	});

	test("preserves the error code the desktop returned", async () => {
		const harness = await startBridge();
		const client = new BridgeClient({ port: harness.port });
		harness.failNext({
			status: 400,
			code: "UNKNOWN_DOMAIN_OPERATION",
			message: "The requested domain operation is not supported",
		});
		await expect(client.status()).rejects.toMatchObject({
			code: "UNKNOWN_DOMAIN_OPERATION",
			status: 400,
		});
	});

	test("notifies subscribers on local writes", async () => {
		const { cards, repository } = await makeCards();
		let notified = 0;
		const unsubscribe = repository.subscribe(() => {
			notified += 1;
		});
		await cards.create();
		expect(notified).toBeGreaterThan(0);
		unsubscribe();
		const seen = notified;
		await cards.create();
		expect(notified).toBe(seen);
	});

	// Two pushers against one store would duplicate change batches, so these
	// must fail loudly rather than silently no-op.
	test("refuses to act as a sync peer", async () => {
		const harness = await startBridge();
		const { repository } = await connectBridgeRepository({
			port: harness.port,
		});
		await expect(repository.getPendingBatches(10)).rejects.toThrow(
			/desktop app owns synchronization/,
		);
		await expect(repository.acknowledge(["a"])).rejects.toThrow(BridgeError);
		await expect(repository.applyRemote([], "peer", "1")).rejects.toThrow(
			BridgeError,
		);
		await expect(repository.getSyncState("peer")).rejects.toThrow(BridgeError);
	});
});
