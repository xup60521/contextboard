import { Link } from "@tanstack/react-router";
import type { JSONContent } from "@tiptap/core";
import { useMutation } from "convex/react";
import { ExternalLink } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
	BaseBoxShapeUtil,
	createShapeId,
	type Editor,
	HTMLContainer,
	type RecordProps,
	Rectangle2d,
	resizeBox,
	T,
	type TLBaseShape,
	type TLResizeInfo,
	useEditor,
	useIsEditing,
	type VecLike,
} from "tldraw";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { RichTextEditor } from "../editor/RichTextEditor";

declare module "@tldraw/tlschema" {
	interface TLGlobalShapePropsMap {
		"text-card": {
			w: number;
			h: number;
			text: string;
		};
		"markdown-card": {
			w: number;
			h: number;
			content: string;
			cardId?: string;
			version?: number;
		};
		"subwhiteboard-link": {
			w: number;
			h: number;
			label: string;
			subwhiteboardId: string;
			childWhiteboardId?: string;
			depth?: number;
		};
	}
}

export type TextCardShape = TLBaseShape<
	"text-card",
	{
		w: number;
		h: number;
		text: string;
	}
>;

export type MarkdownCardShape = TLBaseShape<
	"markdown-card",
	{
		w: number;
		h: number;
		content: string;
		cardId?: string;
		version?: number;
	}
>;

export type SubwhiteboardLinkShape = TLBaseShape<
	"subwhiteboard-link",
	{
		w: number;
		h: number;
		label: string;
		subwhiteboardId: string;
		childWhiteboardId?: string;
		depth?: number;
	}
>;

export const textCardShapeProps = {
	w: T.number,
	h: T.number,
	text: T.string,
} satisfies RecordProps<TextCardShape>;

export const markdownCardShapeProps = {
	w: T.number,
	h: T.number,
	content: T.string,
	cardId: T.string.optional(),
	version: T.number.optional(),
} satisfies RecordProps<MarkdownCardShape>;

export const subwhiteboardLinkShapeProps = {
	w: T.number,
	h: T.number,
	label: T.string,
	subwhiteboardId: T.string,
	childWhiteboardId: T.string.optional(),
	depth: T.number.optional(),
} satisfies RecordProps<SubwhiteboardLinkShape>;

function isEmptyCardContent(content: JSONContent | null): boolean {
	if (!content || content.type !== "doc" || !content.content) return false;
	if (content.content.length !== 1) return false;
	const heading = content.content[0];
	if (heading.type !== "heading" || heading.attrs?.level !== 1) return false;
	if (!heading.content || heading.content.length !== 1) return false;
	const textNode = heading.content[0];
	return textNode.type === "text" && textNode.text === "New card";
}

function TextCardComponent({ shape }: { shape: TextCardShape }) {
	const editor = useEditor();
	const isEditing = useIsEditing(shape.id);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		if (!isEditing) return;

		const textarea = textareaRef.current;
		if (!textarea) return;

		textarea.focus();
		const caretPosition = textarea.value.length;
		textarea.setSelectionRange(caretPosition, caretPosition);
	}, [isEditing]);

	return (
		<HTMLContainer>
			<textarea
				ref={textareaRef}
				className="h-full w-full resize-none rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-[15px] leading-5 text-[var(--card-foreground)] shadow-sm outline-none transition focus:border-[var(--ring)]"
				value={shape.props.text}
				placeholder="Type..."
				spellCheck
				readOnly={!isEditing}
				tabIndex={isEditing ? 0 : -1}
				style={{ pointerEvents: isEditing ? "auto" : "none" }}
				onPointerDown={(e) => editor.markEventAsHandled(e)}
				onPointerUp={(e) => editor.markEventAsHandled(e)}
				onClick={(e) => editor.markEventAsHandled(e)}
				onDoubleClick={(e) => editor.markEventAsHandled(e)}
				onKeyDown={(e) => {
					editor.markEventAsHandled(e);

					if (e.key === "Escape") {
						editor.setEditingShape(null);
						return;
					}

					if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
						editor.complete();
					}
				}}
				onPaste={(e) => editor.markEventAsHandled(e)}
				onWheel={(e) => editor.markEventAsHandled(e)}
				onBlur={() => {
					if (editor.getEditingShapeId() === shape.id) {
						editor.setEditingShape(null);
					}
				}}
				onChange={(e) => {
					editor.updateShape<TextCardShape>({
						id: shape.id,
						type: "text-card",
						props: {
							...shape.props,
							text: e.currentTarget.value,
						},
					});
				}}
			/>
		</HTMLContainer>
	);
}

