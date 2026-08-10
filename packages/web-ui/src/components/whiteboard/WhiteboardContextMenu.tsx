import type { ArrangeStyle } from "@contextboard/application/canvas";
import { createContext, useContext } from "react";
import {
	DefaultContextMenuContent,
	type TLUiContextMenuProps,
	TldrawUiMenuGroup,
	TldrawUiMenuItem,
	TldrawUiMenuSubmenu,
	useEditor,
} from "tldraw";
import { applyAutoArrange, canAutoArrange } from "./auto-arrange";
import { ControlledTldrawContextMenu } from "./ControlledTldrawContextMenu";
import { useWhiteboardNavigation } from "./navigation";
import {
	isMarkdownCardShape,
	isSubwhiteboardLinkShape,
	type WhiteboardContextMenuValue,
} from "./whiteboard-canvas-helpers";

export type { WhiteboardContextMenuValue };

export const WhiteboardContextMenuContext =
	createContext<WhiteboardContextMenuValue | null>(null);

const CARD_ARRANGEMENT_OPTIONS = [
	{ id: "arrange-cards-auto", label: "Auto arrange", style: "auto" },
	{
		id: "arrange-cards-tree-horizontal",
		label: "Tree (horizontal)",
		style: "tree-horizontal",
	},
	{
		id: "arrange-cards-tree-vertical",
		label: "Tree (vertical)",
		style: "tree-vertical",
	},
	{ id: "arrange-cards-mindmap", label: "Mindmap", style: "mindmap" },
	{ id: "arrange-cards-graph", label: "Graph", style: "graph" },
] as const satisfies readonly {
	id: string;
	label: string;
	style: ArrangeStyle;
}[];

export function WhiteboardContextMenu(props: TLUiContextMenuProps) {
	return (
		<ControlledTldrawContextMenu {...props}>
			<WhiteboardContextMenuContent />
			<DefaultContextMenuContent />
		</ControlledTldrawContextMenu>
	);
}

function WhiteboardContextMenuContent() {
	const editor = useEditor();
	const navigate = useWhiteboardNavigation();
	const context = useContext(WhiteboardContextMenuContext);

	if (!context) return null;

	const getMenuPoint = () => {
		const point = context.pointRef.current;
		return point ? { x: point.x, y: point.y } : editor.inputs.currentPagePoint;
	};

	const onlySelectedShape = editor.getOnlySelectedShape();
	const canEnterFullscreen =
		onlySelectedShape &&
		(isMarkdownCardShape(onlySelectedShape) ||
			isSubwhiteboardLinkShape(onlySelectedShape));

	return (
		<TldrawUiMenuGroup id="whiteboard-persistence">
			{canAutoArrange(editor) && (
				<TldrawUiMenuSubmenu
					id="arrange-cards"
					label="Arrange cards"
					size="small"
				>
					<TldrawUiMenuGroup id="arrange-cards-options">
						{CARD_ARRANGEMENT_OPTIONS.map(({ id, label, style }) => (
							<TldrawUiMenuItem
								key={id}
								id={id}
								label={label}
								onSelect={() => {
									applyAutoArrange(editor, style);
								}}
							/>
						))}
					</TldrawUiMenuGroup>
				</TldrawUiMenuSubmenu>
			)}
			{canEnterFullscreen && (
				<TldrawUiMenuItem
					id="enter-fullscreen"
					label="Enter fullscreen"
					onSelect={() => {
						if (
							isMarkdownCardShape(onlySelectedShape) &&
							onlySelectedShape.props.cardId
						) {
							navigate.openCard(onlySelectedShape.props.cardId);
						} else if (
							isSubwhiteboardLinkShape(onlySelectedShape) &&
							onlySelectedShape.props.childWhiteboardId
						) {
							navigate.openWhiteboard(
								onlySelectedShape.props.childWhiteboardId,
							);
						}
					}}
				/>
			)}
			{context.createCardAt && (
				<TldrawUiMenuItem
					id="add-markdown-card"
					label="Add markdown card"
					onSelect={() => context.createCardAt?.(getMenuPoint())}
				/>
			)}
			<TldrawUiMenuItem
				id="add-sub-whiteboard-link"
				label={
					context.createCardAt ? "Add sub-whiteboard link" : "Add whiteboard"
				}
				onSelect={() => context.createSubwhiteboardAt(getMenuPoint())}
			/>
		</TldrawUiMenuGroup>
	);
}
