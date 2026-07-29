import { type RecordProps, T, type TLBaseShape } from "tldraw";

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

export function getBoxIndicatorPath(width: number, height: number) {
	const path = new Path2D();
	path.rect(0, 0, width, height);
	return path;
}

export function getShapeContainerStyle(width: number, height: number) {
	return {
		width,
		height,
	};
}
