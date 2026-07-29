import { useCallback, useMemo, useState } from "react";
import {
	useApplicationRuntime,
	useApplicationValue,
} from "../ApplicationRuntimeProvider";
import type { CardSortOrder } from "../runtime";

const SORT_OPTIONS: Array<{ value: CardSortOrder; label: string }> = [
	{ value: "updated_desc", label: "Recently updated" },
	{ value: "updated_asc", label: "Least recently updated" },
	{ value: "title", label: "Title A–Z" },
	{ value: "title_desc", label: "Title Z–A" },
];

function SearchIcon() {
	return (
		<svg aria-hidden="true" className="cb-icon" viewBox="0 0 24 24">
			<circle cx="11" cy="11" r="7" />
			<path d="m20 20-4-4" />
		</svg>
	);
}

function PlusIcon() {
	return (
		<svg aria-hidden="true" className="cb-icon" viewBox="0 0 24 24">
			<path d="M12 5v14M5 12h14" />
		</svg>
	);
}

export function CardListView() {
	const runtime = useApplicationRuntime();
	const [query, setQuery] = useState("");
	const [sortBy, setSortBy] = useState<CardSortOrder>("updated_desc");
	const [orphanOnly, setOrphanOnly] = useState(false);
	const [creating, setCreating] = useState(false);
	const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

	const cards = useApplicationValue(
		() => runtime.cards.list({ searchTerm: query.trim(), sortBy }),
		[runtime.cards, query, sortBy],
	);
	const visibleCards = useMemo(
		() =>
			cards.status === "ready"
				? cards.data.filter(
						(card) => !orphanOnly || card.activePlacementCount === 0,
					)
				: [],
		[cards, orphanOnly],
	);

	const createCard = useCallback(async () => {
		if (creating) return;
		setCreating(true);
		try {
			const cardId = await runtime.cards.create();
			runtime.navigation.navigate(runtime.navigation.cardHref(cardId));
		} finally {
			setCreating(false);
		}
	}, [creating, runtime]);

	const deleteSelected = useCallback(async () => {
		await Promise.all([...selectedIds].map((cardId) => runtime.cards.delete(cardId)));
		setSelectedIds(new Set());
	}, [runtime.cards, selectedIds]);

	return (
		<main className="cb-library" aria-label="Card Library">
			<header className="cb-library-toolbar">
				<div className="cb-library-toolbar__row">
					<button
						className="cb-pill cb-pill--primary"
						disabled={creating}
						onClick={() => void createCard()}
						type="button"
					>
						<PlusIcon />
						{creating ? "Creating..." : "New card"}
					</button>
					<label className="cb-search">
						<span className="cb-visually-hidden">Find a card</span>
						<SearchIcon />
						<input
							aria-label="Search cards"
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Find a card..."
							type="search"
							value={query}
						/>
					</label>
				</div>
				<div className="cb-library-toolbar__row">
					<button
						aria-pressed={orphanOnly}
						className={`cb-pill${orphanOnly ? " cb-pill--active" : ""}`}
						onClick={() => setOrphanOnly((value) => !value)}
						type="button"
					>
						<span aria-hidden="true">⌄</span>
						Orphan only
						{orphanOnly ? <span aria-hidden="true">×</span> : null}
					</button>
					<div className="cb-library-toolbar__actions">
						<label className="cb-sort-pill">
							<span aria-hidden="true">⇅</span>
							<span>Sort</span>
							<select
								disabled={query.trim().length > 0 || orphanOnly}
								onChange={(event) =>
									setSortBy(event.target.value as CardSortOrder)
								}
								value={sortBy}
							>
								{SORT_OPTIONS.map((option) => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</select>
						</label>
						{selectedIds.size > 0 ? (
							<div className="cb-selection-actions">
								<strong>{selectedIds.size} selected</strong>
								<button onClick={() => void deleteSelected()} type="button">
									Delete
								</button>
								<button onClick={() => setSelectedIds(new Set())} type="button">
									Clear
								</button>
							</div>
						) : null}
					</div>
				</div>
			</header>

			{cards.status === "loading" ? (
				<ul className="cb-library-grid" aria-label="Loading cards">
					{Array.from({ length: 12 }, (_, index) => (
						<li className="cb-library-card cb-library-card--skeleton" key={index} />
					))}
				</ul>
			) : cards.status === "error" ? (
				<div className="cb-library-empty" role="alert">
					<strong>Cards could not be loaded.</strong>
					<span>{cards.error.message}</span>
					<button className="cb-pill" onClick={cards.refresh} type="button">
						Try again
					</button>
				</div>
			) : visibleCards.length === 0 ? (
				<div className="cb-library-empty">
					<span aria-hidden="true" className="cb-library-empty__icon">
						{query.trim() ? "⌕" : orphanOnly ? "✓" : "▦"}
					</span>
					<strong>
						{query.trim()
							? `No results for "${query.trim()}"`
							: orphanOnly
								? "All cards are placed"
								: "No cards yet"}
					</strong>
					<span>
						{query.trim()
							? "Try a different search term."
							: orphanOnly
								? "No unplaced cards right now."
								: "Cards you create will appear here."}
					</span>
				</div>
			) : (
				<ul className="cb-library-grid">
					{visibleCards.map((card) => {
						const selected = selectedIds.has(card.id);
						return (
							<li key={card.id}>
								<button
									aria-pressed={selected}
									className="cb-library-card"
									onClick={(event) => {
										if (event.shiftKey || event.ctrlKey || event.metaKey) {
											setSelectedIds((current) => {
												const next = new Set(current);
												if (next.has(card.id)) next.delete(card.id);
												else next.add(card.id);
												return next;
											});
											return;
										}
										runtime.navigation.navigate(
											runtime.navigation.cardHref(card.id),
										);
									}}
									type="button"
								>
									<h2>{card.title}</h2>
									<span>{card.preview || "No preview yet."}</span>
									<small>
										{card.activePlacementCount === 0
											? "Unplaced"
											: `Placed on ${card.activePlacementCount} board${card.activePlacementCount === 1 ? "" : "s"}`}
									</small>
								</button>
							</li>
						);
					})}
				</ul>
			)}
		</main>
	);
}
