import {
	type CardSortOrder,
	type CardSummary,
	useApplicationRuntime,
} from "@contextboard/application";
import { useEffect, useMemo, useRef, useState } from "react";
import { WhiteboardPickerDialog } from "../whiteboard/WhiteboardPickerDialog";
import { CardGrid } from "./CardGrid";
import { CardLibraryToolbar } from "./CardLibraryToolbar";
import { CardPreviewDialog } from "./CardPreviewDialog";
import { DeleteCardDialog } from "./DeleteCardDialog";
import { useCardLibraryActions } from "./useCardLibraryActions";
import { useCardLibrarySelection } from "./useCardLibrarySelection";
import { useUniformGridWindow } from "./useUniformGridWindow";

export type CardLibrarySearchState = {
	q: string;
	orphanOnly: boolean;
	sort: CardSortOrder;
};
export type CardLibrarySearchAdapter = {
	state: CardLibrarySearchState;
	replace(next: CardLibrarySearchState): void;
};
const sortLabels: Record<CardSortOrder, string> = {
	title: "Title A-Z",
	title_desc: "Title Z-A",
	updated_desc: "Recently updated",
	updated_asc: "Least recently updated",
};

export function CardLibraryPage({
	search,
}: {
	search: CardLibrarySearchAdapter;
}) {
	const { cards, navigation } = useApplicationRuntime();
	const [query, setQuery] = useState(search.state.q);
	const [debouncedQuery, setDebouncedQuery] = useState(query);
	const [rows, setRows] = useState<CardSummary[]>([]);
	const [status, setStatus] = useState<"loading" | "ready" | "error">(
		"loading",
	);
	const [error, setError] = useState<string | null>(null);
	const [previewCardId, setPreviewCardId] = useState<string | null>(null);
	const [isCreatingCard, setIsCreatingCard] = useState(false);
	const deleteDialogOpenRef = useRef(false);

	useEffect(() => {
		const timer = window.setTimeout(() => setDebouncedQuery(query), 150);
		return () => window.clearTimeout(timer);
	}, [query]);

	useEffect(() => {
		let active = true;
		const load = async () => {
			try {
				const pending = cards.list({
					searchTerm: debouncedQuery.trim() || undefined,
					orphanOnly: search.state.orphanOnly,
					sortBy: search.state.sort,
				});
				const result = Array.isArray(pending) ? pending : await pending;
				if (active) {
					setRows(result);
					setStatus("ready");
					setError(null);
				}
			} catch (reason) {
				if (active) {
					setStatus("error");
					setError(
						reason instanceof Error ? reason.message : "Failed to load cards.",
					);
				}
			}
		};
		setStatus("loading");
		void load();
		const unsubscribe = cards.subscribe(() => void load());
		return () => {
			active = false;
			unsubscribe();
		};
	}, [cards, debouncedQuery, search.state.orphanOnly, search.state.sort]);

	const visibleCardIds = useMemo(() => rows.map((card) => card.id), [rows]);
	const gridWindow = useUniformGridWindow(rows.length);
	const selection = useCardLibrarySelection({
		gridElement: gridWindow.gridElement,
		gridMetrics: gridWindow.metrics,
		// Selection scope is every filtered card, never the windowed DOM slice.
		visibleCardIds,
		resetKey: `${debouncedQuery}\0${search.state.orphanOnly}\0${search.state.sort}`,
		previewCardId,
		deleteDialogOpen: deleteDialogOpenRef.current,
		deleteDialogOpenRef,
		onPreviewCard: setPreviewCardId,
	});
	const actions = useCardLibraryActions({
		selectedCardIds: selection.selectedCardIds,
		clearSelection: selection.clearSelection,
		setSelectedCardIds: selection.setSelectedCardIds,
		previewCardId,
		setPreviewCardId,
	});
	deleteDialogOpenRef.current = actions.deleteTargetIds.length > 0;

	const updateSearch = (patch: Partial<CardLibrarySearchState>) =>
		search.replace({ ...search.state, ...patch });
	const createCard = async () => {
		if (isCreatingCard) return;
		setIsCreatingCard(true);
		try {
			const id = await cards.create();
			navigation.navigate(navigation.cardHref(id));
		} finally {
			setIsCreatingCard(false);
		}
	};

	return (
		<div
			ref={selection.selectionSurfaceRef}
			data-testid="cards-selection-surface"
			className="relative min-h-full w-full"
			onPointerDown={selection.handleSelectionPointerDown}
			onPointerMove={selection.handleSelectionPointerMove}
			onPointerUp={(event) =>
				selection.endMarqueeSelection(event, event.clientX, event.clientY)
			}
			onPointerCancel={(event) =>
				selection.endMarqueeSelection(event, event.clientX, event.clientY)
			}
			onClickCapture={selection.consumeSuppressedMarqueeClick}
		>
			<main aria-label="Card Library" className="w-full px-6 pb-2">
				<div
					data-testid="card-library-sticky-toolbar"
					className="sticky top-0 z-40 -mx-6 mb-4 border-b border-[var(--line)] bg-[var(--surface)] px-6 pb-3 pt-2"
				>
					<CardLibraryToolbar
						query={query}
						onQueryChange={(next) => {
							setQuery(next);
							updateSearch({ q: next });
						}}
						orphanOnly={search.state.orphanOnly}
						onToggleOrphanOnly={() =>
							updateSearch({
								orphanOnly: !search.state.orphanOnly,
								sort: "updated_desc",
							})
						}
						sort={search.state.sort}
						displayedSortLabel={
							debouncedQuery.trim()
								? "Relevance"
								: search.state.orphanOnly
									? "Recently updated"
									: sortLabels[search.state.sort]
						}
						isSortLocked={
							Boolean(debouncedQuery.trim()) || search.state.orphanOnly
						}
						onSortChange={(sort) => updateSearch({ sort })}
						selectedCount={selection.selectedCardIds.length}
						onAppendSelected={() =>
							actions.openAppendDialog([...selection.selectedCardIds])
						}
						onDeleteSelected={() =>
							actions.openDeleteDialog([...selection.selectedCardIds])
						}
						onClearSelection={selection.clearSelection}
						onCreateCard={() => void createCard()}
						isCreatingCard={isCreatingCard}
					/>
				</div>
				{actions.appendError || error ? (
					<div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
						{actions.appendError ?? error}
					</div>
				) : null}
				<CardGrid
					status={status === "loading" ? "LoadingFirstPage" : status}
					cards={rows.slice(gridWindow.firstIndex, gridWindow.lastIndex)}
					query={debouncedQuery}
					orphanOnly={search.state.orphanOnly}
					isSelected={selection.isSelected}
					getContextTargetIds={selection.getContextTargetIds}
					gridRef={gridWindow.gridRef}
					columns={gridWindow.metrics.columns}
					paddingTop={gridWindow.paddingTop}
					paddingBottom={gridWindow.paddingBottom}
					onCardClick={selection.handleCardClick}
					onCardPointerDown={selection.handleCardPointerDown}
					onCardContextMenu={(id) =>
						!selection.isSelected(id) && selection.selectOnly(id)
					}
					onPreview={setPreviewCardId}
					onFullscreen={(id) => navigation.navigate(navigation.cardHref(id))}
					onAppend={actions.openAppendDialog}
					onDelete={actions.openDeleteDialog}
					canLoadMore={false}
					onLoadMore={() => undefined}
				/>
				<CardPreviewDialog
					cardId={previewCardId}
					currentWhiteboardId={null}
					onClose={() => setPreviewCardId(null)}
				/>
				<WhiteboardPickerDialog
					open={actions.appendTargetCardIds.length > 0}
					onOpenChange={(open) => !open && actions.closeAppendDialog()}
					onSelect={(id) => void actions.confirmAppendToWhiteboard(id)}
					title={actions.appendPickerTitle}
				/>
				<DeleteCardDialog
					open={actions.deleteTargetIds.length > 0}
					cardCount={actions.deleteTargetIds.length}
					onCancel={actions.closeDeleteDialog}
					onConfirm={() => void actions.confirmDelete()}
				/>
			</main>
			{selection.selectionRect ? (
				<div
					data-testid="cards-selection-marquee"
					className="pointer-events-none absolute z-50 border border-[var(--sea-ink)] bg-[var(--sea-ink)]/10"
					style={selection.selectionRect}
				/>
			) : null}
		</div>
	);
}
