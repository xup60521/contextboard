import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { TLShapeId } from "tldraw";
import type { Id } from "#/integrations/local/types";
import {
	clearCardContentDirty,
	markCardContentDirty,
} from "../dirty-card-content";
import { useVisibleCardContentHydration } from "./useVisibleCardContentHydration";

const queryMock = vi.fn();

vi.mock("#/integrations/local/react", () => ({
	useLocalClient: () => ({
		query: queryMock,
	}),
}));

vi.mock("tldraw", () => ({
	react: (_name: string, fn: () => void) => {
		fn();
		return () => {};
	},
}));

type FakeShape = {
	id: string;
	type: "markdown-card";
	x: number;
	y: number;
	rotation: number;
	props: {
		w: number;
		h: number;
		content: string;
		cardId?: string;
		title?: string;
		preview?: string;
		contentLoaded?: boolean;
		contentVersion?: number;
	};
};

function createEditor(shape: FakeShape, culledShapeIds: string[] = []) {
	const shapes = [shape];
	let editingShapeId: string | null = null;

	return {
		editor: {
			getShape: vi.fn((shapeId: string) =>
				shapes.find((candidate) => candidate.id === shapeId),
			),
			getCurrentPageShapes: vi.fn(() => shapes),
			getCurrentPageShapesSorted: vi.fn(() => shapes),
			getCulledShapes: vi.fn(() => new Set(culledShapeIds)),
			getEditingShapeId: vi.fn(() => editingShapeId),
			select: vi.fn((shapeId: string) => {
				editingShapeId = shapeId;
			}),
			setEditingShape: vi.fn((shapeId: string | null) => {
				editingShapeId = shapeId;
			}),
			run: vi.fn((fn: () => void) => fn()),
			updateShapes: vi.fn((updates: FakeShape[]) => {
				for (const update of updates) {
					const index = shapes.findIndex((candidate) => candidate.id === update.id);
					if (index >= 0) {
						shapes[index] = update;
					}
				}
			}),
		},
		getShapeSnapshot: () => shapes[0],
	};
}

function Harness({
	editor,
	items,
	onReady,
}: {
	editor: ReturnType<typeof createEditor>["editor"];
	items: Array<{
		_id: string;
		kind: "card";
		cardId: Id<"cards">;
		childWhiteboardId: null;
		shapeId: string;
		x: number;
		y: number;
		w: number;
		h: number;
		rotation: number;
		zIndex: number;
		card: {
			_id: Id<"cards">;
			derivedTitle: string;
			preview: string;
			version: number;
		};
		childWhiteboard: null;
	}>;
	onReady?: (
		prioritizeCardContent: (shapeId: TLShapeId, cardId: Id<"cards">) => void,
	) => void;
	children?: ReactNode;
}) {
	const pendingEditShapeIdRef = { current: null as TLShapeId | null };
	const { prioritizeCardContent } = useVisibleCardContentHydration({
		editor: editor as never,
		items: items as never,
		loadedDrawingKey: "whiteboard-1",
		whiteboardKey: "whiteboard-1",
		pendingEditShapeIdRef,
	});

	useEffect(() => {
		onReady?.(prioritizeCardContent);
	}, [onReady, prioritizeCardContent]);

	return null;
}

