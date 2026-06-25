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
	type TLStoreSnapshot,
	type TLUiContextMenuProps,
	Tldraw,
	type TldrawOptions,
	TldrawUiMenuGroup,
	TldrawUiMenuItem,
	react as tldrawReact,
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
import {
	frameFromItem,
	resolveFrameForHydration,
	type SequencedFrame,
	shouldClearOptimisticFrame,
	type WhiteboardFrame,
} from "./frame-sync";
import { getHydratedMarkdownCardHeight } from "./markdown-card-sizing";
import {
	filterSnapshotForPersistence,
	isManagedWhiteboardShapeRecord,
} from "./tldraw-persistence";
import {
	singlePageTldrawComponents,
	singlePageTldrawOptions,
	singlePageTldrawUiOverrides,
} from "./tldraw-single-page";
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

type TldrawDocumentResult = {
	snapshot: TLStoreSnapshot;
	revision: number;
} | null;

type PendingDrawingSave = {
	whiteboardId: Id<"whiteboards"> | null;
	snapshot: TLStoreSnapshot;
	expectedRevision?: number;
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
	...singlePageTldrawOptions,
	createTextOnCanvasDoubleClick: false,
	rightClickPanning: true,
} satisfies Partial<TldrawOptions>;

const whiteboardComponents = {
	...singlePageTldrawComponents,
	ContextMenu: WhiteboardContextMenu,
} satisfies TLComponents;

const WhiteboardContextMenuContext =
	createContext<WhiteboardContextMenuValue | null>(null);

function getWhiteboardKey(whiteboardId: Id<"whiteboards"> | null) {
	return whiteboardId ?? "root";
}

