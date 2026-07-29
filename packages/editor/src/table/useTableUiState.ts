import type { Editor } from "@tiptap/core";
import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { getColumnRects, getLocalRect, getRowRects } from "./table-dom";
import { getActiveTable, getTableFromDomPosition } from "./table-utils";
import type {
	ActiveTableInfo,
	TableControlRect,
	TablePointerState,
	TableUiState,
} from "./types";

const EDGE_PROXIMITY_PX = 20;
const HANDLE_PROXIMITY_PX = 36;

type PointerInput = Pick<TablePointerState, "x" | "y"> & {
	rowIndex?: number | null;
	columnIndex?: number | null;
};

function findContainingIndex(items: TableControlRect[], value: number) {
	return (
		items.find((item) => value >= item.top && value <= item.top + item.height)
			?.index ?? null
	);
}

function findContainingColumnIndex(items: TableControlRect[], value: number) {
	return (
		items.find((item) => value >= item.left && value <= item.left + item.width)
			?.index ?? null
	);
}

function toLocalPointer(
	event: PointerEvent,
	container: HTMLElement,
): Pick<PointerInput, "x" | "y"> {
	const containerRect = container.getBoundingClientRect();
	return {
		x: event.clientX - containerRect.left + container.scrollLeft,
		y: event.clientY - containerRect.top + container.scrollTop,
	};
}

function buildPointerState(
	pointer: PointerInput | null,
	tableRect: TableControlRect,
	rows: TableControlRect[],
	columns: TableControlRect[],
): TablePointerState | null {
	if (!pointer) {
		return null;
	}

	const insideTable =
		pointer.x >= tableRect.left - HANDLE_PROXIMITY_PX &&
		pointer.x <= tableRect.left + tableRect.width + HANDLE_PROXIMITY_PX &&
		pointer.y >= tableRect.top - HANDLE_PROXIMITY_PX &&
		pointer.y <= tableRect.top + tableRect.height + HANDLE_PROXIMITY_PX;

	const overTableBody =
		pointer.x >= tableRect.left &&
		pointer.x <= tableRect.left + tableRect.width &&
		pointer.y >= tableRect.top &&
		pointer.y <= tableRect.top + tableRect.height;

	const nearLeftEdge =
		Math.abs(pointer.x - tableRect.left) <= EDGE_PROXIMITY_PX &&
		pointer.y >= tableRect.top - EDGE_PROXIMITY_PX &&
		pointer.y <= tableRect.top + tableRect.height + EDGE_PROXIMITY_PX;

	const nearRightEdge =
		Math.abs(pointer.x - (tableRect.left + tableRect.width)) <=
			EDGE_PROXIMITY_PX &&
		pointer.y >= tableRect.top - EDGE_PROXIMITY_PX &&
		pointer.y <= tableRect.top + tableRect.height + EDGE_PROXIMITY_PX;

	const nearTopEdge =
		Math.abs(pointer.y - tableRect.top) <= EDGE_PROXIMITY_PX &&
		pointer.x >= tableRect.left - EDGE_PROXIMITY_PX &&
		pointer.x <= tableRect.left + tableRect.width + EDGE_PROXIMITY_PX;

	const nearBottomEdge =
		Math.abs(pointer.y - (tableRect.top + tableRect.height)) <=
			EDGE_PROXIMITY_PX &&
		pointer.x >= tableRect.left - EDGE_PROXIMITY_PX &&
		pointer.x <= tableRect.left + tableRect.width + EDGE_PROXIMITY_PX;

	if (!insideTable && !nearTopEdge && !nearBottomEdge && !nearLeftEdge && !nearRightEdge) {
		return null;
	}

	return {
		...pointer,
		rowIndex: overTableBody
			? (pointer.rowIndex ?? findContainingIndex(rows, pointer.y))
			: nearLeftEdge || nearRightEdge
				? findContainingIndex(rows, pointer.y)
				: null,
		columnIndex: overTableBody
			? (pointer.columnIndex ?? findContainingColumnIndex(columns, pointer.x))
			: nearTopEdge || nearBottomEdge
				? findContainingColumnIndex(columns, pointer.x)
				: null,
		nearTopEdge,
		nearBottomEdge,
		nearLeftEdge,
		nearRightEdge,
	};
}

