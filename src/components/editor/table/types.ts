import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { TableMap } from "@tiptap/pm/tables";

export type TableAxis = "row" | "column";

export type ActiveTableInfo = {
	node: ProseMirrorNode;
	pos: number;
	start: number;
	map: TableMap;
	dom: HTMLElement;
};

export type TableHandleTarget = {
	axis: TableAxis;
	index: number;
};

export type TableMenuTarget = TableHandleTarget;

export type TableControlRect = {
	index: number;
	left: number;
	top: number;
	width: number;
	height: number;
};

export type TablePointerState = {
	x: number;
	y: number;
	rowIndex: number | null;
	columnIndex: number | null;
	nearTopEdge: boolean;
	nearBottomEdge: boolean;
	nearLeftEdge: boolean;
	nearRightEdge: boolean;
};

export type TableUiState = {
	editor: Editor;
	table: ActiveTableInfo;
	tableRect: TableControlRect;
	rows: TableControlRect[];
	columns: TableControlRect[];
	pointer: TablePointerState | null;
};
