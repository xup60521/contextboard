import {
	autoUpdate,
	flip,
	offset,
	shift,
	useDismiss,
	useFloating,
	useInteractions,
} from "@floating-ui/react";
import type { Editor } from "@tiptap/core";
import {
	ArrowDown,
	ArrowLeft,
	ArrowRight,
	ArrowUp,
	Columns2,
	Heading,
	Minus,
	Rows2,
} from "lucide-react";
import type { ComponentType } from "react";
import { useEffect } from "react";
import { cn } from "#/lib/utils";
import {
	moveSelectedColumn,
	moveSelectedRow,
	selectTableTarget,
} from "./table-utils";
import type { ActiveTableInfo, TableMenuTarget } from "./types";

type TableRowColumnMenuProps = {
	editor: Editor;
	table: ActiveTableInfo;
	target: TableMenuTarget | null;
	anchor: HTMLElement | null;
	onClose: () => void;
};

type MenuButtonProps = {
	icon: ComponentType<{ className?: string }>;
	label: string;
	disabled?: boolean;
	onClick: () => void;
	danger?: boolean;
};

function MenuButton({
	icon: Icon,
	label,
	disabled = false,
	onClick,
	danger = false,
}: MenuButtonProps) {
	return (
		<button
			type="button"
			disabled={disabled}
			className={cn(
				"table-menu__button",
				danger && "table-menu__button--danger",
			)}
			onClick={onClick}
		>
			<Icon className="size-3.5" />
			<span>{label}</span>
		</button>
	);
}

export function TableRowColumnMenu({
	editor,
	table,
	target,
	anchor,
	onClose,
}: TableRowColumnMenuProps) {
	const { refs, floatingStyles, context } = useFloating({
		open: Boolean(target && anchor),
		onOpenChange: (open) => {
			if (!open) onClose();
		},
		placement: target?.axis === "column" ? "bottom-start" : "right-start",
		whileElementsMounted: autoUpdate,
		middleware: [offset(8), flip(), shift({ padding: 8 })],
	});
	const dismiss = useDismiss(context);
	const { getFloatingProps } = useInteractions([dismiss]);

	useEffect(() => {
		if (anchor) {
			refs.setReference(anchor);
		}
	}, [anchor, refs]);

	if (!target || !anchor) {
		return null;
	}

	function run(action: () => void) {
		action();
		onClose();
	}

	const isRow = target.axis === "row";
	const canMovePrevious = target.index > 0;
	const canMoveNext = isRow
		? target.index < table.map.height - 1
		: target.index < table.map.width - 1;

	return (
		<div
			ref={refs.setFloating}
			style={floatingStyles}
			className="table-menu"
			{...getFloatingProps()}
		>
			{isRow ? (
				<>
					<MenuButton
						icon={Rows2}
						label="Add row above"
						onClick={() =>
							run(() => {
								selectTableTarget(editor, table, target);
								editor.chain().focus().addRowBefore().run();
							})
						}
					/>
					<MenuButton
						icon={Rows2}
						label="Add row below"
						onClick={() =>
							run(() => {
								selectTableTarget(editor, table, target);
								editor.chain().focus().addRowAfter().run();
							})
						}
					/>
					<MenuButton
						icon={ArrowUp}
						label="Move row up"
						disabled={!canMovePrevious}
						onClick={() =>
							run(() => {
								moveSelectedRow(editor, table, target.index, target.index - 1);
								editor.view.focus();
							})
						}
					/>
					<MenuButton
						icon={ArrowDown}
						label="Move row down"
						disabled={!canMoveNext}
						onClick={() =>
							run(() => {
								moveSelectedRow(editor, table, target.index, target.index + 1);
								editor.view.focus();
							})
						}
					/>
					<MenuButton
						icon={Heading}
						label="Toggle header row"
						onClick={() =>
							run(() => {
								selectTableTarget(editor, table, target);
								editor.chain().focus().toggleHeaderRow().run();
							})
						}
					/>
					<MenuButton
						icon={Minus}
						label="Delete row"
						danger
						onClick={() =>
							run(() => {
								selectTableTarget(editor, table, target);
								editor.chain().focus().deleteRow().run();
							})
						}
					/>
				</>
			) : (
				<>
					<MenuButton
						icon={Columns2}
						label="Add column left"
						onClick={() =>
							run(() => {
								selectTableTarget(editor, table, target);
								editor.chain().focus().addColumnBefore().run();
							})
						}
					/>
					<MenuButton
						icon={Columns2}
						label="Add column right"
						onClick={() =>
							run(() => {
								selectTableTarget(editor, table, target);
								editor.chain().focus().addColumnAfter().run();
							})
						}
					/>
					<MenuButton
						icon={ArrowLeft}
						label="Move column left"
						disabled={!canMovePrevious}
						onClick={() =>
							run(() => {
								moveSelectedColumn(
									editor,
									table,
									target.index,
									target.index - 1,
								);
								editor.view.focus();
							})
						}
					/>
					<MenuButton
						icon={ArrowRight}
						label="Move column right"
						disabled={!canMoveNext}
						onClick={() =>
							run(() => {
								moveSelectedColumn(
									editor,
									table,
									target.index,
									target.index + 1,
								);
								editor.view.focus();
							})
						}
					/>
					<MenuButton
						icon={Heading}
						label="Toggle header column"
						onClick={() =>
							run(() => {
								selectTableTarget(editor, table, target);
								editor.chain().focus().toggleHeaderColumn().run();
							})
						}
					/>
					<MenuButton
						icon={Minus}
						label="Delete column"
						danger
						onClick={() =>
							run(() => {
								selectTableTarget(editor, table, target);
								editor.chain().focus().deleteColumn().run();
							})
						}
					/>
				</>
			)}
		</div>
	);
}
