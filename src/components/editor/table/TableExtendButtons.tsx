import type { Editor } from "@tiptap/core";
import { Plus } from "lucide-react";
import { getCellPosition } from "./table-utils";
import type {
	ActiveTableInfo,
	TableControlRect,
	TablePointerState,
} from "./types";

type TableExtendButtonsProps = {
	editor: Editor;
	table: ActiveTableInfo;
	tableRect: TableControlRect;
	pointer: TablePointerState | null;
};

export function TableExtendButtons({
	editor,
	table,
	tableRect,
	pointer,
}: TableExtendButtonsProps) {
	return (
		<>
			<button
				type="button"
				aria-label="Add column"
				title="Add column"
				className={
					pointer?.nearRightEdge
						? "table-extend-button table-extend-button--column table-control--visible"
						: "table-extend-button table-extend-button--column"
				}
				style={{
					left: tableRect.left + tableRect.width + 6,
					top: tableRect.top,
					height: tableRect.height,
				}}
				onClick={() => {
					const pos = getCellPosition(table, 0, table.map.width - 1);
					editor.chain().focus().setTextSelection(pos).addColumnAfter().run();
				}}
			>
				<Plus className="size-3.5" />
			</button>
			<button
				type="button"
				aria-label="Add row"
				title="Add row"
				className={
					pointer?.nearBottomEdge
						? "table-extend-button table-extend-button--row table-control--visible"
						: "table-extend-button table-extend-button--row"
				}
				style={{
					left: tableRect.left,
					top: tableRect.top + tableRect.height + 6,
					width: tableRect.width,
				}}
				onClick={() => {
					const pos = getCellPosition(table, table.map.height - 1, 0);
					editor.chain().focus().setTextSelection(pos).addRowAfter().run();
				}}
			>
				<Plus className="size-3.5" />
			</button>
		</>
	);
}
