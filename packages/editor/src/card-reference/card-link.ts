import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

export type CardLinkOptions = {
	/** Called on modifier-click of a card reference; null disables the gesture. */
	onOpenPreview: ((cardId: string) => void) | null;
};

/**
 * Enriches ordinary `link` marks with card-reference metadata and wires up
 * modifier-click-to-preview. The extra attributes round-trip as `data-*` so
 * pasted/loaded card references keep their identity even when no card-reference
 * support is wired in (e.g. read-only previews).
 */
export const CardLink = Extension.create<CardLinkOptions>({
	name: "cardLink",

	addOptions() {
		return { onOpenPreview: null };
	},

	addGlobalAttributes() {
		return [
			{
				types: ["link"],
				attributes: {
					cardId: dataAttribute("data-card-id", "cardId"),
					cardLabelMode: dataAttribute("data-card-label-mode", "cardLabelMode"),
					resolvedTitle: dataAttribute("data-resolved-title", "resolvedTitle"),
				},
			},
		];
	},

	addProseMirrorPlugins() {
		const options = this.options;
		return [
			new Plugin({
				key: new PluginKey("cardLinkClick"),
				props: {
					handleClick(_view, _pos, event) {
						const onOpenPreview = options.onOpenPreview;
						if (!onOpenPreview) return false;
						// Plain click keeps normal cursor behavior; only the modifier
						// gesture opens the preview.
						if (!(event.metaKey || event.ctrlKey)) return false;

						const target = event.target as HTMLElement | null;
						const anchor = target?.closest<HTMLElement>("a[data-card-id]");
						const cardId = anchor?.getAttribute("data-card-id");
						if (!cardId) return false;

						event.preventDefault();
						onOpenPreview(cardId);
						return true;
					},
				},
			}),
		];
	},
});

function dataAttribute(domAttribute: string, attributeName: string) {
	return {
		default: null as string | null,
		parseHTML: (element: HTMLElement) => element.getAttribute(domAttribute),
		renderHTML: (attributes: Record<string, unknown>) => {
			const value = attributes[attributeName];
			return value ? { [domAttribute]: String(value) } : {};
		},
	};
}
