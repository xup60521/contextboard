import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
	type TLComponents,
	type TLShapeId,
	Tldraw,
	type TldrawOptions,
	type VecLike,
} from "tldraw";
import type { Id } from "../../../convex/_generated/dataModel";
import { useThemeMode } from "../../hooks/useThemeMode";
import { DeleteCardDialog } from "../cards/DeleteCardDialog";
import { CustomMenuPanel } from "./CustomMenuPanel";
import {
	markdownWhiteboardShapeUtils,
	WhiteboardCardContext,
} from "./custom-shapes";
import { DeleteWhiteboardDialog } from "./DeleteWhiteboardDialog";
import { EditableWhiteboardTitle } from "./EditableWhiteboardTitle";
import type { SequencedFrame } from "./frame-sync";
import { useCameraReset } from "./hooks/useCameraReset";
import { useCanvasEvents } from "./hooks/useCanvasEvents";
import { useCardDeleteShortcut } from "./hooks/useCardDeleteShortcut";
import { useDrawingHydration } from "./hooks/useDrawingHydration";
import { useDrawingSync } from "./hooks/useDrawingSync";
import { useFocusShape } from "./hooks/useFocusShape";
import { useFrameSync } from "./hooks/useFrameSync";
import { useItemCreation } from "./hooks/useItemCreation";
import { useItemsHydration } from "./hooks/useItemsHydration";
import { useRightDragPan } from "./hooks/useRightDragPan";
import { useStoreListener } from "./hooks/useStoreListener";
import { useThemeSync } from "./hooks/useThemeSync";
import { useVisibleCardContentHydration } from "./hooks/useVisibleCardContentHydration";
import { useWhiteboardAssetStore } from "./hooks/useWhiteboardAssetStore";
import { useWhiteboardConvexData } from "./hooks/useWhiteboardConvexData";
import {
	singlePageTldrawComponents,
	singlePageTldrawOptions,
	singlePageTldrawUiOverrides,
} from "./tldraw-single-page";
import { WhiteboardCardPreviewLayer } from "./WhiteboardCardPreviewLayer";
import {
	WhiteboardContextMenu,
	WhiteboardContextMenuContext,
} from "./WhiteboardContextMenu";
import {
	type BoardItemResult,
	getWhiteboardKey,
	type ManagedWhiteboardShape,
} from "./whiteboard-canvas-helpers";
import "tldraw/tldraw.css";

export type { GlobalCardDeleteShortcutEvent } from "./whiteboard-canvas-helpers";
// Re-export the public API so the test file can keep its import path
export {
	collectGlobalDeleteCardIdsFromShapes,
	getRightDragPanNextCamera,
	hasExceededRightDragPanThreshold,
	hasManagedShapeFrameChanged,
	isGlobalCardDeleteShortcut,
	itemToShape,
	syncRightDragPanPointer,
} from "./whiteboard-canvas-helpers";

const whiteboardOptions = {
	...singlePageTldrawOptions,
	createTextOnCanvasDoubleClick: false,
} satisfies Partial<TldrawOptions>;

const whiteboardComponents = {
	...singlePageTldrawComponents,
	ContextMenu: WhiteboardContextMenu,
	MenuPanel: CustomMenuPanel,
} satisfies TLComponents;

