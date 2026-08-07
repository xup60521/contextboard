// @vitest-environment jsdom

import {
	type ApplicationRuntime,
	ApplicationRuntimeProvider,
	createRepositoryCanvasService,
	createRepositoryCardsService,
	createRepositoryWhiteboardsService,
} from "@contextboard/application";
import { createMemoryWorkspaceRepository } from "@contextboard/application/testing";
import { render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";
import { useWhiteboardData } from "./useWhiteboardData";

function createRuntime() {
	let clock = 1_000;
	let counter = 0;
	const repository = createMemoryWorkspaceRepository({ now: () => ++clock });
	const options = {
		now: () => ++clock,
		createId: () => `id-${++counter}`,
		deviceId: "device-1",
		workspaceId: "test",
	};
	const runtime: ApplicationRuntime = {
		platform: "desktop",
		workspaceId: "test",
		cards: createRepositoryCardsService(repository, options),
		whiteboards: createRepositoryWhiteboardsService(repository, options),
		canvas: createRepositoryCanvasService(repository, options),
		navigation: {
			cardsHref: () => "/cards",
			cardHref: (id) => `/cards/${id}`,
			rootWhiteboardHref: () => "/whiteboard",
			whiteboardHref: (id) => `/whiteboard/${id}`,
			navigate: () => undefined,
			replace: () => undefined,
		},
	};
	return runtime;
}

/** Renders the hook and exposes its latest return value. */
function renderData(runtime: ApplicationRuntime, whiteboardId: string | null) {
	const seen: { current: ReturnType<typeof useWhiteboardData> | null } = {
		current: null,
	};
	function Probe() {
		seen.current = useWhiteboardData(whiteboardId);
		return null;
	}
	const wrapper = ({ children }: { children: ReactNode }) => (
		<ApplicationRuntimeProvider runtime={runtime}>
			{children}
		</ApplicationRuntimeProvider>
	);
	render(<Probe />, { wrapper });
	return seen;
}

describe("useWhiteboardData", () => {
	test("exposes the board, its breadcrumbs and its items in the canvas shape", async () => {
		const runtime = createRuntime();
		const boardId = await runtime.whiteboards!.createRoot();
		await runtime.canvas!.createCardItem({
			whiteboardId: boardId,
			shapeId: "shape:card-1",
		});

		const seen = renderData(runtime, boardId);

		await waitFor(() => {
			expect(seen.current?.itemQuery.status).toBe("Exhausted");
			expect(seen.current?.items).toHaveLength(1);
		});
		const item = seen.current!.items[0]!;
		expect(item.kind).toBe("card");
		expect(item.shapeId).toBe("shape:card-1");
		// The canvas reads `derivedTitle`/`_id`, not the service's field names.
		expect(item.card?.derivedTitle).toBeTypeOf("string");
		expect(item._id).toBeTypeOf("string");
		expect(seen.current?.breadcrumbs).toEqual([
			{ _id: boardId, title: "Untitled whiteboard" },
		]);
	});

	test("round-trips a drawing delta through the document", async () => {
		const runtime = createRuntime();
		const boardId = await runtime.whiteboards!.createRoot();
		const seen = renderData(runtime, boardId);

		await waitFor(() => expect(seen.current).not.toBeNull());
		await seen.current!.applyCanvasRecordChanges({
			whiteboardId: boardId,
			added: [{ id: "shape:a", typeName: "shape" }],
			updated: [],
			removed: [],
		});

		await waitFor(() => {
			expect(seen.current?.tldrawDocument?.snapshot.store).toEqual({
				"shape:a": { id: "shape:a", typeName: "shape" },
			});
		});
	});

	test("streams later drawing writes as patches without reloading the document", async () => {
		const runtime = createRuntime();
		const boardId = await runtime.whiteboards!.createRoot();
		await runtime.canvas!.applyRecordChanges({
			whiteboardId: boardId,
			added: [{ id: "shape:a", typeName: "shape", x: 1 }],
			updated: [],
			removed: [],
		});
		const getDocument = vi.spyOn(runtime.canvas!, "getDocument");
		const seen = renderData(runtime, boardId);
		await waitFor(() =>
			expect(seen.current?.tldrawDocument).not.toBeUndefined(),
		);
		getDocument.mockClear();

		await runtime.canvas!.applyRecordChanges({
			whiteboardId: boardId,
			added: [],
			updated: [{ id: "shape:a", typeName: "shape", x: 2 }],
			removed: [],
		});

		await waitFor(() => expect(seen.current?.documentPatches).toHaveLength(1));
		expect(seen.current?.documentPatches[0]?.upserts[0]).toMatchObject({
			recordId: "shape:a",
			revision: 2,
		});
		expect(getDocument).not.toHaveBeenCalled();
	});

	test("reports a missing board as not found", async () => {
		const runtime = createRuntime();
		const seen = renderData(runtime, "missing-board");
		await waitFor(() => expect(seen.current?.whiteboard).toBeNull());
	});

	test("forwards the selected card policy when archiving a board", async () => {
		const runtime = createRuntime();
		const rootId = await runtime.whiteboards!.createRoot();
		const child = await runtime.whiteboards!.createSubwhiteboard({
			parentWhiteboardId: rootId,
			shapeId: "shape:child",
		});
		const cardId = await runtime.cards!.create();
		await runtime.cards!.appendToWhiteboard({
			cardId,
			whiteboardId: child.childWhiteboardId,
		});

		const seen = renderData(runtime, child.childWhiteboardId);
		await waitFor(() => expect(seen.current?.whiteboard).not.toBeNull());
		await seen.current!.archiveWhiteboard({
			whiteboardId: child.childWhiteboardId,
			deleteCards: false,
		});

		expect(await runtime.whiteboards!.get(child.childWhiteboardId)).toBeNull();
		expect(await runtime.cards!.get(cardId)).not.toBeNull();
	});

	test("does not expose the previous board drawing during navigation", async () => {
		const runtime = createRuntime();
		const firstBoardId = await runtime.whiteboards!.createRoot();
		const secondBoardId = await runtime.whiteboards!.createRoot();
		await runtime.canvas!.applyRecordChanges({
			whiteboardId: firstBoardId,
			added: [{ id: "shape:first", typeName: "shape" }],
			updated: [],
			removed: [],
		});

		const seen: { current: ReturnType<typeof useWhiteboardData> | null } = {
			current: null,
		};
		function Probe({ whiteboardId }: { whiteboardId: string }) {
			seen.current = useWhiteboardData(whiteboardId);
			return null;
		}
		const view = render(
			<ApplicationRuntimeProvider runtime={runtime}>
				<Probe whiteboardId={firstBoardId} />
			</ApplicationRuntimeProvider>,
		);

		await waitFor(() =>
			expect(seen.current?.tldrawDocument?.whiteboardId).toBe(firstBoardId),
		);

		view.rerender(
			<ApplicationRuntimeProvider runtime={runtime}>
				<Probe whiteboardId={secondBoardId} />
			</ApplicationRuntimeProvider>,
		);

		expect(seen.current?.itemQuery.status).toBe("LoadingFirstPage");
		expect(seen.current?.tldrawDocument).toBeUndefined();
		await waitFor(() =>
			expect(seen.current?.itemQuery.status).toBe("Exhausted"),
		);
		expect(seen.current?.tldrawDocument).toBeNull();
	});
});
