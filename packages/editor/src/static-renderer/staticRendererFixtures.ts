import type { JSONContent } from "@tiptap/core";

export const STATIC_RENDERER_BASIC_FIXTURE: JSONContent = {
	type: "doc",
	content: [
		{
			type: "heading",
			attrs: { level: 1 },
			content: [{ type: "text", text: "Static renderer" }],
		},
		{
			type: "paragraph",
			content: [{ type: "text", text: "Hello world" }],
		},
	],
};

export const STATIC_RENDERER_FULL_FIXTURE: JSONContent = {
	type: "doc",
	content: [
		{
			type: "heading",
			attrs: { level: 1 },
			content: [{ type: "text", text: "Static renderer parity fixture" }],
		},
		{
			type: "paragraph",
			content: [
				{ type: "text", text: "This paragraph has " },
				{ type: "text", text: "bold", marks: [{ type: "bold" }] },
				{ type: "text", text: ", " },
				{ type: "text", text: "italic", marks: [{ type: "italic" }] },
				{ type: "text", text: ", " },
				{ type: "text", text: "underline", marks: [{ type: "underline" }] },
				{ type: "text", text: ", " },
				{ type: "text", text: "strike", marks: [{ type: "strike" }] },
				{ type: "text", text: ", " },
				{ type: "text", text: "code", marks: [{ type: "code" }] },
				{ type: "text", text: ", and math " },
				{ type: "inlineMath", attrs: { latex: "E = mc^2" } },
				{ type: "text", text: "." },
			],
		},
		{
			type: "paragraph",
			content: [
				{
					type: "text",
					text: "External link",
					marks: [{ type: "link", attrs: { href: "https://example.com" } }],
				},
				{ type: "text", text: " and " },
				{
					type: "text",
					text: "card reference",
					marks: [
						{
							type: "link",
							attrs: {
								href: "/cards/abc123",
								cardId: "abc123",
								cardLabelMode: "auto",
								resolvedTitle: "Card reference",
							},
						},
					],
				},
			],
		},
		{
			type: "blockMath",
			attrs: { latex: "\\int_0^1 x^2\\,dx = \\frac{1}{3}" },
		},
		{
			type: "bulletList",
			content: [
				{
					type: "listItem",
					content: [
						{
							type: "paragraph",
							content: [{ type: "text", text: "Bullet item" }],
						},
					],
				},
			],
		},
		{
			type: "orderedList",
			attrs: { start: 3 },
			content: [
				{
					type: "listItem",
					content: [
						{
							type: "paragraph",
							content: [{ type: "text", text: "Ordered item" }],
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
					content: [{ type: "text", text: "Quoted text" }],
				},
			],
		},
		{
			type: "codeBlock",
			attrs: { language: "ts" },
			content: [{ type: "text", text: "const answer = 42;" }],
		},
		{
			type: "horizontalRule",
		},
		{
			type: "image",
			attrs: {
				src: "https://placehold.co/640x240",
				alt: "Placeholder image",
				title: "Placeholder",
				fileId: "file_demo",
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

export const STATIC_RENDERER_EDGE_FIXTURE: JSONContent = {
	type: "doc",
	content: [
		{
			type: "paragraph",
		},
		{
			type: "paragraph",
			content: [
				{
					type: "text",
					text: "Unsafe link",
					marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
				},
			],
		},
	],
};
