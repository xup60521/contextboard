import { ArrowUpDown, Check, Filter, Search, X } from "lucide-react";
import { SidebarOpenButton } from "#/components/navigation/SidebarOpenButton";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItemIndicator,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import {
	CARD_SORT_OPTIONS,
	type CardSortBy,
	getCardSortLabel,
	isCardSortBy,
} from "#/lib/card-sorting";

export function CardLibraryToolbar({
	query,
	onQueryChange,
	orphanOnly,
	onToggleOrphanOnly,
	sort,
	displayedSortLabel,
	isSortLocked,
	selectedCount,
	onSortChange,
	onAppendSelected,
	onDeleteSelected,
	onClearSelection,
}: {
	query: string;
	onQueryChange: (query: string) => void;
	orphanOnly: boolean;
	onToggleOrphanOnly: () => void;
	sort: CardSortBy;
	displayedSortLabel: string;
	isSortLocked: boolean;
	onSortChange: (sort: CardSortBy) => void;
	selectedCount: number;
	onAppendSelected: () => void;
	onDeleteSelected: () => void;
	onClearSelection: () => void;
}) {
	return (
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
						onChange={(e) => onQueryChange(e.target.value)}
						className="w-44 rounded-md border border-[var(--line)] bg-[var(--surface)] py-1 pl-7 pr-3 text-xs text-[var(--sea-ink)] placeholder:text-[var(--sea-ink-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--sea-ink)]/20"
					/>
				</div>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<button
					type="button"
					onClick={onToggleOrphanOnly}
					className={`cursor-pointer flex h-8 items-center gap-1 rounded-full border px-3 text-xs font-medium transition ${
						orphanOnly
							? "border-[var(--sea-ink)] bg-[var(--sea-ink)] text-[var(--surface)]"
							: "border-[var(--line)] bg-[var(--surface)] text-[var(--sea-ink-soft)] hover:bg-[var(--surface-strong)]"
					}`}
				>
					<Filter size={11} />
					Orphan only
					{orphanOnly ? <X size={11} /> : null}
				</button>
				<div className="ml-auto flex flex-wrap items-center justify-end gap-2">
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<button
								type="button"
								disabled={isSortLocked}
								className="flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 text-xs font-medium text-[var(--sea-ink-soft)] shadow-[0_8px_20px_rgba(15,23,42,0.04)] backdrop-blur-sm transition hover:border-[var(--sea-ink)]/15 hover:bg-[var(--surface-strong)] hover:text-[var(--sea-ink)]"
								aria-label={`Sort cards by ${displayedSortLabel}`}
							>
								<ArrowUpDown size={11} />
								<span>Sort</span>
								<span className="font-semibold text-[var(--sea-ink)]">
									{displayedSortLabel}
								</span>
							</button>
						</DropdownMenuTrigger>
						{isSortLocked ? null : (
							<DropdownMenuContent align="end" className="w-56">
								<div className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--sea-ink-soft)]">
									Sort cards
								</div>
								<DropdownMenuRadioGroup
									value={sort}
									onValueChange={(value) => {
										if (isCardSortBy(value)) {
											onSortChange(value);
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
						)}
					</DropdownMenu>
					{selectedCount > 0 ? (
						<div className="flex h-8 items-center overflow-hidden rounded-full border border-[var(--line)] bg-[var(--surface)] p-0.5 text-xs shadow-[0_10px_24px_rgba(15,23,42,0.05)] backdrop-blur-sm">
							<span className="flex h-7 items-center gap-2 rounded-full bg-[var(--surface-strong)] px-3 font-semibold text-[var(--sea-ink)]">
								<span className="size-1.5 rounded-full bg-[var(--lagoon)]" />
								{selectedCount} selected
							</span>
							<span
								aria-hidden="true"
								className="mx-1 h-4 w-px bg-[var(--line)]"
							/>
							<button
								type="button"
								onClick={onAppendSelected}
								className="cursor-pointer rounded-full px-2.5 py-1 font-semibold text-[var(--sea-ink)] transition hover:bg-[var(--surface-strong)]"
							>
								Append
							</button>
							<button
								type="button"
								onClick={onDeleteSelected}
								className="cursor-pointer rounded-full px-2.5 py-1 font-semibold text-[var(--destructive)] transition hover:bg-red-500/10"
							>
								Delete
							</button>
							<button
								type="button"
								onClick={onClearSelection}
								className="cursor-pointer rounded-full px-2.5 py-1 font-medium text-[var(--sea-ink-soft)] transition hover:bg-[var(--surface-strong)] hover:text-[var(--sea-ink)]"
							>
								Clear
							</button>
						</div>
					) : null}
				</div>
			</div>
		</header>
	);
}
