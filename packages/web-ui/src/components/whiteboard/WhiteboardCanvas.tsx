import { useEffect, useMemo, useRef, useState } from "react";
import {
	type TLComponents,
	type TLShapeId,
	Tldraw,
	type TldrawOptions,
	type VecLike,
} from "tldraw";
import { useThemeMode } from "../../hooks/useThemeMode";
import { DeleteCardDialog } from "../cards/DeleteCardDialog";
import { AppLink } from "../navigation/AppLink";
import { CardPasteResolutionMenu } from "./CardPasteResolutionMenu";
import { CustomMenuPanel } from "./CustomMenuPanel";
import {
	CardContentStoreProvider,
	createCardContentStore,
} from "./card-content-store";
import {
	markdownWhiteboardShapeUtils,
	WhiteboardCardContext,
} from "./custom-shapes";
import { DeleteWhiteboardDialog } from "./DeleteWhiteboardDialog";
import { EditableWhiteboardTitle } from "./EditableWhiteboardTitle";
import type { SequencedFrame } from "./frame-sync";
import { useCameraPersistence } from "./hooks/useCameraPersistence";
import { useCameraReset } from "./hooks/useCameraReset";
import { useCanvasEvents } from "./hooks/useCanvasEvents";
import { useCanvasPersistenceInteraction } from "./hooks/useCanvasPersistenceInteraction";
import { useCardDeleteShortcut } from "./hooks/useCardDeleteShortcut";
import { useCardRelationSync } from "./hooks/useCardRelationSync";
import { useDrawingHydration } from "./hooks/useDrawingHydration";
import { useDrawingSync } from "./hooks/useDrawingSync";
import { useFocusShape } from "./hooks/useFocusShape";
import { useFrameSync } from "./hooks/useFrameSync";
import { useItemCreation } from "./hooks/useItemCreation";
import { useItemsHydration } from "./hooks/useItemsHydration";
import { useLegacyCardContentMigration } from "./hooks/useLegacyCardContentMigration";
import { usePasteResolution } from "./hooks/usePasteResolution";
import { useRightDragPan } from "./hooks/useRightDragPan";
import { useStoreListener } from "./hooks/useStoreListener";
import { useSubwhiteboardEnterShortcut } from "./hooks/useSubwhiteboardEnterShortcut";
import { useSubwhiteboardPrefetch } from "./hooks/useSubwhiteboardPrefetch";
import { useThemeSync } from "./hooks/useThemeSync";
import { useVisibleCardContentHydration } from "./hooks/useVisibleCardContentHydration";
import { useWhiteboardAssetStore } from "./hooks/useWhiteboardAssetStore";
import { useWhiteboardData } from "./hooks/useWhiteboardData";
import { createHydrationGate } from "./hydration-gate";
import type { Id } from "./ids";
import { useWhiteboardNavigation } from "./navigation";
import { tldrawAssetUrls } from "./tldraw-assets";
import {
	singlePageTldrawComponents,
	singlePageTldrawOptions,
	singlePageTldrawUiOverrides,
} from "./tldraw-single-page";
import { WhiteboardActionsContext } from "./WhiteboardActionsContext";
import { WhiteboardCardPreviewLayer } from "./WhiteboardCardPreviewLayer";
import {
	WhiteboardContextMenu,
	WhiteboardContextMenuContext,
} from "./WhiteboardContextMenu";
import { WhiteboardMainMenu } from "./WhiteboardMainMenu";
import { WhiteboardStylePanel } from "./WhiteboardStylePanel";
import {
	type BoardItemResult,
	getWhiteboardKey,
	type ManagedWhiteboardShape,
} from "./whiteboard-canvas-helpers";

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
	MainMenu: WhiteboardMainMenu,
	MenuPanel: CustomMenuPanel,
	StylePanel: WhiteboardStylePanel,
} satisfies TLComponents;

const whiteboardPreviewComponents = {
	...whiteboardComponents,
	ContextMenu: null,
	MainMenu: null,
	MenuPanel: null,
} satisfies TLComponents;

const LOADING_INDICATOR_DELAY_MS = 200;

