import type { Editor } from "@tiptap/core";
import { GripHorizontal, GripVertical } from "lucide-react";
import type { RefObject } from "react";
import { useEffect, useState } from "react";
import { TableExtendButtons } from "./TableExtendButtons";
import { TableRowColumnMenu } from "./TableRowColumnMenu";
import { selectTableColumn, selectTableRow } from "./table-utils";
import type { TableMenuTarget } from "./types";
import { useTableUiState } from "./useTableUiState";

type TableHandlesOverlayProps = {
	editor: Editor;
	containerRef: RefObject<HTMLDivElement | null>;
};

type OpenMenu = {
	target: TableMenuTarget;
	anchor: HTMLElement;
};

const FADE_OUT_MS = 140;

export function TableHandlesOverlay({
	editor,
	containerRef,
}: TableHandlesOverlayProps) {
	const tableState = useTableUiState(editor, containerRef);
	const [openMenu, setOpenMenu] = useState<OpenMenu | null>(null);
	const [visibleRowIndex, setVisibleRowIndex] = useState<number | null>(null);
	const [visibleColumnIndex, setVisibleColumnIndex] = useState<number | null>(
		null,
	);
	const activeRowIndex =
		tableState && openMenu?.target.axis === "row"
			? openMenu.target.index
			: tableState?.pointer?.rowIndex;
	const activeColumnIndex =
		tableState && openMenu?.target.axis === "column"
			? openMenu.target.index
			: tableState?.pointer?.columnIndex;

	useEffect(() => {
		if (activeRowIndex !== null && activeRowIndex !== undefined) {
			setVisibleRowIndex(activeRowIndex);
			return;
		}

		const timeout = window.setTimeout(() => {
			setVisibleRowIndex(null);
		}, FADE_OUT_MS);

		return () => window.clearTimeout(timeout);
	}, [activeRowIndex]);

	useEffect(() => {
		if (activeColumnIndex !== null && activeColumnIndex !== undefined) {
			setVisibleColumnIndex(activeColumnIndex);
			return;
		}

		const timeout = window.setTimeout(() => {
			setVisibleColumnIndex(null);
		}, FADE_OUT_MS);

		return () => window.clearTimeout(timeout);
	}, [activeColumnIndex]);

	if (!tableState) {
		return null;
	}

	const { table, tableRect, rows, columns, pointer } = tableState;
	const activeRow =
		activeRowIndex === null || activeRowIndex === undefined
			? null
			: (rows.find((row) => row.index === activeRowIndex) ?? null);
	const activeColumn =
		activeColumnIndex === null || activeColumnIndex === undefined
			? null
			: (columns.find((column) => column.index === activeColumnIndex) ?? null);
	const visibleRow =
		visibleRowIndex === null
			? null
			: (rows.find((row) => row.index === visibleRowIndex) ?? null);
	const visibleColumn =
		visibleColumnIndex === null
			? null
			: (columns.find((column) => column.index === visibleColumnIndex) ?? null);

	return (
		<div className="table-handles-layer" data-testid="table-handles-overlay">
			{visibleColumn && (
				<button
					type="button"
					aria-label={`Column ${visibleColumn.index + 1} menu`}
					title={`Column ${visibleColumn.index + 1}`}
					className={
						activeColumn
							? "table-column-handle table-control--visible"
							: "table-column-handle"
					}
					style={{
						left: visibleColumn.left + visibleColumn.width / 2,
						top: tableRect.top - 10,
					}}
					onClick={(event) => {
						selectTableColumn(editor, table, visibleColumn.index);
						setOpenMenu({
							target: { axis: "column", index: visibleColumn.index },
							anchor: event.currentTarget,
						});
					}}
				>
					<GripHorizontal className="size-3.5" />
				</button>
			)}
			{visibleRow && (
				<button
					type="button"
					aria-label={`Row ${visibleRow.index + 1} menu`}
					title={`Row ${visibleRow.index + 1}`}
					className={
						activeRow
							? "table-row-handle table-control--visible"
							: "table-row-handle"
					}
					style={{
						left: tableRect.left - 10,
						top: visibleRow.top + visibleRow.height / 2,
					}}
					onClick={(event) => {
						selectTableRow(editor, table, visibleRow.index);
						setOpenMenu({
							target: { axis: "row", index: visibleRow.index },
							anchor: event.currentTarget,
						});
					}}
				>
					<GripVertical className="size-3.5" />
				</button>
			)}
			<TableExtendButtons
				editor={editor}
				table={table}
				tableRect={tableRect}
				pointer={pointer}
			/>
			<TableRowColumnMenu
				editor={editor}
				table={table}
				target={openMenu?.target ?? null}
				anchor={openMenu?.anchor ?? null}
				onClose={() => setOpenMenu(null)}
			/>
		</div>
	);
}
