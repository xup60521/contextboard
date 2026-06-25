import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	createShapeId,
	DefaultContextMenuContent,
	type Editor,
	pointInPolygon,
	type TLComponents,
	type TLCreateShapePartial,
	type TLEventInfo,
	type TLShape,
	type TLShapeId,
	type TLUiContextMenuProps,
	react as tldrawReact,
	Tldraw,
	type TldrawOptions,
	TldrawUiMenuGroup,
	TldrawUiMenuItem,
	useEditor,
	Vec,
	type VecLike,
} from "tldraw";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useThemeMode } from "../../hooks/useThemeMode";
import { getThemeMode, setThemeMode, type ThemeMode } from "../../lib/theme";
import { ControlledTldrawContextMenu } from "./ControlledTldrawContextMenu";
import {
	type MarkdownCardShape,
	markdownWhiteboardShapeUtils,
	type SubwhiteboardLinkShape,
} from "./custom-shapes";
import "tldraw/tldraw.css";

type BoardItemResult = {
	_id: Id<"boardItems">;
	kind: "card" | "subwhiteboard";
	cardId: Id<"cards"> | null;
	childWhiteboardId: Id<"whiteboards"> | null;
	shapeId: string;
	x: number;
	y: number;
	w: number;
	h: number;
	rotation: number;
	zIndex: number;
	card: {
		_id: Id<"cards">;
		content: unknown;
		derivedTitle: string;
		version: number;
	} | null;
	childWhiteboard: {
		_id: Id<"whiteboards">;
		title: string;
		depth: number;
		cardCount: number;
		childWhiteboardCount: number;
	} | null;
};

type FrameUpdate = {
	x: number;
	y: number;
	w: number;
	h: number;
	rotation: number;
	zIndex: number;
};

type ManagedShapePartial =
	| ({ id: TLShapeId } & TLCreateShapePartial<MarkdownCardShape>)
	| ({ id: TLShapeId } & TLCreateShapePartial<SubwhiteboardLinkShape>);

type WhiteboardContextMenuValue = {
	createCardAt: ((point: VecLike) => void) | null;
	createSubwhiteboardAt: (point: VecLike) => void;
	pointRef: { current: VecLike | null };
};

const whiteboardOptions = {
	createTextOnCanvasDoubleClick: false,
	rightClickPanning: true,
} satisfies Partial<TldrawOptions>;

const whiteboardComponents = {
	ContextMenu: WhiteboardContextMenu,
} satisfies TLComponents;

const WhiteboardContextMenuContext =
	createContext<WhiteboardContextMenuValue | null>(null);

