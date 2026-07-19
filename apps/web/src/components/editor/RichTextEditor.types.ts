import type { JSONContent } from "@tiptap/core";
import type { MutableRefObject } from "react";
import type { CardReferenceSupport } from "./card-reference/types";
import type { ImageUploadHandler } from "./ImageUploadExtension";

export type RichTextRuntimeRefs = {
	editableRef: MutableRefObject<boolean>;
	onImageUploadRef: MutableRefObject<ImageUploadHandler | undefined>;
	cardReferenceSupportRef: MutableRefObject<CardReferenceSupport | undefined>;
};

export type MathSelection = {
	pos: number;
	type: "inline" | "block";
	latex: string;
};

export type MathCandidate = MathSelection & {
	nodeSize: number;
};

export type RichTextEditorProps = {
	/** Initial document (TipTap JSON). The editor is the source of truth after mount unless syncContentOnPropChange is enabled. */
	content?: JSONContent | null;
	onChange?: (value: JSONContent) => void;
	onReady?: () => void;
	placeholder?: string;
	className?: string;
	/** When false, the editor keeps the same renderer but disables editing. */
	editable?: boolean;
	/** Class applied to the editing surface (e.g. min-height). */
	contentClassName?: string;
	/** Where to place the cursor when transitioning into edit mode. Defaults to "end". */
	defaultFocusPosition?: "start" | "end";
	/** When true, select all content in the first node on focus (e.g. to let user replace a placeholder title). */
	selectContentOnFocus?: boolean;
	/**
	 * Uploads a pasted/dropped/picked image and resolves to its URL. When
	 * provided, images are stored by the persistence layer instead of being embedded
	 * as base64 data URLs, and the `/upload image` slash command is enabled.
	 */
	onImageUpload?: ImageUploadHandler;
	/**
	 * Connects the editor to card references: the `@` picker and
	 * modifier-click-to-preview. When omitted, the editor stays free of persistence
	 * dependencies (card-reference link marks still render and round-trip).
	 */
	cardReferenceSupport?: CardReferenceSupport;
	/** Whether to render editing chrome such as menus and popovers. */
	showChrome?: boolean;
	/** Whether to push prop content updates into the mounted editor instance. */
	syncContentOnPropChange?: boolean;
};
