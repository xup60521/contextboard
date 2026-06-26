"use client";

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, test, vi } from "vitest";
import { RichTextEditor } from "./RichTextEditor";

const INITIAL_CONTENT: JSONContent = {
	type: "doc",
	content: [
		{
			type: "paragraph",
			content: [{ type: "text", text: "Alpha Beta Gamma" }],
		},
	],
};

function setup(initialContent?: JSONContent) {
	const onChange = vi.fn<(value: JSONContent) => void>();
	const result = render(
		<RichTextEditor
			content={initialContent}
			onChange={onChange}
			editable={true}
		/>,
	);
	return { ...result, onChange };
}

async function paste(container: HTMLElement, text: string) {
	let editor: Element | null = null;

	await waitFor(() => {
		editor = container.querySelector(".ProseMirror[contenteditable='true']");
		expect(editor).not.toBeNull();
	});

	const editorElement = editor;
	if (!editorElement) {
		throw new Error("TipTap editor was not rendered");
	}

	fireEvent.paste(editorElement, {
		clipboardData: {
			files: [],
			getData: (type: string) => (type === "text/plain" ? text : ""),
		},
	});
}

function getLatestDocument(onChange: ReturnType<typeof setup>["onChange"]) {
	const latestCall = onChange.mock.calls.at(-1);
	expect(latestCall).toBeDefined();
	return latestCall?.[0];
}

function findNode(
	content: JSONContent | JSONContent[] | undefined,
	predicate: (node: JSONContent) => boolean,
): JSONContent | undefined {
	if (!content) return undefined;

	const nodes = Array.isArray(content) ? content : [content];

	for (const node of nodes) {
		if (predicate(node)) return node;

		const match = findNode(node.content, predicate);
		if (match) return match;
	}

	return undefined;
}

function findTextNodeWithMark(
	content: JSONContent | JSONContent[] | undefined,
	markType: string,
): JSONContent | undefined {
	return findNode(content, (node) =>
		Boolean(node.text && node.marks?.some((mark) => mark.type === markType)),
	);
}

afterEach(() => {
	cleanup();
});

function selectNodeText(node: Node) {
	const selection = window.getSelection();
	expect(selection).not.toBeNull();
	if (!selection) {
		throw new Error("window.getSelection() returned null");
	}

	const range = document.createRange();
	range.selectNodeContents(node);
	selection.removeAllRanges();
	selection.addRange(range);
	return selection;
}