function parseMarkdownContent(content: string): JSONContent | null {
	if (!content) return null;

	try {
		return JSON.parse(content) as JSONContent;
	} catch {
		return null;
	}
}

function MarkdownCardComponent({ shape }: { shape: MarkdownCardShape }) {
	if (shape.props.cardId) {
		return <ConvexMarkdownCardComponent shape={shape} />;
	}

	return <LocalMarkdownCardComponent shape={shape} />;
}

function ConvexMarkdownCardComponent({ shape }: { shape: MarkdownCardShape }) {
	const editor = useEditor();
	const isEditing = useIsEditing(shape.id);
	const updateContent = useMutation(api.cards.updateContent);
	const cardRef = useRef<HTMLDivElement>(null);
	const latestPropsRef = useRef(shape.props);
	const pendingContentRef = useRef<JSONContent | null>(null);
	const saveTimerRef = useRef<number | null>(null);
	const initialContentRef = useRef<JSONContent | null>(
		parseMarkdownContent(shape.props.content),
	);

	latestPropsRef.current = shape.props;

	const flushSave = useCallback(() => {
		if (saveTimerRef.current !== null) {
			window.clearTimeout(saveTimerRef.current);
			saveTimerRef.current = null;
		}

		const content = pendingContentRef.current;
		pendingContentRef.current = null;
		if (!content || !shape.props.cardId) return;

		void updateContent({
			cardId: shape.props.cardId as Id<"cards">,
			content,
		});
	}, [shape.props.cardId, updateContent]);

	const scheduleSave = useCallback(
		(value: JSONContent) => {
			const serializedContent = JSON.stringify(value);
			pendingContentRef.current = value;

			editor.updateShape<MarkdownCardShape>({
				id: shape.id,
				type: "markdown-card",
				props: {
					...latestPropsRef.current,
					content: serializedContent,
				},
			});

			if (saveTimerRef.current !== null) {
				window.clearTimeout(saveTimerRef.current);
			}

			saveTimerRef.current = window.setTimeout(flushSave, 450);
		},
		[editor, flushSave, shape.id],
	);

	useEffect(() => {
		return () => {
			flushSave();
		};
	}, [flushSave]);

	const HEADER_HEIGHT = 28;

	useLayoutEffect(() => {
		const card = cardRef.current;
		if (!card) return;

		let frame: number | null = null;

		const syncHeight = () => {
			frame = null;
			const contentHeight = Math.ceil(card.scrollHeight) - HEADER_HEIGHT;
			const nextHeight = Math.max(96, contentHeight + HEADER_HEIGHT);
			const latestProps = latestPropsRef.current;

			if (Math.abs(nextHeight - latestProps.h) < 1) {
				return;
			}

			editor.updateShape<MarkdownCardShape>({
				id: shape.id,
				type: "markdown-card",
				props: {
					...latestProps,
					h: nextHeight,
				},
			});
		};

		const scheduleSyncHeight = () => {
			if (frame !== null) return;
			frame = window.requestAnimationFrame(syncHeight);
		};

		scheduleSyncHeight();

		const resizeObserver = new ResizeObserver(scheduleSyncHeight);
		resizeObserver.observe(card);

		return () => {
			resizeObserver.disconnect();
			if (frame !== null) {
				window.cancelAnimationFrame(frame);
			}
		};
	}, [editor, shape.id]);

	if (!shape.props.cardId) return null;

	return (
		<HTMLContainer>
			{/** biome-ignore lint/a11y/noStaticElementInteractions: tldraw shapes guard pointer/keyboard events here. */}
			<div
				ref={cardRef}
				className="relative w-full rounded-md border border-[var(--border)] bg-[var(--card)] px-8 py-8 text-[var(--card-foreground)] shadow-sm transition focus-within:border-[var(--ring)]"
				style={{ pointerEvents: isEditing ? "auto" : "none" }}
				onPointerDown={(e) => {
					if (isEditing) editor.markEventAsHandled(e);
				}}
				onPointerUp={(e) => {
					if (isEditing) editor.markEventAsHandled(e);
				}}
				onClick={(e) => {
					if (isEditing) editor.markEventAsHandled(e);
				}}
				onDoubleClick={(e) => {
					if (isEditing) editor.markEventAsHandled(e);
				}}
				onKeyDown={(e) => {
					if (!isEditing) return;
					editor.markEventAsHandled(e);

					if (e.key === "Escape") {
						editor.setEditingShape(null);
					}
				}}
				onPaste={(e) => {
					if (isEditing) editor.markEventAsHandled(e);
				}}
				onWheel={(e) => {
					if (isEditing) editor.markEventAsHandled(e);
				}}
			>
				<Link
					to="/cards/$cardId"
					params={{ cardId: shape.props.cardId }}
					draggable={false}
					onPointerDown={(e) => {
						editor.markEventAsHandled(e);
						e.stopPropagation();
					}}
					onPointerUp={(e) => {
						editor.markEventAsHandled(e);
						e.stopPropagation();
					}}
					onClick={(e) => {
						editor.markEventAsHandled(e);
						e.stopPropagation();
					}}
					className="absolute right-2 top-2 z-10 flex size-6 items-center justify-center rounded bg-[var(--card)] text-[var(--muted-foreground)] shadow-sm transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
					style={{ pointerEvents: "auto" }}
					aria-label="Open card editor"
				>
					<ExternalLink className="size-3.5" />
				</Link>
				<RichTextEditor
					editable={isEditing}
					content={initialContentRef.current}
					contentClassName="min-h-12 pr-7"
					placeholder="Type '/' for commands"
					onChange={scheduleSave}
					defaultFocusPosition={isEmptyCardContent(initialContentRef.current) ? "start" : "end"}
					selectContentOnFocus={isEmptyCardContent(initialContentRef.current)}
				/>
			</div>
		</HTMLContainer>
	);
}

