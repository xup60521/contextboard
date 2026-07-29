import type { AnyExtension } from "@tiptap/core";
import {
	Details,
	DetailsContent,
	DetailsSummary,
} from "@tiptap/extension-details";
import Image from "@tiptap/extension-image";
import { Mathematics } from "@tiptap/extension-mathematics";
import { TableKit } from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";
import { CardLink } from "../card-reference/card-link";

export const StaticEditorImage = Image.extend({
	addAttributes() {
		return {
			...this.parent?.(),
			fileId: {
				default: null,
				parseHTML: (element) => element.getAttribute("data-file-id"),
				renderHTML: (attributes) =>
					attributes.fileId ? { "data-file-id": attributes.fileId } : {},
			},
		};
	},
});

export function createStaticRichTextExtensions() {
	return [
		StarterKit.configure({
			link: {
				openOnClick: false,
			},
		}),

		CardLink.configure({
			onOpenPreview: null,
		}),

		StaticEditorImage.configure({
			inline: false,
			allowBase64: true,
			HTMLAttributes: {
				class: "editor-image",
			},
		}),

		TableKit.configure({
			table: {
				resizable: false,
				renderWrapper: true,
				cellMinWidth: 96,
				HTMLAttributes: {
					class: "editor-table",
				},
			},
			tableCell: {},
			tableHeader: {},
			tableRow: {},
		}),

		Details.configure({
			persist: true,
			HTMLAttributes: {
				class: "editor-details",
			},
		}),

		DetailsSummary.configure({
			HTMLAttributes: {
				class: "editor-details-summary",
			},
		}),

		DetailsContent.configure({
			HTMLAttributes: {
				class: "editor-details-content",
			},
		}),

		Mathematics,
	] satisfies AnyExtension[];
}
