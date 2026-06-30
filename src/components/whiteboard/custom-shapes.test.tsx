import { cleanup, render, screen } from "@testing-library/react";
import type { JSONContent } from "@tiptap/core";
import type React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { MarkdownCardComponent, type MarkdownCardShape } from "./custom-shapes";

let isEditing = false;
const editorMock = {
	updateShape: vi.fn(),
	setEditingShape: vi.fn(),
	getEditingShapeId: vi.fn(() => null),
};

let cardDocumentEditorProps: Record<string, unknown> | null = null;
let richTextEditorProps: Record<string, unknown> | null = null;
let staticRendererProps: Record<string, unknown> | null = null;
const useDebouncedCardSaveMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, ...props }: Record<string, unknown>) => (
		<a {...props as React.ComponentPropsWithoutRef<"a">}>{children as React.ReactNode}</a>
	),
}));

vi.mock("convex/react", () => ({
	useMutation: () => vi.fn(),
}));

vi.mock("jotai", () => ({
	atom: vi.fn((value: unknown) => ({ init: value })),
	useSetAtom: () => vi.fn(),
}));

vi.mock("lucide-react", () => ({
	ExternalLink: () => <svg data-testid="external-link" />,
}));

vi.mock("#/components/cards/CardDocumentEditor", () => ({
	CardDocumentEditor: (props: Record<string, unknown>) => {
		cardDocumentEditorProps = props;
		return <div data-testid="card-document-editor" />;
	},
}));

vi.mock("#/components/cards/useDebouncedCardSave", () => ({
	useDebouncedCardSave: (...args: unknown[]) => useDebouncedCardSaveMock(...args),
}));

vi.mock("#/components/editor/RichTextEditor", () => ({
	RichTextEditor: (props: Record<string, unknown>) => {
		richTextEditorProps = props;
		return <div data-testid="rich-text-editor" />;
	},
}));

vi.mock("#/components/editor/static-renderer", () => ({
	StaticRichTextRenderer: (props: Record<string, unknown>) => {
		staticRendererProps = props;
		return <div data-testid="static-rich-text-renderer" />;
	},
}));

vi.mock("tldraw", () => {
	const scalar = {
		optional: () => scalar,
	};

	class MockBaseBoxShapeUtil {
		editor: unknown;

		constructor(editor: unknown) {
			this.editor = editor;
		}
	}

	return {
		BaseBoxShapeUtil: MockBaseBoxShapeUtil,
		createShapeId: vi.fn(() => "shape:generated"),
		HTMLContainer: ({ children, ...props }: Record<string, unknown>) => (
			<div {...props as React.ComponentPropsWithoutRef<"div">}>{children as React.ReactNode}</div>
		),
		Rectangle2d: class {},
		resizeBox: vi.fn((shape: unknown) => shape),
		stopEventPropagation: vi.fn(),
		T: {
			number: scalar,
			string: scalar,
			boolean: scalar,
		},
		useEditor: () => editorMock,
		useIsEditing: () => isEditing,
	};
});

const EMPTY_CARD_CONTENT: JSONContent = {
	type: "doc",
	content: [
		{
			type: "heading",
			attrs: { level: 1 },
			content: [{ type: "text", text: "New card" }],
		},
	],
};

const CONTENT_A: JSONContent = {
	type: "doc",
	content: [
		{
			type: "paragraph",
			content: [{ type: "text", text: "Alpha" }],
		},
	],
};

const CONTENT_B: JSONContent = {
	type: "doc",
	content: [
		{
			type: "paragraph",
			content: [{ type: "text", text: "Beta" }],
		},
	],
};

beforeAll(() => {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			disconnect() {}
		},
	);
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		callback(0);
		return 1;
	});
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

beforeEach(() => {
	isEditing = false;
	cardDocumentEditorProps = null;
	richTextEditorProps = null;
	staticRendererProps = null;
	useDebouncedCardSaveMock.mockReset();
	useDebouncedCardSaveMock.mockReturnValue({
		scheduleSave: vi.fn(),
		flushSave: vi.fn(),
	});
	editorMock.updateShape.mockReset();
	editorMock.setEditingShape.mockReset();
	editorMock.getEditingShapeId.mockReset();
	editorMock.getEditingShapeId.mockReturnValue(null);
});

afterEach(() => {
	cleanup();
});

