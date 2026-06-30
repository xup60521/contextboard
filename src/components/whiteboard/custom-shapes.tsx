import {
	BaseBoxShapeUtil,
	createShapeId,
	type Editor,
	Rectangle2d,
	resizeBox,
	type TLResizeInfo,
	type VecLike,
} from "tldraw";
import { ConvexMarkdownCardComponent } from "./ConvexMarkdownCardShape";
import { LocalMarkdownCardComponent } from "./LocalMarkdownCardShape";
import {
	getBoxIndicatorPath,
	type MarkdownCardShape,
	markdownCardShapeProps,
} from "./MarkdownCardShapeTypes";
import { MarkdownCardSummaryShell } from "./MarkdownCardShell";
import {
	createSubwhiteboardLinkShape,
	makeSubwhiteboardId,
	SubwhiteboardLinkShapeUtil,
} from "./SubwhiteboardLinkShape";
import { createTextCardShape, TextCardShapeUtil } from "./TextCardShape";

export type {
	MarkdownCardShape,
	SubwhiteboardLinkShape,
	TextCardShape,
} from "./MarkdownCardShapeTypes";
export {
	markdownCardShapeProps,
	subwhiteboardLinkShapeProps,
	textCardShapeProps,
} from "./MarkdownCardShapeTypes";
export { ConvexMarkdownCardComponent, LocalMarkdownCardComponent };
export {
	createSubwhiteboardLinkShape,
	makeSubwhiteboardId,
	SubwhiteboardLinkShapeUtil,
};
export { createTextCardShape, TextCardShapeUtil };
export { WhiteboardCardContext } from "./WhiteboardCardContext";

function isConvexCardLoaded(shape: MarkdownCardShape) {
	return !shape.props.cardId || shape.props.contentLoaded === true;
}

export function MarkdownCardComponent({ shape }: { shape: MarkdownCardShape }) {
	if (shape.props.cardId) {
		if (!shape.props.contentLoaded) {
			return <MarkdownCardSummaryShell shape={shape} />;
		}
		return <ConvexMarkdownCardComponent shape={shape} />;
	}

	return <LocalMarkdownCardComponent shape={shape} />;
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

export const whiteboardShapeUtils = [
	TextCardShapeUtil,
	SubwhiteboardLinkShapeUtil,
] as const;

export const markdownWhiteboardShapeUtils = [
	MarkdownCardShapeUtil,
	SubwhiteboardLinkShapeUtil,
] as const;

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
