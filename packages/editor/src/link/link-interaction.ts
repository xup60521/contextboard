import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { openExternalLink } from "./external-link";

export type LinkInteractionOptions = {
	/** Called on modifier-click of a card reference; null disables the gesture. */
	onOpenPreview: ((cardId: string) => void) | null;
	onOpenWhiteboard: ((whiteboardId: string) => void) | null;
};

/**
 * Routes an anchor to whatever opens it: card references to their preview,
 * whiteboard references to their board, everything else to the platform link
 * opener. Returns whether the link was handled, so callers know when to swallow
 * the event. Card references without support wired in stay unhandled — their
 * href is an in-app route either way.
 */
export function followLink(
	anchor: HTMLElement,
	options: LinkInteractionOptions,
): boolean {
	const cardId = anchor.getAttribute("data-card-id");
	if (cardId) {
		if (!options.onOpenPreview) return false;
		options.onOpenPreview(cardId);
		return true;
	}

	const whiteboardId = anchor.getAttribute("data-whiteboard-id");
	if (whiteboardId) {
		if (!options.onOpenWhiteboard) return false;
		options.onOpenWhiteboard(whiteboardId);
		return true;
	}

	return openExternalLink(anchor.getAttribute("href"));
}

/**
 * Owns clicks on every anchor in the editor. While editing, a plain click
 * places the caret and the modifier gesture follows the link — the same one
 * card references have always used. On readonly surfaces there is no caret to
 * place, so a plain click follows the link instead of letting the browser
 * navigate the app away.
 */
export const LinkInteraction = Extension.create<LinkInteractionOptions>({
	name: "linkInteraction",

	addOptions() {
		return { onOpenPreview: null, onOpenWhiteboard: null };
	},

	addProseMirrorPlugins() {
		const options = this.options;
		return [
			new Plugin({
				key: new PluginKey("linkInteractionClick"),
				props: {
					handleClick(view, _pos, event) {
						const follows = event.metaKey || event.ctrlKey || !view.editable;
						if (!follows) return false;

						const target = event.target as HTMLElement | null;
						const anchor = target?.closest<HTMLElement>("a");
						if (!anchor || !followLink(anchor, options)) return false;

						event.preventDefault();
						return true;
					},
				},
			}),
		];
	},
});
