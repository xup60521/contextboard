import type { Editor, Range } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { cardHref } from "./path";
import { cardReferencePluginKey } from "./plugin-key";
import { createCardReferenceRenderer } from "./renderer";
import type { CardReferenceSuggestion } from "./types";

export type CardReferenceExtensionOptions = {
	search: (
		query: string,
		signal: AbortSignal,
	) => Promise<CardReferenceSuggestion[]>;
};

/**
 * Adds the `@` card picker. Typing `@` opens an async search popup; selecting a
 * result inserts the target card's title as a link mark carrying card metadata.
 */
export const CardReferenceExtension =
	Extension.create<CardReferenceExtensionOptions>({
		name: "cardReference",

		addOptions() {
			return {
				search: async () => [],
			};
		},

		addProseMirrorPlugins() {
			const options = this.options;
			return [
				Suggestion<CardReferenceSuggestion, CardReferenceSuggestion>({
					editor: this.editor,
					pluginKey: cardReferencePluginKey,
					char: "@",
					startOfLine: false,
					allowSpaces: false,
					items: async ({ query }) => {
						const controller = new AbortController();
						try {
							return await options.search(query, controller.signal);
						} catch {
							return [];
						}
					},
					command: ({ editor, range, props }) => {
						insertCardReference(editor, range, props);
					},
					render: createCardReferenceRenderer,
				}),
			];
		},
	});

/** Replaces the `@query` range with the card's title as an `auto` card link. */
function insertCardReference(
	editor: Editor,
	range: Range,
	item: CardReferenceSuggestion,
) {
	editor
		.chain()
		.focus()
		.deleteRange(range)
		.insertContent([
			{
				type: "text",
				text: item.title || "Untitled card",
				marks: [
					{
						type: "link",
						attrs: {
							href: cardHref(item.id),
							cardId: item.id,
							cardLabelMode: "auto",
							resolvedTitle: item.title,
						},
					},
				],
			},
			{ type: "text", text: " " },
		])
		.run();
}
