import { ContextMenu as RadixContextMenu } from "radix-ui";
import { useCallback, useEffect, useRef } from "react";
import {
	preventDefault,
	type TLUiContextMenuProps,
	TldrawUiMenuContextProvider,
	useContainer,
	useDirection,
	useEditor,
	useEditorComponents,
	useMenuIsOpen,
	useTranslation,
} from "tldraw";

export function ControlledTldrawContextMenu({
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
