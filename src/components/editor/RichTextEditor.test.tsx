"use client";

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, test, vi } from "vitest";
import { RichTextEditor } from "./RichTextEditor";

function setup(initialContent?: JSONContent) {
	const onChange = vi.fn<(value: JSONContent) => void>();
	const { container } = render(
		<RichTextEditor
			content={initialContent}
			onChange={onChange}
			editable={true}
		/>,
	);
	return { container, onChange };
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
	});

	test("handles empty paste gracefully", async () => {
		const { container, onChange } = setup();

		await paste(container, "");

		await waitFor(() => expect(onChange).toHaveBeenCalled());

		const doc = getLatestDocument(onChange);
		expect(doc?.content).toEqual([{ type: "paragraph" }]);
	});
});