export function WhiteboardCanvas({
	whiteboardId,
	focusShapeId = null,
}: {
	whiteboardId: Id<"whiteboards"> | null;
	focusShapeId?: string | null;
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
	const tldrawDocument = useQuery(api.tldrawDocuments.get, {
		whiteboardId,
	}) as TldrawDocumentResult | undefined;
	const createCardItem = useMutation(api.canvas.createCardItem);
	const createSubwhiteboardItem = useMutation(
		api.canvas.createSubwhiteboardItem,
	);
	const updateItemFrame = useMutation(api.canvas.updateItemFrame);
	const archiveItem = useMutation(api.canvas.archiveItem);
	const restoreItem = useMutation(api.canvas.restoreItem);
	const saveTldrawDocument = useMutation(api.tldrawDocuments.save);

	const [editor, setEditor] = useState<Editor | null>(null);
	const [loadedDrawingKey, setLoadedDrawingKey] = useState<string | null>(null);
	const themeMode = useThemeMode();
	const whiteboardKey = getWhiteboardKey(whiteboardId);
	const hydratingRef = useRef(false);
	const itemIdByShapeIdRef = useRef(new Map<string, Id<"boardItems">>());
	const contextMenuPointRef = useRef<VecLike | null>(null);
	const pendingEditShapeIdRef = useRef<TLShapeId | null>(null);
	const loadedDrawingKeyRef = useRef<string | null>(null);
	const emptyDrawingSnapshotRef = useRef<TLStoreSnapshot | null>(null);
	const tldrawDocumentRevisionRef = useRef<number | null>(null);
	const saveDrawingTimerRef = useRef<number | null>(null);
	const pendingDrawingSaveRef = useRef<PendingDrawingSave | null>(null);
	const latestItemsRef = useRef(new Map<Id<"boardItems">, BoardItemResult>());
	const queuedFrameUpdatesRef = useRef(
		new Map<Id<"boardItems">, SequencedFrame>(),
	);
	const optimisticFramesRef = useRef(
		new Map<Id<"boardItems">, SequencedFrame>(),
	);
	const frameUpdateSeqRef = useRef(0);
	const flushTimerRef = useRef<number | null>(null);
	const pendingCameraResetRef = useRef(true);
	const handledFocusRef = useRef<string | null>(null);

	const flushFrameUpdates = useCallback(() => {
		flushTimerRef.current = null;
		const queuedFrames = queuedFrameUpdatesRef.current;
		queuedFrameUpdatesRef.current = new Map();

		for (const [itemId, sequencedFrame] of queuedFrames) {
			void updateItemFrame({ itemId, ...sequencedFrame.frame }).catch(() => {
				const currentFrame = optimisticFramesRef.current.get(itemId);
				if (!shouldClearOptimisticFrame(currentFrame, sequencedFrame.seq)) {
					return;
				}

				optimisticFramesRef.current.delete(itemId);
				const latestItem = latestItemsRef.current.get(itemId);
				if (!latestItem || !editor) return;

				hydratingRef.current = true;
				editor.run(() => rehydrateItemShape(editor, latestItem), {
					history: "ignore",
				});
				window.setTimeout(() => {
					hydratingRef.current = false;
				}, 0);
			});
		}
	}, [editor, updateItemFrame]);

	const flushDrawingSave = useCallback(() => {
		saveDrawingTimerRef.current = null;
		const pendingSave = pendingDrawingSaveRef.current;
		pendingDrawingSaveRef.current = null;
		if (!pendingSave) return;

		void saveTldrawDocument({
			whiteboardId: pendingSave.whiteboardId,
			snapshot: pendingSave.snapshot,
			expectedRevision: pendingSave.expectedRevision,
		})
			.then(({ revision }: { revision: number }) => {
				if (pendingSave.whiteboardId === whiteboardId) {
					tldrawDocumentRevisionRef.current = revision;
				}
			})
			.catch((error) => {
				console.warn("Failed to save tldraw document", error);
			});
	}, [saveTldrawDocument, whiteboardId]);

	const queueDrawingSave = useCallback(
		(snapshot: TLStoreSnapshot) => {
			pendingDrawingSaveRef.current = {
				whiteboardId,
				snapshot,
				expectedRevision: tldrawDocumentRevisionRef.current ?? undefined,
			};

			if (saveDrawingTimerRef.current !== null) {
				window.clearTimeout(saveDrawingTimerRef.current);
			}

			saveDrawingTimerRef.current = window.setTimeout(flushDrawingSave, 750);
		},
		[flushDrawingSave, whiteboardId],
	);

	const queueFrameUpdate = useCallback(
		(itemId: Id<"boardItems">, frame: WhiteboardFrame) => {
			const sequencedFrame = {
				seq: frameUpdateSeqRef.current + 1,
				frame,
			};
			frameUpdateSeqRef.current = sequencedFrame.seq;
			queuedFrameUpdatesRef.current.set(itemId, sequencedFrame);
			optimisticFramesRef.current.set(itemId, sequencedFrame);

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

	// The editor is now persistent across whiteboard navigation, so reset the
	// per-board bookkeeping whenever the active board changes. Any pending frame
	// writes for the previous board are flushed first so moves aren't lost.
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on whiteboardId; flushFrameUpdates is stable.
	useEffect(() => {
		if (!editor) return;

		if (flushTimerRef.current !== null) {
			window.clearTimeout(flushTimerRef.current);
			flushFrameUpdates();
		}
		if (saveDrawingTimerRef.current !== null) {
			window.clearTimeout(saveDrawingTimerRef.current);
			flushDrawingSave();
		}

		itemIdByShapeIdRef.current = new Map();
		optimisticFramesRef.current = new Map();
		queuedFrameUpdatesRef.current = new Map();
		pendingEditShapeIdRef.current = null;
		pendingDrawingSaveRef.current = null;
		pendingCameraResetRef.current = true;
		setLoadedDrawingKey(null);
		loadedDrawingKeyRef.current = null;
	}, [editor, flushDrawingSave, flushFrameUpdates, whiteboardId]);

	useEffect(() => {
		tldrawDocumentRevisionRef.current = tldrawDocument?.revision ?? null;
	}, [tldrawDocument?.revision]);

	useEffect(() => {
		loadedDrawingKeyRef.current = loadedDrawingKey;
	}, [loadedDrawingKey]);

	useEffect(() => {
		if (!editor || tldrawDocument === undefined) return;
		if (loadedDrawingKeyRef.current === whiteboardKey) return;

		const snapshot =
			tldrawDocument?.snapshot ?? emptyDrawingSnapshotRef.current;
		hydratingRef.current = true;
		if (snapshot) {
			editor.loadSnapshot(snapshot);
		}

		setLoadedDrawingKey(whiteboardKey);
		window.setTimeout(() => {
			hydratingRef.current = false;
		}, 0);
	}, [editor, tldrawDocument, whiteboardKey]);

	useEffect(() => {
		if (!editor) return;
		if (loadedDrawingKey !== whiteboardKey) return;

		const itemIdByShapeId = new Map<string, Id<"boardItems">>();
		const latestItems = new Map<Id<"boardItems">, BoardItemResult>();
		const wantedItemIds = new Set<Id<"boardItems">>();
		for (const item of items) {
			itemIdByShapeId.set(item.shapeId, item._id);
			latestItems.set(item._id, item);
			wantedItemIds.add(item._id);
		}
		itemIdByShapeIdRef.current = itemIdByShapeId;
		latestItemsRef.current = latestItems;

		for (const itemId of optimisticFramesRef.current.keys()) {
			if (!wantedItemIds.has(itemId)) {
				optimisticFramesRef.current.delete(itemId);
			}
		}
		for (const itemId of queuedFrameUpdatesRef.current.keys()) {
			if (!wantedItemIds.has(itemId)) {
				queuedFrameUpdatesRef.current.delete(itemId);
			}
		}

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
					const serverFrame = frameFromItem(item);
					const optimisticFrame = optimisticFramesRef.current.get(item._id);
					const frameResolution = resolveFrameForHydration(
						serverFrame,
						optimisticFrame,
					);

					if (frameResolution.acknowledged) {
						optimisticFramesRef.current.delete(item._id);
					}

					rehydrateItemShape(editor, item, frameResolution.frame);
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
	}, [editor, items, loadedDrawingKey, whiteboardKey]);

	// After switching boards, reset the camera once the new board's first page
	// has loaded so it opens at a sensible viewport instead of inheriting the
	// previous board's pan/zoom. Runs after the hydration effect has created the
	// new shapes (effects fire in definition order).
	useEffect(() => {
		if (!editor || !pendingCameraResetRef.current) return;
		if (itemQuery.status === "LoadingFirstPage") return;

		pendingCameraResetRef.current = false;
		if (items.length > 0) {
			editor.zoomToFit();
		} else {
			editor.setCamera({ x: 0, y: 0, z: 1 });
		}
	}, [editor, items, itemQuery.status]);

	// Navigate & focus: when a `focus` shape id is present (set by the command
	// palette via the route's search param), select and zoom to that shape once
	// the board has hydrated, then clear the param so re-selecting re-triggers.
	// biome-ignore lint/correctness/useExhaustiveDependencies: items re-runs after hydration creates the focused shape.
	useEffect(() => {
		if (!focusShapeId) {
			handledFocusRef.current = null;
			return;
		}
		if (!editor || loadedDrawingKey !== whiteboardKey) return;
		if (handledFocusRef.current === focusShapeId) return;

		const shapeId = focusShapeId as TLShapeId;
		if (!editor.getShape(shapeId)) return; // shape not hydrated yet; will re-run

		handledFocusRef.current = focusShapeId;
		pendingCameraResetRef.current = false;
		editor.select(shapeId);
		const bounds = editor.getShapePageBounds(shapeId);
		if (bounds) {
			editor.zoomToBounds(bounds, { animation: { duration: 300 }, inset: 128 });
		}

		void navigate({
			to: ".",
			replace: true,
			search: (prev: { focus?: string }) => ({ ...prev, focus: undefined }),
		});
	}, [editor, focusShapeId, items, loadedDrawingKey, navigate, whiteboardKey]);

	useEffect(() => {
		if (!editor) return;

		const removeListener = editor.store.listen(
			({ changes }) => {
				if (hydratingRef.current) return;

				for (const record of Object.values(changes.added)) {
					if (!isManagedWhiteboardShape(record)) continue;
					if (record.type !== "markdown-card") continue; // cards only
					if (itemIdByShapeIdRef.current.has(record.id)) continue; // already-tracked → not a restore
					void restoreItem({ whiteboardId, shapeId: record.id });
				}

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

				if (hasPersistableDrawingChange(changes)) {
					queueDrawingSave(
						filterSnapshotForPersistence(
							editor.store.getStoreSnapshot("document"),
						),
					);
				}
			},
			{ source: "user", scope: "document" },
		);

		return () => {
			removeListener();
		};
	}, [
		archiveItem,
		restoreItem,
		whiteboardId,
		editor,
		queueDrawingSave,
		queueFrameUpdate,
	]);

	// Canvas interactions (right-click point capture, double-click to open a
	// sub-whiteboard or create an item). Registered in an effect rather than
	// `onMount` so the latest `whiteboardId`/create callbacks are used after
	// navigating between boards on the now-persistent editor.
	useEffect(() => {
		if (!editor) return;

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
				openSubwhiteboardShape(navigate, info.shape);
				return;
			}

			if (info.target !== "canvas") return;

			const hitShape = getWhiteboardDoubleClickShape(editor, point);

			if (hitShape) {
				openSubwhiteboardShape(navigate, hitShape);
				return;
			}

			const hitOverlay = editor.overlays.getOverlayAtPoint(
				point,
				editor.options.hitTestMargin / editor.getZoomLevel(),
			);

			if (hitOverlay || isPointInCurrentSelection(editor, point)) {
				return;
			}

			if (whiteboardId) {
				createCardAt(point);
			} else {
				createSubwhiteboardAt(point);
			}
		};

		editor.on("event", handleEvent);

		return () => {
			editor.off("event", handleEvent);
		};
	}, [editor, whiteboardId, createCardAt, createSubwhiteboardAt, navigate]);

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
				flushFrameUpdates();
			}
			if (saveDrawingTimerRef.current !== null) {
				window.clearTimeout(saveDrawingTimerRef.current);
				flushDrawingSave();
			}
		};
	}, [flushDrawingSave, flushFrameUpdates]);

	const contextValue: WhiteboardContextMenuValue = {
		createCardAt: whiteboardId ? createCardAt : null,
		createSubwhiteboardAt,
		pointRef: contextMenuPointRef,
	};

	// Render as an overlay above the persistent <Tldraw> instead of replacing it,
	// so the editor is never unmounted while a board's data is (re)loading.
	const overlayLabel = !whiteboardId
		? null
		: whiteboard === undefined || breadcrumbs === undefined
			? "Loading whiteboard..."
			: whiteboard === null
				? "Whiteboard not found."
				: null;

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
							emptyDrawingSnapshotRef.current =
								mountedEditor.store.getStoreSnapshot("document");
							setEditor(mountedEditor);

							return () => {
								setEditor(null);
							};
						}}
						options={whiteboardOptions}
						overrides={singlePageTldrawUiOverrides}
						shapeUtils={markdownWhiteboardShapeUtils}
					/>
				</WhiteboardContextMenuContext.Provider>
			</div>
			{overlayLabel && <WhiteboardLoadingOverlay label={overlayLabel} />}
		</main>
	);
}

