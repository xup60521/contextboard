import "katex/dist/katex.min.css";
import "./editor.css";

import type { JSONContent } from "@tiptap/core";
import { NodeSelection, type Transaction } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { cn } from "#/lib/utils";
import type { CardReferenceSupport } from "./card-reference/types";
import {
	createRichTextExtensions,
	type ImageUploadHandler,
	type MathSelection,
} from "./createRichTextExtensions";
import { EditorBubbleMenu } from "./EditorBubbleMenu";
import { imageInputPluginKey } from "./ImageInputExtension";
import { MathEditor } from "./MathEditor";
import { skipMathEditorAutoOpenMeta } from "./MarkdownPasteExtension";
import { ImageCommand } from "./slash/ImageCommand";
import { TableHandlesOverlay } from "./table/TableHandlesOverlay";

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
	/**
	 * Connects the editor to card references: the `@` picker and
	 * modifier-click-to-preview. When omitted, the editor stays free of Convex
	 * dependencies (card-reference link marks still render and round-trip).
	 */
	cardReferenceSupport?: CardReferenceSupport;
};

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
	cardReferenceSupport,
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
	// Same pattern for card-reference support, so the `@` search and
	// modifier-click-to-preview always use the current handlers.
	const cardReferenceSupportRef = useRef(cardReferenceSupport);
	cardReferenceSupportRef.current = cardReferenceSupport;
	// Whether to register the `@` picker is decided once, at editor creation.
	const enableCardReferencesRef = useRef(Boolean(cardReferenceSupport));

	function openMathSelection(selection: MathSelection | null) {
		mathSelectionRef.current = selection;
		setMathSelection(selection);
	}

	const editor = useEditor({
		// Required under TanStack Start SSR to avoid a hydration mismatch.
		immediatelyRender: false,
		extensions: createRichTextExtensions({
			mode: editable ? "editable" : "readonly",
			placeholder,
			onImageUpload,
			cardReferenceSupport: enableCardReferencesRef.current
				? cardReferenceSupport
				: undefined,
			onMathClick: (selection) => openMathSelection(selection),
		}),
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

	// Toggle `ctrl-holding` class on the editor shell when Ctrl/Meta is held,
	// so card-reference links show a pointer cursor (signalling the modifier
	// gesture opens the preview).
	useEffect(() => {
		if (!editor) return;

		function onKeyChange(event: KeyboardEvent) {
			const active = event.ctrlKey || event.metaKey;
			containerRef.current?.classList.toggle("ctrl-holding", active);
		}

		document.addEventListener("keydown", onKeyChange);
		document.addEventListener("keyup", onKeyChange);

		return () => {
			document.removeEventListener("keydown", onKeyChange);
			document.removeEventListener("keyup", onKeyChange);
		};
	}, [editor]);

	if (!editor) {
		return null;
	}

	return (
		<div
			ref={containerRef}
			className={cn(className, "rich-text-editor-shell relative cursor-text")}
		>
			<EditorBubbleMenu editor={editor} />
			<EditorContent editor={editor} />
			{editable && (
				<>
					<TableHandlesOverlay editor={editor} containerRef={containerRef} />
				</>
			)}
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
