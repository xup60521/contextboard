import type { Editor } from "@tiptap/core";
import { useState } from "react";
import { cn } from "#/lib/utils";

type TableGridPickerProps = {
	editor: Editor;
	onSelect?: () => void;
};

const GRID_SIZE = 8;

export function TableGridPicker({ editor, onSelect }: TableGridPickerProps) {
	const [hovered, setHovered] = useState({ rows: 3, columns: 3 });

	function insertTable(rows: number, columns: number) {
		editor
			.chain()
			.focus()
			.insertTable({ rows, cols: columns, withHeaderRow: true })
			.run();
		onSelect?.();
	}

	return (
		<div className="table-grid-picker" data-testid="table-grid-picker">
			<div className="table-grid-picker__label">
				{hovered.rows} x {hovered.columns}
			</div>
			<div className="table-grid-picker__grid">
				{Array.from({ length: GRID_SIZE }).map((_, rowIndex) =>
					Array.from({ length: GRID_SIZE }).map((__, columnIndex) => {
						const rows = rowIndex + 1;
						const columns = columnIndex + 1;
						const active = rows <= hovered.rows && columns <= hovered.columns;

						return (
							<button
								key={`${rows}-${columns}`}
								type="button"
								aria-label={`Insert ${rows} by ${columns} table`}
								className={cn(
									"table-grid-picker__cell",
									active && "table-grid-picker__cell--active",
								)}
								onPointerEnter={() => setHovered({ rows, columns })}
								onClick={() => insertTable(rows, columns)}
							/>
						);
					}),
				)}
			</div>
		</div>
	);
}
