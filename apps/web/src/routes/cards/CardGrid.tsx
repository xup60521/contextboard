import { CheckCircle2, Eye, LayoutGrid, Maximize2, Plus, SearchX, Trash2 } from "lucide-react";
import type {
	PointerEvent as ReactButtonPointerEvent,
	MouseEvent as ReactMouseEvent,
} from "react";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "#/components/ui/context-menu";
import type { Doc, Id } from "#/integrations/local/types";

type CardTile = Doc<"cards">;
type CardGridStatus = "LoadingFirstPage" | "CanLoadMore" | string;

export function CardGrid({
	status,
	cards,
	query,
	orphanOnly,
	isSelected,
	getContextTargetIds,
	registerCardElement,
	onCardClick,
	onCardPointerDown,
	onCardContextMenu,
	onPreview,
	onFullscreen,
	onAppend,
	onDelete,
	canLoadMore,
	onLoadMore,
}: {
	status: CardGridStatus;
	cards: CardTile[];
	query: string;
	orphanOnly: boolean;
	isSelected: (cardId: Id<"cards">) => boolean;
	getContextTargetIds: (cardId: Id<"cards">) => Id<"cards">[];
	registerCardElement: (cardId: Id<"cards">, node: HTMLElement | null) => void;
	onCardClick: (
		cardId: Id<"cards">,
		event: ReactMouseEvent<HTMLButtonElement>,
	) => void;
	onCardPointerDown: (
		cardId: Id<"cards">,
		event: ReactButtonPointerEvent<HTMLButtonElement>,
	) => void;
	onCardContextMenu: (cardId: Id<"cards">) => void;
	onPreview: (cardId: Id<"cards">) => void;
	onFullscreen: (cardId: Id<"cards">) => void;
	onAppend: (cardIds: Id<"cards">[]) => void;
	onDelete: (cardIds: Id<"cards">[]) => void;
	canLoadMore: boolean;
	onLoadMore: () => void;
}) {
	if (status === "LoadingFirstPage") {
		return (
			<ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
				{Array.from({ length: 12 }).map((_, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton list
					<li key={i} className="flex">
						<div className="island-shell flex h-[170px] w-full animate-pulse flex-col rounded-xl p-4">
							<div className="mb-2 h-4 w-3/4 rounded bg-[var(--line)]" />
							<div className="h-3 w-full rounded bg-[var(--line)] opacity-60" />
							<div className="mt-1 h-3 w-5/6 rounded bg-[var(--line)] opacity-60" />
							<div className="mt-auto h-2.5 w-1/2 rounded bg-[var(--line)] opacity-40" />
						</div>
					</li>
				))}
			</ul>
		);
	}

	if (cards.length === 0) {
		const isSearch = query.trim().length > 0;
		const Icon = isSearch ? SearchX : orphanOnly ? CheckCircle2 : LayoutGrid;
		const title = isSearch
			? `No results for "${query.trim()}"`
			: orphanOnly
				? "All cards are placed"
				: "No cards yet";
		const subtitle = isSearch
			? "Try a different search term."
			: orphanOnly
				? "No unplaced cards right now."
				: "Cards you create will appear here.";

		return (
			<div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
				<Icon
					className="size-10 text-[var(--sea-ink-soft)] opacity-40"
					strokeWidth={1.25}
				/>
				<div className="space-y-1">
					<p className="text-sm font-semibold text-[var(--sea-ink-soft)]">{title}</p>
					<p className="text-xs text-[var(--sea-ink-soft)] opacity-60">{subtitle}</p>
				</div>
			</div>
		);
	}

	return (
		<>
			<ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
				{cards.map((card) => {
					const contextTargetIds = getContextTargetIds(card._id);
					const singleTarget = contextTargetIds.length === 1;

					return (
						<li
							key={card._id}
							data-card-tile="true"
							className="flex"
							ref={(node) => registerCardElement(card._id, node)}
						>
							<CardLibraryTile
								card={card}
								selected={isSelected(card._id)}
								onClick={(event) => onCardClick(card._id, event)}
								onPointerDown={(event) => onCardPointerDown(card._id, event)}
								onContextMenu={() => onCardContextMenu(card._id)}
								onPreview={() => onPreview(card._id)}
								onFullscreen={() => onFullscreen(card._id)}
								onAppend={() => onAppend(contextTargetIds)}
								onDelete={() => onDelete(contextTargetIds)}
								canPreview={singleTarget}
								canFullscreen={singleTarget}
								canAppend={contextTargetIds.length > 0}
								appendLabel={
									contextTargetIds.length === 1
										? "Append to whiteboard..."
										: `Append ${contextTargetIds.length} cards to whiteboard...`
								}
								deleteLabel={
									contextTargetIds.length === 1
										? "Delete card"
										: `Delete ${contextTargetIds.length} cards`
								}
							/>
						</li>
					);
				})}
			</ul>

			{canLoadMore ? (
				<button
					type="button"
					className="mt-4 rounded border border-[var(--line)] px-3 py-1.5 text-sm font-semibold text-[var(--sea-ink)] hover:bg-[var(--surface-strong)]"
					onClick={onLoadMore}
				>
					Load more
				</button>
			) : null}
		</>
	);
}

