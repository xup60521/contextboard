// @vitest-environment jsdom

import {
	cardsServiceConformance,
	createRepositoryCardsService,
} from "@contextboard/application";
import { createMemoryHistory } from "@tanstack/react-router";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { DesktopApp } from "./DesktopApp";
import { createDesktopRouter } from "./router";
import { createDesktopRepository, type Invoke } from "./runtime/repository";

vi.mock("@contextboard/web-ui", async (importOriginal) => ({
	...(await importOriginal<typeof import("@contextboard/web-ui")>()),
	WhiteboardCanvas: ({ whiteboardId }: { whiteboardId: string | null }) => (
		<div
			data-testid="whiteboard-canvas"
			data-whiteboard-id={whiteboardId === null ? "root" : whiteboardId}
		/>
	),
}));

vi.mock("@contextboard/editor", async (importOriginal) => ({
	...(await importOriginal<typeof import("@contextboard/editor")>()),
	RichTextEditor: ({
		onChange,
	}: {
		onChange?: (content: unknown) => void;
	}) => (
		<textarea
			aria-label="Card content"
			onChange={(event) =>
				onChange?.({
					type: "doc",
					content: [
						{
							type: "heading",
							attrs: { level: 1 },
							content: [{ type: "text", text: event.target.value }],
						},
					],
				})
			}
		/>
	),
}));

type Entity = Record<string, unknown> & {
	id: string;
	revision: number;
	deletedAt: number | null;
};

/**
 * In-process stand-in for the Rust `workspace_*` commands. It mirrors the
 * SQLite allowlist and materialization rules, so the shared UI is exercised
 * against the same semantics the native build enforces.
 */
function createNativeStub() {
	const store = new Map<string, Map<string, Entity>>();
	let clock = 1_000;
	const entities: Record<string, string> = {
		cards: "card",
		whiteboards: "whiteboard",
		items: "boardItem",
		records: "canvasRecord",
		tldrawDocuments: "tldrawDocument",
		files: "file",
		fileReferences: "fileReference",
		cardReferences: "cardReference",
		cardRelations: "cardRelation",
	};
	const table = (entityType: string) => {
		const rows = store.get(entityType) ?? new Map<string, Entity>();
		store.set(entityType, rows);
		return rows;
	};
	const resolve = (type: unknown) => {
		const [prefix, action] = String(type).split(".");
		const entityType = entities[prefix ?? ""];
		if (!entityType)
			throw {
				code: "UNKNOWN_DOMAIN_OPERATION",
				message: "The requested domain operation is not supported",
			};
		return { entityType, action };
	};

	const invoke: Invoke = async (command, args = {}) => {
		if (command === "desktop_bootstrap")
			return { version: "0.0.0", platform: "windows", storageAvailable: true };
		if (args.workspaceId !== "contextboard-desktop")
			throw { code: "INVALID_ARGUMENT", message: "workspaceId is invalid" };

		if (command === "workspace_query") {
			const query = args.query as { type: string; input?: { id?: string } };
			const { entityType, action } = resolve(query.type);
			const rows = table(entityType);
			if (action === "get")
				return rows.get(String(query.input?.id))?.deletedAt === null
					? rows.get(String(query.input?.id))
					: null;
			if (action !== "list")
				throw {
					code: "UNKNOWN_DOMAIN_OPERATION",
					message: "The requested domain operation is not supported",
				};
			return [...rows.values()].filter((row) => row.deletedAt === null);
		}

		if (command === "workspace_execute") {
			const request = args.command as {
				type: string;
				input?: {
					value?: Record<string, unknown>;
					writes?: Array<{
						entity: string;
						operation: "upsert" | "delete";
						id: string;
						value?: Record<string, unknown>;
						expectedRevision?: number;
					}>;
				};
			};
			const { entityType, action } = resolve(request.type);

			// Multi-entity atomic form: the command type is only a label and each
			// write names its own entity, mirroring the SQLite command contract.
			if (request.input?.writes) {
				const writes = request.input.writes;
				if (!writes.length || writes.length > 200)
					throw {
						code: "INVALID_ARGUMENT",
						message: "writes must contain 1 to 200 entries",
					};
				return writes.map((write) => {
					const rows = table(write.entity);
					const existing = rows.get(write.id);
					const revision = ((existing?.revision as number) ?? 0) + 1;
					if (
						write.expectedRevision !== undefined &&
						write.expectedRevision !== revision - 1
					)
						throw {
							code: "INVALID_ARGUMENT",
							message: `CONFLICT: revision mismatch for ${write.entity}:${write.id}`,
						};
					const now = ++clock;
					const deleted = write.operation === "delete";
					const materialized = {
						...(deleted ? existing : write.value),
						id: write.id,
						revision,
						updatedAt: now,
						deletedAt: deleted ? now : null,
					} as Entity;
					rows.set(write.id, materialized);
					return materialized;
				});
			}

			if (!["create", "put", "update", "delete"].includes(action ?? ""))
				throw {
					code: "UNKNOWN_DOMAIN_OPERATION",
					message: "The requested domain operation is not supported",
				};
			const value = request.input?.value;
			if (!value || typeof value.id !== "string")
				throw {
					code: "INVALID_ARGUMENT",
					message: "A valid entity ID is required",
				};
			const rows = table(entityType);
			const now = ++clock;
			const deleted = action === "delete";
			const materialized = {
				...value,
				id: value.id,
				revision: ((rows.get(value.id)?.revision as number) ?? 0) + 1,
				updatedAt: now,
				deletedAt: deleted ? now : null,
			} as Entity;
			rows.set(value.id, materialized);
			return action === "create" ? value.id : materialized;
		}

		throw { code: "INVALID_ARGUMENT", message: `Unknown command ${command}` };
	};

	return { invoke, store };
}

