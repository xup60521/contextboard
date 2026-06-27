import { useDebouncedValue } from "@tanstack/react-pacer";
import { createFileRoute, Link } from "@tanstack/react-router";
import { usePaginatedQuery } from "convex/react";
import { useState } from "react";
import { SidebarOpenButton } from "#/components/navigation/SidebarOpenButton";
import { CardPreviewDialog } from "#/components/search/CardPreviewDialog";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

export const Route = createFileRoute("/cards/orphans")({
	ssr: false,
	component: RouteComponent,
});

function GridIcon() {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<rect x="3" y="3" width="7" height="7" />
			<rect x="14" y="3" width="7" height="7" />
			<rect x="3" y="14" width="7" height="7" />
			<rect x="14" y="14" width="7" height="7" />
		</svg>
	);
}

function ListIcon() {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<line x1="8" y1="6" x2="21" y2="6" />
			<line x1="8" y1="12" x2="21" y2="12" />
			<line x1="8" y1="18" x2="21" y2="18" />
			<line x1="3" y1="6" x2="3.01" y2="6" />
			<line x1="3" y1="12" x2="3.01" y2="12" />
			<line x1="3" y1="18" x2="3.01" y2="18" />
		</svg>
	);
}

function RouteComponent() {
	const [query, setQuery] = useState("");
	const [debouncedQuery] = useDebouncedValue(query, { wait: 150 });
	const [previewCardId, setPreviewCardId] = useState<Id<"cards"> | null>(null);
	const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

	const cards = usePaginatedQuery(
		api.cards.listOrphans,
		debouncedQuery.trim() ? { searchTerm: debouncedQuery.trim() } : {},
		{ initialNumItems: 50 },
	);

	return (
		<main className="w-full px-6 py-6">
			<header className="mb-5 flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-start gap-3">
					<SidebarOpenButton />
					<div>
						<h1 className="text-2xl font-bold text-[var(--sea-ink)]">
							Orphan cards
						</h1>
					</div>
				</div>
			</header>

			<div className="mb-4 flex gap-2">
				<input
					type="text"
					placeholder="Search orphan cards..."
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-2.5 text-sm text-[var(--sea-ink)] placeholder:text-[var(--sea-ink-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--sea-ink)]/20"
				/>
				<div className="flex overflow-hidden rounded-lg border border-[var(--line)]">
					<button
						type="button"
						onClick={() => setViewMode("grid")}
						className={`flex items-center px-3 py-2 transition ${viewMode === "grid" ? "bg-[var(--surface-strong)] text-[var(--sea-ink)]" : "bg-[var(--surface)] text-[var(--sea-ink-soft)] hover:bg-[var(--surface-strong)]"}`}
						aria-label="Grid view"
						aria-pressed={viewMode === "grid"}
					>
						<GridIcon />
					</button>
					<button
						type="button"
						onClick={() => setViewMode("list")}
						className={`flex items-center border-l border-[var(--line)] px-3 py-2 transition ${viewMode === "list" ? "bg-[var(--surface-strong)] text-[var(--sea-ink)]" : "bg-[var(--surface)] text-[var(--sea-ink-soft)] hover:bg-[var(--surface-strong)]"}`}
						aria-label="List view"
						aria-pressed={viewMode === "list"}
					>
						<ListIcon />
					</button>
				</div>
			</div>

			{cards.results.length === 0 ? (
				<div className="island-shell rounded-2xl p-8 text-sm font-semibold text-[var(--sea-ink-soft)]">
					{debouncedQuery.trim()
						? `No orphan cards matching "${debouncedQuery.trim()}".`
						: "No orphan cards."}
				</div>
			) : viewMode === "grid" ? (
				<ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
					{cards.results.map((card) => (
						<li key={card._id} className="flex">
							<button
								type="button"
								onClick={() => setPreviewCardId(card._id)}
								className="island-shell flex h-full min-h-[120px] w-full flex-col rounded-xl p-4 text-left transition hover:shadow-md"
							>
								<h2 className="line-clamp-2 text-sm font-bold text-[var(--sea-ink)]">
									{card.derivedTitle}
								</h2>
								<p className="mt-2 line-clamp-4 text-xs text-[var(--sea-ink-soft)]">
									{card.preview || "No preview yet."}
								</p>
							</button>
						</li>
					))}
				</ul>
			) : (
				<section className="island-shell overflow-hidden rounded-2xl">
					<ul className="divide-y divide-[var(--line)]">
						{cards.results.map((card) => (
							<li key={card._id}>
								<button
									type="button"
									onClick={() => setPreviewCardId(card._id)}
									className="block w-full text-left p-4 transition hover:bg-[var(--surface-strong)]"
								>
									<h2 className="text-base font-bold text-[var(--sea-ink)]">
										{card.derivedTitle}
									</h2>
									<p className="mt-1 line-clamp-2 text-sm text-[var(--sea-ink-soft)]">
										{card.preview || "No preview yet."}
									</p>
								</button>
							</li>
						))}
					</ul>
				</section>
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
		</main>
	);
}
