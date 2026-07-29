// @vitest-environment jsdom

import {
	ApplicationRuntimeProvider,
	type ApplicationRuntime,
	createRepositoryCanvasService,
	createRepositoryCardsService,
	createRepositoryWhiteboardsService,
} from "@contextboard/application";
import { createMemoryWorkspaceRepository } from "@contextboard/application/testing";
import { render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, test } from "vitest";
import { useWhiteboardData } from "./useWhiteboardData";

function createRuntime() {
	let clock = 1_000;
	let counter = 0;
	const repository = createMemoryWorkspaceRepository({ now: () => ++clock });
	const options = {
		now: () => ++clock,
		createId: () => `id-${++counter}`,
		deviceId: "device-1",
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

	test("reports a missing board as not found", async () => {
		const runtime = createRuntime();
		const seen = renderData(runtime, "missing-board");
		await waitFor(() => expect(seen.current?.whiteboard).toBeNull());
	});
});
