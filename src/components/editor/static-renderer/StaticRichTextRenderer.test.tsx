import { Node, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { renderToReactElement } from "@tiptap/static-renderer/pm/react";
import { StaticRichTextRenderer } from "./StaticRichTextRenderer";
import {
	STATIC_RENDERER_BASIC_FIXTURE,
	STATIC_RENDERER_EDGE_FIXTURE,
	STATIC_RENDERER_FULL_FIXTURE,
} from "./staticRendererFixtures";
import { createStaticRendererOptions } from "./staticRendererMappings";

afterEach(() => {
	cleanup();
});

describe("StaticRichTextRenderer", () => {
	test("renders without mounting ProseMirror", () => {
		const { container } = render(
			<StaticRichTextRenderer content={STATIC_RENDERER_BASIC_FIXTURE} />,
		);

		expect(container.querySelector(".ProseMirror")).toBeNull();
		expect(container.querySelector("[contenteditable]")).toBeNull();
		expect(
			container.querySelector("[data-static-rich-text-renderer='true']"),
		).not.toBeNull();
		expect(container.querySelector(".rich-text-editor-shell")).not.toBeNull();
	});

	test("renders headings and paragraphs", () => {
		render(<StaticRichTextRenderer content={STATIC_RENDERER_BASIC_FIXTURE} />);

		expect(
			screen.getByRole("heading", { name: "Static renderer", level: 1 }),
		).not.toBeNull();
		expect(screen.getByText("Hello world")).not.toBeNull();
	});

	test("renders common marks", () => {
		const { container } = render(
			<StaticRichTextRenderer content={STATIC_RENDERER_FULL_FIXTURE} />,
		);

		expect(container.querySelector("strong")?.textContent).toBe("bold");
		expect(container.querySelector("em")?.textContent).toBe("italic");
		expect(container.querySelector("u")?.textContent).toBe("underline");
		expect(container.querySelector("s")?.textContent).toBe("strike");
		expect(container.querySelector("code")?.textContent).toContain("code");
	});

	test("renders external links", () => {
		render(<StaticRichTextRenderer content={STATIC_RENDERER_FULL_FIXTURE} />);

		const link = screen.getByRole("link", { name: "External link" });
		expect(link.getAttribute("href")).toBe("https://example.com");
		expect(link.getAttribute("target")).toBe("_blank");
	});

	test("preserves card reference link metadata", () => {
		render(<StaticRichTextRenderer content={STATIC_RENDERER_FULL_FIXTURE} />);

		const link = screen.getByRole("link", { name: "card reference" });
		expect(link.getAttribute("href")).toBe("/cards/abc123");
		expect(link.getAttribute("data-card-id")).toBe("abc123");
		expect(link.getAttribute("data-card-label-mode")).toBe("auto");
		expect(link.getAttribute("data-resolved-title")).toBe("Card reference");
	});

	test("opens card reference callback on ctrl click", () => {
		const onOpenCardPreview = vi.fn();

		render(
			<StaticRichTextRenderer
				content={STATIC_RENDERER_FULL_FIXTURE}
				onOpenCardPreview={onOpenCardPreview}
			/>,
		);

		const link = screen.getByRole("link", { name: "card reference" });
		fireEvent.click(link, { ctrlKey: true });

		expect(onOpenCardPreview).toHaveBeenCalledWith("abc123");
	});

	test("opens card reference callback on meta click", () => {
		const onOpenCardPreview = vi.fn();

		render(
			<StaticRichTextRenderer
				content={STATIC_RENDERER_FULL_FIXTURE}
				onOpenCardPreview={onOpenCardPreview}
			/>,
		);

		const link = screen.getByRole("link", { name: "card reference" });
		fireEvent.click(link, { metaKey: true });

		expect(onOpenCardPreview).toHaveBeenCalledWith("abc123");
	});

	test("does not open card reference callback on plain click", () => {
		const onOpenCardPreview = vi.fn();

		render(
			<StaticRichTextRenderer
				content={STATIC_RENDERER_FULL_FIXTURE}
				onOpenCardPreview={onOpenCardPreview}
			/>,
		);

		const link = screen.getByRole("link", { name: "card reference" });
		fireEvent.click(link);

		expect(onOpenCardPreview).not.toHaveBeenCalled();
	});

	test("renders tables without editor overlays", () => {
		const { container } = render(
			<StaticRichTextRenderer content={STATIC_RENDERER_FULL_FIXTURE} />,
		);

		expect(container.querySelector(".tableWrapper")).not.toBeNull();
		expect(container.querySelector("table")).not.toBeNull();
		expect(screen.getByText("Name")).not.toBeNull();
		expect(screen.getByText("Alpha")).not.toBeNull();
		expect(screen.queryByTestId("table-handles-overlay")).toBeNull();
	});

	test("renders details content", () => {
		const { container } = render(
			<StaticRichTextRenderer content={STATIC_RENDERER_FULL_FIXTURE} />,
		);

		const details = container.querySelector('[data-type="details"]');
		expect(details).not.toBeNull();
		expect(details?.tagName).toBe("DIV");
		expect(details?.querySelector("button")?.getAttribute("data-state")).toBe(
			"open",
		);
		expect(screen.getByText("More info")).not.toBeNull();
		expect(screen.getByText("Hidden answer")).not.toBeNull();
	});

	test("renders images with editor image class and file id", () => {
		const { container } = render(
			<StaticRichTextRenderer content={STATIC_RENDERER_FULL_FIXTURE} />,
		);

		const image = container.querySelector("img.editor-image");
		expect(image).not.toBeNull();
		expect(image?.getAttribute("alt")).toBe("Placeholder image");
		expect(image?.getAttribute("data-file-id")).toBe("file_demo");
	});

	test("renders math nodes", () => {
		const { container } = render(
			<StaticRichTextRenderer content={STATIC_RENDERER_FULL_FIXTURE} />,
		);

		expect(container.querySelector('[data-type="inline-math"]')).not.toBeNull();
		expect(container.querySelector('[data-type="block-math"]')).not.toBeNull();
	});

	test("does not render unsafe javascript href", () => {
		const { container } = render(
			<StaticRichTextRenderer content={STATIC_RENDERER_EDGE_FIXTURE} />,
		);

		const link = container.querySelector("a");
		expect(link).not.toBeNull();
		if (!link) {
			throw new Error("Expected an anchor to be rendered");
		}

		expect(link.getAttribute("href")).not.toBe("javascript:alert(1)");
	});

	test("renders empty content without crashing", () => {
		const { container } = render(<StaticRichTextRenderer content={null} />);

		expect(
			container.querySelector("[data-static-rich-text-renderer='true']"),
		).not.toBeNull();
		expect(container.querySelector(".ProseMirror")).toBeNull();
	});

	test("uses unhandled node fallback for schema-known custom nodes", () => {
		const CustomNode = Node.create({
			name: "customStaticRendererNode",
			group: "block",
			content: "text*",
		});

		const element = renderToReactElement({
			extensions: [StarterKit, CustomNode],
			content: {
				type: "doc",
				content: [
					{
						type: "customStaticRendererNode",
						content: [{ type: "text", text: "fallback" }],
					},
				],
			} satisfies JSONContent,
			options: createStaticRendererOptions({}),
		});

		const { container } = render(element);

		expect(container.querySelector("[data-unhandled-node-type]")).not.toBeNull();
		expect(screen.getByText("[Unhandled node: customStaticRendererNode]")).not.toBeNull();
	});
});
