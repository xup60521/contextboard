import { useDebouncedValue } from "@tanstack/react-pacer";
import { createFileRoute, stripSearchParams } from "@tanstack/react-router";
import { usePaginatedQuery } from "#/integrations/local/react";
import { useMemo, useRef, useState } from "react";
import { DeleteCardDialog } from "#/components/cards/DeleteCardDialog";
import { CardPreviewDialog } from "#/components/search/CardPreviewDialog";
import { WhiteboardPickerDialog } from "#/components/whiteboard/WhiteboardPickerDialog";
import { api } from "#/integrations/local/api";
import type { Id } from "#/integrations/local/types";
import {
	type CardSortBy,
	DEFAULT_CARD_SORT_BY,
	getCardSortLabel,
	isCardSortBy,
} from "#/lib/card-sorting";
import { CardGrid } from "./CardGrid";
import { CardLibraryToolbar } from "./CardLibraryToolbar";
import { useCardLibraryActions } from "./useCardLibraryActions";
import { useCardLibrarySelection } from "./useCardLibrarySelection";

interface CardSearch {
	orphan: string;
	sort: CardSortBy;
	q: string;
}

export const Route = createFileRoute("/cards/")({
	ssr: false,
	validateSearch: (search: Record<string, unknown>): CardSearch => ({
		orphan: typeof search.orphan === "string" ? search.orphan : "",
		sort: isCardSortBy(search.sort) ? search.sort : DEFAULT_CARD_SORT_BY,
		q: typeof search.q === "string" ? search.q : "",
	}),
	search: {
		middlewares: [stripSearchParams({ q: "" })],
	},
	component: RouteComponent,
});

export function RouteComponent() {
	const navigate = Route.useNavigate();
	const { orphan, sort, q } = Route.useSearch();
	const initialOrphan = orphan === "true";

	const [query, setQuery] = useState(q);
	const [debouncedQuery] = useDebouncedValue(query, { wait: 150 });
	const [previewCardId, setPreviewCardId] = useState<Id<"cards"> | null>(null);
	const [orphanOnly, setOrphanOnly] = useState(initialOrphan);
	const deleteDialogOpenRef = useRef(false);
	const trimmedQuery = debouncedQuery.trim();
	const hasSearchQuery = trimmedQuery.length > 0;
	const isSortLocked = hasSearchQuery || orphanOnly;
	const displayedSortLabel = hasSearchQuery
		? "Relevance"
		: orphanOnly
			? getCardSortLabel("updated")
			: getCardSortLabel(sort);
	const selectionResetKey = `${debouncedQuery}\u0000${orphanOnly ? "1" : "0"}\u0000${sort}`;

	const cards = usePaginatedQuery(
		api.cards.listAll,
		{
			...(trimmedQuery ? { searchTerm: trimmedQuery } : {}),
			...(orphanOnly ? { orphanOnly: true } : {}),
			sortBy: sort,
		},
		{ initialNumItems: 50 },
	);
	const visibleCardIds = useMemo(
		() => cards.results.map((card) => card._id),
		[cards.results],
	);

	const selection = useCardLibrarySelection({
		visibleCardIds,
		resetKey: selectionResetKey,
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
		navigate,
	});
	deleteDialogOpenRef.current = actions.deleteTargetIds.length > 0;

	const toggleOrphanOnly = () => {
		const next = !orphanOnly;
		setOrphanOnly(next);
		navigate({
			search: (prev) => ({
				...prev,
				orphan: next ? "true" : "",
				sort: "updated",
			}),
			replace: true,
		});
	};

	const setSort = (nextSort: CardSortBy) => {
		navigate({
			search: (prev) => ({
				...prev,
				sort: nextSort,
			}),
			replace: true,
		});
	};

	const setSearchQuery = (nextQuery: string) => {
		setQuery(nextQuery);
		navigate({
			search: (prev) => ({ ...prev, q: nextQuery }),
			replace: true,
		});
	};

	const registerCardElement = (
		cardId: Id<"cards">,
		node: HTMLElement | null,
	) => {
		if (node) {
			selection.cardElementByIdRef.current.set(cardId, node);
		} else {
			selection.cardElementByIdRef.current.delete(cardId);
		}
	};

	return (
		<div
			ref={selection.selectionSurfaceRef}
			data-testid="cards-selection-surface"
			className="relative min-h-full w-full overflow-hidden"
			onPointerDown={selection.handleSelectionPointerDown}
			onPointerMove={selection.handleSelectionPointerMove}
			onPointerUp={(event) =>
				selection.endMarqueeSelection(event, event.clientX, event.clientY)
			}
			onPointerCancel={(event) =>
				selection.endMarqueeSelection(event, event.clientX, event.clientY)
			}
			onClickCapture={(event) => {
				selection.consumeSuppressedMarqueeClick(event);
			}}
		>
			<main className="w-full px-6 py-2">
				<CardLibraryToolbar
					query={query}
					onQueryChange={setSearchQuery}
					orphanOnly={orphanOnly}
					onToggleOrphanOnly={toggleOrphanOnly}
					sort={sort}
					displayedSortLabel={displayedSortLabel}
					isSortLocked={isSortLocked}
					onSortChange={setSort}
					selectedCount={selection.selectedCardIds.length}
					onAppendSelected={() =>
						actions.openAppendDialog([...selection.selectedCardIds])
					}
					onDeleteSelected={() =>
						actions.openDeleteDialog([...selection.selectedCardIds])
					}
					onClearSelection={selection.clearSelection}
				/>

				{actions.appendError ? (
					<div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
						{actions.appendError}
					</div>
				) : null}

				<CardGrid
					status={cards.status}
					cards={cards.results}
					query={debouncedQuery}
					orphanOnly={orphanOnly}
					isSelected={selection.isSelected}
					getContextTargetIds={selection.getContextTargetIds}
					registerCardElement={registerCardElement}
					onCardClick={selection.handleCardClick}
					onCardPointerDown={selection.handleCardPointerDown}
					onCardContextMenu={(cardId) => {
						if (!selection.isSelected(cardId)) {
							selection.selectOnly(cardId);
						}
					}}
					onPreview={setPreviewCardId}
					onFullscreen={(cardId) =>
						navigate({
							to: "/cards/$cardId",
							params: { cardId },
						})
					}
					onAppend={actions.openAppendDialog}
					onDelete={actions.openDeleteDialog}
					canLoadMore={cards.status === "CanLoadMore"}
					onLoadMore={() => cards.loadMore(50)}
				/>

				<CardPreviewDialog
					cardId={previewCardId}
					currentWhiteboardId={null}
					onClose={() => setPreviewCardId(null)}
				/>

				<WhiteboardPickerDialog
					open={actions.appendTargetCardIds.length > 0}
					onOpenChange={(open) => {
						if (!open) actions.closeAppendDialog();
					}}
					onSelect={(whiteboardId) => {
						void actions.confirmAppendToWhiteboard(whiteboardId);
					}}
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
					style={{
						left: selection.selectionRect.left,
						top: selection.selectionRect.top,
						width: selection.selectionRect.width,
						height: selection.selectionRect.height,
					}}
				/>
			) : null}
		</div>
	);
}
