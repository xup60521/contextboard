import { Editor } from "@tiptap/core";
import { TableKit } from "@tiptap/extension-table";
import { CellSelection } from "@tiptap/pm/tables";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, test } from "vitest";
import {
	getActiveTable,
	getCellPosition,
	selectTableColumn,
	selectTableRow,
} from "./table-utils";

const editors: Editor[] = [];

const TABLE_CONTENT = {
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

function createEditor() {
	const element = document.createElement("div");
	document.body.appendChild(element);

	const editor = new Editor({
		element,
		extensions: [
			StarterKit,
			TableKit.configure({
				table: { resizable: true },
				tableCell: {},
				tableHeader: {},
				tableRow: {},
			}),
		],
		content: TABLE_CONTENT,
	});

	editors.push(editor);
	editor.commands.setTextSelection(4);
	return editor;
}

afterEach(() => {
	for (const editor of editors.splice(0)) {
		editor.destroy();
		const el = editor.options.element;
		if (el && typeof el === "object" && "remove" in el) {
			(el as HTMLElement).remove();
		}
	}
});

describe("table-utils", () => {
	test("detects the active table from the editor selection", () => {
		const editor = createEditor();

		const table = getActiveTable(editor);

		expect(table).not.toBeNull();
		expect(table?.map.width).toBe(2);
		expect(table?.map.height).toBe(2);
	});

	test("resolves row and column cell positions through TableMap", () => {
		const editor = createEditor();
		const table = getActiveTable(editor);
		expect(table).not.toBeNull();
		if (!table) throw new Error("Expected an active table");

		const firstCell = getCellPosition(table, 0, 0);
		const secondRowSecondCell = getCellPosition(table, 1, 1);

		expect(firstCell).toBeGreaterThan(table.start);
		expect(secondRowSecondCell).toBeGreaterThan(firstCell);
	});

	test("creates row and column CellSelection instances", () => {
		const editor = createEditor();
		const table = getActiveTable(editor);
		expect(table).not.toBeNull();
		if (!table) throw new Error("Expected an active table");

		selectTableRow(editor, table, 1);
		expect(editor.state.selection).toBeInstanceOf(CellSelection);
		expect((editor.state.selection as CellSelection).isRowSelection()).toBe(
			true,
		);

		selectTableColumn(editor, table, 0);
		expect(editor.state.selection).toBeInstanceOf(CellSelection);
		expect((editor.state.selection as CellSelection).isColSelection()).toBe(
			true,
		);
	});
});