function CardLibraryTile({
	card,
	selected,
	onClick,
	onPointerDown,
	onContextMenu,
	onPreview,
	onFullscreen,
	onAppend,
	onDelete,
	canPreview,
	canFullscreen,
	canAppend,
	appendLabel,
	deleteLabel,
}: {
	card: CardTile;
	selected: boolean;
	onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
	onPointerDown: (event: ReactButtonPointerEvent<HTMLButtonElement>) => void;
	onContextMenu: () => void;
	onPreview: () => void;
	onFullscreen: () => void;
	onAppend: () => void;
	onDelete: () => void;
	canPreview: boolean;
	canFullscreen: boolean;
	canAppend: boolean;
	appendLabel: string;
	deleteLabel: string;
}) {
	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<button
					type="button"
					onClick={onClick}
					onPointerDown={onPointerDown}
					onContextMenu={onContextMenu}
					aria-pressed={selected}
					className={`island-shell flex h-full cursor-pointer min-h-[120px] w-full flex-col rounded-xl p-4 text-left transition hover:shadow-md focus-visible:ring-2 focus-visible:ring-[var(--lagoon)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)] ${
						selected
							? "bg-[var(--surface-strong)] outline-1 outline-offset-2 outline-[var(--sea-ink)]"
							: "focus:outline-none"
					}`}
				>
					<h2 className="line-clamp-2 text-sm font-bold text-[var(--sea-ink)]">
						{card.derivedTitle}
					</h2>
					<p className="mt-2 line-clamp-4 text-xs text-[var(--sea-ink-soft)]">
						{card.preview || "No preview yet."}
					</p>
					<p className="mt-auto pt-2 text-[10px] text-[var(--sea-ink-soft)]">
						{(card.activePlacementCount ?? 0) === 0
							? "Unplaced"
							: `Placed on ${card.activePlacementCount ?? 0} board${(card.activePlacementCount ?? 0) === 1 ? "" : "s"}`}
					</p>
				</button>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem onSelect={onPreview} disabled={!canPreview}>
					<Eye className="size-4" />
					Preview
				</ContextMenuItem>
				<ContextMenuItem onSelect={onFullscreen} disabled={!canFullscreen}>
					<Maximize2 className="size-4" />
					Fullscreen
				</ContextMenuItem>
				<ContextMenuItem onSelect={onAppend} disabled={!canAppend}>
					<Plus className="size-4" />
					{appendLabel}
				</ContextMenuItem>
				<ContextMenuItem
					onSelect={onDelete}
					className="text-red-600 focus:text-red-600"
				>
					<Trash2 className="size-4" />
					{deleteLabel}
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}
