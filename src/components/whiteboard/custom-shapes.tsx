import { Link } from "@tanstack/react-router";
import type { JSONContent } from "@tiptap/core";
import { useMutation } from "convex/react";
import { useSetAtom } from "jotai";
import { ExternalLink } from "lucide-react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	BaseBoxShapeUtil,
	createShapeId,
	type Editor,
	HTMLContainer,
	type RecordProps,
	Rectangle2d,
	resizeBox,
	stopEventPropagation,
	T,
	type TLBaseShape,
	type TLResizeInfo,
	useEditor,
	useIsEditing,
	type VecLike,
} from "tldraw";
import { CardDocumentEditor } from "#/components/cards/CardDocumentEditor";
import { useDebouncedCardSave } from "#/components/cards/useDebouncedCardSave";
import { StaticRichTextRenderer } from "#/components/editor/static-renderer";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { whiteboardPreviewCardIdAtom } from "../../lib/atoms";
import { RichTextEditor } from "../editor/RichTextEditor";
import { resolveMarkdownCardHeight } from "./markdown-card-sizing";
import { hydrateCardShapes } from "./whiteboard-canvas-helpers";

/**
 * The whiteboard a markdown card lives on, so its editor can offer card
 * references scoped to the current board (empty-`@` recent cards). Provided by
 * `WhiteboardCanvas`; null on the root board / when unavailable.
 */
export const WhiteboardCardContext = createContext<Id<"whiteboards"> | null>(
	null,
);

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
		title?: string;
		preview?: string;
		contentLoaded?: boolean;
		contentVersion?: number;
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
	title: T.string.optional(),
	preview: T.string.optional(),
	contentLoaded: T.boolean.optional(),
	contentVersion: T.number.optional(),
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
		<HTMLContainer style={getShapeContainerStyle(shape.props.w, shape.props.h)}>
			<textarea
				ref={textareaRef}
				className="h-full w-full resize-none rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-[15px] leading-5 text-[var(--card-foreground)] shadow-sm outline-none transition focus:border-[var(--ring)]"
				value={shape.props.text}
				placeholder="Type..."
				spellCheck
				readOnly={!isEditing}
				tabIndex={isEditing ? 0 : -1}
				style={{ pointerEvents: isEditing ? "auto" : "none" }}
				onPointerDown={(e) => stopEventPropagation(e)}
				onPointerUp={(e) => stopEventPropagation(e)}
				onClick={(e) => stopEventPropagation(e)}
				onDoubleClick={(e) => stopEventPropagation(e)}
				onKeyDown={(e) => {
					stopEventPropagation(e);

					if (e.key === "Escape") {
						editor.setEditingShape(null);
						return;
					}

					if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
						editor.complete();
					}
				}}
				onPaste={(e) => stopEventPropagation(e)}
				onWheel={(e) => stopEventPropagation(e)}
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

function isConvexCardLoaded(shape: MarkdownCardShape) {
	return !shape.props.cardId || shape.props.contentLoaded === true;
}

function SummaryCardShell({
	shape,
}: {
	shape: MarkdownCardShape;
}) {
	const cardId = shape.props.cardId as Id<"cards">;
	const hasSummary = Boolean(shape.props.title || shape.props.preview);

	return (
		<HTMLContainer style={getShapeContainerStyle(shape.props.w, shape.props.h)}>
			<div className="relative h-full w-full overflow-hidden rounded-md border border-[var(--border)] bg-[var(--card)] text-[var(--card-foreground)] shadow-sm">
				<Link
					to="/cards/$cardId"
					params={{ cardId }}
					draggable={false}
					onPointerDown={(e) => {
						stopEventPropagation(e);
						e.stopPropagation();
					}}
					onPointerUp={(e) => {
						stopEventPropagation(e);
						e.stopPropagation();
					}}
					onClick={(e) => {
						stopEventPropagation(e);
						e.stopPropagation();
					}}
					className="absolute right-2 top-2 z-10 flex size-6 items-center justify-center rounded bg-[var(--card)] text-[var(--muted-foreground)] shadow-sm transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
					style={{ pointerEvents: "auto" }}
					aria-label="Open card editor"
				>
					<ExternalLink className="size-3.5" />
				</Link>
				<div className="flex h-full flex-col px-8 py-8">
					<div className="mb-3 inline-flex w-fit rounded-full border border-[var(--border)] bg-[var(--background)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
						Loading card
					</div>
					{hasSummary ? (
						<>
							<div className="text-base font-semibold leading-6">
								{shape.props.title || "Untitled card"}
							</div>
							<div className="mt-3 line-clamp-6 whitespace-pre-wrap text-sm leading-6 text-[var(--muted-foreground)]">
								{shape.props.preview || "No preview yet."}
							</div>
						</>
					) : (
						<>
							<div className="text-base font-semibold leading-6">
								Card content
							</div>
							<div className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
								Content loads when the card enters view.
							</div>
						</>
					)}
				</div>
			</div>
		</HTMLContainer>
	);
}

