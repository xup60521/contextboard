import type { Editor } from "@tiptap/core";
import { BubbleMenu } from "@tiptap/react/menus";
import { Bold, Code, Italic, Link2, Strikethrough } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { cn } from "#/lib/utils";

type EditorBubbleMenuProps = {
	editor: Editor;
};

type BubbleButtonProps = {
	icon: ComponentType<{ className?: string }>;
	label: string;
	isActive: boolean;
	onClick: () => void;
};

function BubbleButton({
	icon: Icon,
	label,
	isActive,
	onClick,
}: BubbleButtonProps): ReactNode {
	return (
		<button
			type="button"
			title={label}
			aria-label={label}
			aria-pressed={isActive}
			onClick={onClick}
			className={cn(
				"flex size-8 items-center justify-center rounded-md transition-colors",
				isActive
					? "bg-[var(--link-bg-hover)] text-[var(--lagoon-deep)]"
					: "text-[var(--sea-ink-soft)] hover:bg-[var(--link-bg-hover)] hover:text-[var(--sea-ink)]",
			)}
		>
			<Icon className="size-4" />
		</button>
	);
}

export function EditorBubbleMenu({ editor }: EditorBubbleMenuProps) {
	function toggleLink() {
		if (editor.isActive("link")) {
			editor.chain().focus().unsetLink().run();
			return;
		}

		const previousUrl = editor.getAttributes("link").href as string | undefined;
		const url = window.prompt("Link URL", previousUrl ?? "https://");
		if (url === null) {
			return;
		}

		if (url === "") {
			editor.chain().focus().unsetLink().run();
			return;
		}

		editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
	}

	return (
		<BubbleMenu
			editor={editor}
			shouldShow={({ editor: instance, from, to }) =>
				from !== to &&
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
				label="Link"
				isActive={editor.isActive("link")}
				onClick={toggleLink}
			/>
		</BubbleMenu>
	);
}