export function WhiteboardCanvas({
	whiteboardId,
}: {
	whiteboardId: Id<"whiteboards"> | null;
}) {
	const navigate = useNavigate();
	const whiteboard = useQuery(
		api.whiteboards.get,
		whiteboardId ? { whiteboardId } : "skip",
	);
	const breadcrumbs = useQuery(
		api.whiteboards.getBreadcrumbs,
		whiteboardId ? { whiteboardId } : "skip",
	);
	const itemQuery = usePaginatedQuery(
		api.canvas.listItems,
		{ whiteboardId },
		{ initialNumItems: 200 },
	);
	const createCardItem = useMutation(api.canvas.createCardItem);
	const createSubwhiteboardItem = useMutation(
		api.canvas.createSubwhiteboardItem,
	);
	const updateItemFrame = useMutation(api.canvas.updateItemFrame);
	const archiveItem = useMutation(api.canvas.archiveItem);

	const [editor, setEditor] = useState<Editor | null>(null);
	const themeMode = useThemeMode();
	const hydratingRef = useRef(false);
	const itemIdByShapeIdRef = useRef(new Map<string, Id<"boardItems">>());
	const contextMenuPointRef = useRef<VecLike | null>(null);
	const pendingEditShapeIdRef = useRef<TLShapeId | null>(null);
	const pendingFramesRef = useRef(new Map<Id<"boardItems">, FrameUpdate>());
	const flushTimerRef = useRef<number | null>(null);

	const flushFrameUpdates = useCallback(() => {
		flushTimerRef.current = null;
		const pendingFrames = pendingFramesRef.current;
		pendingFramesRef.current = new Map();

		for (const [itemId, frame] of pendingFrames) {
			void updateItemFrame({ itemId, ...frame });
		}
	}, [updateItemFrame]);

	const queueFrameUpdate = useCallback(
		(itemId: Id<"boardItems">, frame: FrameUpdate) => {
			pendingFramesRef.current.set(itemId, frame);

			if (flushTimerRef.current !== null) {
				window.clearTimeout(flushTimerRef.current);
			}

			flushTimerRef.current = window.setTimeout(flushFrameUpdates, 250);
		},
		[flushFrameUpdates],
	);

	const createCardAt = useCallback(
		(point: VecLike) => {
			if (!whiteboardId) return;

			const shapeId = createShapeId();
			pendingEditShapeIdRef.current = shapeId;

			void createCardItem({
				whiteboardId,
				shapeId,
				x: point.x,
				y: point.y,
			}).catch(() => {
				if (pendingEditShapeIdRef.current === shapeId) {
					pendingEditShapeIdRef.current = null;
				}
			});
		},
		[createCardItem, whiteboardId],
	);

	const createSubwhiteboardAt = useCallback(
		(point: VecLike) => {
			const shapeId = createShapeId();
			pendingEditShapeIdRef.current = shapeId;

			void createSubwhiteboardItem({
				parentWhiteboardId: whiteboardId,
				shapeId,
				x: point.x,
				y: point.y,
			}).catch(() => {
				if (pendingEditShapeIdRef.current === shapeId) {
					pendingEditShapeIdRef.current = null;
				}
			});
		},
		[createSubwhiteboardItem, whiteboardId],
	);

	const items = (itemQuery.results ?? []) as BoardItemResult[];

	useEffect(() => {
		if (!editor) return;

		const itemIdByShapeId = new Map<string, Id<"boardItems">>();
		for (const item of items) {
			itemIdByShapeId.set(item.shapeId, item._id);
		}
		itemIdByShapeIdRef.current = itemIdByShapeId;

		const wantedShapeIds = new Set(items.map((item) => item.shapeId));
		const currentManagedShapes = editor
			.getCurrentPageShapes()
			.filter(isManagedWhiteboardShape);

		hydratingRef.current = true;
		editor.run(
			() => {
				const staleShapeIds = currentManagedShapes
					.filter((shape) => !wantedShapeIds.has(shape.id))
					.map((shape) => shape.id);

				if (staleShapeIds.length > 0) {
					editor.deleteShapes(staleShapeIds);
				}

				for (const item of items) {
					const nextShape = itemToShape(item);
					const existingShape = editor.getShape(nextShape.id as TLShapeId);

					if (existingShape) {
						editor.updateShape(
							preserveEditingCardContent(editor, existingShape, nextShape),
						);
					} else {
						editor.createShape(nextShape);
					}
				}
			},
			{ history: "ignore" },
		);

		window.setTimeout(() => {
			hydratingRef.current = false;
			const pendingEditShapeId = pendingEditShapeIdRef.current;
			if (!pendingEditShapeId || !editor.getShape(pendingEditShapeId)) return;

			pendingEditShapeIdRef.current = null;
			editor.select(pendingEditShapeId);
			editor.setEditingShape(pendingEditShapeId);
		}, 0);
	}, [editor, items]);

	useEffect(() => {
		if (!editor) return;

		const removeListener = editor.store.listen(
			({ changes }) => {
				if (hydratingRef.current) return;

				for (const shape of Object.values(changes.removed)) {
					if (!isManagedWhiteboardShape(shape)) continue;

					const itemId = itemIdByShapeIdRef.current.get(shape.id);
					if (itemId) {
						const deleteCards =
							shape.type === "subwhiteboard-link"
								? window.confirm(
										"Delete cards inside this whiteboard too?\n\nOK: delete cards\nCancel: keep cards as orphan cards",
									)
								: true;
						void archiveItem({ itemId, deleteCards });
					}
				}

				const sortedShapes = editor.getCurrentPageShapesSorted();
				const zIndexByShapeId = new Map(
					sortedShapes.map((shape, index) => [shape.id, index]),
				);

				for (const [, changed] of Object.values(changes.updated)) {
					if (!isManagedWhiteboardShape(changed)) continue;

					const itemId = itemIdByShapeIdRef.current.get(changed.id);
					if (!itemId) continue;

					queueFrameUpdate(itemId, {
						x: changed.x,
						y: changed.y,
						w: changed.props.w,
						h: changed.props.h,
						rotation: changed.rotation,
						zIndex: zIndexByShapeId.get(changed.id) ?? 0,
					});
				}
			},
			{ source: "user", scope: "document" },
		);

		return () => {
			removeListener();
		};
	}, [archiveItem, editor, queueFrameUpdate]);

	// App theme -> tldraw color scheme.
	useEffect(() => {
		if (!editor) return;
		const target = modeToColorScheme(themeMode);
		if (editor.user.getUserPreferences().colorScheme !== target) {
			editor.user.updateUserPreferences({ colorScheme: target });
		}
	}, [editor, themeMode]);

	// tldraw color scheme (e.g. its built-in theme menu) -> app theme, so the
	// custom cards and the rest of the app follow tldraw's own toggle too.
	useEffect(() => {
		if (!editor) return;
		return tldrawReact("sync tldraw color scheme to app theme", () => {
			const nextMode = colorSchemeToMode(
				editor.user.getUserPreferences().colorScheme,
			);
			if (getThemeMode() !== nextMode) {
				setThemeMode(nextMode);
			}
		});
	}, [editor]);

	useEffect(() => {
		return () => {
			if (flushTimerRef.current !== null) {
				window.clearTimeout(flushTimerRef.current);
			}
		};
	}, []);

	const contextValue: WhiteboardContextMenuValue = {
		createCardAt: whiteboardId ? createCardAt : null,
		createSubwhiteboardAt,
		pointRef: contextMenuPointRef,
	};

	if (whiteboardId && (whiteboard === undefined || breadcrumbs === undefined)) {
		return <WhiteboardLoading label="Loading whiteboard..." />;
	}

	if (whiteboardId && whiteboard === null) {
		return <WhiteboardLoading label="Whiteboard not found." />;
	}

	const displayedBreadcrumbs = whiteboardId ? (breadcrumbs ?? []) : [];

	return (
		<main className="relative h-[calc(100dvh-80px)] min-h-[620px] w-full overflow-hidden bg-[var(--background)]">
			<div className="pointer-events-none absolute left-1/2 top-2 z-10 flex max-w-[min(92vw,40rem)] -translate-x-1/2 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-sm text-[var(--card-foreground)] shadow-sm">
				<nav className="pointer-events-auto flex min-w-0 items-center gap-2">
					<Link
						to="/whiteboard"
						className="truncate font-semibold text-[var(--card-foreground)] hover:text-[var(--lagoon-deep)]"
					>
						Root
					</Link>
					{displayedBreadcrumbs.map((crumb) => (
						<span key={crumb._id} className="flex min-w-0 items-center gap-2">
							<span className="text-[var(--muted-foreground)]">/</span>
							{crumb._id === whiteboardId ? (
								<EditableWhiteboardTitle
									whiteboardId={crumb._id}
									title={crumb.title}
								/>
							) : (
								<Link
									to="/whiteboard/$whiteboardId"
									params={{ whiteboardId: crumb._id }}
									className="truncate font-semibold text-[var(--card-foreground)] hover:text-[var(--lagoon-deep)]"
								>
									{crumb.title}
								</Link>
							)}
						</span>
					))}
				</nav>
				{itemQuery.status === "CanLoadMore" && (
					<button
						type="button"
						className="pointer-events-auto shrink-0 rounded border border-[var(--border)] px-2 py-0.5 text-xs font-semibold text-[var(--card-foreground)] hover:bg-[var(--accent)]"
						onClick={() => itemQuery.loadMore(100)}
					>
						Load more
					</button>
				)}
			</div>
			<div className="absolute inset-0 overflow-hidden bg-[var(--background)]">
				<WhiteboardContextMenuContext.Provider value={contextValue}>
					<Tldraw
						components={whiteboardComponents}
						onMount={(mountedEditor) => {
							setEditor(mountedEditor);

							const handleEvent = (info: TLEventInfo) => {
								if (info.type === "pointer" && info.name === "right_click") {
									const point = mountedEditor.inputs.getCurrentPagePoint();
									contextMenuPointRef.current = { x: point.x, y: point.y };
								}

								if (
									info.type !== "click" ||
									info.name !== "double_click" ||
									info.phase !== "up"
								) {
									return;
								}

								const point = mountedEditor.inputs.getCurrentPagePoint();

								if (info.target === "shape") {
									openSubwhiteboardShape(navigate, info.shape);
									return;
								}

								if (info.target !== "canvas") return;

								const hitShape = getWhiteboardDoubleClickShape(
									mountedEditor,
									point,
								);

								if (hitShape) {
									openSubwhiteboardShape(navigate, hitShape);
									return;
								}

								const hitOverlay = mountedEditor.overlays.getOverlayAtPoint(
									point,
									mountedEditor.options.hitTestMargin /
										mountedEditor.getZoomLevel(),
								);

								if (
									hitOverlay ||
									isPointInCurrentSelection(mountedEditor, point)
								) {
									return;
								}

								if (whiteboardId) {
									createCardAt(point);
								} else {
									createSubwhiteboardAt(point);
								}
							};

							mountedEditor.on("event", handleEvent);

							return () => {
								mountedEditor.off("event", handleEvent);
								setEditor(null);
							};
						}}
						options={whiteboardOptions}
						shapeUtils={markdownWhiteboardShapeUtils}
					/>
				</WhiteboardContextMenuContext.Provider>
			</div>
		</main>
	);
}

