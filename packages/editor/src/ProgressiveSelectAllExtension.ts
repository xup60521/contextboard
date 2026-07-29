import { Extension } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

/**
 * Makes Ctrl/Cmd+A progressive: the first press selects the current text block,
 * a second press falls back to selecting the whole document. Runs at a high
 * priority so it wins over the `baseKeymap` `selectAll` binding.
 */
export const ProgressiveSelectAll = Extension.create({
	name: "progressiveSelectAll",
	priority: 1000,

	addKeyboardShortcuts() {
		return {
			"Mod-a": ({ editor }) => {
				const { selection } = editor.state;
				const { $from, $to, from, to } = selection;

				const selectWholeDoc =
					!(selection instanceof TextSelection) ||
					!$from.sameParent($to) ||
					!$from.parent.isTextblock;

				if (selectWholeDoc) {
					return editor.commands.selectAll();
				}

				const blockStart = $from.start();
				const blockEnd = $from.end();

				// An empty block would make the first press look like a no-op, and a
				// selection already covering the block is the "second press" case.
				if (
					blockStart === blockEnd ||
					(from === blockStart && to === blockEnd)
				) {
					return editor.commands.selectAll();
				}

				editor.commands.setTextSelection({ from: blockStart, to: blockEnd });
				return true;
			},
		};
	},
});
