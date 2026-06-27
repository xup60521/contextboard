import { render, screen } from "@testing-library/react";
import type { JSONContent } from "@tiptap/core";
import { describe, expect, test } from "vitest";
import { CardContentPreview } from "./CardContentPreview";

const PREVIEW_CONTENT: JSONContent = {
	type: "doc",
	content: [
		{
			type: "heading",
			attrs: { level: 2 },
			content: [{ type: "text", text: "Preview heading" }],
		},
		{
			type: "paragraph",
			content: [
				{ type: "text", text: "Read " },
				{
					type: "text",
					text: "this",
					marks: [{ type: "bold" }],
				},
				{ type: "text", text: " and visit " },
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
				{ type: "text", text: "." },
			],
		},
		{
			type: "bulletList",
			content: [
				{
					type: "listItem",
					content: [
						{
							type: "paragraph",
							content: [{ type: "text", text: "Alpha" }],
						},
					],
				},
			],
		},
		{
			type: "blockquote",
			content: [
				{
					type: "paragraph",
					content: [{ type: "text", text: "Quoted" }],
				},
			],
		},
		{
			type: "codeBlock",
			content: [{ type: "text", text: "const value = 1;" }],
		},
		{
			type: "inlineMath",
			attrs: { latex: "E=mc^2" },
		},
		{
			type: "blockMath",
			attrs: { latex: "\\int_0^1 x^2 dx" },
		},
		{
			type: "image",
			attrs: {
				src: "https://example.com/image.png",
				alt: "Preview image",
			},
		},
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

describe("CardContentPreview", () => {
	test("renders representative TipTap JSON without mounting ProseMirror", () => {
		const { container } = render(
			<CardContentPreview content={PREVIEW_CONTENT} />,
		);

		expect(
			screen.getByRole("heading", { name: "Preview heading", level: 2 }),
		).not.toBeNull();
		expect(screen.getByText("Quoted")).not.toBeNull();
		expect(screen.getByText("const value = 1;")).not.toBeNull();
		expect(screen.getByText("$E=mc^2$")).not.toBeNull();
		expect(screen.getByText("More info")).not.toBeNull();
		expect(screen.getByText("Hidden answer")).not.toBeNull();
		expect(screen.getByRole("img", { name: "Preview image" })).not.toBeNull();
		expect(
			screen.getByRole("link", { name: "Example" }).getAttribute("href"),
		).toBe("https://example.com");
		expect(container.querySelector("table")).not.toBeNull();
		expect(container.querySelector(".ProseMirror")).toBeNull();
	});
});
