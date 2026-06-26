import "katex/dist/katex.min.css";
import "./editor.css";

import type { JSONContent } from "@tiptap/core";
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
import { NodeSelection, type Transaction } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState } from "react";
import { cn } from "#/lib/utils";
import { EditorBubbleMenu } from "./EditorBubbleMenu";
import { ImageInput, imageInputPluginKey } from "./ImageInputExtension";
import {
	createImageUploadExtension,
	type ImageUploadHandler,
} from "./ImageUploadExtension";
import {
	MarkdownPaste,
	skipMathEditorAutoOpenMeta,
} from "./MarkdownPasteExtension";
import { MathEditor, type MathSelection } from "./MathEditor";
import { ImageCommand } from "./slash/ImageCommand";
import { SlashCommand } from "./slash/slash-command";

type RichTextEditorProps = {
	/** Initial document (TipTap JSON). The editor is the source of truth after mount. */
	content?: JSONContent | null;
	onChange?: (value: JSONContent) => void;
	onReady?: () => void;
	placeholder?: string;
	className?: string;
	/** When false, the editor is read-only. Defaults to true. */
	editable?: boolean;
	/** Class applied to the editing surface (e.g. min-height). */
	contentClassName?: string;
	/** Where to place the cursor when transitioning into edit mode. Defaults to "end". */
	defaultFocusPosition?: "start" | "end";
	/** When true, select all content in the first node on focus (e.g. to let user replace a placeholder title). */
	selectContentOnFocus?: boolean;
	/**
	 * Uploads a pasted/dropped/picked image and resolves to its URL. When
	 * provided, images are stored externally (Convex) instead of being embedded
	 * as base64 data URLs, and the `/upload image` slash command is enabled.
	 */
	onImageUpload?: ImageUploadHandler;
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
): Promise<string | null> {
	if (!upload) {
		return readFileAsDataUrl(file);
	}

	try {
		return await upload(file);
	} catch (error) {
		console.error("Image upload failed", error);
		return null;
	}
}

type MathCandidate = MathSelection & {
	nodeSize: number;
};

function clampPosition(pos: number, max: number) {
	return Math.min(Math.max(pos, 0), max);
}

function selectionDistance(candidate: MathCandidate, pos: number) {
	if (pos >= candidate.pos && pos <= candidate.pos + candidate.nodeSize) {
		return 0;
	}

	return Math.min(
		Math.abs(pos - candidate.pos),
		Math.abs(pos - (candidate.pos + candidate.nodeSize)),
	);
}

function findInsertedMathSelection(
	transaction: Transaction,
): MathSelection | null {
	if (!transaction.docChanged) {
		return null;
	}

	const candidates: MathCandidate[] = [];

	transaction.steps.forEach((step, index) => {
		step.getMap().forEach((oldStart, oldEnd, newStart, newEnd) => {
			const oldSize = oldEnd - oldStart;
			const newSize = newEnd - newStart;

			if (newSize <= 0 || newSize === oldSize) {
				return;
			}

			const laterMapping = transaction.mapping.slice(index + 1);
			const from = clampPosition(
				laterMapping.map(newStart, -1),
				transaction.doc.content.size,
			);
			const to = clampPosition(
				laterMapping.map(newEnd, 1),
				transaction.doc.content.size,
			);

			if (to <= from) {
				return;
			}

			transaction.doc.nodesBetween(from, to, (node, pos) => {
				if (node.type.name === "inlineMath" || node.type.name === "blockMath") {
					candidates.push({
						pos,
						type: node.type.name === "inlineMath" ? "inline" : "block",
						latex: String(node.attrs.latex ?? ""),
						nodeSize: node.nodeSize,
					});
					return false;
				}

				return true;
			});
		});
	});

	if (candidates.length === 0) {
		return null;
	}

	const [closest] = candidates.sort((a, b) => {
		const distanceDifference =
			selectionDistance(a, transaction.selection.from) -
			selectionDistance(b, transaction.selection.from);

		if (distanceDifference !== 0) {
			return distanceDifference;
		}

		return b.pos - a.pos;
	});

	return {
		pos: closest.pos,
		type: closest.type,
		latex: closest.latex,
	};
}

function selectionBelongsToEditor(
	root: HTMLElement,
	selection: Selection,
): boolean {
	return (
		(selection.anchorNode !== null && root.contains(selection.anchorNode)) ||
		(selection.focusNode !== null && root.contains(selection.focusNode))
	);
}