function LocalMarkdownCardComponent({ shape }: { shape: MarkdownCardShape }) {
	const editor = useEditor();
	const isEditing = useIsEditing(shape.id);
	const cardRef = useRef<HTMLDivElement>(null);
	const latestPropsRef = useRef(shape.props);
	// The TipTap editor is the source of truth after mount, so read the persisted
	// content only once.
	const initialContentRef = useRef<JSONContent | null>(
		parseMarkdownContent(shape.props.content),
	);

	latestPropsRef.current = shape.props;

	const HEADER_HEIGHT = 28;

	useLayoutEffect(() => {
		const card = cardRef.current;
		if (!card) return;

		let frame: number | null = null;

		const syncHeight = () => {
			frame = null;
			const contentHeight = Math.ceil(card.scrollHeight) - HEADER_HEIGHT;
			const nextHeight = Math.max(64, contentHeight + HEADER_HEIGHT);
			const latestProps = latestPropsRef.current;

			if (Math.abs(nextHeight - latestProps.h) < 1) {
				return;
			}

			editor.updateShape<MarkdownCardShape>({
				id: shape.id,
				type: "markdown-card",
				props: {
					...latestProps,
					h: nextHeight,
				},
			});
		};

		const scheduleSyncHeight = () => {
			if (frame !== null) return;
			frame = window.requestAnimationFrame(syncHeight);
		};

		scheduleSyncHeight();

		const resizeObserver = new ResizeObserver(scheduleSyncHeight);
		resizeObserver.observe(card);

		return () => {
			resizeObserver.disconnect();
			if (frame !== null) {
				window.cancelAnimationFrame(frame);
			}
		};
	}, [editor, shape.id]);

	return (
		<HTMLContainer>
			{/** biome-ignore lint/a11y/noStaticElementInteractions: tldraw shapes guard pointer/keyboard events here. */}
			<div
				ref={cardRef}
				className="w-full rounded-md border border-[var(--border)] bg-[var(--card)] px-8 py-8 text-[var(--card-foreground)] shadow-sm transition focus-within:border-[var(--ring)]"
				style={{ pointerEvents: isEditing ? "auto" : "none" }}
				onPointerDown={(e) => {
					if (isEditing) editor.markEventAsHandled(e);
				}}
				onPointerUp={(e) => {
					if (isEditing) editor.markEventAsHandled(e);
				}}
				onClick={(e) => {
					if (isEditing) editor.markEventAsHandled(e);
				}}
				onDoubleClick={(e) => {
					if (isEditing) editor.markEventAsHandled(e);
				}}
				onKeyDown={(e) => {
					if (!isEditing) return;
					editor.markEventAsHandled(e);

					if (e.key === "Escape") {
						editor.setEditingShape(null);
					}
				}}
				onPaste={(e) => {
					if (isEditing) editor.markEventAsHandled(e);
				}}
				onWheel={(e) => {
					if (isEditing) editor.markEventAsHandled(e);
				}}
			>
				<div
					className="flex items-center justify-end border-b border-[var(--border)] px-2 py-1"
					style={{ pointerEvents: "auto" }}
					onPointerDown={(e) => {
						if (isEditing) editor.markEventAsHandled(e);
					}}
				>
					<Link
						to="/test/markdown"
						draggable={false}
						onPointerDown={(e) => {
							editor.markEventAsHandled(e);
							e.stopPropagation();
						}}
						onPointerUp={(e) => {
							editor.markEventAsHandled(e);
							e.stopPropagation();
						}}
						onClick={(e) => {
							editor.markEventAsHandled(e);
							e.stopPropagation();
						}}
						className="flex size-5 items-center justify-center rounded text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
					>
						<ExternalLink className="size-3.5" />
					</Link>
				</div>
				<RichTextEditor
					editable={isEditing}
					content={initialContentRef.current}
					contentClassName="min-h-6"
					placeholder="Type '/' for commands"
					onChange={(value) => {
						editor.updateShape<MarkdownCardShape>({
							id: shape.id,
							type: "markdown-card",
							props: {
								...latestPropsRef.current,
								content: JSON.stringify(value),
							},
						});
					}}
					defaultFocusPosition={isEmptyCardContent(initialContentRef.current) ? "start" : "end"}
					selectContentOnFocus={isEmptyCardContent(initialContentRef.current)}
				/>
			</div>
		</HTMLContainer>
	);
}

