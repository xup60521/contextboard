import { useEffect, useRef } from "react";
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

declare module "@tldraw/tlschema" {
	interface TLGlobalShapePropsMap {
		"text-card": {
			w: number;
			h: number;
			text: string;
		};
		"subwhiteboard-link": {
			w: number;
			h: number;
			label: string;
			subwhiteboardId: string;
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

export type SubwhiteboardLinkShape = TLBaseShape<
	"subwhiteboard-link",
	{
		w: number;
		h: number;
		label: string;
		subwhiteboardId: string;
	}
>;

export const textCardShapeProps = {
	w: T.number,
	h: T.number,
	text: T.string,
} satisfies RecordProps<TextCardShape>;

export const subwhiteboardLinkShapeProps = {
	w: T.number,
	h: T.number,
	label: T.string,
	subwhiteboardId: T.string,
} satisfies RecordProps<SubwhiteboardLinkShape>;

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
				className="h-full w-full resize-none rounded-md border border-[#d7c897] bg-[#fff8d7] px-3 py-2 text-[15px] leading-5 text-[#243438] shadow-[0_10px_22px_rgba(88,78,36,0.16)] outline-none transition focus:border-[#5eb7ad] focus:bg-[#fffbea]"
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
		return (
			<HTMLContainer>
				<div className="flex h-full w-full flex-col justify-between rounded-md border border-[#7aa7a2] bg-[#eef9f6] px-3 py-2 text-[#173a40] shadow-[0_10px_22px_rgba(23,58,64,0.14)]">
					<div className="flex items-center gap-2 text-[15px] font-bold leading-5">
						<span className="grid h-7 w-7 shrink-0 place-items-center rounded bg-[#d7f1eb] text-[16px]">
							-&gt;
						</span>
						<span className="min-w-0 truncate">{shape.props.label}</span>
					</div>
					<div className="truncate font-mono text-[11px] leading-4 text-[#416166]">
						{shape.props.subwhiteboardId}
					</div>
				</div>
			</HTMLContainer>
		);
	}
}

export const whiteboardShapeUtils = [
	TextCardShapeUtil,
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