function findTableNearPointer(
	container: HTMLElement,
	pointer: PointerInput,
	editor: Editor,
): ActiveTableInfo | null {
	const tables = container.querySelectorAll("table");
	for (const tableEl of tables) {
		const rect = getLocalRect(tableEl, container);
		const nearEdge =
			pointer.x >= rect.left - EDGE_PROXIMITY_PX &&
			pointer.x <= rect.left + rect.width + EDGE_PROXIMITY_PX &&
			pointer.y >= rect.top - EDGE_PROXIMITY_PX &&
			pointer.y <= rect.top + rect.height + EDGE_PROXIMITY_PX;

		if (nearEdge) {
			const firstCell = tableEl.querySelector("td, th");
			if (firstCell instanceof HTMLElement) {
				return getTableFromDomPosition(editor, firstCell);
			}
		}
	}
	return null;
}

function buildTableUiState(
	editor: Editor,
	container: HTMLElement,
	table: ActiveTableInfo | null,
	pointer: PointerInput | null,
): TableUiState | null {
	if (!table || !container.contains(table.dom)) {
		return null;
	}
	const tableRect = getLocalRect(table.dom, container);
	const rows = getRowRects(table.dom, container);
	const columns = getColumnRects(table.dom, container);

	return {
		editor,
		table,
		tableRect,
		rows,
		columns,
		pointer: buildPointerState(pointer, tableRect, rows, columns),
	};
}

export function useTableUiState(
	editor: Editor,
	containerRef: RefObject<HTMLDivElement | null>,
) {
	const [state, setState] = useState<TableUiState | null>(null);
	const hoveredTableRef = useRef<ActiveTableInfo | null>(null);
	const pointerRef = useRef<PointerInput | null>(null);
	const animationFrameRef = useRef<number | null>(null);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) {
			return;
		}

		const update = () => {
			if (animationFrameRef.current !== null) {
				window.cancelAnimationFrame(animationFrameRef.current);
			}

			animationFrameRef.current = window.requestAnimationFrame(() => {
				animationFrameRef.current = null;
				const selectedTable = getActiveTable(editor);
				let table = selectedTable ?? hoveredTableRef.current;

				if (!table && pointerRef.current) {
					table = findTableNearPointer(
						container,
						pointerRef.current,
						editor,
					);
					if (table) {
						hoveredTableRef.current = table;
					}
				}

				setState(
					buildTableUiState(editor, container, table, pointerRef.current),
				);
			});
		};

		const handlePointerMove = (event: PointerEvent) => {
			const target =
				event.target instanceof HTMLElement
					? event.target.closest("td, th")
					: null;
			const row = target?.closest("tr") ?? null;
			const tableElement = row?.closest("table") ?? null;
			const rowIndex =
				row && tableElement
					? Array.from(tableElement.querySelectorAll("tr")).indexOf(row)
					: null;
			const columnIndex =
				target && row ? Array.from(row.children).indexOf(target) : null;

			pointerRef.current = {
				...toLocalPointer(event, container),
				rowIndex,
				columnIndex,
			};
			if (target instanceof HTMLElement) {
				const hoveredTable = getTableFromDomPosition(editor, target);
				if (hoveredTable) {
					hoveredTableRef.current = hoveredTable;
				}
			}
			update();
		};

		const handlePointerLeave = () => {
			hoveredTableRef.current = null;
			pointerRef.current = null;
			update();
		};

		editor.on("selectionUpdate", update);
		editor.on("transaction", update);
		container.addEventListener("pointermove", handlePointerMove);
		container.addEventListener("pointerleave", handlePointerLeave);
		window.addEventListener("resize", update);
		window.addEventListener("scroll", update, true);
		update();

		return () => {
			if (animationFrameRef.current !== null) {
				window.cancelAnimationFrame(animationFrameRef.current);
			}
			editor.off("selectionUpdate", update);
			editor.off("transaction", update);
			container.removeEventListener("pointermove", handlePointerMove);
			container.removeEventListener("pointerleave", handlePointerLeave);
			window.removeEventListener("resize", update);
			window.removeEventListener("scroll", update, true);
		};
	}, [editor, containerRef]);

	return state;
}