export function WhiteboardCanvas({
	whiteboardId,
	focusShapeId = null,
}: {
	whiteboardId: Id<"whiteboards"> | null;
	focusShapeId?: string | null;
}) {
	const navigate = useNavigate();
	const themeMode = useThemeMode();
	const whiteboardKey = getWhiteboardKey(whiteboardId);

	// ── Convex data ────────────────────────────────────────────────────────────
	const {
		whiteboard,
		breadcrumbs,
		itemQuery,
		items,
		tldrawDocument,
		createCardItem,
		createSubwhiteboardItem,
		updateItemFrame,
		archiveItem,
		archiveCardsGlobally,
		restoreOrAdoptCardItem,
		saveTldrawDocument,
		generateUploadUrl,
		finalizeUpload,
	} = useWhiteboardConvexData(whiteboardId);

	const assetStore = useWhiteboardAssetStore({
		generateUploadUrl,
		finalizeUpload,
	});

	// ── Editor instance ────────────────────────────────────────────────────────
	const [editor, setEditor] = useState<import("tldraw").Editor | null>(null);
	const [whiteboardDeletePending, setWhiteboardDeletePending] = useState<{
		itemId: Id<"boardItems">;
		shape: ManagedWhiteboardShape;
	} | null>(null);

	// ── Shared refs (written/read by multiple hooks) ───────────────────────────
	const hydratingRef = useRef(false);
	const optimisticFramesRef = useRef(
		new Map<Id<"boardItems">, SequencedFrame>(),
	);
	const pendingEditShapeIdRef = useRef<TLShapeId | null>(null);
	const itemIdByShapeIdRef = useRef(new Map<string, Id<"boardItems">>());
	const latestItemsRef = useRef(new Map<Id<"boardItems">, BoardItemResult>());
	const contextMenuPointRef = useRef<VecLike | null>(null);

	// ── Hooks ──────────────────────────────────────────────────────────────────
	const {
		flushFrameUpdates,
		queueFrameUpdate,
		queuedFrameUpdatesRef,
		flushTimerRef,
	} = useFrameSync({
		editor,
		updateItemFrame,
		latestItemsRef,
		optimisticFramesRef,
		hydratingRef,
	});

	const {
		flushDrawingSave,
		queueDrawingSave,
		pendingDrawingSaveRef,
		saveDrawingTimerRef,
	} = useDrawingSync({ whiteboardId, tldrawDocument, saveTldrawDocument });

	const { createCardAt, createSubwhiteboardAt } = useItemCreation({
		whiteboardId,
		createCardItem,
		createSubwhiteboardItem,
		pendingEditShapeIdRef,
	});

	const {
		loadedDrawingKey,
		setLoadedDrawingKey,
		emptyDrawingSnapshotRef,
		deferredBindingsRef,
	} = useDrawingHydration({
		editor,
		whiteboardKey,
		tldrawDocument,
		hydratingRef,
	});

	const { prioritizeCardContent, scheduleVisibleCardHydration } =
		useVisibleCardContentHydration({
			editor,
			items,
			loadedDrawingKey,
			whiteboardKey,
			pendingEditShapeIdRef,
		});

	useItemsHydration({
		editor,
		items,
		loadedDrawingKey,
		whiteboardKey,
		deferredBindingsRef,
		optimisticFramesRef,
		queuedFrameUpdatesRef,
		itemIdByShapeIdRef,
		latestItemsRef,
		pendingEditShapeIdRef,
		prioritizeCardContent,
		scheduleVisibleCardHydration,
		hydratingRef,
	});

	const { pendingCameraResetRef } = useCameraReset({
		editor,
		items,
		itemQueryStatus: itemQuery.status,
	});

	useFocusShape({
		editor,
		focusShapeId,
		items,
		loadedDrawingKey,
		whiteboardKey,
		pendingCameraResetRef,
		navigate,
	});

	const { whiteboardCardDeletePending, setWhiteboardCardDeletePending } =
		useCardDeleteShortcut({ editor });

	useStoreListener({
		editor,
		whiteboardId,
		hydratingRef,
		itemIdByShapeIdRef,
		archiveItem,
		restoreOrAdoptCardItem,
		setWhiteboardDeletePending,
		queueFrameUpdate,
		queueDrawingSave,
	});

	useCanvasEvents({
		editor,
		whiteboardId,
		createCardAt,
		createSubwhiteboardAt,
		contextMenuPointRef,
		prioritizeCardContent,
		pendingEditShapeIdRef,
		navigate,
	});

	useRightDragPan({ editor });
	useThemeSync({ editor, themeMode });

	// ── Board reset: flush and clear all per-board state on whiteboard switch ──
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on whiteboardId; flush fns stable
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
		pendingEditShapeIdRef.current = null;
		queuedFrameUpdatesRef.current = new Map();
		pendingDrawingSaveRef.current = null;
		pendingCameraResetRef.current = true;
		setWhiteboardCardDeletePending(null);
		setWhiteboardDeletePending(null);
		setLoadedDrawingKey(null);
	}, [editor, whiteboardId]);

	// ── Unmount: flush any pending writes ──────────────────────────────────────
	// biome-ignore lint/correctness/useExhaustiveDependencies: cleanup reads timer refs at unmount
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

	// ── Derived display values ─────────────────────────────────────────────────
	const contextValue = {
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
		<main className="flex h-dvh min-h-[620px] w-full overflow-hidden bg-[var(--background)]">
			<div className="relative flex-1 overflow-hidden bg-[var(--background)]">
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
						<WhiteboardCardContext.Provider value={whiteboardId}>
							<Tldraw
								assets={assetStore}
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
						</WhiteboardCardContext.Provider>
					</WhiteboardContextMenuContext.Provider>
				</div>
				{overlayLabel && <WhiteboardLoadingOverlay label={overlayLabel} />}
			</div>
			<DeleteWhiteboardDialog
				open={whiteboardDeletePending !== null}
				onCancel={() => {
					if (!whiteboardDeletePending) return;
					hydratingRef.current = true;
					editor?.createShape(whiteboardDeletePending.shape);
					window.setTimeout(() => {
						hydratingRef.current = false;
					}, 0);
					setWhiteboardDeletePending(null);
				}}
				onKeepCards={() => {
					if (whiteboardDeletePending) {
						void archiveItem({
							itemId: whiteboardDeletePending.itemId,
							deleteCards: false,
						});
						setWhiteboardDeletePending(null);
					}
				}}
				onDeleteCards={() => {
					if (whiteboardDeletePending) {
						void archiveItem({
							itemId: whiteboardDeletePending.itemId,
							deleteCards: true,
						});
						setWhiteboardDeletePending(null);
					}
				}}
			/>
			<DeleteCardDialog
				open={whiteboardCardDeletePending !== null}
				cardCount={whiteboardCardDeletePending?.cardIds.length ?? 1}
				onCancel={() => {
					setWhiteboardCardDeletePending(null);
				}}
				onConfirm={() => {
					if (!whiteboardCardDeletePending) return;

					void archiveCardsGlobally({
						cardIds: whiteboardCardDeletePending.cardIds,
					}).catch((error) => {
						console.warn(
							"Failed to archive cards from whiteboard shortcut",
							error,
						);
					});

					setWhiteboardCardDeletePending(null);
				}}
			/>
			<WhiteboardCardPreviewLayer currentWhiteboardId={whiteboardId} />
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