describe("RichTextEditor - Markdown paste functionality", () => {
	test("converts markdown to TipTap nodes when pasted", async () => {
		const { container, onChange } = setup();

		await paste(
			container,
			`# Heading

This is a **bold** text and *italic* text.

- List item 1
- List item 2

[Link text](https://example.com)`,
		);

		await waitFor(() => expect(onChange).toHaveBeenCalled());

		const doc = getLatestDocument(onChange);
		expect(
			findNode(
				doc?.content,
				(node) => node.type === "heading" && node.attrs?.level === 1,
			),
		).toMatchObject({
			type: "heading",
			attrs: { level: 1 },
			content: [{ type: "text", text: "Heading" }],
		});

		expect(findTextNodeWithMark(doc?.content, "bold")).toMatchObject({
			type: "text",
			text: "bold",
		});
		expect(findTextNodeWithMark(doc?.content, "italic")).toMatchObject({
			type: "text",
			text: "italic",
		});
		expect(
			findNode(doc?.content, (node) => node.type === "bulletList"),
		).toBeDefined();
		expect(findTextNodeWithMark(doc?.content, "link")).toMatchObject({
			type: "text",
			text: "Link text",
			marks: [
				expect.objectContaining({
					type: "link",
					attrs: expect.objectContaining({ href: "https://example.com" }),
				}),
			],
		});
	});

	test("keeps plain text as a paragraph when pasted", async () => {
		const { container, onChange } = setup();

		await paste(container, "Just plain text without markdown formatting");

		await waitFor(() => expect(onChange).toHaveBeenCalled());

		const doc = getLatestDocument(onChange);
		expect(doc?.content).toEqual([
			{
				type: "paragraph",
				content: [
					{ type: "text", text: "Just plain text without markdown formatting" },
				],
			},
		]);
		expect(
			findNode(doc?.content, (node) => node.type === "heading"),
		).toBeUndefined();
	});

	test("converts dollar-delimited math when pasted", async () => {
		const { container, onChange } = setup();

		await paste(
			container,
			`The inline formula is $E = mc^2$.

$$
\\int_0^1 x^2\\,dx
$$`,
		);

		await waitFor(() => expect(onChange).toHaveBeenCalled());

		const doc = getLatestDocument(onChange);
		expect(
			findNode(
				doc?.content,
				(node) =>
					node.type === "inlineMath" && node.attrs?.latex === "E = mc^2",
			),
		).toMatchObject({
			type: "inlineMath",
			attrs: { latex: "E = mc^2" },
		});
		expect(
			findNode(
				doc?.content,
				(node) =>
					node.type === "blockMath" &&
					node.attrs?.latex === "\\int_0^1 x^2\\,dx",
			),
		).toMatchObject({
			type: "blockMath",
			attrs: { latex: "\\int_0^1 x^2\\,dx" },
		});
		expect(container.querySelector("textarea")).toBeNull();
	});

	test("converts markdown tables when pasted", async () => {
		const { container, onChange } = setup();

		await paste(
			container,
			`| Name | Value |
| --- | --- |
| Alpha | 1 |
| Beta | 2 |`,
		);

		await waitFor(() => expect(onChange).toHaveBeenCalled());

		const doc = getLatestDocument(onChange);
		expect(
			findNode(doc?.content, (node) => node.type === "table"),
		).toBeDefined();
		expect(
			findNode(doc?.content, (node) => node.type === "tableHeader"),
		).toMatchObject({
			type: "tableHeader",
			content: [
				{
					type: "paragraph",
					content: [{ type: "text", text: "Name" }],
				},
			],
		});
		expect(
			findNode(
				doc?.content,
				(node) =>
					node.type === "text" && (node.text === "Alpha" || node.text === "2"),
			),
		).toBeDefined();
	});

	test("converts details dropdown blocks when pasted", async () => {
		const { container, onChange } = setup();

		await paste(
			container,
			`:::details More info
Hidden **bold** answer.
:::`,
		);

		await waitFor(() => expect(onChange).toHaveBeenCalled());

		const doc = getLatestDocument(onChange);
		expect(
			findNode(doc?.content, (node) => node.type === "details"),
		).toMatchObject({
			type: "details",
			attrs: { open: true },
		});
		expect(
			findNode(doc?.content, (node) => node.type === "detailsSummary"),
		).toMatchObject({
			type: "detailsSummary",
			content: [{ type: "text", text: "More info" }],
		});
		expect(
			findNode(doc?.content, (node) => node.type === "detailsContent"),
		).toBeDefined();
		expect(findTextNodeWithMark(doc?.content, "bold")).toMatchObject({
			type: "text",
			text: "bold",
		});
	});

	test("handles empty paste gracefully", async () => {
		const { container, onChange } = setup();

		await paste(container, "");

		await waitFor(() => expect(onChange).toHaveBeenCalled());

		const doc = getLatestDocument(onChange);
		expect(doc?.content).toEqual([{ type: "paragraph" }]);
	});

	test("clears editor selection when editable becomes false", async () => {
		const { container, rerender } = render(
			<RichTextEditor content={INITIAL_CONTENT} editable={true} />,
		);

		const editorElement = await waitFor(() => {
			const element = container.querySelector<HTMLElement>(
				".ProseMirror[contenteditable='true']",
			);
			expect(element).not.toBeNull();
			if (!element) {
				throw new Error("Editable editor was not rendered");
			}
			return element;
		});

		const textNode = editorElement?.querySelector("p")?.firstChild;
		expect(textNode).not.toBeNull();
		if (!textNode) {
			throw new Error("Editor paragraph text node was not rendered");
		}

		const selection = selectNodeText(textNode);
		expect(selection.rangeCount).toBe(1);

		rerender(<RichTextEditor content={INITIAL_CONTENT} editable={false} />);

		await waitFor(() => {
			expect(editorElement.getAttribute("contenteditable")).toBe("false");
			expect(window.getSelection()?.rangeCount ?? 0).toBe(0);
		});
	});

	test("does not clear selection outside the editor when editable becomes false", async () => {
		const { container, rerender } = render(
			<div>
				<RichTextEditor content={INITIAL_CONTENT} editable={true} />
				<p data-testid="outside">Outside selection</p>
			</div>,
		);

		const editorElement = await waitFor(() => {
			const element = container.querySelector<HTMLElement>(
				".ProseMirror[contenteditable='true']",
			);
			expect(element).not.toBeNull();
			if (!element) {
				throw new Error("Editable editor was not rendered");
			}
			return element;
		});

		const outsideTextNode = container.querySelector(
			'[data-testid="outside"]',
		)?.firstChild;
		expect(outsideTextNode).not.toBeNull();
		if (!outsideTextNode) {
			throw new Error("Outside text node was not rendered");
		}

		const selection = selectNodeText(outsideTextNode);
		expect(selection.rangeCount).toBe(1);
		expect(selection.toString()).toBe("Outside selection");

		rerender(
			<div>
				<RichTextEditor content={INITIAL_CONTENT} editable={false} />
				<p data-testid="outside">Outside selection</p>
			</div>,
		);

		await waitFor(() => {
			expect(editorElement.getAttribute("contenteditable")).toBe("false");
		});
		expect(window.getSelection()?.rangeCount).toBe(1);
		expect(window.getSelection()?.toString()).toBe("Outside selection");
	});
});