export function WhiteboardCanvas({
	whiteboardId,
	focusShapeId = null,
	mode = "edit",
}: {
	whiteboardId: Id<"whiteboards"> | null;
	focusShapeId?: string | null;
	mode?: "edit" | "preview";
}) {
	const readOnly = mode === "preview";
	const navigate = useWhiteboardNavigation();
	const themeMode = useThemeMode();
	const whiteboardKey = getWhiteboardKey(whiteboardId);

	// ── Persisted data ─────────────────────────────────────────────────────────
	const {
		whiteboard,
		workspaceId,
		breadcrumbs,
		itemQuery,
		items,
		itemsReady,
		tldrawDocument,
		documentPatchGeneration,
		takeDocumentPatches,
		prefetchWhiteboard,
		reloadDocument,
		createCardItem,
		createSubwhiteboardItem,
		updateItemFrames,
		archiveItem,
		archiveWhiteboard,
		archiveCardsGlobally,
		restoreOrAdoptCardItem,
		applyCanvasRecordChanges,
		generateUploadUrl,
		finalizeUpload,
	} = useWhiteboardData(whiteboardId);

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
	const [currentWhiteboardDeletePending, setCurrentWhiteboardDeletePending] =
		useState(false);

	// ── Shared refs (written/read by multiple hooks) ───────────────────────────
	const hydratingRef = useMemo(createHydrationGate, []);
	const cardContentStore = useMemo(createCardContentStore, []);
	const interactionActiveRef = useRef(false);
	const optimisticFramesRef = useRef(
		new Map<Id<"boardItems">, SequencedFrame>(),
	);
	const pendingEditShapeIdRef = useRef<TLShapeId | null>(null);
	const itemIdByShapeIdRef = useRef(new Map<string, Id<"boardItems">>());
	const latestItemsRef = useRef(new Map<Id<"boardItems">, BoardItemResult>());
	const protectedPasteShapeIdsRef = useRef(new Set<string>());
	const contextMenuPointRef = useRef<VecLike | null>(null);

	// ── Hooks ──────────────────────────────────────────────────────────────────
	const {
		flushFrameUpdates,
		pauseFramePersistence,
		queueFrameUpdate,
		queuedFrameUpdatesRef,
		flushTimerRef,
	} = useFrameSync({
		editor,
		updateItemFrames,
		latestItemsRef,
		optimisticFramesRef,
		hydratingRef,
		interactionActiveRef,
	});

	const {
		flushDrawingSave,
		pauseDrawingPersistence,
		queueDrawingSave,
		pendingDrawingSaveRef,
		saveDrawingTimerRef,
		drawingSaveState,
		acknowledgeDrawingEcho,
	} = useDrawingSync({
		whiteboardId,
		applyCanvasRecordChanges,
		interactionActiveRef,
	});

	useCanvasPersistenceInteraction({
		editor,
		interactionActiveRef,
		pauseFramePersistence,
		flushFrameUpdates,
		pauseDrawingPersistence,
		flushDrawingSave,
	});

	const { createCardAt, createSubwhiteboardAt } = useItemCreation({
		whiteboardId,
		createCardItem,
		createSubwhiteboardItem,
		pendingEditShapeIdRef,
	});

	// Reset per-board persistence state before the drawing hydration effect is
	// registered. This prevents a route change from hydrating into stale refs.
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on whiteboardId; flush fns stable
	useEffect(() => {
		if (!editor) return;

		if (flushTimerRef.current !== null) {
			window.clearTimeout(flushTimerRef.current);
			flushFrameUpdates();
		}
		if (saveDrawingTimerRef.current !== null) {
			window.clearTimeout(saveDrawingTimerRef.current);
			void flushDrawingSave().catch(() => undefined);
		}

		hydratingRef.reset();
		itemIdByShapeIdRef.current = new Map();
		optimisticFramesRef.current = new Map();
		protectedPasteShapeIdsRef.current.clear();
		pendingEditShapeIdRef.current = null;
		queuedFrameUpdatesRef.current = new Map();
		pendingDrawingSaveRef.current = null;
		setWhiteboardDeletePending(null);
		setCurrentWhiteboardDeletePending(false);
	}, [editor, whiteboardId]);

	const {
		loadedDrawingKey,
		emptyDrawingSnapshotRef,
		deferredBindingsRef,
		reconciliationGeneration,
		hydrationError,
		retryDrawingHydration,
	} = useDrawingHydration({
		editor,
		whiteboardId,
		whiteboardKey,
		tldrawDocument,
		documentPatchGeneration,
		takeDocumentPatches,
		reloadDocument,
		itemsReady: itemQuery.status !== "LoadingFirstPage",
		hydratingRef,
		drawingSaveState,
		acknowledgeDrawingEcho,
	});

	const { prioritizeCardContent, scheduleVisibleCardHydration } =
		useVisibleCardContentHydration({
			editor,
			items,
			loadedDrawingKey,
			whiteboardKey,
			pendingEditShapeIdRef,
			contentStore: cardContentStore,
		});

	const legacyCardContentReady = useLegacyCardContentMigration({
		editor,
		loadedDrawingKey,
		whiteboardKey,
		contentStore: cardContentStore,
		enabled: !readOnly,
	});

	useItemsHydration({
		editor,
		items,
		itemsReady: itemsReady && legacyCardContentReady,
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
		protectedPasteShapeIdsRef,
		reconciliationGeneration,
		readOnly,
	});

	useCardRelationSync({
		editor,
		whiteboardId: readOnly ? null : whiteboardId,
		whiteboardKey,
		loadedDrawingKey,
		reconciliationGeneration,
		hydratingRef,
		interactionActiveRef,
	});

	const { pendingCameraResetRef } = useCameraReset({
		editor,
		items,
		itemQueryStatus: itemQuery.status,
		loadedDrawingKey,
		whiteboardKey,
		workspaceId,
	});

	useCameraPersistence({
		editor,
		workspaceId,
		whiteboardKey,
		loadedDrawingKey,
		pendingCameraResetRef,
		enabled: !readOnly,
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
		useCardDeleteShortcut({ editor, enabled: !readOnly });

	useSubwhiteboardEnterShortcut({ editor, navigate, enabled: !readOnly });
	useSubwhiteboardPrefetch({ editor, prefetchWhiteboard });

	const {
		pending: pendingPaste,
		handleUiEvent,
		consumePasteIntent,
		handleAddedCards,
		handleRemovedCards,
		resolvePending: resolvePaste,
	} = usePasteResolution({
		editor,
		whiteboardId,
		workspaceId,
		restoreOrAdoptCardItem,
		protectedPasteShapeIdsRef,
		contentStore: cardContentStore,
	});

	useStoreListener({
		editor,
		whiteboardId,
		hydratingRef,
		itemIdByShapeIdRef,
		archiveItem,
		consumePasteIntent,
		handleAddedCards,
		handleRemovedCards,
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
		readOnly,
	});

	useRightDragPan({ editor });
	useThemeSync({ editor, themeMode });

	useEffect(() => {
		if (!editor || loadedDrawingKey !== whiteboardKey) return;
		try {
			if (typeof performance !== "undefined")
				performance.mark("contextboard:whiteboard-hydrated");
		} catch {
			// Performance marks are diagnostics only.
		}
	}, [editor, loadedDrawingKey, whiteboardKey]);

	// ── Board reset: flush and clear all per-board state on whiteboard switch ──
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on whiteboardId; flush fns stable
	useEffect(() => {
		if (!editor) return;

		setWhiteboardCardDeletePending(null);
		cardContentStore.reset();
	}, [cardContentStore, editor, whiteboardId]);

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
				void flushDrawingSave().catch(() => undefined);
			}
		};
	}, [flushDrawingSave, flushFrameUpdates]);

	// ── Derived display values ─────────────────────────────────────────────────
	const contextValue = useMemo(
		() => ({
			createCardAt: !readOnly && whiteboardId ? createCardAt : null,
			createSubwhiteboardAt,
			pointRef: contextMenuPointRef,
		}),
		[createCardAt, createSubwhiteboardAt, readOnly, whiteboardId],
	);

	const whiteboardActions = useMemo(
		() => ({
			canDelete: !readOnly && whiteboardId !== null && Boolean(whiteboard),
			requestDelete: () => setCurrentWhiteboardDeletePending(true),
		}),
		[readOnly, whiteboard, whiteboardId],
	);

	// Render as an overlay above the persistent <Tldraw> instead of replacing it,
	// so the editor is never unmounted while a board's data is (re)loading.
	// The drawing key matters as much as the metadata: the editor instance is
	// deliberately shared across boards, so until the new board's snapshot has
	// loaded the canvas is still showing the *previous* board's shapes.
	const whiteboardIsLoading =
		whiteboardId !== null &&
		(whiteboard === undefined ||
			breadcrumbs === undefined ||
			loadedDrawingKey !== whiteboardKey);
	const showLoadingIndicator = useDelayedVisibility(
		whiteboardIsLoading,
		LOADING_INDICATOR_DELAY_MS,
	);
	const overlayLabel =
		whiteboardId && whiteboard === null
			? "Whiteboard not found."
			: showLoadingIndicator
				? "Loading whiteboard..."
				: null;

	const displayedBreadcrumbs = whiteboardId ? (breadcrumbs ?? []) : [];

	const finishWhiteboardDelete = (deleteCards: boolean) => {
		if (whiteboardDeletePending) {
			void archiveItem({
				itemId: whiteboardDeletePending.itemId,
				deleteCards,
			});
			setWhiteboardDeletePending(null);
			return;
		}

		if (!currentWhiteboardDeletePending || !whiteboardId) return;
		void archiveWhiteboard({
			whiteboardId,
			deleteCards,
		})
			.then(() => {
				setCurrentWhiteboardDeletePending(false);
				const parentId = whiteboard?.parentWhiteboardId;
				if (parentId) navigate.openWhiteboard(parentId);
				else navigate.openRootWhiteboard();
			})
			.catch((error) => {
				console.warn("Failed to delete whiteboard", error);
			});
	};

	return (
		<main
			className={
				readOnly
					? "flex h-full min-h-0 w-full overflow-hidden bg-[var(--background)]"
					: "flex h-dvh min-h-[620px] w-full overflow-hidden bg-[var(--background)]"
			}
		>
			<div className="relative flex-1 overflow-hidden bg-[var(--background)]">
				<div className="pointer-events-none absolute left-1/2 top-2 z-10 flex max-w-[min(92vw,40rem)] -translate-x-1/2 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-sm text-[var(--card-foreground)] shadow-sm">
					<nav className="pointer-events-auto flex min-w-0 items-center gap-2">
						{readOnly ? (
							<span className="truncate font-semibold text-[var(--card-foreground)]">
								Root
							</span>
						) : (
							<AppLink
								href={navigate.rootWhiteboardHref()}
								onPointerEnter={() => prefetchWhiteboard(null)}
								onFocus={() => prefetchWhiteboard(null)}
								className="truncate font-semibold text-[var(--card-foreground)] hover:text-[var(--lagoon-deep)]"
							>
								Root
							</AppLink>
						)}
						{displayedBreadcrumbs.map((crumb, index) => (
							<span key={crumb._id} className="flex min-w-0 items-center gap-2">
								<span className="text-[var(--muted-foreground)]">/</span>
								{index === displayedBreadcrumbs.length - 1 ? (
									<EditableWhiteboardTitle
										whiteboardId={crumb._id}
										title={crumb.title}
										readOnly={readOnly}
									/>
								) : readOnly ? (
									<span className="truncate font-semibold text-[var(--card-foreground)]">
										{crumb.title}
									</span>
								) : (
									<AppLink
										href={navigate.whiteboardHref(crumb._id)}
										onPointerEnter={() => prefetchWhiteboard(crumb._id)}
										onFocus={() => prefetchWhiteboard(crumb._id)}
										className="truncate font-semibold text-[var(--card-foreground)] hover:text-[var(--lagoon-deep)]"
									>
										{crumb.title}
									</AppLink>
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
				<div className="absolute inset-0 isolate overflow-hidden bg-[var(--background)]">
					<WhiteboardActionsContext.Provider value={whiteboardActions}>
						<WhiteboardContextMenuContext.Provider value={contextValue}>
							<WhiteboardCardContext.Provider value={whiteboardId}>
								<CardContentStoreProvider store={cardContentStore}>
									<Tldraw
										assets={assetStore}
										assetUrls={tldrawAssetUrls}
										components={
											readOnly
												? whiteboardPreviewComponents
												: whiteboardComponents
										}
										onMount={(mountedEditor) => {
											mountedEditor.updateInstanceState({
												isReadonly: readOnly,
											});
											try {
												if (typeof performance !== "undefined")
													performance.mark("contextboard:tldraw-mounted");
											} catch {
												// Performance marks are diagnostics only.
											}
											emptyDrawingSnapshotRef.current =
												mountedEditor.store.getStoreSnapshot("document");
											setEditor(mountedEditor);

											return () => {
												setEditor(null);
											};
										}}
										options={whiteboardOptions}
										onUiEvent={readOnly ? undefined : handleUiEvent}
										overrides={singlePageTldrawUiOverrides}
										shapeUtils={markdownWhiteboardShapeUtils}
									/>
								</CardContentStoreProvider>
							</WhiteboardCardContext.Provider>
						</WhiteboardContextMenuContext.Provider>
					</WhiteboardActionsContext.Provider>
				</div>
				{!readOnly && pendingPaste ? (
					<CardPasteResolutionMenu
						pending={pendingPaste}
						onResolve={resolvePaste}
					/>
				) : null}
				{hydrationError?.whiteboardKey === whiteboardKey ? (
					<WhiteboardHydrationErrorOverlay onRetry={retryDrawingHydration} />
				) : overlayLabel ? (
					<WhiteboardLoadingOverlay label={overlayLabel} />
				) : null}
			</div>
			{!readOnly ? (
				<DeleteWhiteboardDialog
					open={
						whiteboardDeletePending !== null || currentWhiteboardDeletePending
					}
					onCancel={() => {
						if (whiteboardDeletePending) {
							hydratingRef.current = true;
							editor?.createShape(whiteboardDeletePending.shape);
							window.setTimeout(() => {
								hydratingRef.current = false;
							}, 0);
						}
						setWhiteboardDeletePending(null);
						setCurrentWhiteboardDeletePending(false);
					}}
					onKeepCards={() => finishWhiteboardDelete(false)}
					onDeleteCards={() => finishWhiteboardDelete(true)}
				/>
			) : null}
			{!readOnly ? (
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
			) : null}
			{!readOnly ? (
				<WhiteboardCardPreviewLayer currentWhiteboardId={whiteboardId} />
			) : null}
		</main>
	);
}

function useDelayedVisibility(visible: boolean, delayMs: number) {
	const [delayedVisible, setDelayedVisible] = useState(false);

	useEffect(() => {
		if (!visible) {
			setDelayedVisible(false);
			return;
		}

		const timer = window.setTimeout(() => {
			setDelayedVisible(true);
		}, delayMs);
		return () => window.clearTimeout(timer);
	}, [delayMs, visible]);

	return visible && delayedVisible;
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

function WhiteboardHydrationErrorOverlay({ onRetry }: { onRetry: () => void }) {
	return (
		<div
			className="absolute inset-0 z-20 grid place-items-center bg-[color-mix(in_oklab,var(--background)_92%,transparent)] p-4"
			role="alert"
		>
			<div className="max-w-md rounded-lg border border-amber-500/35 bg-[var(--card)] p-4 text-[var(--card-foreground)] shadow-lg">
				<p className="text-sm font-semibold">無法載入這個白板的部分畫布資料</p>
				<p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
					原始資料仍然保留。你可以重試，或先從側邊欄前往其他白板。
				</p>
				<button
					type="button"
					onClick={onRetry}
					className="mt-3 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm font-semibold outline-none transition-colors hover:bg-[var(--accent)] focus-visible:ring-[3px] focus-visible:ring-ring/50"
				>
					重試
				</button>
			</div>
		</div>
	);
}
