import { useApplicationRuntime } from "@contextboard/application";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	BaseBoxShapeUtil,
	createShapeId,
	type Editor,
	HTMLContainer,
	Rectangle2d,
	resizeBox,
	stopEventPropagation,
	type TLResizeInfo,
	type TLShape,
	useEditor,
	type VecLike,
} from "tldraw";
import type { Id } from "./ids";
import {
	getBoxIndicatorPath,
	getShapeContainerStyle,
	type SubwhiteboardLinkShape,
	subwhiteboardLinkShapeProps,
} from "./MarkdownCardShapeTypes";

type SubwhiteboardDropHandler = (
	target: SubwhiteboardLinkShape,
	shapes: TLShape[],
) => void;

const dropHandlers = new WeakMap<Editor, SubwhiteboardDropHandler>();

export function registerSubwhiteboardDropHandler(
	editor: Editor,
	handler: SubwhiteboardDropHandler,
) {
	dropHandlers.set(editor, handler);
	return () => {
		if (dropHandlers.get(editor) === handler) dropHandlers.delete(editor);
	};
}

export function dispatchSubwhiteboardDrop(
	editor: Editor,
	target: SubwhiteboardLinkShape,
	shapes: TLShape[],
) {
	dropHandlers.get(editor)?.(target, shapes);
}

export function makeSubwhiteboardId() {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}

	return `sub-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function SubwhiteboardLinkComponent({
	shape,
}: {
	shape: SubwhiteboardLinkShape;
}) {
	const editor = useEditor();
	const { whiteboards } = useApplicationRuntime();
	const updateTitle = useCallback(
		async (input: { whiteboardId: string; title: string }) => {
			await whiteboards?.rename(input);
		},
		[whiteboards],
	);
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
			<div className="flex h-full w-full flex-col justify-between rounded-md border border-[var(--border)] bg-[var(--card)] px-6 py-5 text-[var(--card-foreground)] shadow-sm">
				<div className="flex items-center gap-3 text-[26px] font-bold leading-8">
					<span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[var(--accent)] text-[22px] text-[var(--lagoon-deep)]">
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
				<div className="truncate font-mono text-[14px] leading-5 text-[var(--muted-foreground)]">
					{shape.props.cardCount !== undefined
						? `${shape.props.cardCount} cards · ${shape.props.childWhiteboardCount ?? 0} boards`
						: shape.props.depth !== undefined
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
			w: 384,
			h: 208,
			label: "Sub-whiteboard",
			subwhiteboardId: makeSubwhiteboardId(),
		};
	}

	override canResize() {
		return true;
	}

	override canEdit() {
		return false;
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
		return resizeBox(shape, info, { minWidth: 240, minHeight: 132 });
	}

	override onDropShapesOver(shape: SubwhiteboardLinkShape, shapes: TLShape[]) {
		dispatchSubwhiteboardDrop(this.editor, shape, shapes);
	}

	override component(shape: SubwhiteboardLinkShape) {
		return <SubwhiteboardLinkComponent shape={shape} />;
	}
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
