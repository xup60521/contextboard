import { computePosition, flip, offset, shift } from "@floating-ui/dom";
import { ReactRenderer } from "@tiptap/react";
import {
	exitSuggestion,
	type SuggestionKeyDownProps,
	type SuggestionProps,
} from "@tiptap/suggestion";
import {
	CardReferenceList,
	type CardReferenceListHandle,
	type CardReferenceListProps,
} from "./CardReferenceList";
import { cardReferencePluginKey } from "./plugin-key";
import type { CardReferenceSuggestion } from "./types";

type CardReferenceSuggestionProps = SuggestionProps<
	CardReferenceSuggestion,
	CardReferenceSuggestion
>;

export function createCardReferenceRenderer() {
	let component: ReactRenderer<
		CardReferenceListHandle,
		CardReferenceListProps
	> | null = null;
	let popup: HTMLDivElement | null = null;

	function reposition(clientRect: CardReferenceSuggestionProps["clientRect"]) {
		if (!popup || !clientRect) {
			return;
		}

		const rect = clientRect();
		if (!rect) {
			return;
		}

		const virtualElement = { getBoundingClientRect: () => rect };
		computePosition(virtualElement, popup, {
			placement: "bottom-start",
			strategy: "fixed",
			middleware: [offset(8), flip(), shift({ padding: 8 })],
		}).then(({ x, y }) => {
			if (!popup) {
				return;
			}
			popup.style.left = `${x}px`;
			popup.style.top = `${y}px`;
		});
	}

	function destroy() {
		popup?.remove();
		popup = null;
		component?.destroy();
		component = null;
	}

	return {
		onStart: (props: CardReferenceSuggestionProps) => {
			const renderer = new ReactRenderer(CardReferenceList, {
				props,
				editor: props.editor,
			});
			component = renderer;

			if (!props.clientRect) {
				return;
			}

			popup = document.createElement("div");
			popup.style.position = "fixed";
			popup.style.top = "0";
			popup.style.left = "0";
			popup.style.zIndex = "50";
			popup.appendChild(renderer.element);
			document.body.appendChild(popup);
			reposition(props.clientRect);
		},

		onUpdate: (props: CardReferenceSuggestionProps) => {
			component?.updateProps(props);
			reposition(props.clientRect);
		},

		onKeyDown: (props: SuggestionKeyDownProps) => {
			if (props.event.key === "Escape") {
				exitSuggestion(props.view, cardReferencePluginKey);
				destroy();
				return true;
			}

			return component?.ref?.onKeyDown(props.event) ?? false;
		},

		onExit: () => {
			destroy();
		},
	};
}
