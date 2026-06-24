import { createFileRoute } from "@tanstack/react-router";
import { ContextMenu as RadixContextMenu } from "radix-ui";
import { createContext, useCallback, useContext, useEffect, useRef } from "react";
import {
	DefaultContextMenuContent,
	type Editor,
	pointInPolygon,
	preventDefault,
	type TLComponents,
	type TLEventInfo,
	type TLShape,
	type TLUiContextMenuProps,
	Tldraw,
	type TldrawOptions,
	TldrawUiMenuContextProvider,
	TldrawUiMenuGroup,
	TldrawUiMenuItem,
	useContainer,
	useDirection,
	useEditor,
	useEditorComponents,
	useMenuIsOpen,
	useTranslation,
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
	// Disable right-click panning so the context menu opens reliably via the
	// native contextmenu path instead of tldraw's synthetic-event-on-pointerup
	// mechanism (which is gated on `inputs.isPanning` and could get stuck).
	rightClickPanning: false,
} satisfies Partial<TldrawOptions>;

const whiteboardComponents = {
	ContextMenu: WhiteboardContextMenu,
} satisfies TLComponents;

type WhiteboardContextMenuPointRef = { current: VecLike | null };

const WhiteboardContextMenuPointContext =
	createContext<WhiteboardContextMenuPointRef | null>(null);

const untranslated = (label: string) => label;

function RouteComponent() {
	const navigate = Route.useNavigate();
	const contextMenuPointRef = useRef<VecLike | null>(null);

	return (
		<main className="h-[calc(100dvh-80px)] min-h-[620px] p-3">
			<div className="relative h-full overflow-hidden rounded-md border border-[var(--line)] bg-white shadow-[0_18px_38px_rgba(23,58,64,0.12)]">
				<WhiteboardContextMenuPointContext.Provider value={contextMenuPointRef}>
					<Tldraw
						components={whiteboardComponents}
						onMount={(editor) => {
							const handleEvent = (info: TLEventInfo) => {
								if (info.type === "pointer" && info.name === "right_click") {
									const point = editor.inputs.getCurrentPagePoint();
									contextMenuPointRef.current = { x: point.x, y: point.y };
								}

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
				</WhiteboardContextMenuPointContext.Provider>
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
		<ControlledTldrawContextMenu {...props}>
			<DefaultContextMenuContent />
			<WhiteboardContextMenuContent />
		</ControlledTldrawContextMenu>
	);
}

function ControlledTldrawContextMenu({
	children,
	disabled = false,
}: TLUiContextMenuProps) {
	const editor = useEditor();
	const msg = useTranslation();
	const { Canvas } = useEditorComponents();

	const preventEscapeFromLosingShapeFocus = useCallback(
		(e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				editor.getContainer().focus();
			}
		},
		[editor],
	);

	useEffect(() => {
		const body = editor.getContainerDocument().body;
		return () => {
			body.removeEventListener("keydown", preventEscapeFromLosingShapeFocus, {
				capture: true,
			});
		};
	}, [editor, preventEscapeFromLosingShapeFocus]);

	const suppressDismissUntilRef = useRef(0);

	const handleRegistryOpenChange = useCallback(
		(isOpen: boolean) => {
			const body = editor.getContainerDocument().body;

			if (!isOpen) {
				const onlySelectedShape = editor.getOnlySelectedShape();

				if (
					onlySelectedShape &&
					editor.isShapeOrAncestorLocked(onlySelectedShape)
				) {
					editor.setSelectedShapes([]);
				}

				editor.timers.requestAnimationFrame(() => {
					body.removeEventListener("keydown", preventEscapeFromLosingShapeFocus, {
						capture: true,
					});
				});
				return;
			}

			body.addEventListener("keydown", preventEscapeFromLosingShapeFocus, {
				capture: true,
			});

			if (editor.getInstanceState().isCoarsePointer) {
				suppressDismissUntilRef.current = Date.now() + 500;

				const selectedShapes = editor.getSelectedShapes();
				const currentPagePoint = editor.inputs.getCurrentPagePoint();
				const shapesAtPoint = editor.getShapesAtPoint(currentPagePoint);

				if (
					!selectedShapes.length ||
					!shapesAtPoint.some((shape) => selectedShapes.includes(shape))
				) {
					const lockedShapes = shapesAtPoint.filter((shape) =>
						editor.isShapeOrAncestorLocked(shape),
					);

					if (lockedShapes.length) {
						editor.select(...lockedShapes.map((shape) => shape.id));
					}
				}
			}
		},
		[editor, preventEscapeFromLosingShapeFocus],
	);

	const container = useContainer();
	const dir = useDirection();
	const [isOpen, handleOpenChange] = useMenuIsOpen(
		"context menu",
		handleRegistryOpenChange,
	);

	return (
		<RadixContextMenu.Root
			dir={dir}
			modal={false}
			open={isOpen}
			onOpenChange={handleOpenChange}
		>
			<RadixContextMenu.Trigger
				onContextMenu={undefined}
				dir="ltr"
				disabled={disabled}
			>
				{Canvas ? <Canvas /> : null}
			</RadixContextMenu.Trigger>
			{isOpen && (
				<RadixContextMenu.Portal container={container}>
					<RadixContextMenu.Content
						className="tlui-menu tlui-scrollable"
						data-testid="context-menu"
						aria-label={msg("context-menu.title")}
						alignOffset={-4}
						collisionPadding={4}
						onContextMenu={preventDefault}
						onPointerDownOutside={(e) => {
							if (Date.now() < suppressDismissUntilRef.current)
								e.preventDefault();
						}}
						onInteractOutside={(e) => {
							if (Date.now() < suppressDismissUntilRef.current)
								e.preventDefault();
						}}
						onFocusOutside={(e) => {
							if (Date.now() < suppressDismissUntilRef.current)
								e.preventDefault();
						}}
					>
						<TldrawUiMenuContextProvider
							type="context-menu"
							sourceId="context-menu"
						>
							{children}
						</TldrawUiMenuContextProvider>
					</RadixContextMenu.Content>
				</RadixContextMenu.Portal>
			)}
		</RadixContextMenu.Root>
	);
}

function WhiteboardContextMenuContent() {
	const editor = useEditor();
	const contextMenuPointRef = useContext(WhiteboardContextMenuPointContext);

	const getMenuPoint = () => {
		const point = contextMenuPointRef?.current;
		return point
			? { x: point.x, y: point.y }
			: editor.inputs.getCurrentPagePoint();
	};

	return (
		<TldrawUiMenuGroup id="whiteboard-poc">
			<TldrawUiMenuItem
				id="add-text-card"
				label={untranslated("Add text card")}
				onSelect={() => {
					createTextCardShape(editor, getMenuPoint(), {
						centered: true,
					});
				}}
			/>
			<TldrawUiMenuItem
				id="add-sub-whiteboard-link"
				label={untranslated("Add sub-whiteboard link")}
				onSelect={() => {
					createSubwhiteboardLinkShape(editor, getMenuPoint());
				}}
			/>
		</TldrawUiMenuGroup>
	);
}
