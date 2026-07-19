import { computePosition, flip, offset, shift } from "@floating-ui/dom";
import { ReactRenderer } from "@tiptap/react";
import {
	exitSuggestion,
	type SuggestionKeyDownProps,
	type SuggestionProps,
} from "@tiptap/suggestion";
import type { SlashCommandItem } from "./items";
import { slashCommandPluginKey } from "./plugin-key";
import type {
	SlashCommandListHandle,
	SlashCommandListProps,
} from "./SlashCommandList";
import { SlashCommandList } from "./SlashCommandList";

type SlashSuggestionProps = SuggestionProps<SlashCommandItem, SlashCommandItem>;

export function createSlashRenderer() {
	let component: ReactRenderer<
		SlashCommandListHandle,
		SlashCommandListProps
	> | null = null;
	let popup: HTMLDivElement | null = null;

	function reposition(clientRect: SlashSuggestionProps["clientRect"]) {
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
		onStart: (props: SlashSuggestionProps) => {
			const renderer = new ReactRenderer(SlashCommandList, {
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

		onUpdate: (props: SlashSuggestionProps) => {
			component?.updateProps(props);
			reposition(props.clientRect);
		},

		onKeyDown: (props: SuggestionKeyDownProps) => {
			if (props.event.key === "Escape") {
				exitSuggestion(props.view, slashCommandPluginKey);
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
