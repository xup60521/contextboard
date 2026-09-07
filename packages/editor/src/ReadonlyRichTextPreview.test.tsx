import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ReadonlyRichTextPreview } from "./ReadonlyRichTextPreview";

if (!("getClientRects" in Text.prototype)) {
	Object.defineProperty(Text.prototype, "getClientRects", {
		value: () => [new DOMRect()],
	});
}

if (!("getBoundingClientRect" in Text.prototype)) {
	Object.defineProperty(Text.prototype, "getBoundingClientRect", {
		value: () => new DOMRect(),
	});
}

if (typeof document.elementFromPoint !== "function") {
	Object.defineProperty(document, "elementFromPoint", {
		value: () => document.body,
	});
}

const PARAGRAPH_CONTENT: JSONContent = {
	type: "doc",
	content: [
		{
			type: "paragraph",
			content: [{ type: "text", text: "Hello world" }],
		},
	],
};

const HEADING_CONTENT: JSONContent = {
	type: "doc",
	content: [
		{
			type: "heading",
			attrs: { level: 2 },
			content: [{ type: "text", text: "Preview heading" }],
		},
	],
};

const CARD_REFERENCE_CONTENT: JSONContent = {
	type: "doc",
	content: [
		{
			type: "paragraph",
			content: [
				{
					type: "text",
					text: "My Card",
					marks: [
						{
							type: "link",
							attrs: {
								href: "/cards/abc123",
								cardId: "abc123",
								cardLabelMode: "auto",
								resolvedTitle: "My Card",
							},
						},
					],
				},
			],
		},
	],
};

const WHITEBOARD_REFERENCE_CONTENT: JSONContent = {
	type: "doc",
	content: [{
		type: "paragraph",
		content: [{
			type: "text",
			text: "My Board",
			marks: [{ type: "link", attrs: { href: "/whiteboard/board-1", whiteboardRefId: "board-1" } }],
		}],
	}],
};

afterEach(() => {
	cleanup();
});

/**
 * Node rendering lives in RichTextEditor and StaticRichTextRenderer tests. Only
 * the props this wrapper pins down are worth covering here.
 */
describe("ReadonlyRichTextPreview", () => {
	test("updates the rendered document when content changes", async () => {
		const { rerender } = render(
			<ReadonlyRichTextPreview content={PARAGRAPH_CONTENT} />,
		);

		await waitFor(() => {
			expect(screen.getByText("Hello world")).not.toBeNull();
		});

		rerender(<ReadonlyRichTextPreview content={HEADING_CONTENT} />);

		await waitFor(() => {
			expect(
				screen.getByRole("heading", { name: "Preview heading", level: 2 }),
			).not.toBeNull();
		});
	});

	test("does not expose contenteditable=true", async () => {
		const { container } = render(
			<ReadonlyRichTextPreview content={PARAGRAPH_CONTENT} />,
		);

		await waitFor(() => {
			const prosemirror = container.querySelector(".ProseMirror");
			expect(prosemirror).not.toBeNull();
			expect(prosemirror?.getAttribute("contenteditable")).toBe("false");
		});
	});

	test("opens card references on modifier click when preview support is provided", async () => {
		const onOpenPreview = vi.fn<(cardId: string) => void>();
		const search = vi.fn(async () => []);

		render(
			<ReadonlyRichTextPreview
				content={CARD_REFERENCE_CONTENT}
				cardReferenceSupport={{ search, onOpenPreview }}
			/>,
		);

		const link = await screen.findByRole("link", { name: "My Card" });
		expect(link.getAttribute("data-card-id")).toBe("abc123");
		fireEvent.mouseDown(link, { ctrlKey: true });
		fireEvent.mouseUp(link, { ctrlKey: true });
		fireEvent.click(link, { ctrlKey: true });

		expect(onOpenPreview).toHaveBeenCalledWith("abc123");
	});

	test("opens whiteboard references without opening a card preview", async () => {
		const onOpenPreview = vi.fn<(cardId: string) => void>();
		const onOpenWhiteboard = vi.fn<(whiteboardId: string) => void>();
		const search = vi.fn(async () => []);
		render(
			<ReadonlyRichTextPreview
				content={WHITEBOARD_REFERENCE_CONTENT}
				cardReferenceSupport={{ search, onOpenPreview, onOpenWhiteboard }}
			/>,
		);
		const link = await screen.findByRole("link", { name: "My Board" });
		fireEvent.mouseDown(link, { ctrlKey: true });
		fireEvent.mouseUp(link, { ctrlKey: true });
		fireEvent.click(link, { ctrlKey: true });
		expect(onOpenWhiteboard).toHaveBeenCalledWith("board-1");
		expect(onOpenPreview).not.toHaveBeenCalled();
	});
});
