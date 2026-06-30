import { useEffect, useRef } from "react";
import {
	BaseBoxShapeUtil,
	createShapeId,
	type Editor,
	HTMLContainer,
	Rectangle2d,
	resizeBox,
	stopEventPropagation,
	type TLResizeInfo,
	useEditor,
	useIsEditing,
	type VecLike,
} from "tldraw";
import {
	getBoxIndicatorPath,
	getShapeContainerStyle,
	type TextCardShape,
	textCardShapeProps,
} from "./MarkdownCardShapeTypes";

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