function WhiteboardLoading({ label }: { label: string }) {
	return (
		<main className="grid h-[calc(100dvh-80px)] min-h-[620px] place-items-center bg-[var(--background)] p-3">
			<div className="rounded-md border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm font-semibold text-[var(--card-foreground)]">
				{label}
			</div>
		</main>
	);
}

function EditableWhiteboardTitle({
	whiteboardId,
	title,
}: {
	whiteboardId: Id<"whiteboards">;
	title: string;
}) {
	const updateTitle = useMutation(api.whiteboards.updateTitle);
	const inputRef = useRef<HTMLInputElement>(null);
	const isFocusedRef = useRef(false);
	const skipNextBlurSaveRef = useRef(false);
	const [draftTitle, setDraftTitle] = useState(title);

	useEffect(() => {
		if (isFocusedRef.current) return;
		setDraftTitle(title);
	}, [title]);

	const saveTitle = useCallback(() => {
		const nextTitle = draftTitle.replace(/\s+/g, " ").trim() || "Untitled whiteboard";
		setDraftTitle(nextTitle);

		if (nextTitle !== title) {
			void updateTitle({ whiteboardId, title: nextTitle });
		}
	}, [draftTitle, title, updateTitle, whiteboardId]);

	return (
		<span className="inline-grid max-w-[min(42vw,28rem)] items-center">
			<span
				aria-hidden
				className="invisible col-start-1 row-start-1 truncate whitespace-pre border border-transparent px-1 py-0.5 font-semibold"
			>
				{draftTitle || " "}
			</span>
			<input
				ref={inputRef}
				className="col-start-1 row-start-1 w-full min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 font-semibold text-[var(--card-foreground)] outline-none transition focus:border-[var(--border)] focus:bg-[var(--background)]"
				value={draftTitle}
				aria-label="Whiteboard name"
				spellCheck
				onFocus={() => {
					isFocusedRef.current = true;
				}}
				onChange={(event) => setDraftTitle(event.currentTarget.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						inputRef.current?.blur();
					}

					if (event.key === "Escape") {
						event.preventDefault();
						skipNextBlurSaveRef.current = true;
						setDraftTitle(title);
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
		</span>
	);
}

type TLColorScheme = "light" | "dark" | "system";

function modeToColorScheme(mode: ThemeMode): TLColorScheme {
	return mode === "auto" ? "system" : mode;
}

function colorSchemeToMode(scheme: TLColorScheme | undefined): ThemeMode {
	return scheme === "light" || scheme === "dark" ? scheme : "auto";
}

function itemToShape(item: BoardItemResult): ManagedShapePartial {
	const id = item.shapeId as TLShapeId;

	if (item.kind === "card") {
		return {
			id,
			type: "markdown-card",
			x: item.x,
			y: item.y,
			rotation: item.rotation,
			props: {
				w: item.w,
				h: item.h,
				content: item.card ? JSON.stringify(item.card.content) : "",
				cardId: item.cardId ?? undefined,
				version: item.card?.version,
			},
		};
	}

	return {
		id,
		type: "subwhiteboard-link",
		x: item.x,
		y: item.y,
		rotation: item.rotation,
		props: {
			w: item.w,
			h: item.h,
			label: item.childWhiteboard?.title ?? "Sub-whiteboard",
			subwhiteboardId: item.childWhiteboardId ?? "",
			childWhiteboardId: item.childWhiteboardId ?? undefined,
			depth: item.childWhiteboard?.depth,
		},
	};
}

function isManagedWhiteboardShape(
	shape: unknown,
): shape is MarkdownCardShape | SubwhiteboardLinkShape {
	return (
		typeof shape === "object" &&
		shape !== null &&
		"type" in shape &&
		((shape as { type: string }).type === "markdown-card" ||
			(shape as { type: string }).type === "subwhiteboard-link")
	);
}

function openSubwhiteboardShape(
	navigate: ReturnType<typeof useNavigate>,
	shape: TLShape,
) {
	if (shape.type !== "subwhiteboard-link") return;

	const childWhiteboardId = shape.props.childWhiteboardId;
	if (!childWhiteboardId) return;

	void navigate({
		to: "/whiteboard/$whiteboardId",
		params: { whiteboardId: childWhiteboardId },
	});
}

function preserveEditingCardContent(
	editor: Editor,
	existingShape: TLShape,
	nextShape: ManagedShapePartial,
) {
	if (
		existingShape.id !== editor.getEditingShapeId() ||
		existingShape.type !== "markdown-card" ||
		nextShape.type !== "markdown-card"
	) {
		return nextShape;
	}

	return {
		...nextShape,
		props: {
			...nextShape.props,
			content: existingShape.props.content,
			h: existingShape.props.h,
		},
	};
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

function WhiteboardContextMenuContent() {
	const editor = useEditor();
	const context = useContext(WhiteboardContextMenuContext);

	if (!context) return null;

	const getMenuPoint = () => {
		const point = context.pointRef.current;
		return point
			? { x: point.x, y: point.y }
			: editor.inputs.getCurrentPagePoint();
	};

	return (
		<TldrawUiMenuGroup id="whiteboard-convex">
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