function isMarkdownCardVisible(card: HTMLDivElement | null) {
	return Boolean(card && card.getClientRects().length > 0);
}

function getMeasuredMarkdownCardHeight({
	card,
	currentHeight,
	headerHeight,
	minHeight,
	isContentReady,
}: {
	card: HTMLDivElement | null;
	currentHeight: number;
	headerHeight: number;
	minHeight: number;
	isContentReady: boolean;
}) {
	return resolveMarkdownCardHeight({
		currentHeight,
		measuredScrollHeight: card ? Math.ceil(card.scrollHeight) : null,
		headerHeight,
		minHeight,
		isContentReady,
		isVisible: isMarkdownCardVisible(card),
	});
}

function getBoxIndicatorPath(width: number, height: number) {
	const path = new Path2D();
	path.rect(0, 0, width, height);
	return path;
}

function getShapeContainerStyle(width: number, height: number) {
	return {
		width,
		height,
	};
}

export function MarkdownCardComponent({ shape }: { shape: MarkdownCardShape }) {
	if (shape.props.cardId) {
		if (!shape.props.contentLoaded) {
			return <SummaryCardShell shape={shape} />;
		}
		return <ConvexMarkdownCardComponent shape={shape} />;
	}

	return <LocalMarkdownCardComponent shape={shape} />;
}

export function ConvexMarkdownCardComponent({
	shape,
}: {
	shape: MarkdownCardShape;
}) {
	const editor = useEditor();
	const isEditing = useIsEditing(shape.id);
	const cardId = shape.props.cardId as Id<"cards">;
	const boardWhiteboardId = useContext(WhiteboardCardContext);
	const openWhiteboardPreview = useSetAtom(whiteboardPreviewCardIdAtom);
	const currentContent = useMemo(
		() => parseMarkdownContent(shape.props.content),
		[shape.props.content],
	);
	const { scheduleSave: schedulePersistedSave } = useDebouncedCardSave(
		cardId,
		450,
		{
			initialContent: currentContent,
			onPersisted: ({ content, version }) => {
				hydrateCardShapes(editor, { cardId, content, version });
			},
		},
	);
	const cardRef = useRef<HTMLDivElement>(null);
	const latestPropsRef = useRef(shape.props);
	const syncFrameRef = useRef<number | null>(null);
	const [isContentReady, setIsContentReady] = useState(false);
	const staticContent = currentContent;
	latestPropsRef.current = shape.props;
	const HEADER_HEIGHT = 28;
	const MIN_HEIGHT = 96;

	const syncHeight = useCallback(() => {
		syncFrameRef.current = null;
		const latestProps = latestPropsRef.current;
		const nextHeight = getMeasuredMarkdownCardHeight({
			card: cardRef.current,
			currentHeight: latestProps.h,
			headerHeight: HEADER_HEIGHT,
			minHeight: MIN_HEIGHT,
			isContentReady,
		});

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
	}, [editor, isContentReady, shape.id]);

	const scheduleSyncHeight = useCallback(() => {
		if (syncFrameRef.current !== null) return;
		syncFrameRef.current = window.requestAnimationFrame(syncHeight);
	}, [syncHeight]);

	const scheduleSave = useCallback(
		(value: JSONContent) => {
			const serializedContent = JSON.stringify(value);
			const latestProps = latestPropsRef.current;
			const nextHeight = getMeasuredMarkdownCardHeight({
				card: cardRef.current,
				currentHeight: latestProps.h,
				headerHeight: HEADER_HEIGHT,
				minHeight: MIN_HEIGHT,
				isContentReady,
			});

			editor.updateShape<MarkdownCardShape>({
				id: shape.id,
				type: "markdown-card",
				props: {
					...latestProps,
					content: serializedContent,
					h: nextHeight,
				},
			});

			schedulePersistedSave(value);
		},
		[editor, isContentReady, schedulePersistedSave, shape.id],
	);

	useLayoutEffect(() => {
		const card = cardRef.current;
		if (!card) return;

		scheduleSyncHeight();

		const resizeObserver = new ResizeObserver(scheduleSyncHeight);
		resizeObserver.observe(card);

		return () => {
			resizeObserver.disconnect();
			if (syncFrameRef.current !== null) {
				window.cancelAnimationFrame(syncFrameRef.current);
				syncFrameRef.current = null;
			}
		};
	}, [scheduleSyncHeight]);

	useEffect(() => {
		if (!isContentReady) return;
		scheduleSyncHeight();
	}, [isContentReady, scheduleSyncHeight]);
	const selectInitialContent = isEmptyCardContent(currentContent);

	return (
		<HTMLContainer style={getShapeContainerStyle(shape.props.w, shape.props.h)}>
			{/** biome-ignore lint/a11y/noStaticElementInteractions: tldraw shapes guard pointer/keyboard events here. */}
			<div
				className="relative h-full w-full overflow-hidden rounded-md border border-[var(--border)] bg-[var(--card)] text-[var(--card-foreground)] shadow-sm transition focus-within:border-[var(--ring)]"
				style={{ pointerEvents: isEditing ? "auto" : "none" }}
				onPointerDown={(e) => {
					if (isEditing) stopEventPropagation(e);
				}}
				onPointerUp={(e) => {
					if (isEditing) stopEventPropagation(e);
				}}
				onClick={(e) => {
					if (isEditing) stopEventPropagation(e);
				}}
				onDoubleClick={(e) => {
					if (isEditing) stopEventPropagation(e);
				}}
				onKeyDown={(e) => {
					if (!isEditing) return;
					stopEventPropagation(e);

					if (e.key === "Escape") {
						editor.setEditingShape(null);
					}
				}}
				onPaste={(e) => {
					if (isEditing) stopEventPropagation(e);
				}}
				onWheel={(e) => {
					if (isEditing) stopEventPropagation(e);
				}}
			>
				<Link
					to="/cards/$cardId"
					params={{ cardId }}
					draggable={false}
					onPointerDown={(e) => {
						stopEventPropagation(e);
						e.stopPropagation();
					}}
					onPointerUp={(e) => {
						stopEventPropagation(e);
						e.stopPropagation();
					}}
					onClick={(e) => {
						stopEventPropagation(e);
						e.stopPropagation();
					}}
					className="absolute right-2 top-2 z-10 flex size-6 items-center justify-center rounded bg-[var(--card)] text-[var(--muted-foreground)] shadow-sm transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
					style={{ pointerEvents: "auto" }}
					aria-label="Open card editor"
				>
					<ExternalLink className="size-3.5" />
				</Link>
				<div ref={cardRef} className="w-full px-8 py-8">
					{isEditing ? (
						<CardDocumentEditor
							editable
							content={currentContent}
							whiteboardId={boardWhiteboardId}
							onOpenPreview={openWhiteboardPreview}
							contentClassName="min-h-12 pr-7"
							placeholder="Type '/' for commands"
							onChange={scheduleSave}
							onReady={() => setIsContentReady(true)}
							defaultFocusPosition={selectInitialContent ? "start" : "end"}
							selectContentOnFocus={selectInitialContent}
						/>
					) : (
						<StaticRichTextRenderer
							content={staticContent}
							contentClassName="min-h-12 pr-7"
							onReady={() => setIsContentReady(true)}
						/>
					)}
				</div>
			</div>
		</HTMLContainer>
	);
}

