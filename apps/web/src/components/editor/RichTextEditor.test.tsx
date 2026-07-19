"use client";

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, test, vi } from "vitest";
import { RichTextEditor } from "./RichTextEditor";

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

if (!("getClientRects" in Range.prototype)) {
	Object.defineProperty(Range.prototype, "getClientRects", {
		value: () => [new DOMRect()],
	});
}

if (!("getBoundingClientRect" in Range.prototype)) {
	Object.defineProperty(Range.prototype, "getBoundingClientRect", {
		value: () => new DOMRect(),
	});
}

const INITIAL_CONTENT: JSONContent = {
	type: "doc",
	content: [
		{
			type: "paragraph",
			content: [{ type: "text", text: "Alpha Beta Gamma" }],
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
				{
					type: "tableRow",
					content: [
						{
							type: "tableCell",
							content: [
								{
									type: "paragraph",
									content: [{ type: "text", text: "Beta" }],
								},
							],
						},
						{
							type: "tableCell",
							content: [
								{
									type: "paragraph",
									content: [{ type: "text", text: "2" }],
								},
							],
						},
					],
				},
			],
		},
	],
};

const MATH_CONTENT: JSONContent = {
	type: "doc",
	content: [
		{
			type: "paragraph",
			content: [
				{ type: "text", text: "Formula: " },
				{
					type: "inlineMath",
					attrs: { latex: "E = mc^2" },
				},
			],
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

function countTableRows(doc: JSONContent | undefined) {
	return (
		findNode(doc?.content, (node) => node.type === "table")?.content?.length ??
		0
	);
}

function countColumnsInFirstRow(doc: JSONContent | undefined) {
	const table = findNode(doc?.content, (node) => node.type === "table");
	return table?.content?.[0]?.content?.length ?? 0;
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

async function getEditorElement(
	container: HTMLElement,
	editable = true,
): Promise<HTMLElement> {
	let editor: HTMLElement | null = null;

	await waitFor(() => {
		editor = container.querySelector<HTMLElement>(
			`.ProseMirror[contenteditable='${editable ? "true" : "false"}']`,
		);
		expect(editor).not.toBeNull();
	});

	if (!editor) {
		throw new Error("TipTap editor was not rendered");
	}

	return editor;
}

function placeCaretInside(node: Node, offset = 0) {
	const selection = window.getSelection();
	expect(selection).not.toBeNull();
	if (!selection) {
		throw new Error("window.getSelection() returned null");
	}

	const range = document.createRange();
	range.setStart(node, offset);
	range.collapse(true);
	selection.removeAllRanges();
	selection.addRange(range);
}

async function focusTableCell(
	container: HTMLElement,
	text: string,
	editable = true,
) {
	const editorElement = await getEditorElement(container, editable);
	const textNode = Array.from(container.querySelectorAll("td, th"))
		.map((cell) =>
			cell.textContent === text ? cell.querySelector("p")?.firstChild : null,
		)
		.find(Boolean);
	const cellElement = textNode?.parentElement?.closest("td, th");

	expect(textNode).not.toBeNull();
	if (!textNode) {
		throw new Error(`Table cell "${text}" was not rendered`);
	}
	expect(cellElement).not.toBeNull();
	if (!cellElement) {
		throw new Error(`Table cell "${text}" container was not rendered`);
	}

	placeCaretInside(textNode, textNode.textContent?.length ?? 0);
	fireEvent.focus(editorElement);
	fireEvent.mouseUp(cellElement);
	document.dispatchEvent(new Event("selectionchange"));
	return cellElement;
}

async function activateTableControls(container: HTMLElement, text = "Alpha") {
	const cellElement = await focusTableCell(container, text);
	fireEvent.pointerMove(cellElement);
	await screen.findByTestId("table-handles-overlay");
	return cellElement;
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

	test("pasted /cards/ links become card references in custom mode", async () => {
		const { container, onChange } = setup();

		await paste(container, "See [My Card](/cards/abc123) here.");

		await waitFor(() => expect(onChange).toHaveBeenCalled());

		const doc = getLatestDocument(onChange);
		const link = findTextNodeWithMark(doc?.content, "link");
		const mark = link?.marks?.find((entry) => entry.type === "link");
		expect(link?.text).toBe("My Card");
		expect(mark?.attrs).toMatchObject({
			href: "/cards/abc123",
			cardId: "abc123",
			cardLabelMode: "custom",
		});
	});

	test("pasted external links stay plain links", async () => {
		const { container, onChange } = setup();

		await paste(container, "Visit [Example](https://example.com) now.");

		await waitFor(() => expect(onChange).toHaveBeenCalled());

		const doc = getLatestDocument(onChange);
		const link = findTextNodeWithMark(doc?.content, "link");
		const mark = link?.marks?.find((entry) => entry.type === "link");
		expect(mark?.attrs?.href).toBe("https://example.com");
		expect(mark?.attrs?.cardId ?? null).toBeNull();
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
		});

		test("shows placeholder markers only while editable", async () => {
			const { container, rerender } = render(
				<RichTextEditor content={null} editable={true} />,
			);

			await waitFor(() => {
				expect(container.querySelector(".is-editor-empty")).not.toBeNull();
			});

			rerender(<RichTextEditor content={null} editable={false} />);

			await waitFor(() => {
				expect(container.querySelector(".is-editor-empty")).toBeNull();
			});
		});

		test("opens math editor only while editable", async () => {
			const { container, rerender } = render(
				<RichTextEditor content={MATH_CONTENT} editable={false} />,
			);

			const readonlyMath = await waitFor(() => {
				const element = container.querySelector<HTMLElement>(
					'[data-type="inline-math"]',
				);
				expect(element).not.toBeNull();
				if (!element) {
					throw new Error("Inline math was not rendered");
				}
				return element;
			});

			fireEvent.click(readonlyMath);
			expect(screen.queryByText("Inline math - LaTeX")).toBeNull();

			rerender(<RichTextEditor content={MATH_CONTENT} editable={true} />);

			const editableMath = await waitFor(() => {
				const element = container.querySelector<HTMLElement>(
					'[data-type="inline-math"]',
				);
				expect(element).not.toBeNull();
				if (!element) {
					throw new Error("Inline math was not rendered");
				}
				return element;
			});

			fireEvent.click(editableMath);
			const editor = await screen.findByRole("textbox");
			expect((editor as HTMLTextAreaElement).value).toBe("E = mc^2");
		});
	});

describe("RichTextEditor - table controls", () => {
		test("shows row and column handles in editable mode when a table is active", async () => {
			const { container } = setup(TABLE_CONTENT);

		await activateTableControls(container, "Alpha");

		expect(
			await screen.findByRole("button", { name: "Row 2 menu" }),
		).not.toBeNull();
		expect(screen.getByRole("button", { name: "Column 1 menu" })).not.toBeNull();
		expect(screen.queryByRole("button", { name: "Table menu" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Delete table" })).toBeNull();
	});

	test("does not show overlays in read-only mode", async () => {
		const { container } = render(
			<RichTextEditor content={TABLE_CONTENT} editable={false} />,
		);

		const cellElement = await focusTableCell(container, "Alpha", false);
		fireEvent.pointerMove(cellElement);

			await waitFor(() => {
				expect(
					screen.queryByTestId("table-handles-overlay"),
				).toBeNull();
			});
		});

		test("hides overlays after switching from editable to readonly", async () => {
			const { container, rerender } = render(
				<RichTextEditor content={TABLE_CONTENT} editable={true} />,
			);

			await activateTableControls(container, "Alpha");
			expect(screen.getByTestId("table-handles-overlay")).not.toBeNull();

			rerender(<RichTextEditor content={TABLE_CONTENT} editable={false} />);

			await waitFor(() => {
				expect(screen.queryByTestId("table-handles-overlay")).toBeNull();
				expect(
					container.querySelector(".ProseMirror")?.getAttribute("contenteditable"),
				).toBe("false");
			});
		});

	test("adds a row below the current row", async () => {
		const { container, onChange } = setup(TABLE_CONTENT);

		await activateTableControls(container, "Alpha");
		fireEvent.click(await screen.findByRole("button", { name: "Row 2 menu" }));
		fireEvent.click(
			await screen.findByRole("button", { name: "Add row below" }),
		);

		await waitFor(() => expect(onChange).toHaveBeenCalled());
		expect(countTableRows(getLatestDocument(onChange))).toBe(4);
	});

	test("deletes the current row", async () => {
		const { container, onChange } = setup(TABLE_CONTENT);

		await activateTableControls(container, "Alpha");
		fireEvent.click(await screen.findByRole("button", { name: "Row 2 menu" }));
		fireEvent.click(await screen.findByRole("button", { name: "Delete row" }));

		await waitFor(() => expect(onChange).toHaveBeenCalled());
		expect(countTableRows(getLatestDocument(onChange))).toBe(2);
	});

	test("adds a column to the right of the current column", async () => {
		const { container, onChange } = setup(TABLE_CONTENT);

		await activateTableControls(container, "Alpha");
		fireEvent.click(
			await screen.findByRole("button", { name: "Column 1 menu" }),
		);
		fireEvent.click(
			await screen.findByRole("button", { name: "Add column right" }),
		);

		await waitFor(() => expect(onChange).toHaveBeenCalled());
		expect(countColumnsInFirstRow(getLatestDocument(onChange))).toBe(3);
	});

	test("deletes the current column", async () => {
		const { container, onChange } = setup(TABLE_CONTENT);

		await activateTableControls(container, "Alpha");
		fireEvent.click(
			await screen.findByRole("button", { name: "Column 1 menu" }),
		);
		fireEvent.click(
			await screen.findByRole("button", { name: "Delete column" }),
		);

		await waitFor(() => expect(onChange).toHaveBeenCalled());
		expect(countColumnsInFirstRow(getLatestDocument(onChange))).toBe(1);
		expect(
			findNode(
				getLatestDocument(onChange)?.content,
				(node) => node.type === "text" && node.text === "Alpha",
			),
		).toBeUndefined();
	});

	test("extend buttons add a row and column", async () => {
		const { container, onChange } = setup(TABLE_CONTENT);

		await activateTableControls(container, "Alpha");
		fireEvent.click(await screen.findByRole("button", { name: "Add row" }));
		fireEvent.click(await screen.findByRole("button", { name: "Add column" }));

		await waitFor(() => expect(onChange).toHaveBeenCalled());
		const doc = getLatestDocument(onChange);
		expect(countTableRows(doc)).toBe(4);
		expect(countColumnsInFirstRow(doc)).toBe(3);
	});
});
