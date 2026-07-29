import type { Editor } from "@tiptap/core";
import type { ResolvedPos } from "@tiptap/pm/model";
import type { Selection } from "@tiptap/pm/state";
import {
	CellSelection,
	findTable,
	moveTableColumn,
	moveTableRow,
	TableMap,
} from "@tiptap/pm/tables";
import type { ActiveTableInfo } from "./types";

export const TABLE_CELL_NODE_NAMES = new Set(["tableCell", "tableHeader"]);

export function isTableCellSelection(
	selection: Selection,
): selection is CellSelection {
	return selection instanceof CellSelection;
}

export function hasAncestorNamed($pos: ResolvedPos, names: Set<string>) {
	for (let depth = $pos.depth; depth >= 0; depth -= 1) {
		if (names.has($pos.node(depth).type.name)) {
			return true;
		}
	}

	return false;
}

export function isSelectionInsideTableCell(selection: Selection) {
	if (selection instanceof CellSelection) {
		return true;
	}

	return (
		hasAncestorNamed(selection.$from, TABLE_CELL_NODE_NAMES) ||
		hasAncestorNamed(selection.$to, TABLE_CELL_NODE_NAMES)
	);
}

function getTableDom(editor: Editor, tablePos: number): HTMLElement | null {
	const nodeDom = editor.view.nodeDOM(tablePos);
	if (!(nodeDom instanceof HTMLElement)) {
		return null;
	}

	if (nodeDom.matches("table")) {
		return nodeDom;
	}

	return nodeDom.querySelector("table") ?? nodeDom;
}

export function getActiveTable(editor: Editor): ActiveTableInfo | null {
	const { selection } = editor.state;
	const $pos =
		selection instanceof CellSelection
			? selection.$anchorCell
			: selection.$from;
	const table = findTable($pos);

	if (!table) {
		return null;
	}

	const dom = getTableDom(editor, table.pos);
	if (!dom) {
		return null;
	}

	return {
		node: table.node,
		pos: table.pos,
		start: table.start,
		map: TableMap.get(table.node),
		dom,
	};
}

export function getTableFromDomPosition(
	editor: Editor,
	cellElement: HTMLElement,
): ActiveTableInfo | null {
	const pos = editor.view.posAtDOM(cellElement, 0);
	const table = findTable(editor.state.doc.resolve(pos));

	if (!table) {
		return null;
	}

	const dom = getTableDom(editor, table.pos);
	if (!dom) {
		return null;
	}

	return {
		node: table.node,
		pos: table.pos,
		start: table.start,
		map: TableMap.get(table.node),
		dom,
	};
}

export function getCellPosition(
	table: Pick<ActiveTableInfo, "node" | "start" | "map">,
	rowIndex: number,
	columnIndex: number,
) {
	return table.start + table.map.positionAt(rowIndex, columnIndex, table.node);
}

export function selectTableRow(
	editor: Editor,
	table: ActiveTableInfo,
	rowIndex: number,
) {
	const row = Math.min(Math.max(rowIndex, 0), table.map.height - 1);
	const anchor = getCellPosition(table, row, 0);
	const head = getCellPosition(table, row, table.map.width - 1);
	const transaction = editor.state.tr
		.setSelection(
			CellSelection.rowSelection(
				editor.state.doc.resolve(anchor),
				editor.state.doc.resolve(head),
			),
		)
		.scrollIntoView();

	editor.view.dispatch(transaction);
	editor.view.focus();
}

export function selectTableColumn(
	editor: Editor,
	table: ActiveTableInfo,
	columnIndex: number,
) {
	const column = Math.min(Math.max(columnIndex, 0), table.map.width - 1);
	const anchor = getCellPosition(table, 0, column);
	const head = getCellPosition(table, table.map.height - 1, column);
	const transaction = editor.state.tr
		.setSelection(
			CellSelection.colSelection(
				editor.state.doc.resolve(anchor),
				editor.state.doc.resolve(head),
			),
		)
		.scrollIntoView();

	editor.view.dispatch(transaction);
	editor.view.focus();
}

export function selectTableTarget(
	editor: Editor,
	table: ActiveTableInfo,
	target: { axis: "row" | "column"; index: number },
) {
	if (target.axis === "row") {
		selectTableRow(editor, table, target.index);
		return;
	}

	selectTableColumn(editor, table, target.index);
}

export function moveSelectedRow(
	editor: Editor,
	table: ActiveTableInfo,
	from: number,
	to: number,
) {
	const target = Math.min(Math.max(to, 0), table.map.height - 1);
	if (target === from) {
		return false;
	}

	return moveTableRow({ from, to: target, pos: table.pos, select: true })(
		editor.state,
		(transaction) => editor.view.dispatch(transaction),
	);
}

export function moveSelectedColumn(
	editor: Editor,
	table: ActiveTableInfo,
	from: number,
	to: number,
) {
	const target = Math.min(Math.max(to, 0), table.map.width - 1);
	if (target === from) {
		return false;
	}

	return moveTableColumn({ from, to: target, pos: table.pos, select: true })(
		editor.state,
		(transaction) => editor.view.dispatch(transaction),
	);
}
