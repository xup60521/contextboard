import { useDebouncedValue } from "@tanstack/react-pacer";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, usePaginatedQuery } from "convex/react";
import { ArrowUpDown, Check, Eye, Filter, Maximize2, Search, Trash2, X } from "lucide-react";
import { useState } from "react";
import { SidebarOpenButton } from "#/components/navigation/SidebarOpenButton";
import { CardPreviewDialog } from "#/components/search/CardPreviewDialog";
import { DeleteCardDialog } from "#/components/cards/DeleteCardDialog";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "#/components/ui/context-menu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItemIndicator,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import {
	CARD_SORT_OPTIONS,
	type CardSortBy,
	DEFAULT_CARD_SORT_BY,
	getCardSortLabel,
	isCardSortBy,
} from "../../../convex/model/cardSorting";

interface CardSearch {
	orphan: string;
	sort: CardSortBy;
}

export const Route = createFileRoute("/cards/")({
	ssr: false,
	validateSearch: (search: Record<string, unknown>): CardSearch => ({
		orphan: typeof search.orphan === "string" ? search.orphan : "",
		sort: isCardSortBy(search.sort) ? search.sort : DEFAULT_CARD_SORT_BY,
	}),
	component: RouteComponent,
});

export function RouteComponent() {
	const navigate = Route.useNavigate();
	const { orphan, sort } = Route.useSearch();
	const initialOrphan = orphan === "true";

	const [query, setQuery] = useState("");
	const [debouncedQuery] = useDebouncedValue(query, { wait: 150 });
	const [previewCardId, setPreviewCardId] = useState<Id<"cards"> | null>(null);
	const [orphanOnly, setOrphanOnly] = useState(initialOrphan);
	const archiveCards = useMutation(api.cards.archiveCards);
	const [deleteTargetIds, setDeleteTargetIds] = useState<Id<"cards">[]>([]);

	const openDeleteDialog = (cardId: Id<"cards">) => {
		setDeleteTargetIds([cardId]);
	};

	const closeDeleteDialog = () => {
		setDeleteTargetIds([]);
	};

	const confirmDelete = async () => {
		const [cardId] = deleteTargetIds;
		if (!cardId) return;

		await archiveCards({ cardIds: [cardId] });
		setDeleteTargetIds([]);

		if (previewCardId === cardId) {
			setPreviewCardId(null);
		}
	};

	const toggleOrphanOnly = () => {
		const next = !orphanOnly;
		setOrphanOnly(next);
		navigate({
			search: (prev) => ({
				...prev,
				orphan: next ? "true" : "",
				sort,
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

	const cards = usePaginatedQuery(
		api.cards.listAll,
		{
			...(debouncedQuery.trim() ? { searchTerm: debouncedQuery.trim() } : {}),
			...(orphanOnly ? { orphanOnly: true } : {}),
			sortBy: sort,
		},
		{ initialNumItems: 50 },
	);

	return (
		<main className="w-full px-6 py-2">
			<header className="mb-4 flex flex-col gap-1.5">
				<div className="flex items-center gap-2">
					<SidebarOpenButton />
					<div className="relative flex items-center">
						<Search
							size={12}
							className="pointer-events-none absolute left-2 text-[var(--sea-ink-soft)]"
						/>
						<input
							type="text"
							placeholder="Find a card..."
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							className="w-44 rounded-md border border-[var(--line)] bg-[var(--surface)] py-1 pl-7 pr-3 text-xs text-[var(--sea-ink)] placeholder:text-[var(--sea-ink-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--sea-ink)]/20"
						/>
					</div>
				</div>
				<div className="flex items-center gap-1.5">
					<button
						type="button"
						onClick={toggleOrphanOnly}
						className={`cursor-pointer flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
							orphanOnly
								? "border-[var(--sea-ink)] bg-[var(--sea-ink)] text-[var(--surface)]"
								: "border-[var(--line)] bg-[var(--surface)] text-[var(--sea-ink-soft)] hover:bg-[var(--surface-strong)]"
						}`}
					>
						<Filter size={11} />
						Orphan only
						{orphanOnly && <X size={11} />}
					</button>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<button
								type="button"
								className="ml-auto flex cursor-pointer items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1 text-xs font-medium text-[var(--sea-ink-soft)] transition hover:bg-[var(--surface-strong)] hover:text-[var(--sea-ink)]"
								aria-label={`Sort cards by ${getCardSortLabel(sort)}`}
							>
								<ArrowUpDown size={11} />
								<span>Sort:</span>
								<span className="font-semibold text-[var(--sea-ink)]">
									{getCardSortLabel(sort)}
								</span>
							</button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-56">
							<div className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--sea-ink-soft)]">
								Sort cards
							</div>
							<DropdownMenuRadioGroup
								value={sort}
								onValueChange={(value) => {
									if (isCardSortBy(value)) {
										setSort(value);
									}
								}}
							>
								{CARD_SORT_OPTIONS.map((sortBy) => (
									<DropdownMenuRadioItem key={sortBy} value={sortBy}>
										<DropdownMenuItemIndicator>
											<Check size={12} />
										</DropdownMenuItemIndicator>
										{getCardSortLabel(sortBy)}
									</DropdownMenuRadioItem>
								))}
							</DropdownMenuRadioGroup>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</header>

			{cards.status === "LoadingFirstPage" ? (
				<ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
					{Array.from({ length: 12 }).map((_, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton list
						<li key={i} className="flex">
							<div className="island-shell flex min-h-[120px] w-full animate-pulse flex-col rounded-xl p-4">
								<div className="mb-2 h-4 w-3/4 rounded bg-[var(--line)]" />
								<div className="h-3 w-full rounded bg-[var(--line)] opacity-60" />
								<div className="mt-1 h-3 w-5/6 rounded bg-[var(--line)] opacity-60" />
								<div className="mt-auto h-2.5 w-1/2 rounded bg-[var(--line)] opacity-40" />
							</div>
						</li>
					))}
				</ul>
			) : cards.results.length === 0 ? (
				<div className="island-shell rounded-2xl p-8 text-sm font-semibold text-[var(--sea-ink-soft)]">
					{debouncedQuery.trim()
						? `No cards matching "${debouncedQuery.trim()}".`
						: orphanOnly
							? "No orphan cards."
							: "No cards."}
				</div>
			) : (
				<ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
					{cards.results.map((card) => (
						<li key={card._id} className="flex">
							<CardLibraryTile
								card={card}
								onPreview={() => setPreviewCardId(card._id)}
								onFullscreen={() =>
									navigate({
										to: "/cards/$cardId",
										params: { cardId: card._id },
									})
								}
								onDelete={() => openDeleteDialog(card._id)}
							/>
						</li>
					))}
				</ul>
			)}

			{cards.status === "CanLoadMore" && (
				<button
					type="button"
					className="mt-4 rounded border border-[var(--line)] px-3 py-1.5 text-sm font-semibold text-[var(--sea-ink)] hover:bg-[var(--surface-strong)]"
					onClick={() => cards.loadMore(50)}
				>
					Load more
				</button>
			)}

			<CardPreviewDialog
				cardId={previewCardId}
				currentWhiteboardId={null}
				onClose={() => setPreviewCardId(null)}
			/>

			<DeleteCardDialog
				open={deleteTargetIds.length > 0}
				cardCount={deleteTargetIds.length}
				onCancel={closeDeleteDialog}
				onConfirm={() => void confirmDelete()}
			/>
		</main>
	);
}

type CardTile = Doc<"cards"> & { placementCount: number };

function CardLibraryTile({
	card,
	onPreview,
	onFullscreen,
	onDelete,
}: {
	card: CardTile;
	onPreview: () => void;
	onFullscreen: () => void;
	onDelete: () => void;
}) {
	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<button
					type="button"
					onClick={onPreview}
					className="island-shell flex h-full cursor-pointer min-h-[120px] w-full flex-col rounded-xl p-4 text-left transition hover:shadow-md"
				>
					<h2 className="line-clamp-2 text-sm font-bold text-[var(--sea-ink)]">
						{card.derivedTitle}
					</h2>
					<p className="mt-2 line-clamp-4 text-xs text-[var(--sea-ink-soft)]">
						{card.preview || "No preview yet."}
					</p>
					<p className="mt-auto pt-2 text-[10px] text-[var(--sea-ink-soft)]">
						{card.placementCount === 0
							? "Unplaced"
							: `Placed on ${card.placementCount} board${card.placementCount === 1 ? "" : "s"}`}
					</p>
				</button>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem onSelect={onPreview}>
					<Eye className="size-4" />
					Preview
				</ContextMenuItem>
				<ContextMenuItem onSelect={onFullscreen}>
					<Maximize2 className="size-4" />
					Fullscreen
				</ContextMenuItem>
				<ContextMenuItem
					onSelect={onDelete}
					className="text-red-600 focus:text-red-600"
				>
					<Trash2 className="size-4" />
					Delete
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}
