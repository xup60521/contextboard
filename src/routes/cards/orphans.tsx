import { createFileRoute, Link } from "@tanstack/react-router";
import { usePaginatedQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

export const Route = createFileRoute("/cards/orphans")({
	ssr: false,
	component: RouteComponent,
});

function RouteComponent() {
	const cards = usePaginatedQuery(
		api.cards.listOrphans,
		{},
		{ initialNumItems: 50 },
	);

	return (
		<main className="page-wrap py-6">
			<header className="mb-5 flex flex-wrap items-center justify-between gap-3">
				<div>
					<p className="island-kicker">Cards</p>
					<h1 className="text-2xl font-bold text-[var(--sea-ink)]">
						Orphan cards
					</h1>
				</div>
				<Link
					to="/whiteboard"
					className="rounded border border-[var(--line)] px-3 py-1.5 text-sm font-semibold text-[var(--sea-ink)] hover:bg-[var(--surface-strong)]"
				>
					Back to root
				</Link>
			</header>

			<section className="island-shell overflow-hidden rounded-2xl">
				{cards.results.length === 0 ? (
					<div className="p-8 text-sm font-semibold text-[var(--sea-ink-soft)]">
						No orphan cards.
					</div>
				) : (
					<ul className="divide-y divide-[var(--line)]">
						{cards.results.map((card) => (
							<li key={card._id}>
								<Link
									to="/cards/$cardId"
									params={{ cardId: card._id }}
									className="block p-4 transition hover:bg-[var(--surface-strong)]"
								>
									<h2 className="text-base font-bold text-[var(--sea-ink)]">
										{card.derivedTitle}
									</h2>
									<p className="mt-1 line-clamp-2 text-sm text-[var(--sea-ink-soft)]">
										{card.preview || "No preview yet."}
									</p>
								</Link>
							</li>
						))}
					</ul>
				)}
			</section>

			{cards.status === "CanLoadMore" && (
				<button
					type="button"
					className="mt-4 rounded border border-[var(--line)] px-3 py-1.5 text-sm font-semibold text-[var(--sea-ink)] hover:bg-[var(--surface-strong)]"
					onClick={() => cards.loadMore(50)}
				>
					Load more
				</button>
			)}
		</main>
	);
}