export function makeSubwhiteboardId() {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}

	return `sub-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export class TextCardShapeUtil extends BaseBoxShapeUtil<TextCardShape> {
	static override type = "text-card" as const;
	static override props = textCardShapeProps;

	override getDefaultProps(): TextCardShape["props"] {
		return {
			w: 280,
			h: 120,
			text: "",
		};
	}

	override canResize() {
		return true;
	}

	override canEdit() {
		return true;
	}

	override hideSelectionBoundsBg(shape: TextCardShape) {
		return this.editor.getEditingShapeId() === shape.id;
	}

	override hideSelectionBoundsFg(shape: TextCardShape) {
		return this.editor.getEditingShapeId() === shape.id;
	}

	override isAspectRatioLocked() {
		return false;
	}

	override getGeometry(shape: TextCardShape) {
		return new Rectangle2d({
			width: shape.props.w,
			height: shape.props.h,
			isFilled: true,
		});
	}

	override getIndicatorPath(shape: TextCardShape): Path2D {
		const path = new Path2D();
		path.rect(0, 0, shape.props.w, shape.props.h);
		return path;
	}

	override onResize(shape: TextCardShape, info: TLResizeInfo<TextCardShape>) {
		return resizeBox(shape, info, { minWidth: 160, minHeight: 64 });
	}

	override component(shape: TextCardShape) {
		return <TextCardComponent shape={shape} />;
	}
}

export class MarkdownCardShapeUtil extends BaseBoxShapeUtil<MarkdownCardShape> {
	static override type = "markdown-card" as const;
	static override props = markdownCardShapeProps;

	override getDefaultProps(): MarkdownCardShape["props"] {
		return {
			w: 360,
			h: 240,
			content: "",
		};
	}

	override canResize() {
		return true;
	}

	override canEdit() {
		return true;
	}

	override hideSelectionBoundsBg(shape: MarkdownCardShape) {
		return this.editor.getEditingShapeId() === shape.id;
	}

	override hideSelectionBoundsFg(shape: MarkdownCardShape) {
		return this.editor.getEditingShapeId() === shape.id;
	}

	override isAspectRatioLocked() {
		return false;
	}

	override getGeometry(shape: MarkdownCardShape) {
		return new Rectangle2d({
			width: shape.props.w,
			height: shape.props.h,
			isFilled: true,
		});
	}

	override getIndicatorPath(shape: MarkdownCardShape): Path2D {
		const path = new Path2D();
		path.rect(0, 0, shape.props.w, shape.props.h);
		return path;
	}

	override onResize(
		shape: MarkdownCardShape,
		info: TLResizeInfo<MarkdownCardShape>,
	) {
		const resized = resizeBox(shape, info, { minWidth: 220, minHeight: 64 });

		return {
			...resized,
			props: {
				...resized.props,
				h: shape.props.h,
			},
		};
	}

	override component(shape: MarkdownCardShape) {
		return <MarkdownCardComponent shape={shape} />;
	}
}

function SubwhiteboardLinkComponent({
	shape,
}: {
	shape: SubwhiteboardLinkShape;
}) {
	const editor = useEditor();
	const isEditing = useIsEditing(shape.id);
	const updateTitle = useMutation(api.whiteboards.updateTitle);
	const inputRef = useRef<HTMLInputElement>(null);
	const isFocusedRef = useRef(false);
	const skipNextBlurSaveRef = useRef(false);
	const [draftTitle, setDraftTitle] = useState(shape.props.label);
	const displayedId = shape.props.childWhiteboardId ?? shape.props.subwhiteboardId;

	useEffect(() => {
		if (isFocusedRef.current) return;
		setDraftTitle(shape.props.label);
	}, [shape.props.label]);

	useEffect(() => {
		if (!isEditing) return;

		const input = inputRef.current;
		if (!input) return;

		input.focus();
		input.select();
	}, [isEditing]);

	const saveTitle = useCallback(() => {
		const nextTitle =
			draftTitle.replace(/\s+/g, " ").trim() || "Untitled whiteboard";

		if (nextTitle !== shape.props.label) {
			editor.updateShape<SubwhiteboardLinkShape>({
				id: shape.id,
				type: "subwhiteboard-link",
				props: {
					...shape.props,
					label: nextTitle,
				},
			});
		}

		if (shape.props.childWhiteboardId) {
			void updateTitle({
				whiteboardId: shape.props.childWhiteboardId as Id<"whiteboards">,
				title: nextTitle,
			});
		}

		setDraftTitle(nextTitle);
	}, [draftTitle, editor, shape.id, shape.props, updateTitle]);

	return (
		<HTMLContainer>
			<div className="flex h-full w-full flex-col justify-between rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-[var(--card-foreground)] shadow-sm">
				<div className="flex items-center gap-2 text-[15px] font-bold leading-5">
					<span className="grid h-7 w-7 shrink-0 place-items-center rounded bg-[var(--accent)] text-[16px] text-[var(--lagoon-deep)]">
						-&gt;
					</span>
					<input
						ref={inputRef}
						className="min-w-0 flex-1 truncate rounded border border-transparent bg-transparent px-1 py-0.5 font-bold text-[var(--card-foreground)] outline-none transition focus:border-[var(--border)] focus:bg-[var(--background)]"
						value={draftTitle}
						aria-label="Whiteboard name"
						spellCheck
						style={{ pointerEvents: "auto" }}
						onFocus={() => {
							isFocusedRef.current = true;
						}}
						onPointerDown={(event) => {
							editor.markEventAsHandled(event);
							event.stopPropagation();
						}}
						onPointerUp={(event) => {
							editor.markEventAsHandled(event);
							event.stopPropagation();
						}}
						onClick={(event) => {
							editor.markEventAsHandled(event);
							event.stopPropagation();
						}}
						onDoubleClick={(event) => {
							editor.markEventAsHandled(event);
							event.stopPropagation();
						}}
						onChange={(event) => setDraftTitle(event.currentTarget.value)}
						onKeyDown={(event) => {
							editor.markEventAsHandled(event);

							if (event.key === "Enter") {
								event.preventDefault();
								inputRef.current?.blur();
							}

							if (event.key === "Escape") {
								event.preventDefault();
								skipNextBlurSaveRef.current = true;
								setDraftTitle(shape.props.label);
								inputRef.current?.blur();
							}
						}}
						onBlur={() => {
							isFocusedRef.current = false;
							if (skipNextBlurSaveRef.current) {
								skipNextBlurSaveRef.current = false;
								return;
							}
							saveTitle();
						}}
					/>
				</div>
				<div className="truncate font-mono text-[11px] leading-4 text-[var(--muted-foreground)]">
					{shape.props.depth !== undefined
						? `depth ${shape.props.depth} - ${displayedId}`
						: displayedId}
				</div>
			</div>
		</HTMLContainer>
	);
}

export class SubwhiteboardLinkShapeUtil extends BaseBoxShapeUtil<SubwhiteboardLinkShape> {
	static override type = "subwhiteboard-link" as const;
	static override props = subwhiteboardLinkShapeProps;

	override getDefaultProps(): SubwhiteboardLinkShape["props"] {
		return {
			w: 220,
			h: 84,
			label: "Sub-whiteboard",
			subwhiteboardId: makeSubwhiteboardId(),
		};
	}

	override canResize() {
		return true;
	}

	override canEdit() {
		return true;
	}

	override isAspectRatioLocked() {
		return false;
	}

	override getGeometry(shape: SubwhiteboardLinkShape) {
		return new Rectangle2d({
			width: shape.props.w,
			height: shape.props.h,
			isFilled: true,
		});
	}

	override getIndicatorPath(shape: SubwhiteboardLinkShape): Path2D {
		const path = new Path2D();
		path.rect(0, 0, shape.props.w, shape.props.h);
		return path;
	}

	override onResize(
		shape: SubwhiteboardLinkShape,
		info: TLResizeInfo<SubwhiteboardLinkShape>,
	) {
		return resizeBox(shape, info, { minWidth: 180, minHeight: 64 });
	}

	override component(shape: SubwhiteboardLinkShape) {
		return <SubwhiteboardLinkComponent shape={shape} />;
	}
}

export const whiteboardShapeUtils = [
	TextCardShapeUtil,
	SubwhiteboardLinkShapeUtil,
] as const;

export const markdownWhiteboardShapeUtils = [
	MarkdownCardShapeUtil,
	SubwhiteboardLinkShapeUtil,
] as const;

export function createTextCardShape(
	editor: Editor,
	point: VecLike,
	options: { centered?: boolean } = {},
) {
	const props = new TextCardShapeUtil(editor).getDefaultProps();
	const id = createShapeId();
	const x = options.centered ? point.x - props.w / 2 : point.x;
	const y = options.centered ? point.y - props.h / 2 : point.y;

	editor.markHistoryStoppingPoint("create text card");
	editor.createShape<TextCardShape>({
		id,
		type: "text-card",
		x,
		y,
		props,
	});
	editor.select(id);
}

export function createMarkdownCardShape(
	editor: Editor,
	point: VecLike,
	options: { centered?: boolean } = {},
) {
	const props = new MarkdownCardShapeUtil(editor).getDefaultProps();
	const id = createShapeId();
	const x = options.centered ? point.x - props.w / 2 : point.x;
	const y = options.centered ? point.y - props.h / 2 : point.y;

	editor.markHistoryStoppingPoint("create markdown card");
	editor.createShape<MarkdownCardShape>({
		id,
		type: "markdown-card",
		x,
		y,
		props,
	});
	editor.select(id);
}

export function createSubwhiteboardLinkShape(editor: Editor, point: VecLike) {
	const props = new SubwhiteboardLinkShapeUtil(editor).getDefaultProps();
	const id = createShapeId();

	editor.markHistoryStoppingPoint("create sub-whiteboard link");
	editor.createShape<SubwhiteboardLinkShape>({
		id,
		type: "subwhiteboard-link",
		x: point.x - props.w / 2,
		y: point.y - props.h / 2,
		props: {
			...props,
			subwhiteboardId: makeSubwhiteboardId(),
		},
	});
	editor.select(id);
}
