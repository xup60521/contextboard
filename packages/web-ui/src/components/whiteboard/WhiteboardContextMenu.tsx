import { useWhiteboardNavigation } from "./navigation";
import { createContext, useContext } from "react";
import {
	DefaultContextMenuContent,
	type TLUiContextMenuProps,
	TldrawUiMenuGroup,
	TldrawUiMenuItem,
	useEditor,
} from "tldraw";
import { ControlledTldrawContextMenu } from "./ControlledTldrawContextMenu";
import {
	isMarkdownCardShape,
	isSubwhiteboardLinkShape,
	type WhiteboardContextMenuValue,
} from "./whiteboard-canvas-helpers";

export { type WhiteboardContextMenuValue };

export const WhiteboardContextMenuContext =
	createContext<WhiteboardContextMenuValue | null>(null);

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
