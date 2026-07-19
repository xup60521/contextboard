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

const INLINE_MATH_CONTENT: JSONContent = {
	type: "doc",
	content: [
		{
			type: "paragraph",
			content: [
				{ type: "text", text: "Formula: " },
				{
					type: "inlineMath",
					attrs: { latex: "E=mc^2" },
				},
			],
		},
	],
};

const TABLE_CONTENT: JSONContent = {
	type: "doc",
	content: [
		{
			type: "table",
			content: [
				{
					type: "tableRow",
					content: [
						{
							type: "tableHeader",
							content: [
								{
									type: "paragraph",
									content: [{ type: "text", text: "Name" }],
								},
							],
						},
						{
							type: "tableHeader",
							content: [
								{
									type: "paragraph",
									content: [{ type: "text", text: "Value" }],
								},
							],
						},
					],
				},
				{
					type: "tableRow",
					content: [
						{
							type: "tableCell",
							content: [
								{
									type: "paragraph",
									content: [{ type: "text", text: "Alpha" }],
								},
							],
						},
						{
							type: "tableCell",
							content: [
								{
									type: "paragraph",
									content: [{ type: "text", text: "1" }],
								},
							],
						},
					],
				},
			],
		},
	],
};

const DETAILS_CONTENT: JSONContent = {
	type: "doc",
	content: [
		{
			type: "details",
			attrs: { open: true },
			content: [
				{
					type: "detailsSummary",
					content: [{ type: "text", text: "More info" }],
				},
				{
					type: "detailsContent",
					content: [
						{
							type: "paragraph",
							content: [{ type: "text", text: "Hidden answer" }],
						},
					],
				},
			],
		},
	],
};

const IMAGE_CONTENT: JSONContent = {
	type: "doc",
	content: [
		{
			type: "image",
			attrs: {
				src: "https://example.com/image.png",
				alt: "Preview image",
			},
		},
	],
};

const LINK_CONTENT: JSONContent = {
	type: "doc",
	content: [
		{
			type: "paragraph",
			content: [
				{
					type: "text",
					text: "Example",
					marks: [
						{
							type: "link",
							attrs: { href: "https://example.com" },
						},
					],
				},
			],
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

afterEach(() => {
	cleanup();
});

describe("ReadonlyRichTextPreview", () => {
	test("renders plain paragraphs", async () => {
		render(<ReadonlyRichTextPreview content={PARAGRAPH_CONTENT} />);

		await waitFor(() => {
			expect(screen.getByText("Hello world")).not.toBeNull();
		});
	});

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

	test("renders headings", async () => {
		render(<ReadonlyRichTextPreview content={HEADING_CONTENT} />);

		await waitFor(() => {
			expect(
				screen.getByRole("heading", { name: "Preview heading", level: 2 }),
			).not.toBeNull();
		});
	});

	test("renders tables without table-handle controls", async () => {
		const { container } = render(
			<ReadonlyRichTextPreview content={TABLE_CONTENT} />,
		);

		await waitFor(() => {
			expect(container.querySelector("table")).not.toBeNull();
			expect(screen.getByText("Name")).not.toBeNull();
			expect(screen.getByText("Alpha")).not.toBeNull();
			expect(screen.queryByTestId("table-handles-overlay")).toBeNull();
		});
	});

	test("renders details blocks in persisted open state", async () => {
		render(<ReadonlyRichTextPreview content={DETAILS_CONTENT} />);

		await waitFor(() => {
			expect(screen.getByText("More info")).not.toBeNull();
			expect(screen.getByText("Hidden answer")).not.toBeNull();
		});
	});

	test("renders images", async () => {
		const { container } = render(
			<ReadonlyRichTextPreview content={IMAGE_CONTENT} />,
		);

		await waitFor(() => {
			const image = container.querySelector("img[alt='Preview image']");
			expect(image).not.toBeNull();
			expect(image?.getAttribute("src")).toBe("https://example.com/image.png");
		});
	});

	test("renders external links", async () => {
		render(<ReadonlyRichTextPreview content={LINK_CONTENT} />);

		await waitFor(() => {
			const link = screen.getByRole("link", { name: "Example" });
			expect(link).not.toBeNull();
			expect(link.getAttribute("href")).toBe("https://example.com");
		});
	});

	test("renders card-reference link marks", async () => {
		render(<ReadonlyRichTextPreview content={CARD_REFERENCE_CONTENT} />);

		await waitFor(() => {
			const link = screen.getByRole("link", { name: "My Card" });
			expect(link).not.toBeNull();
			expect(link.getAttribute("href")).toBe("/cards/abc123");
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

	test("does not open the math editor in readonly mode", async () => {
		const { container } = render(
			<ReadonlyRichTextPreview content={INLINE_MATH_CONTENT} />,
		);

		const inlineMath = await waitFor(() => {
			const element = container.querySelector<HTMLElement>(
				'[data-type="inline-math"]',
			);
			expect(element).not.toBeNull();
			if (!element) {
				throw new Error("Inline math was not rendered");
			}
			return element;
		});

		fireEvent.click(inlineMath);
		expect(screen.queryByText("Inline math - LaTeX")).toBeNull();
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

	test("renders with custom className", async () => {
		const { container } = render(
			<ReadonlyRichTextPreview
				content={PARAGRAPH_CONTENT}
				className="custom-class"
			/>,
		);

		await waitFor(() => {
			expect(container.querySelector(".custom-class")).not.toBeNull();
		});
	});

	test("renders empty content gracefully", async () => {
		const { container } = render(<ReadonlyRichTextPreview content={null} />);

		await waitFor(() => {
			const prosemirror = document.querySelector(".ProseMirror");
			expect(prosemirror).not.toBeNull();
			expect(container.querySelector(".is-editor-empty")).toBeNull();
		});
	});
});