const mount = (
	invoke: Invoke,
	initialEntry = "/",
	history = createMemoryHistory({ initialEntries: [initialEntry] }),
) =>
	render(<DesktopApp invoke={invoke} router={createDesktopRouter(history)} />);

afterEach(cleanup);

describe("Desktop card conformance (semantic IPC boundary)", () => {
	for (const scenario of cardsServiceConformance) {
		test(scenario.name, async () => {
			await scenario.run(
				createRepositoryCardsService(
					createDesktopRepository(
						"contextboard-desktop",
						createNativeStub().invoke,
					),
				),
			);
		});
	}
});

describe("Desktop application shell", () => {
	test("redirects to the shared card library and shows the desktop platform", async () => {
		const { invoke } = createNativeStub();
		mount(invoke);
		expect(
			await screen.findByRole("main", { name: "Card Library" }),
		).toBeTruthy();
		expect(screen.getByText("Desktop")).toBeTruthy();
		expect(screen.getByText("Local only")).toBeTruthy();
	});

	test("keeps the boot screen visible until the native runtime answers", async () => {
		const invoke: Invoke = async () => {
			throw { code: "STORAGE_NOT_INITIALIZED", message: "Storage is closed" };
		};
		mount(invoke);
		expect(
			await screen.findByText("The desktop runtime did not start"),
		).toBeTruthy();
	});

	test("creates, opens, edits and deletes a card, and survives a reopen", async () => {
		const native = createNativeStub();
		mount(native.invoke);

		expect(await screen.findByText("No cards yet")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "New card" }));

		const editor = await screen.findByLabelText("Card content");
		const editable = editor.querySelector("[contenteditable=true]") ?? editor;
		editable.textContent = "Desktop research";
		fireEvent.input(editable, {
			inputType: "insertText",
			data: "Desktop research",
		});
		// The shared editor debounces, so wait for the write to reach SQLite.
		await waitFor(
			() =>
				expect(
					[...(native.store.get("card")?.values() ?? [])][0]?.derivedTitle,
				).toBe("Desktop research"),
			{ timeout: 3_000 },
		);

		// "Close" the window and reopen against the same native store.
		cleanup();
		mount(native.invoke, "/cards");
		expect(
			await screen.findByRole("heading", { name: "Desktop research" }),
		).toBeTruthy();

		// Select in the shared library grid, then bulk-delete from the toolbar.
		const card = screen.getByRole("button", { name: /Desktop research/ });
		fireEvent.click(card, { detail: 1, shiftKey: true });
		fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
		fireEvent.click(
			await screen.findByRole("button", { name: "Delete card" }),
		);
		await waitFor(() => expect(screen.getByText("No cards yet")).toBeTruthy());

		// The tombstone is durable, not just hidden by the view.
		cleanup();
		mount(native.invoke, "/cards");
		expect(await screen.findByText("No cards yet")).toBeTruthy();
	});

	test("opens a card deep link directly, as a reload would", async () => {
		const native = createNativeStub();
		mount(native.invoke);
		await screen.findByText("No cards yet");
		fireEvent.click(screen.getByRole("button", { name: "New card" }));
		await screen.findByLabelText("Card content");
		const cardId = [...(native.store.get("card")?.keys() ?? [])][0];
		expect(cardId).toBeTruthy();

		cleanup();
		mount(native.invoke, `/cards/${cardId}`);
		expect(await screen.findByLabelText("Card content")).toBeTruthy();
	});

	test("opens the root board as the null whiteboard, not a board entity", async () => {
		// The root board holds only subwhiteboard links; the shared canvas gates
		// card creation on a non-null whiteboardId. Materialising a real root
		// board here would silently let cards be added to it.
		const native = createNativeStub();
		mount(native.invoke, "/whiteboard");
		const canvas = await screen.findByTestId("whiteboard-canvas");
		expect(canvas.getAttribute("data-whiteboard-id")).toBe("root");
		expect(native.store.get("whiteboard")?.size ?? 0).toBe(0);
	});

	test("opens a specific board by id", async () => {
		const native = createNativeStub();
		mount(native.invoke, "/whiteboard/board-7");
		const canvas = await screen.findByTestId("whiteboard-canvas");
		expect(canvas.getAttribute("data-whiteboard-id")).toBe("board-7");
	});

	test("rejects domain operations outside the native allowlist", async () => {
		const { invoke } = createNativeStub();
		await expect(
			invoke("workspace_query", {
				workspaceId: "contextboard-desktop",
				query: { type: "secrets.list", input: {} },
			}),
		).rejects.toMatchObject({ code: "UNKNOWN_DOMAIN_OPERATION" });
		await expect(
			invoke("workspace_execute", {
				workspaceId: "other-workspace",
				command: { type: "cards.create", input: {} },
			}),
		).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
	});
});