function WhiteboardLoadingOverlay({ label }: { label: string }) {
	return (
		<div className="absolute inset-0 z-20 grid place-items-center bg-[var(--background)] p-3">
			<div className="rounded-md border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm font-semibold text-[var(--card-foreground)]">
				{label}
			</div>
		</div>
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
		const nextTitle =
			draftTitle.replace(/\s+/g, " ").trim() || "Untitled whiteboard";
		setDraftTitle(nextTitle);

		if (nextTitle !== title) {
			void updateTitle({ whiteboardId, title: nextTitle });
		}
	}, [draftTitle, title, updateTitle, whiteboardId]);

	return (
		<span className="relative inline-block min-w-0 max-w-[min(42vw,28rem)] align-middle">
			<span
				aria-hidden
				className="invisible block truncate whitespace-pre border border-transparent px-1 py-0.5 font-semibold"
			>
				{draftTitle || " "}
			</span>
			<input
				ref={inputRef}
				className="absolute inset-0 h-full w-full min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 font-semibold text-[var(--card-foreground)] outline-none transition focus:border-[var(--border)] focus:bg-[var(--background)]"
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

export function itemToShape(
	item: BoardItemResult,
	frame = frameFromItem(item),
): ManagedShapePartial {
	const id = item.shapeId as TLShapeId;

	if (item.kind === "card") {
		const content = item.card ? JSON.stringify(item.card.content) : "";

		return {
			id,
			type: "markdown-card",
			x: frame.x,
			y: frame.y,
			rotation: frame.rotation,
			props: {
				w: frame.w,
				h: getHydratedMarkdownCardHeight({
					content,
					width: frame.w,
					serverHeight: frame.h,
					minHeight: 96,
				}),
				content,
				cardId: item.cardId ?? undefined,
				version: item.card?.version,
			},
		};
	}

	return {
		id,
		type: "subwhiteboard-link",
		x: frame.x,
		y: frame.y,
		rotation: frame.rotation,
		props: {
			w: frame.w,
			h: frame.h,
			label: item.childWhiteboard?.title ?? "Sub-whiteboard",
			subwhiteboardId: item.childWhiteboardId ?? "",
			childWhiteboardId: item.childWhiteboardId ?? undefined,
			depth: item.childWhiteboard?.depth,
		},
	};
}

function rehydrateItemShape(
	editor: Editor,
	item: BoardItemResult,
	frame = frameFromItem(item),
) {
	const nextShape = itemToShape(item, frame);
	const existingShape = editor.getShape(nextShape.id as TLShapeId);

	if (existingShape) {
		editor.updateShape(
			preserveEditingCardContent(editor, existingShape, nextShape),
		);
	} else {
		editor.createShape(nextShape);
	}
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

function hasPersistableDrawingChange(changes: {
	added: Record<string, unknown>;
	updated: Record<string, [unknown, unknown]>;
	removed: Record<string, unknown>;
}) {
	for (const record of Object.values(changes.added)) {
		if (!isManagedWhiteboardShapeRecord(record)) return true;
	}

	for (const [, nextRecord] of Object.values(changes.updated)) {
		if (!isManagedWhiteboardShapeRecord(nextRecord)) return true;
	}

	for (const record of Object.values(changes.removed)) {
		if (!isManagedWhiteboardShapeRecord(record)) return true;
	}

	return false;
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
		existingShape.type !== "markdown-card" ||
		nextShape.type !== "markdown-card"
	) {
		return nextShape;
	}

	const preserve: { h: number; content?: string } = {
		h: existingShape.props.h,
	};

	if (existingShape.id === editor.getEditingShapeId()) {
		preserve.content = existingShape.props.content;
	}

	return {
		...nextShape,
		props: { ...nextShape.props, ...preserve },
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