describe("useVisibleCardContentHydration", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		queryMock.mockReset();
	});

	afterEach(() => {
		vi.runOnlyPendingTimers();
		vi.useRealTimers();
		clearCardContentDirty("card-1" as Id<"cards">);
	});

	test("fetches visible unloaded cards and hydrates their shapes", async () => {
		const { editor, getShapeSnapshot } = createEditor({
			id: "shape:card-1",
			type: "markdown-card",
			x: 0,
			y: 0,
			rotation: 0,
			props: {
				w: 320,
				h: 160,
				content: "",
				cardId: "card-1",
				title: "Alpha",
				preview: "Preview",
				contentLoaded: false,
				contentVersion: 2,
			},
		});

		queryMock.mockResolvedValue([
			{
				cardId: "card-1",
				content: { type: "doc", content: [{ type: "paragraph" }] },
				version: 2,
			},
		]);

		render(
			<Harness
				editor={editor}
				items={[
					{
						_id: "item-1",
						kind: "card",
						cardId: "card-1" as Id<"cards">,
						childWhiteboardId: null,
						shapeId: "shape:card-1",
						x: 0,
						y: 0,
						w: 320,
						h: 160,
						rotation: 0,
						zIndex: 1,
						card: {
							_id: "card-1" as Id<"cards">,
							derivedTitle: "Alpha",
							preview: "Preview",
							version: 2,
						},
						childWhiteboard: null,
					},
				]}
			/>,
		);

		await vi.runAllTimersAsync();

		expect(queryMock).toHaveBeenCalledTimes(1);
		expect(queryMock.mock.calls[0]?.[1]).toEqual({
			cardIds: ["card-1"],
		});
		expect(getShapeSnapshot()?.props.contentLoaded).toBe(true);
		expect(getShapeSnapshot()?.props.contentVersion).toBe(2);
		expect(getShapeSnapshot()?.props.content).toContain('"type":"doc"');
	});

	test("skips cards with unsaved local edits", async () => {
		const { editor, getShapeSnapshot } = createEditor({
			id: "shape:card-1",
			type: "markdown-card",
			x: 0,
			y: 0,
			rotation: 0,
			props: {
				w: 320,
				h: 160,
				content: '{"type":"doc","content":[{"type":"paragraph"}]}',
				cardId: "card-1",
				title: "Alpha",
				preview: "Preview",
				contentLoaded: false,
				contentVersion: 1,
			},
		});

		// Card has been edited locally but not yet persisted (newer than its
		// version). Hydration must not run for it — doing so would clobber the
		// unsaved content and re-trigger the reactive in a loop.
		markCardContentDirty("card-1" as Id<"cards">);

		render(
			<Harness
				editor={editor}
				items={[
					{
						_id: "item-1",
						kind: "card",
						cardId: "card-1" as Id<"cards">,
						childWhiteboardId: null,
						shapeId: "shape:card-1",
						x: 0,
						y: 0,
						w: 320,
						h: 160,
						rotation: 0,
						zIndex: 1,
						card: {
							_id: "card-1" as Id<"cards">,
							derivedTitle: "Alpha",
							preview: "Preview",
							version: 2,
						},
						childWhiteboard: null,
					},
				]}
			/>,
		);

		await vi.runAllTimersAsync();

		expect(queryMock).not.toHaveBeenCalled();
		expect(editor.updateShapes).not.toHaveBeenCalled();
		expect(getShapeSnapshot()?.props.content).toContain('"type":"doc"');
	});

	test("prioritized cards enter edit mode after content loads", async () => {
		const { editor } = createEditor(
			{
				id: "shape:card-1",
				type: "markdown-card",
				x: 0,
				y: 0,
				rotation: 0,
				props: {
					w: 320,
					h: 160,
					content: "",
					cardId: "card-1",
					title: "Alpha",
					preview: "Preview",
					contentLoaded: false,
					contentVersion: 3,
				},
			},
			["shape:card-1"],
		);

		queryMock.mockResolvedValue([
			{
				cardId: "card-1",
				content: { type: "doc", content: [{ type: "paragraph" }] },
				version: 3,
			},
		]);

		let prioritize:
			| ((shapeId: TLShapeId, cardId: Id<"cards">) => void)
			| undefined;
		render(
			<Harness
				editor={editor}
				items={[
					{
						_id: "item-1",
						kind: "card",
						cardId: "card-1" as Id<"cards">,
						childWhiteboardId: null,
						shapeId: "shape:card-1",
						x: 0,
						y: 0,
						w: 320,
						h: 160,
						rotation: 0,
						zIndex: 1,
						card: {
							_id: "card-1" as Id<"cards">,
							derivedTitle: "Alpha",
							preview: "Preview",
							version: 3,
						},
						childWhiteboard: null,
					},
				]}
				onReady={(callback) => {
					prioritize = callback;
				}}
			/>,
		);

		prioritize?.("shape:card-1" as TLShapeId, "card-1" as Id<"cards">);
		await vi.runAllTimersAsync();

		expect(editor.select).toHaveBeenCalledWith("shape:card-1");
		expect(editor.setEditingShape).toHaveBeenCalledWith("shape:card-1");
	});
});
