import { Extension } from "@tiptap/core";
import { isCardReferenceLink } from "./link-commands";

export type LinkShortcutOptions = {
	/** Opens the link editor popover; null leaves the shortcut unbound. */
	onOpenLinkEditor: (() => void) | null;
};

/** Binds Mod+K to the link editor, the way every other editor does. */
export const LinkShortcut = Extension.create<LinkShortcutOptions>({
	name: "linkShortcut",

	addOptions() {
		return { onOpenLinkEditor: null };
	},

	addKeyboardShortcuts() {
		return {
			"Mod-k": () => {
				const open = this.options.onOpenLinkEditor;
				if (!open || !this.editor.isEditable) return false;
				if (isCardReferenceLink(this.editor)) return false;

				open();
				return true;
			},
		};
	},
});