function createShape(
	props: Partial<MarkdownCardShape["props"]> = {},
): MarkdownCardShape {
	return {
		id: "shape:card-1",
		type: "markdown-card",
		x: 0,
		y: 0,
		props: {
			w: 576,
			h: 160,
			content: JSON.stringify(CONTENT_A),
			contentLoaded: true,
			...props,
		},
	} as MarkdownCardShape;
}

describe("MarkdownCardComponent", () => {
	test("renders a summary shell for unloaded Convex-backed cards", () => {
		render(
			<MarkdownCardComponent
				shape={createShape({
					cardId: "card-1",
					content: "",
					contentLoaded: false,
					title: "Summary title",
					preview: "Summary preview",
				})}
			/>,
		);

		expect(screen.getByText("Loading card")).toBeTruthy();
		expect(screen.getByText("Summary title")).toBeTruthy();
		expect(screen.getByText("Summary preview")).toBeTruthy();
		expect(cardDocumentEditorProps).toBeNull();
		expect(staticRendererProps).toBeNull();
	});

	test("re-enters Convex-backed edit mode with the latest content", () => {
		const shapeA = createShape({
			cardId: "card-1",
			content: JSON.stringify(CONTENT_A),
			contentLoaded: true,
		});
		const shapeB = createShape({
			cardId: "card-1",
			content: JSON.stringify(CONTENT_B),
			contentLoaded: true,
		});

		isEditing = true;
		const { rerender } = render(<MarkdownCardComponent shape={shapeA} />);

		expect(cardDocumentEditorProps?.content).toEqual(CONTENT_A);

		isEditing = false;
		rerender(<MarkdownCardComponent shape={shapeB} />);

		expect(staticRendererProps?.content).toEqual(CONTENT_B);

		isEditing = true;
		rerender(<MarkdownCardComponent shape={shapeB} />);

		expect(cardDocumentEditorProps?.content).toEqual(CONTENT_B);
	});

	test("re-enters local edit mode with the latest content", () => {
		const shapeA = createShape({ content: JSON.stringify(CONTENT_A) });
		const shapeB = createShape({ content: JSON.stringify(CONTENT_B) });

		isEditing = true;
		const { rerender } = render(<MarkdownCardComponent shape={shapeA} />);

		expect(richTextEditorProps?.content).toEqual(CONTENT_A);

		isEditing = false;
		rerender(<MarkdownCardComponent shape={shapeB} />);

		expect(staticRendererProps?.content).toEqual(CONTENT_B);

		isEditing = true;
		rerender(<MarkdownCardComponent shape={shapeB} />);

		expect(richTextEditorProps?.content).toEqual(CONTENT_B);
	});

	test("updates placeholder focus behavior from empty to non-empty content", () => {
		const emptyShape = createShape({
			cardId: "card-1",
			content: JSON.stringify(EMPTY_CARD_CONTENT),
		});
		const filledShape = createShape({
			cardId: "card-1",
			content: JSON.stringify(CONTENT_B),
		});

		isEditing = true;
		const { rerender } = render(<MarkdownCardComponent shape={emptyShape} />);

		expect(cardDocumentEditorProps?.content).toEqual(EMPTY_CARD_CONTENT);
		expect(cardDocumentEditorProps?.defaultFocusPosition).toBe("start");
		expect(cardDocumentEditorProps?.selectContentOnFocus).toBe(true);

		isEditing = false;
		rerender(<MarkdownCardComponent shape={filledShape} />);

		isEditing = true;
		rerender(<MarkdownCardComponent shape={filledShape} />);

		expect(cardDocumentEditorProps?.content).toEqual(CONTENT_B);
		expect(cardDocumentEditorProps?.defaultFocusPosition).toBe("end");
		expect(cardDocumentEditorProps?.selectContentOnFocus).toBe(false);
	});

	test("passes the current persisted Convex card content into autosave", () => {
		isEditing = true;

		render(
			<MarkdownCardComponent
				shape={createShape({
					cardId: "card-1",
					content: JSON.stringify(CONTENT_A),
				})}
			/>,
		);

		expect(useDebouncedCardSaveMock).toHaveBeenCalledWith(
			"card-1",
			450,
			expect.objectContaining({
				initialContent: CONTENT_A,
				onPersisted: expect.any(Function),
			}),
		);
	});
});
