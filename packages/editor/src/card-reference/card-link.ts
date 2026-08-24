import { Extension } from "@tiptap/core";

/**
 * Enriches ordinary `link` marks with card-reference metadata. The extra
 * attributes round-trip as `data-*` so pasted/loaded card references keep their
 * identity even when no card-reference support is wired in (e.g. read-only
 * previews). Following a reference is handled by `LinkInteraction`, which owns
 * clicks for every kind of link.
 */
export const CardLink = Extension.create({
	name: "cardLink",

	addGlobalAttributes() {
		return [
			{
				types: ["link"],
				attributes: {
					cardId: dataAttribute("data-card-id", "cardId"),
					whiteboardRefId: dataAttribute(
						"data-whiteboard-id",
						"whiteboardRefId",
					),
					cardLabelMode: dataAttribute("data-card-label-mode", "cardLabelMode"),
					resolvedTitle: dataAttribute("data-resolved-title", "resolvedTitle"),
				},
			},
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
