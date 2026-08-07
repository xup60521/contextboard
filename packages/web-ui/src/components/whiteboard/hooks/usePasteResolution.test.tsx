// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import type { Editor } from "tldraw";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { MarkdownCardShape } from "../custom-shapes";
import { usePasteResolution } from "./usePasteResolution";

afterEach(cleanup);

const card = (overrides: Partial<MarkdownCardShape["props"]> = {}) =>
	({
		id: "shape:pasted",
		type: "markdown-card",
		x: 10,
		y: 20,
		rotation: 0,
		props: {
			w: 320,
			h: 160,
			content: '{"type":"doc","content":[]}',
			cardId: "card:source",
			originWorkspaceId: "workspace:current",
			...overrides,
		},
	}) as MarkdownCardShape;

function renderResolution({
	shape = card(),
	restore = vi.fn(async () => undefined),
}: {
	shape?: MarkdownCardShape;
	restore?: ReturnType<typeof vi.fn>;
} = {}) {
	const editor = {
		pageToScreen: vi.fn(() => ({ x: 100, y: 120 })),
		getShape: vi.fn(() => shape),
		updateShape: vi.fn(),
		updateShapes: vi.fn(),
	} as unknown as Editor;
	const protectedPasteShapeIdsRef = { current: new Set<string>() };
	const seen: {
		current: ReturnType<typeof usePasteResolution> | null;
	} = { current: null };

	function Probe() {
		seen.current = usePasteResolution({
			editor,
			whiteboardId: "whiteboard:1",
			workspaceId: "workspace:current",
			restoreOrAdoptCardItem: restore,
			protectedPasteShapeIdsRef,
		});
		return null;
	}

	render(<Probe />);
	return { editor, restore, seen, shape, protectedPasteShapeIdsRef };
}

function currentResolution(seen: {
	current: ReturnType<typeof usePasteResolution> | null;
}) {
	if (!seen.current) throw new Error("resolution hook did not render");
	return seen.current;
}

describe("usePasteResolution", () => {
	test("defers trusted paste cards until the user chooses", () => {
		const { restore, seen, shape, protectedPasteShapeIdsRef } =
			renderResolution();
		const resolution = currentResolution(seen);

		act(() => {
			resolution.handleUiEvent("paste", { source: "kbd" });
			resolution.consumePasteIntent();
			resolution.handleAddedCards([shape], true);
		});

		expect(seen.current?.pending?.cards).toBe(1);
		expect(protectedPasteShapeIdsRef.current).toContain("shape:pasted");
		expect(restore).not.toHaveBeenCalled();
	});

	test("duplicates untrusted cards immediately and strips linkage props", async () => {
		const { editor, restore, seen, shape } = renderResolution({
			shape: card({ originWorkspaceId: "workspace:foreign" }),
		});
		const resolution = currentResolution(seen);

		act(() => {
			resolution.handleAddedCards([shape], true);
		});
		await act(async () => undefined);

		expect(editor.updateShape).toHaveBeenCalledWith(
			expect.objectContaining({
				props: expect.objectContaining({
					cardId: undefined,
					originWorkspaceId: undefined,
				}),
			}),
		);
		expect(restore).toHaveBeenCalledWith(
			expect.objectContaining({
				placement: "duplicate",
				sourceCardId: undefined,
				sourceWorkspaceId: undefined,
			}),
		);
	});

	test("resolves a pending batch as a duplicate only explicitly", async () => {
		const { editor, restore, seen, shape } = renderResolution();
		const resolution = currentResolution(seen);

		act(() => {
			resolution.handleAddedCards([shape], true);
		});
		await act(async () => {
			await resolution.resolvePending("duplicate");
		});

		expect(editor.updateShape).toHaveBeenCalled();
		expect(restore).toHaveBeenCalledWith(
			expect.objectContaining({ placement: "duplicate" }),
		);
		expect(seen.current?.pending).toBeNull();
	});

	test("drops a pending card that is deleted before resolution", async () => {
		const { restore, seen, shape, protectedPasteShapeIdsRef } =
			renderResolution();
		const resolution = currentResolution(seen);

		act(() => {
			resolution.handleAddedCards([shape], true);
			resolution.handleRemovedCards([shape.id]);
		});
		await act(async () => {
			await resolution.resolvePending("link");
		});

		expect(restore).not.toHaveBeenCalled();
		expect(seen.current?.pending).toBeNull();
		expect(protectedPasteShapeIdsRef.current).not.toContain(shape.id);
	});

	test("commits a pending batch as linked during cleanup", async () => {
		const { restore, seen, shape } = renderResolution();
		const resolution = currentResolution(seen);

		act(() => {
			resolution.handleAddedCards([shape], true);
		});
		await act(async () => {
			cleanup();
		});

		expect(restore).toHaveBeenCalledWith(
			expect.objectContaining({
				placement: "link",
				sourceCardId: "card:source",
				sourceWorkspaceId: "workspace:current",
			}),
		);
	});
});
