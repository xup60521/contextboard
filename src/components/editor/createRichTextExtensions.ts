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

export type RichTextExtensionMode = "editable" | "readonly";

export type RichTextExtensionOptions = {
	mode: RichTextExtensionMode;
	/** Placeholder text for the editor (only used in editable mode). */
	placeholder?: string;
	/** Image upload handler (only used in editable mode). */
	onImageUpload?: ImageUploadHandler;
	/** Card reference support for the @ picker (only used in editable mode). */
	cardReferenceSupport?: CardReferenceSupport;
	/** Called when a math node is clicked (only used in editable mode). */
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
 * Creates the TipTap extension list for a given mode.
 *
 * In `editable` mode, all extensions are included (matching the original
 * RichTextEditor behavior). In `readonly` mode, only rendering-critical
 * extensions are included — no file handling, markdown paste, slash commands,
 * image upload, placeholder, or card reference picker.
 */
export function createRichTextExtensions(
	options: RichTextExtensionOptions,
) {
	const {
		mode,
		placeholder,
		onImageUpload,
		cardReferenceSupport,
		onMathClick,
	} = options;
	const isEditable = mode === "editable";

	// Refs for latest handlers — these are captured at editor creation time
	// but we wrap them in closures so the extension list doesn't need to change.
	let currentOnImageUpload: ImageUploadHandler | undefined = onImageUpload;
	let currentCardReferenceSupport: CardReferenceSupport | undefined =
		cardReferenceSupport;

	if (isEditable && onImageUpload) {
		// Keep ref current for paste/drop handlers
		const uploadHandler = onImageUpload;
		const wrappedHandler: ImageUploadHandler = (file) => uploadHandler(file);
		currentOnImageUpload = wrappedHandler;
	}

	if (isEditable && cardReferenceSupport) {
		const support = cardReferenceSupport;
		currentCardReferenceSupport = support;
	}

	const enableCardReferences = Boolean(cardReferenceSupport);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const extensions: any[] = [
		StarterKit.configure({
			link: { openOnClick: false },
		}),
		CardLink.configure({
			onOpenPreview: isEditable
				? (cardId) =>
						currentCardReferenceSupport?.onOpenPreview(cardId) ?? undefined
				: null,
		}),
		EditorImage.configure({
			inline: false,
			allowBase64: true,
			resize: isEditable
				? {
						enabled: true,
						directions: ["top", "bottom", "left", "right"],
						minWidth: 50,
						minHeight: 50,
					}
				: undefined,
			HTMLAttributes: {
				class: "editor-image",
			},
		}),
		TableKit.configure({
			table: {
				resizable: isEditable,
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
			inlineOptions: isEditable && onMathClick
				? {
						onClick: (node, pos) =>
							onMathClick({
								pos,
								type: "inline",
								latex: String(node.attrs.latex ?? ""),
							}),
					}
				: undefined,
			blockOptions: isEditable && onMathClick
				? {
						onClick: (node, pos) =>
							onMathClick({
								pos,
								type: "block",
								latex: String(node.attrs.latex ?? ""),
							}),
					}
				: undefined,
		}),
	];

	// Editable-only extensions
	if (isEditable) {
		const onImageUploadRef = currentOnImageUpload;

		extensions.push(
			FileHandler.configure({
				allowedMimeTypes: [
					"image/jpeg",
					"image/png",
					"image/gif",
					"image/webp",
				],
				onDrop: (editor, files, pos) => {
					for (const file of files) {
						if (!file.type.startsWith("image/")) continue;
						void resolveImageSrc(file, onImageUploadRef).then((image) => {
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
						});
					}
				},
				onPaste: (editor, files) => {
					for (const file of files) {
						if (!file.type.startsWith("image/")) continue;
						void resolveImageSrc(file, onImageUploadRef).then((image) => {
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
						});
					}
				},
			}),
			MarkdownPaste,
			ImageInput,
			Placeholder.configure({
				placeholder: placeholder ?? "Type '/' for commands",
			}),
			SlashCommand,
		);

		if (currentOnImageUpload) {
			extensions.push(createImageUploadExtension(currentOnImageUpload));
		}

		if (enableCardReferences && currentCardReferenceSupport) {
			extensions.push(
				CardReferenceExtension.configure({
					search: (query, signal) =>
						currentCardReferenceSupport?.search(query, signal) ??
						Promise.resolve([]),
				}),
			);
		}
	}

	return extensions;
}