export function LocalMarkdownCardComponent({
	shape,
}: {
	shape: MarkdownCardShape;
}) {
	const editor = useEditor();
	const isEditing = useIsEditing(shape.id);
	const cardRef = useRef<HTMLDivElement>(null);
	const latestPropsRef = useRef(shape.props);
	const syncFrameRef = useRef<number | null>(null);
	const [isContentReady, setIsContentReady] = useState(false);
	const currentContent = useMemo(
		() => parseMarkdownContent(shape.props.content),
		[shape.props.content],
	);
	const staticContent = currentContent;

	latestPropsRef.current = shape.props;
	const HEADER_HEIGHT = 28;
	const MIN_HEIGHT = 64;
	const selectInitialContent = isEmptyCardContent(currentContent);

	const syncHeight = useCallback(() => {
		syncFrameRef.current = null;
		const latestProps = latestPropsRef.current;
		const nextHeight = getMeasuredMarkdownCardHeight({
			card: cardRef.current,
			currentHeight: latestProps.h,
			headerHeight: HEADER_HEIGHT,
			minHeight: MIN_HEIGHT,
			isContentReady,
		});

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
	}, [editor, isContentReady, shape.id]);

	const scheduleSyncHeight = useCallback(() => {
		if (syncFrameRef.current !== null) return;
		syncFrameRef.current = window.requestAnimationFrame(syncHeight);
	}, [syncHeight]);

	useLayoutEffect(() => {
		const card = cardRef.current;
		if (!card) return;

		scheduleSyncHeight();

		const resizeObserver = new ResizeObserver(scheduleSyncHeight);
		resizeObserver.observe(card);

		return () => {
			resizeObserver.disconnect();
			if (syncFrameRef.current !== null) {
				window.cancelAnimationFrame(syncFrameRef.current);
				syncFrameRef.current = null;
			}
		};
	}, [scheduleSyncHeight]);

	useEffect(() => {
		if (!isContentReady) return;
		scheduleSyncHeight();
	}, [isContentReady, scheduleSyncHeight]);

	return (
		<HTMLContainer style={getShapeContainerStyle(shape.props.w, shape.props.h)}>
			{/** biome-ignore lint/a11y/noStaticElementInteractions: tldraw shapes guard pointer/keyboard events here. */}
			<div
				className="h-full w-full overflow-hidden rounded-md border border-[var(--border)] bg-[var(--card)] text-[var(--card-foreground)] shadow-sm transition focus-within:border-[var(--ring)]"
				style={{ pointerEvents: isEditing ? "auto" : "none" }}
				onPointerDown={(e) => {
					if (isEditing) stopEventPropagation(e);
				}}
				onPointerUp={(e) => {
					if (isEditing) stopEventPropagation(e);
				}}
				onClick={(e) => {
					if (isEditing) stopEventPropagation(e);
				}}
				onDoubleClick={(e) => {
					if (isEditing) stopEventPropagation(e);
				}}
				onKeyDown={(e) => {
					if (!isEditing) return;
					stopEventPropagation(e);

					if (e.key === "Escape") {
						editor.setEditingShape(null);
					}
				}}
				onPaste={(e) => {
					if (isEditing) stopEventPropagation(e);
				}}
				onWheel={(e) => {
					if (isEditing) stopEventPropagation(e);
				}}
			>
				<div ref={cardRef} className="w-full">
					<div
						className="flex items-center justify-end border-b border-[var(--border)] px-2 py-1"
						style={{ pointerEvents: "auto" }}
						onPointerDown={(e) => {
							if (isEditing) stopEventPropagation(e);
						}}
					>
						<Link
							to="/test/markdown"
							draggable={false}
							onPointerDown={(e) => {
								stopEventPropagation(e);
								e.stopPropagation();
							}}
							onPointerUp={(e) => {
								stopEventPropagation(e);
								e.stopPropagation();
							}}
							onClick={(e) => {
								stopEventPropagation(e);
								e.stopPropagation();
							}}
							className="flex size-5 items-center justify-center rounded text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
						>
							<ExternalLink className="size-3.5" />
						</Link>
					</div>
					<div className="px-8 py-8">
						{isEditing ? (
							<RichTextEditor
								editable
								content={currentContent}
								contentClassName="min-h-6"
								placeholder="Type '/' for commands"
								onChange={(value) => {
									const latestProps = latestPropsRef.current;
									const nextHeight = getMeasuredMarkdownCardHeight({
										card: cardRef.current,
										currentHeight: latestProps.h,
										headerHeight: HEADER_HEIGHT,
										minHeight: MIN_HEIGHT,
										isContentReady,
									});

									editor.updateShape<MarkdownCardShape>({
										id: shape.id,
										type: "markdown-card",
										props: {
											...latestProps,
											content: JSON.stringify(value),
											h: nextHeight,
										},
									});
								}}
								onReady={() => setIsContentReady(true)}
								defaultFocusPosition={selectInitialContent ? "start" : "end"}
								selectContentOnFocus={selectInitialContent}
							/>
						) : (
							<StaticRichTextRenderer
								content={staticContent}
								contentClassName="min-h-6"
								onReady={() => setIsContentReady(true)}
							/>
						)}
					</div>
				</div>
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

	override indicator(shape: TextCardShape) {
		return <rect width={shape.props.w} height={shape.props.h} />;
	}

	getIndicatorPath(shape: TextCardShape): Path2D {
		return getBoxIndicatorPath(shape.props.w, shape.props.h);
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

	override canEdit(shape: MarkdownCardShape) {
		return isConvexCardLoaded(shape);
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

	override indicator(shape: MarkdownCardShape) {
		return <rect width={shape.props.w} height={shape.props.h} />;
	}

	getIndicatorPath(shape: MarkdownCardShape): Path2D {
		return getBoxIndicatorPath(shape.props.w, shape.props.h);
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
	const displayedId =
		shape.props.childWhiteboardId ?? shape.props.subwhiteboardId;

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
		<HTMLContainer style={getShapeContainerStyle(shape.props.w, shape.props.h)}>
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
							stopEventPropagation(event);
							event.stopPropagation();
						}}
						onPointerUp={(event) => {
							stopEventPropagation(event);
							event.stopPropagation();
						}}
						onClick={(event) => {
							stopEventPropagation(event);
							event.stopPropagation();
						}}
						onDoubleClick={(event) => {
							stopEventPropagation(event);
							event.stopPropagation();
						}}
						onChange={(event) => setDraftTitle(event.currentTarget.value)}
						onKeyDown={(event) => {
							stopEventPropagation(event);

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

	override indicator(shape: SubwhiteboardLinkShape) {
		return <rect width={shape.props.w} height={shape.props.h} />;
	}

	getIndicatorPath(shape: SubwhiteboardLinkShape): Path2D {
		return getBoxIndicatorPath(shape.props.w, shape.props.h);
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
