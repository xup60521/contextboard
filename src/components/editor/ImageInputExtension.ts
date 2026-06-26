import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

export const imageInputPluginKey = new PluginKey("imageInput");

export const ImageInput = Extension.create({
	name: "imageInput",

	addProseMirrorPlugins() {
		return [
			new Plugin({
				key: imageInputPluginKey,
				state: {
					init: () => ({ pos: null as number | null }),
					apply(tr, prev) {
						const meta = tr.getMeta(imageInputPluginKey);
						if (meta) {
							return meta;
						}
						if (tr.docChanged && prev.pos !== null) {
							return { pos: null };
						}
						return prev;
					},
				},
				props: {
					handleKeyDown(view, event) {
						const state = imageInputPluginKey.getState(view.state);
						if (!state?.pos) return false;

						if (event.key === "Escape") {
							view.dispatch(
								view.state.tr.setMeta(imageInputPluginKey, { pos: null }),
							);
							return true;
						}
						return false;
					},
				},
			}),
		];
	},
});
