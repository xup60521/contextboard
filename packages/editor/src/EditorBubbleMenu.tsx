import type { Editor } from "@tiptap/core";
import { BubbleMenu } from "@tiptap/react/menus";
import { Bold, Code, Italic, Link2, Strikethrough } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { isCardReferenceLink, removeLink } from "./link/link-commands";
import { cn } from "./platform/utils";
import { isTableCellSelection } from "./table/table-utils";

type EditorBubbleMenuProps = {
	editor: Editor;
	onOpenLinkEditor: () => void;
};

type BubbleButtonProps = {
	icon: ComponentType<{ className?: string }>;
	label: string;
	isActive: boolean;
	disabled?: boolean;
	onClick: () => void;
};

function BubbleButton({
	icon: Icon,
	label,
	isActive,
	disabled = false,
	onClick,
}: BubbleButtonProps): ReactNode {
	return (
		<button
			type="button"
			title={label}
			aria-label={label}
			aria-pressed={isActive}
			disabled={disabled}
			onClick={onClick}
			className={cn(
				"flex size-8 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40",
				isActive
					? "bg-[var(--link-bg-hover)] text-[var(--lagoon-deep)]"
					: "text-[var(--sea-ink-soft)] hover:bg-[var(--link-bg-hover)] hover:text-[var(--sea-ink)]",
			)}
		>
			<Icon className="size-4" />
		</button>
	);
}

export function EditorBubbleMenu({
	editor,
	onOpenLinkEditor,
}: EditorBubbleMenuProps) {
	const isCardReference = isCardReferenceLink(editor);

	function toggleLink() {
		// A second press on an active link removes it; otherwise the popover
		// takes over so the href can be typed inline.
		if (editor.isActive("link")) {
			removeLink(editor);
			return;
		}

		onOpenLinkEditor();
	}

	return (
		<BubbleMenu
			editor={editor}
			shouldShow={({ editor: instance, from, to }) =>
				// A collapsed caret inside a link still gets the menu, so an existing
				// link can be edited or removed without selecting its text first.
				(from !== to ||
					(instance.isActive("link") && !isCardReferenceLink(instance))) &&
				!isTableCellSelection(instance.state.selection) &&
				!instance.isActive("codeBlock") &&
				!instance.isActive("inlineMath") &&
				!instance.isActive("blockMath")
			}
			className="flex items-center gap-0.5 rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] p-1 shadow-[0_14px_34px_rgba(23,58,64,0.18)] backdrop-blur-md"
		>
			<BubbleButton
				icon={Bold}
				label="Bold"
				isActive={editor.isActive("bold")}
				onClick={() => editor.chain().focus().toggleBold().run()}
			/>
			<BubbleButton
				icon={Italic}
				label="Italic"
				isActive={editor.isActive("italic")}
				onClick={() => editor.chain().focus().toggleItalic().run()}
			/>
			<BubbleButton
				icon={Strikethrough}
				label="Strikethrough"
				isActive={editor.isActive("strike")}
				onClick={() => editor.chain().focus().toggleStrike().run()}
			/>
			<BubbleButton
				icon={Code}
				label="Inline code"
				isActive={editor.isActive("code")}
				onClick={() => editor.chain().focus().toggleCode().run()}
			/>
			<span className="mx-0.5 h-5 w-px bg-[var(--line)]" />
			<BubbleButton
				icon={Link2}
				label={
					isCardReference
						? "Card reference"
						: editor.isActive("link")
							? "Remove link"
							: "Link"
				}
				isActive={editor.isActive("link")}
				disabled={isCardReference}
				onClick={toggleLink}
			/>
		</BubbleMenu>
	);
}
