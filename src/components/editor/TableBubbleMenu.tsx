import type { Editor } from "@tiptap/core";
import type { ResolvedPos } from "@tiptap/pm/model";
import type { Selection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import { BubbleMenu } from "@tiptap/react/menus";
import { Columns2, Minus, Rows2, Table2 } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { useEffect, useState } from "react";
import { cn } from "#/lib/utils";

type TableBubbleMenuProps = {
	editor: Editor;
	editable: boolean;
};

type TableActionButtonProps = {
	icon: ComponentType<{ className?: string }>;
	label: string;
	disabled: boolean;
	onClick: () => void;
};

const TABLE_CELL_NODE_NAMES = new Set(["tableCell", "tableHeader"]);

function hasAncestorNamed($pos: ResolvedPos, names: Set<string>) {
	for (let depth = $pos.depth; depth >= 0; depth -= 1) {
		if (names.has($pos.node(depth).type.name)) {
			return true;
		}
	}

	return false;
}

export function isTableCellSelection(selection: Selection) {
	return selection instanceof CellSelection;
}

export function isCollapsedSelectionInsideTableCell(selection: Selection) {
	return (
		selection.empty && hasAncestorNamed(selection.$from, TABLE_CELL_NODE_NAMES)
	);
}

function getAnchorCellElement(editor: Editor) {
	const { selection } = editor.state;

	if (selection instanceof CellSelection) {
		const domNode = editor.view.nodeDOM(selection.$anchorCell.pos);
		return domNode instanceof HTMLElement ? domNode : null;
	}

	const domSelection = window.getSelection();
	if (!domSelection?.anchorNode) {
		return null;
	}

	const anchorElement =
		domSelection.anchorNode instanceof HTMLElement
			? domSelection.anchorNode
			: domSelection.anchorNode.parentElement;

	return anchorElement?.closest("td, th") ?? null;
}

function getBubbleAnchorElement(editor: Editor) {
	return getAnchorCellElement(editor) ?? editor.view.dom;
}

function TableActionButton({
	icon: Icon,
	label,
	disabled,
	onClick,
}: TableActionButtonProps): ReactNode {
	return (
		<button
			type="button"
			title={label}
			aria-label={label}
			disabled={disabled}
			onClick={onClick}
			className={cn(
				"inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors",
				disabled
					? "cursor-not-allowed text-[var(--sea-ink-soft)] opacity-45"
					: "text-[var(--sea-ink-soft)] hover:bg-[var(--link-bg-hover)] hover:text-[var(--sea-ink)]",
			)}
		>
			<Icon className="size-3.5" />
			<span>{label}</span>
		</button>
	);
}

export function TableBubbleMenu({ editor, editable }: TableBubbleMenuProps) {
	const [, setSelectionVersion] = useState(0);

	useEffect(() => {
		const rerender = () => {
			setSelectionVersion((version) => version + 1);
		};

		editor.on("selectionUpdate", rerender);

		return () => {
			editor.off("selectionUpdate", rerender);
		};
	}, [editor]);

	const canAddRowBefore = editor.can().addRowBefore();
	const canAddRowAfter = editor.can().addRowAfter();
	const canDeleteRow = editor.can().deleteRow();
	const canAddColumnBefore = editor.can().addColumnBefore();
	const canAddColumnAfter = editor.can().addColumnAfter();
	const canDeleteColumn = editor.can().deleteColumn();
	const canDeleteTable = editor.can().deleteTable();

	return (
		<BubbleMenu
			editor={editor}
			pluginKey="tableBubbleMenu"
			updateDelay={0}
			getReferencedVirtualElement={() => {
				const anchor = getBubbleAnchorElement(editor);

				return {
					getBoundingClientRect: () => anchor.getBoundingClientRect(),
					getClientRects: () => anchor.getClientRects(),
				};
			}}
			shouldShow={({ editor: instance }) =>
				editable &&
				(isTableCellSelection(instance.state.selection) ||
					isCollapsedSelectionInsideTableCell(instance.state.selection))
			}
			data-testid="table-bubble-menu"
			className="flex items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] p-1 shadow-[0_14px_34px_rgba(23,58,64,0.18)] backdrop-blur-md"
		>
			<TableActionButton
				icon={Rows2}
				label="Add row above"
				disabled={!canAddRowBefore}
				onClick={() => editor.chain().focus().addRowBefore().run()}
			/>
			<TableActionButton
				icon={Rows2}
				label="Add row below"
				disabled={!canAddRowAfter}
				onClick={() => editor.chain().focus().addRowAfter().run()}
			/>
			<TableActionButton
				icon={Minus}
				label="Delete row"
				disabled={!canDeleteRow}
				onClick={() => editor.chain().focus().deleteRow().run()}
			/>
			<span className="mx-0.5 h-5 w-px bg-[var(--line)]" />
			<TableActionButton
				icon={Columns2}
				label="Add column left"
				disabled={!canAddColumnBefore}
				onClick={() => editor.chain().focus().addColumnBefore().run()}
			/>
			<TableActionButton
				icon={Columns2}
				label="Add column right"
				disabled={!canAddColumnAfter}
				onClick={() => editor.chain().focus().addColumnAfter().run()}
			/>
			<TableActionButton
				icon={Minus}
				label="Delete column"
				disabled={!canDeleteColumn}
				onClick={() => editor.chain().focus().deleteColumn().run()}
			/>
			<span className="mx-0.5 h-5 w-px bg-[var(--line)]" />
			<TableActionButton
				icon={Table2}
				label="Delete table"
				disabled={!canDeleteTable}
				onClick={() => editor.chain().focus().deleteTable().run()}
			/>
		</BubbleMenu>
	);
}
