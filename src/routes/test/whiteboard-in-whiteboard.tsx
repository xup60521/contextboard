import { createFileRoute } from "@tanstack/react-router";
import {
	DefaultContextMenu,
	DefaultContextMenuContent,
	type Editor,
	pointInPolygon,
	type TLComponents,
	type TLEventInfo,
	type TLShape,
	type TLUiContextMenuProps,
	Tldraw,
	type TldrawOptions,
	TldrawUiMenuGroup,
	TldrawUiMenuItem,
	useEditor,
	Vec,
	type VecLike,
} from "tldraw";
import {
	createSubwhiteboardLinkShape,
	createTextCardShape,
	whiteboardShapeUtils,
} from "../../components/whiteboard/custom-shapes";
import "tldraw/tldraw.css";

export const Route = createFileRoute("/test/whiteboard-in-whiteboard")({
	component: RouteComponent,
});

const whiteboardOptions = {
	createTextOnCanvasDoubleClick: false,
} satisfies Partial<TldrawOptions>;

const whiteboardComponents = {
	ContextMenu: WhiteboardContextMenu,
} satisfies TLComponents;

function RouteComponent() {
	const navigate = Route.useNavigate();

	return (
		<main className="h-[calc(100dvh-80px)] min-h-[620px] p-3">
			<div className="relative h-full overflow-hidden rounded-md border border-[var(--line)] bg-white shadow-[0_18px_38px_rgba(23,58,64,0.12)]">
				<Tldraw
					components={whiteboardComponents}
					onMount={(editor) => {
						const handleEvent = (info: TLEventInfo) => {
							if (
								info.type !== "click" ||
								info.name !== "double_click" ||
								info.phase !== "up"
							) {
								return;
							}

							const point = editor.inputs.getCurrentPagePoint();

							if (info.target === "shape") {
								if (info.shape.type === "subwhiteboard-link") {
									void navigate({
										to: "/test/subwhiteboard/$subwhiteboardid",
										params: {
											subwhiteboardid: info.shape.props.subwhiteboardId,
										},
									});
								}
								return;
							}

							if (info.target !== "canvas") return;

							const hitShape = getWhiteboardDoubleClickShape(editor, point);

							if (hitShape) {
								if (hitShape.type === "subwhiteboard-link") {
									void navigate({
										to: "/test/subwhiteboard/$subwhiteboardid",
										params: {
											subwhiteboardid: hitShape.props.subwhiteboardId,
										},
									});
								}

								return;
							}

							const hitOverlay = editor.overlays.getOverlayAtPoint(
								point,
								editor.options.hitTestMargin / editor.getZoomLevel(),
							);

							if (hitOverlay || isPointInCurrentSelection(editor, point))
								return;

							createTextCardShape(editor, point);
						};

						editor.on("event", handleEvent);

						return () => {
							editor.off("event", handleEvent);
						};
					}}
					options={whiteboardOptions}
					persistenceKey="contextboard-main-whiteboard-poc"
					shapeUtils={whiteboardShapeUtils}
				/>
			</div>
		</main>
	);
}

function getWhiteboardDoubleClickShape(
	editor: Editor,
	point: VecLike,
): TLShape | undefined {
	const hoveredShape = editor.getHoveredShape();

	if (hoveredShape && !editor.isShapeOfType(hoveredShape, "group")) {
		return hoveredShape;
	}

	return (
		editor.getSelectedShapeAtPoint(point) ??
		editor.getShapeAtPoint(point, {
			margin: editor.options.hitTestMargin / editor.getZoomLevel(),
			hitInside: true,
			hitLabels: true,
			hitLocked: true,
			hitFrameInside: true,
			renderingOnly: true,
		})
	);
}

function isPointInCurrentSelection(editor: Editor, point: VecLike) {
	const selectionBounds = editor.getSelectionRotatedPageBounds();

	if (!selectionBounds) return false;

	const selectionRotation = editor.getSelectionRotation();

	if (!selectionRotation) {
		return selectionBounds.containsPoint(point);
	}

	return pointInPolygon(
		point,
		selectionBounds.corners.map((corner) =>
			Vec.RotWith(corner, selectionBounds.point, selectionRotation),
		),
	);
}

function WhiteboardContextMenu(props: TLUiContextMenuProps) {
	return (
		<DefaultContextMenu {...props}>
			<DefaultContextMenuContent />
			<WhiteboardContextMenuContent />
		</DefaultContextMenu>
	);
}

function WhiteboardContextMenuContent() {
	const editor = useEditor();

	return (
		<TldrawUiMenuGroup id="whiteboard-poc">
			<TldrawUiMenuItem
				id="add-text-card"
				label="Add text card"
				onSelect={() => {
					createTextCardShape(editor, editor.inputs.getCurrentPagePoint(), {
						centered: true,
					});
				}}
			/>
			<TldrawUiMenuItem
				id="add-sub-whiteboard-link"
				label="Add sub-whiteboard link"
				onSelect={() => {
					createSubwhiteboardLinkShape(
						editor,
						editor.inputs.getCurrentPagePoint(),
					);
				}}
			/>
		</TldrawUiMenuGroup>
	);
}
