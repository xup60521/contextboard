import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { filterSlashItems, type SlashCommandItem } from "./items";
import { slashCommandPluginKey } from "./plugin-key";
import { createSlashRenderer } from "./renderer";

export const SlashCommand = Extension.create({
	name: "slashCommand",

	addProseMirrorPlugins() {
		return [
			Suggestion<SlashCommandItem, SlashCommandItem>({
				editor: this.editor,
				pluginKey: slashCommandPluginKey,
				char: "/",
				startOfLine: false,
				allowSpaces: false,
				items: ({ query }) => filterSlashItems(query),
				command: ({ editor, range, props }) => {
					props.command({ editor, range });
				},
				render: createSlashRenderer,
			}),
		];
	},
});