export function RichTextEditor({
	content,
	onChange,
	onReady,
	placeholder,
	className,
	editable = true,
	contentClassName = "min-h-[60vh]",
	defaultFocusPosition = "end",
	selectContentOnFocus = false,
	onImageUpload,
}: RichTextEditorProps) {
	const [mathSelection, setMathSelection] = useState<MathSelection | null>(
		null,
	);
	const [imageInputPos, setImageInputPos] = useState<number | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const mathSelectionRef = useRef<MathSelection | null>(null);
	const imageInputPosRef = useRef<number | null>(null);
	const didNotifyReadyRef = useRef(false);
	const wasEditableRef = useRef(editable);
	// `useEditor` captures config once at creation; read the latest uploader
	// through a ref so paste/drop always use the current handler.
	const onImageUploadRef = useRef(onImageUpload);
	onImageUploadRef.current = onImageUpload;

	function openMathSelection(selection: MathSelection | null) {
		mathSelectionRef.current = selection;
		setMathSelection(selection);
	}

	const editor = useEditor({
		// Required under TanStack Start SSR to avoid a hydration mismatch.
		immediatelyRender: false,
		extensions: [
			StarterKit,
			Image.configure({
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
						void resolveImageSrc(file, onImageUploadRef.current).then((src) => {
							if (!src) return;
							editor
								.chain()
								.focus()
								.command(({ tr, commands }) => {
									const safePos = Math.min(pos, tr.doc.content.size);
									return commands.insertContentAt(safePos, {
										type: "image",
										attrs: { src },
									});
								})
								.run();
						});
					}
				},
				onPaste: (editor, files) => {
					for (const file of files) {
						if (!file.type.startsWith("image/")) continue;
						void resolveImageSrc(file, onImageUploadRef.current).then((src) => {
							if (!src) return;
							editor
								.chain()
								.focus()
								.insertContent({ type: "image", attrs: { src } })
								.run();
						});
					}
				},
			}),
			TableKit.configure({
				table: {
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
			MarkdownPaste,
			ImageInput,
			Placeholder.configure({
				placeholder: placeholder ?? "Type '/' for commands",
			}),
			Mathematics.configure({
				inlineOptions: {
					onClick: (node, pos) =>
						openMathSelection({
							pos,
							type: "inline",
							latex: String(node.attrs.latex ?? ""),
						}),
				},
				blockOptions: {
					onClick: (node, pos) =>
						openMathSelection({
							pos,
							type: "block",
							latex: String(node.attrs.latex ?? ""),
						}),
				},
			}),
			SlashCommand,
			// Only enable the file-picker upload command when an uploader exists.
			...(onImageUpload ? [createImageUploadExtension(onImageUpload)] : []),
		],
		content: content ?? "",
		editorProps: {
			attributes: {
				class: `prose dark:prose-invert max-w-none focus:outline-none ${contentClassName}`,
			},
			// When a math node is selected, Enter opens its editor instead of
			// inserting a new line.
			handleKeyDown: (view, event) => {
				if (event.key !== "Enter" || event.shiftKey) {
					return false;
				}
				const { selection } = view.state;
				if (!(selection instanceof NodeSelection)) {
					return false;
				}
				const { node } = selection;
				if (node.type.name !== "inlineMath" && node.type.name !== "blockMath") {
					return false;
				}
				openMathSelection({
					pos: selection.from,
					type: node.type.name === "inlineMath" ? "inline" : "block",
					latex: String(node.attrs.latex ?? ""),
				});
				return true;
			},
		},
		onTransaction: ({ transaction }) => {
			if (editor) {
				const imgState = imageInputPluginKey.getState(editor.state);
				const imgPos = imgState?.pos ?? null;
				if (imgPos !== imageInputPosRef.current) {
					imageInputPosRef.current = imgPos;
					setImageInputPos(imgPos);
				}
			}

			if (mathSelectionRef.current) {
				return;
			}

			if (transaction.getMeta(skipMathEditorAutoOpenMeta)) {
				return;
			}

			const insertedMathSelection = findInsertedMathSelection(transaction);
			if (insertedMathSelection) {
				openMathSelection(insertedMathSelection);
			}
		},
		onUpdate: ({ editor: instance }) => {
			onChange?.(instance.getJSON());
		},
	});

	// `useEditor` reads `editable` only at creation, so keep it in sync. Focus the
	// editor when it transitions into edit mode (e.g. a card enters editing) without
	// stealing focus on an always-editable page's initial mount.
	useEffect(() => {
		if (!editor) {
			return;
		}

		editor.setEditable(editable);

		if (editable && !wasEditableRef.current) {
			editor.commands.focus(defaultFocusPosition);

			if (selectContentOnFocus) {
				const firstChild = editor.state.doc.content.firstChild;
				if (firstChild) {
					editor.commands.setTextSelection({
						from: 1,
						to: firstChild.nodeSize - 1,
					});
				}
			}
		}

		if (!editable && wasEditableRef.current) {
			editor.commands.blur();

			const container = containerRef.current;
			const selection = window.getSelection();

			if (
				container &&
				selection &&
				selection.rangeCount > 0 &&
				selectionBelongsToEditor(container, selection)
			) {
				selection.removeAllRanges();
			}
		}

		wasEditableRef.current = editable;
	}, [editor, editable, defaultFocusPosition, selectContentOnFocus]);

	useEffect(() => {
		if (!editor || !onReady || didNotifyReadyRef.current) {
			return;
		}

		const frame = window.requestAnimationFrame(() => {
			if (didNotifyReadyRef.current) {
				return;
			}

			if (!containerRef.current?.querySelector(".ProseMirror")) {
				return;
			}

			didNotifyReadyRef.current = true;
			onReady();
		});

		return () => {
			window.cancelAnimationFrame(frame);
		};
	}, [editor, onReady]);

	if (!editor) {
		return null;
	}

	return (
		<div ref={containerRef} className={cn(className, "cursor-text")}>
			<EditorBubbleMenu editor={editor} />
			<EditorContent editor={editor} />
			{imageInputPos !== null && <ImageCommand editor={editor} />}
			{mathSelection && (
				<MathEditor
					key={mathSelection.pos}
					editor={editor}
					selection={mathSelection}
					onClose={() => openMathSelection(null)}
				/>
			)}
		</div>
	);
}
