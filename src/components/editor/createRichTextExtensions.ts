import {
	Details,
	DetailsContent,
	DetailsSummary,
} from "@tiptap/extension-details";
import FileHandler from "@tiptap/extension-file-handler";
import Image from "@tiptap/extension-image";
import { Mathematics } from "@tiptap/extension-mathematics";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";
import { CardLink } from "./card-reference/card-link";
import { CardReferenceExtension } from "./card-reference/card-reference";
import type { CardReferenceSupport } from "./card-reference/types";
import { ImageInput } from "./ImageInputExtension";
import {
	createImageUploadExtension,
	type ImageUploadHandler,
} from "./ImageUploadExtension";
import { MarkdownPaste } from "./MarkdownPasteExtension";
import { SlashCommand } from "./slash/slash-command";

export type { ImageUploadHandler };

export type MathSelection = {
	pos: number;
	type: "inline" | "block";
	latex: string;
};

type MutableRefObject<T> = {
	current: T;
};

export type RichTextRuntimeRefs = {
	editableRef: MutableRefObject<boolean>;
	onImageUploadRef: MutableRefObject<ImageUploadHandler | undefined>;
	cardReferenceSupportRef: MutableRefObject<CardReferenceSupport | undefined>;
};

export type RichTextExtensionOptions = {
	/** Placeholder text for the editor. */
	placeholder?: string;
	/** Runtime refs read by long-lived extensions after mount. */
	runtime: RichTextRuntimeRefs;
	/** Called when a math node is clicked in editable mode. */
	onMathClick?: (selection: MathSelection) => void;
};

/** Reads a local file as a base64 data URL (fallback when no uploader is set). */
function readFileAsDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});
}

/**
 * Resolves an image file to an `src`: uploads it when an uploader is provided,
 * otherwise falls back to an inline base64 data URL. Returns `null` if an upload
 * fails so the caller can skip insertion.
 */
async function resolveImageSrc(
	file: File,
	upload: ImageUploadHandler | undefined,
): Promise<{ src: string; fileId?: string | null } | null> {
	if (!upload) {
		return { src: await readFileAsDataUrl(file) };
	}

	try {
		return await upload(file);
	} catch (error) {
		console.error("Image upload failed", error);
		return null;
	}
}

export const EditorImage = Image.extend({
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

/**
 * Creates the single TipTap extension list shared by editable and readonly
 * surfaces. Runtime differences are derived from refs so mount order does not
 * lock the editor into different capabilities.
 */
export function createRichTextExtensions(
	options: RichTextExtensionOptions,
) {
	const { placeholder, runtime, onMathClick } = options;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const extensions: any[] = [
		StarterKit.configure({
			link: { openOnClick: false },
		}),
		CardLink.configure({
			onOpenPreview: (cardId) =>
				runtime.cardReferenceSupportRef.current?.onOpenPreview(cardId) ??
				undefined,
		}),
		EditorImage.configure({
			inline: false,
			allowBase64: true,
			resize: {
				enabled: true,
				directions: ["top", "bottom", "left", "right"],
				minWidth: 50,
				minHeight: 50,
			},
			HTMLAttributes: {
				class: "editor-image",
			},
		}),
		TableKit.configure({
			table: {
				resizable: true,
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
			renderToggleButton: ({ element, isOpen }) => {
				element.setAttribute(
					"aria-label",
					isOpen ? "Collapse dropdown" : "Expand dropdown",
				);
				element.dataset.state = isOpen ? "open" : "closed";
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
		Mathematics.configure({
			inlineOptions: onMathClick
				? {
						onClick: (node, pos) => {
							if (!runtime.editableRef.current) {
								return;
							}

							onMathClick({
								pos,
								type: "inline",
								latex: String(node.attrs.latex ?? ""),
							});
						},
					}
				: undefined,
			blockOptions: onMathClick
				? {
						onClick: (node, pos) => {
							if (!runtime.editableRef.current) {
								return;
							}

							onMathClick({
								pos,
								type: "block",
								latex: String(node.attrs.latex ?? ""),
							});
						},
					}
				: undefined,
		}),
		FileHandler.configure({
			allowedMimeTypes: [
				"image/jpeg",
				"image/png",
				"image/gif",
				"image/webp",
			],
			onDrop: (editor, files, pos) => {
				if (!runtime.editableRef.current) {
					return;
				}

				for (const file of files) {
					if (!file.type.startsWith("image/")) continue;
					void resolveImageSrc(file, runtime.onImageUploadRef.current).then(
						(image) => {
							if (!image) return;
							editor
								.chain()
								.focus()
								.command(({ tr, commands }) => {
									const safePos = Math.min(pos, tr.doc.content.size);
									return commands.insertContentAt(safePos, {
										type: "image",
										attrs: {
											src: image.src,
											...(image.fileId ? { fileId: image.fileId } : {}),
										},
									});
								})
								.run();
						},
					);
				}
			},
			onPaste: (editor, files) => {
				if (!runtime.editableRef.current) {
					return;
				}

				for (const file of files) {
					if (!file.type.startsWith("image/")) continue;
					void resolveImageSrc(file, runtime.onImageUploadRef.current).then(
						(image) => {
							if (!image) return;
							editor
								.chain()
								.focus()
								.insertContent({
									type: "image",
									attrs: {
										src: image.src,
										...(image.fileId ? { fileId: image.fileId } : {}),
									},
								})
								.run();
						},
					);
				}
			},
		}),
		MarkdownPaste,
		ImageInput,
		Placeholder.configure({
			placeholder: placeholder ?? "Type '/' for commands",
			showOnlyWhenEditable: true,
		}),
		SlashCommand,
		createImageUploadExtension(() => (file) =>
			resolveImageSrc(file, runtime.onImageUploadRef.current).then((image) => {
				if (!image) {
					throw new Error("Image upload failed");
				}
				return image;
			}),
		),
		CardReferenceExtension.configure({
			search: (query, signal) =>
				runtime.cardReferenceSupportRef.current?.search(query, signal) ??
				Promise.resolve([]),
		}),
	];

	return extensions;
}
