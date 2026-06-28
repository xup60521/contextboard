import { useDebouncedValue } from "@tanstack/react-pacer";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, usePaginatedQuery } from "convex/react";
import {
	ArrowUpDown,
	Check,
	Eye,
	Filter,
	Maximize2,
	Plus,
	Search,
	Trash2,
	X,
} from "lucide-react";
import {
	type PointerEvent as ReactButtonPointerEvent,
	type MouseEvent as ReactMouseEvent,
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useRef,
	useState,
} from "react";
import { DeleteCardDialog } from "#/components/cards/DeleteCardDialog";
import { SidebarOpenButton } from "#/components/navigation/SidebarOpenButton";
import { CardPreviewDialog } from "#/components/search/CardPreviewDialog";
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
import { WhiteboardPickerDialog } from "#/components/whiteboard/WhiteboardPickerDialog";
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

type SelectionRect = {
	left: number;
	top: number;
	width: number;
	height: number;
};

type SelectionBounds = {
	left: number;
	right: number;
	top: number;
	bottom: number;
};

type DragSelectionState = {
	pointerId: number;
	startX: number;
	startY: number;
	hasMoved: boolean;
};

type SuppressedClick = {
	x: number;
	y: number;
	expiresAt: number;
};

const MARQUEE_EXCLUDED_SELECTOR =
	"button, input, textarea, select, a, [role='button'], [role='menuitem'], [contenteditable='true']";
const MARQUEE_CLICK_SUPPRESS_MS = 750;
const MARQUEE_CLICK_TOLERANCE = 8;
const MARQUEE_DRAG_THRESHOLD = 4;

function rectsIntersect(a: DOMRect, b: SelectionBounds) {
	return (
		a.left <= b.right &&
		a.right >= b.left &&
		a.top <= b.bottom &&
		a.bottom >= b.top
	);
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
	const [selectedCardIds, setSelectedCardIds] = useState<Id<"cards">[]>([]);
	const [orphanOnly, setOrphanOnly] = useState(initialOrphan);
	const archiveCards = useMutation(api.cards.archiveCards);
	const appendToWhiteboard = useMutation(api.cards.appendToWhiteboard);
	const appendCardsToWhiteboard = useMutation(api.cards.appendCardsToWhiteboard);
	const [deleteTargetIds, setDeleteTargetIds] = useState<Id<"cards">[]>([]);
	const [appendTargetCardIds, setAppendTargetCardIds] = useState<
		Id<"cards">[]
	>([]);
	const [isAppending, setIsAppending] = useState(false);
	const [appendError, setAppendError] = useState<string | null>(null);
	const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(
		null,
	);
	const selectionSurfaceRef = useRef<HTMLDivElement>(null);
	const cardElementByIdRef = useRef(new Map<Id<"cards">, HTMLElement>());
	const dragStartRef = useRef<DragSelectionState | null>(null);
	const suppressedClickRef = useRef<SuppressedClick | null>(null);
	const suppressCardClickTimeoutRef = useRef<number | null>(null);
	const selectionResetKey = `${debouncedQuery}\u0000${orphanOnly ? "1" : "0"}\u0000${sort}`;
	const previousSelectionResetKeyRef = useRef(selectionResetKey);

	const isSelected = (cardId: Id<"cards">) => selectedCardIds.includes(cardId);

	const clearSelection = () => {
		setSelectedCardIds((prev) => (prev.length === 0 ? prev : []));
	};

	const clearSuppressedClick = () => {
		suppressedClickRef.current = null;
		if (suppressCardClickTimeoutRef.current !== null) {
			window.clearTimeout(suppressCardClickTimeoutRef.current);
			suppressCardClickTimeoutRef.current = null;
		}
	};

	const armMarqueeClickSuppression = (x: number, y: number) => {
		clearSuppressedClick();
		suppressedClickRef.current = {
			x,
			y,
			expiresAt: Date.now() + MARQUEE_CLICK_SUPPRESS_MS,
		};
		suppressCardClickTimeoutRef.current = window.setTimeout(
			clearSuppressedClick,
			MARQUEE_CLICK_SUPPRESS_MS,
		);
	};

	const consumeSuppressedMarqueeClick = (
		event: ReactMouseEvent<HTMLElement>,
	) => {
		const suppressedClick = suppressedClickRef.current;
		if (!suppressedClick) {
			return false;
		}

		if (Date.now() > suppressedClick.expiresAt) {
			clearSuppressedClick();
			return false;
		}

		const matchesGeneratedClick =
			Math.abs(event.clientX - suppressedClick.x) <= MARQUEE_CLICK_TOLERANCE &&
			Math.abs(event.clientY - suppressedClick.y) <= MARQUEE_CLICK_TOLERANCE;

		if (!matchesGeneratedClick) {
			return false;
		}

		clearSuppressedClick();
		event.preventDefault();
		event.stopPropagation();
		return true;
	};

	const selectOnly = (cardId: Id<"cards">) => {
		setSelectedCardIds((prev) =>
			prev.length === 1 && prev[0] === cardId ? prev : [cardId],
		);
	};

	const toggleSelection = (cardId: Id<"cards">) => {
		setSelectedCardIds((prev) =>
			prev.includes(cardId)
				? prev.filter((id) => id !== cardId)
				: [...prev, cardId],
		);
	};

	const getContextTargetIds = (cardId: Id<"cards">) => {
		if (selectedCardIds.includes(cardId)) {
			return [...selectedCardIds];
		}

		return [cardId];
	};

	const openDeleteDialog = (cardIds: Id<"cards">[]) => {
		setDeleteTargetIds(cardIds);
	};

	const openAppendDialog = (cardIds: Id<"cards">[]) => {
		setAppendTargetCardIds(cardIds);
		setAppendError(null);
	};

	const closeDeleteDialog = () => {
		setDeleteTargetIds([]);
	};

	const closeAppendDialog = () => {
		if (isAppending) return;
		setAppendTargetCardIds([]);
		setAppendError(null);
	};

	const confirmDelete = async () => {
		const targetIds = [...deleteTargetIds];
		if (targetIds.length === 0) return;

		await archiveCards({ cardIds: targetIds });
		setDeleteTargetIds([]);
		setSelectedCardIds((prev) =>
			prev.filter((cardId) => !targetIds.includes(cardId)),
		);

		if (previewCardId && targetIds.includes(previewCardId)) {
			setPreviewCardId(null);
		}
	};

	const confirmAppendToWhiteboard = async (whiteboardId: Id<"whiteboards">) => {
		if (appendTargetCardIds.length === 0 || isAppending) return;

		setIsAppending(true);
		setAppendError(null);

		try {
			if (appendTargetCardIds.length === 1) {
				const placement = await appendToWhiteboard({
					cardId: appendTargetCardIds[0],
					whiteboardId,
				});

				if (!placement?.shapeId) {
					throw new Error("Card was appended, but no shape id was returned.");
				}

				setAppendTargetCardIds([]);
				clearSelection();

				await navigate({
					to: "/whiteboard/$whiteboardId",
					params: { whiteboardId: placement.whiteboardId },
					search: { focus: placement.shapeId },
				});
				return;
			}

			const result = await appendCardsToWhiteboard({
				cardIds: appendTargetCardIds,
				whiteboardId,
			});
			setAppendTargetCardIds([]);
			clearSelection();

			await navigate({
				to: "/whiteboard/$whiteboardId",
				params: { whiteboardId: result.whiteboardId },
			});
		} catch (error) {
			setAppendError(
				error instanceof Error
					? error.message
					: "Failed to append card to whiteboard.",
			);
		} finally {
			setIsAppending(false);
		}
	};

	const appendPickerTitle =
		appendTargetCardIds.length <= 1
			? isAppending
				? "Appending..."
				: "Append to whiteboard"
			: isAppending
				? "Appending cards..."
				: `Append ${appendTargetCardIds.length} cards to whiteboard`;

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
	useEffect(() => {
		if (previousSelectionResetKeyRef.current === selectionResetKey) {
			return;
		}

		previousSelectionResetKeyRef.current = selectionResetKey;
		setSelectedCardIds((prev) => (prev.length === 0 ? prev : []));
	}, [selectionResetKey]);

	useEffect(() => {
		const visibleIds = new Set(cards.results.map((card) => card._id));
		setSelectedCardIds((prev) => {
			const next = prev.filter((id) => visibleIds.has(id));
			return next.length === prev.length ? prev : next;
		});
	}, [cards.results]);

	useEffect(() => {
		return () => {
			suppressedClickRef.current = null;
			if (suppressCardClickTimeoutRef.current !== null) {
				window.clearTimeout(suppressCardClickTimeoutRef.current);
				suppressCardClickTimeoutRef.current = null;
			}
		};
	}, []);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") {
				return;
			}

			if (deleteTargetIds.length > 0 || previewCardId !== null) {
				return;
			}

			setSelectedCardIds((prev) => (prev.length === 0 ? prev : []));
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [deleteTargetIds.length, previewCardId]);

	const updateMarqueeSelection = (
		startState: DragSelectionState,
		currentX: number,
		currentY: number,
	) => {
		const surfaceRect = selectionSurfaceRef.current?.getBoundingClientRect();
		if (!surfaceRect) {
			return;
		}

		const left = Math.min(startState.startX, currentX);
		const top = Math.min(startState.startY, currentY);
		const right = Math.max(startState.startX, currentX);
		const bottom = Math.max(startState.startY, currentY);
		const intersectedIds: Id<"cards">[] = [];

		for (const [cardId, element] of cardElementByIdRef.current) {
			const rect = element.getBoundingClientRect();
			if (rectsIntersect(rect, { left, right, top, bottom })) {
				intersectedIds.push(cardId);
			}
		}

		setSelectionRect({
			left: left - surfaceRect.left,
			top: top - surfaceRect.top,
			width: right - left,
			height: bottom - top,
		});
		setSelectedCardIds(intersectedIds);
	};

	const handleSelectionPointerDown = (
		event: ReactPointerEvent<HTMLDivElement>,
	) => {
		if (!event.isPrimary || event.button !== 0) {
			return;
		}

		if (!(event.target instanceof HTMLElement)) {
			return;
		}

		// Synthetic events from portaled content (e.g. the card context menu) bubble
		// through the React tree to this handler even though their DOM target lives
		// outside the selection surface. Skip them so marquee selection never starts there.
		if (!event.currentTarget.contains(event.target)) {
			return;
		}

		if (
			event.target.closest(
				`[data-card-tile='true'], ${MARQUEE_EXCLUDED_SELECTOR}`,
			)
		) {
			return;
		}

		const surfaceRect = selectionSurfaceRef.current?.getBoundingClientRect();
		if (!surfaceRect) {
			return;
		}

		dragStartRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			hasMoved: false,
		};
		setSelectionRect({
			left: event.clientX - surfaceRect.left,
			top: event.clientY - surfaceRect.top,
			width: 0,
			height: 0,
		});
		clearSelection();
		event.preventDefault();
		event.currentTarget.setPointerCapture?.(event.pointerId);
	};

	const handleSelectionPointerMove = (
		event: ReactPointerEvent<HTMLDivElement>,
	) => {
		const dragState = dragStartRef.current;
		if (!dragState || dragState.pointerId !== event.pointerId) {
			return;
		}

		if (
			Math.hypot(
				event.clientX - dragState.startX,
				event.clientY - dragState.startY,
			) >= MARQUEE_DRAG_THRESHOLD
		) {
			dragState.hasMoved = true;
		}
		updateMarqueeSelection(dragState, event.clientX, event.clientY);
	};

	const endMarqueeSelection = (
		event: ReactPointerEvent<HTMLDivElement>,
		currentX: number,
		currentY: number,
	) => {
		const dragState = dragStartRef.current;
		if (!dragState || dragState.pointerId !== event.pointerId) {
			return;
		}

		updateMarqueeSelection(dragState, currentX, currentY);
		dragStartRef.current = null;
		setSelectionRect(null);
		if (
			dragState.hasMoved ||
			Math.hypot(currentX - dragState.startX, currentY - dragState.startY) >=
				MARQUEE_DRAG_THRESHOLD
		) {
			armMarqueeClickSuppression(currentX, currentY);
		}
		event.currentTarget.releasePointerCapture?.(event.pointerId);
	};

	const handleCardClick = (
		cardId: Id<"cards">,
		event: ReactMouseEvent<HTMLButtonElement>,
	) => {
		if (consumeSuppressedMarqueeClick(event)) {
			return;
		}

		if (event.shiftKey) {
			toggleSelection(cardId);
			return;
		}

		setPreviewCardId(cardId);
	};

	const handleCardPointerDown = (
		cardId: Id<"cards">,
		event: ReactButtonPointerEvent<HTMLButtonElement>,
	) => {
		if (!event.isPrimary) {
			return;
		}

		if (event.button !== 2) {
			return;
		}

		if (!isSelected(cardId)) {
			selectOnly(cardId);
		}
	};

	return (
		<div
			ref={selectionSurfaceRef}
			data-testid="cards-selection-surface"
			className="relative min-h-full w-full overflow-hidden"
			onPointerDown={handleSelectionPointerDown}
			onPointerMove={handleSelectionPointerMove}
			onPointerUp={(event) =>
				endMarqueeSelection(event, event.clientX, event.clientY)
			}
			onPointerCancel={(event) =>
				endMarqueeSelection(event, event.clientX, event.clientY)
			}
			onClickCapture={(event) => {
				consumeSuppressedMarqueeClick(event);
			}}
		>
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
					<div className="flex flex-wrap items-center gap-2">
						<button
							type="button"
							onClick={toggleOrphanOnly}
							className={`cursor-pointer flex h-8 items-center gap-1 rounded-full border px-3 text-xs font-medium transition ${
								orphanOnly
									? "border-[var(--sea-ink)] bg-[var(--sea-ink)] text-[var(--surface)]"
									: "border-[var(--line)] bg-[var(--surface)] text-[var(--sea-ink-soft)] hover:bg-[var(--surface-strong)]"
							}`}
						>
							<Filter size={11} />
							Orphan only
							{orphanOnly && <X size={11} />}
						</button>
						<div className="ml-auto flex flex-wrap items-center justify-end gap-2">
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<button
										type="button"
										className="flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 text-xs font-medium text-[var(--sea-ink-soft)] shadow-[0_8px_20px_rgba(15,23,42,0.04)] backdrop-blur-sm transition hover:border-[var(--sea-ink)]/15 hover:bg-[var(--surface-strong)] hover:text-[var(--sea-ink)]"
										aria-label={`Sort cards by ${getCardSortLabel(sort)}`}
									>
										<ArrowUpDown size={11} />
										<span>Sort</span>
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
							{selectedCardIds.length > 0 ? (
								<div className="flex h-8 items-center overflow-hidden rounded-full border border-[var(--line)] bg-[var(--surface)] p-0.5 text-xs shadow-[0_10px_24px_rgba(15,23,42,0.05)] backdrop-blur-sm">
									<span className="flex h-7 items-center gap-2 rounded-full bg-[var(--surface-strong)] px-3 font-semibold text-[var(--sea-ink)]">
										<span className="size-1.5 rounded-full bg-[var(--lagoon)]" />
										{selectedCardIds.length} selected
									</span>
									<span
										aria-hidden="true"
										className="mx-1 h-4 w-px bg-[var(--line)]"
									/>
									<button
										type="button"
										onClick={() => openAppendDialog([...selectedCardIds])}
										className="cursor-pointer rounded-full px-2.5 py-1 font-semibold text-[var(--sea-ink)] transition hover:bg-[var(--surface-strong)]"
									>
										Append
									</button>
									<button
										type="button"
										onClick={() => openDeleteDialog([...selectedCardIds])}
										className="cursor-pointer rounded-full px-2.5 py-1 font-semibold text-[var(--destructive)] transition hover:bg-red-500/10"
									>
										Delete
									</button>
									<button
										type="button"
										onClick={clearSelection}
										className="cursor-pointer rounded-full px-2.5 py-1 font-medium text-[var(--sea-ink-soft)] transition hover:bg-[var(--surface-strong)] hover:text-[var(--sea-ink)]"
									>
										Clear
									</button>
								</div>
							) : null}
						</div>
					</div>
				</header>

				{appendError ? (
					<div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
						{appendError}
					</div>
				) : null}

				{cards.status === "LoadingFirstPage" ? (
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
						{cards.results.map((card) => {
							const contextTargetIds = getContextTargetIds(card._id);
							const singleTarget = contextTargetIds.length === 1;

							return (
								<li
									key={card._id}
									data-card-tile="true"
									className="flex"
									ref={(node) => {
										if (node) {
											cardElementByIdRef.current.set(card._id, node);
										} else {
											cardElementByIdRef.current.delete(card._id);
										}
									}}
								>
									<CardLibraryTile
										card={card}
										selected={isSelected(card._id)}
										onClick={(event) => handleCardClick(card._id, event)}
										onPointerDown={(event) =>
											handleCardPointerDown(card._id, event)
										}
										onContextMenu={() => {
											if (!isSelected(card._id)) {
												selectOnly(card._id);
											}
										}}
										onPreview={() => setPreviewCardId(card._id)}
										onFullscreen={() =>
											navigate({
												to: "/cards/$cardId",
												params: { cardId: card._id },
											})
										}
										onAppend={() => openAppendDialog(contextTargetIds)}
										onDelete={() => openDeleteDialog(contextTargetIds)}
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

				<WhiteboardPickerDialog
					open={appendTargetCardIds.length > 0}
					onOpenChange={(open) => {
						if (!open) closeAppendDialog();
					}}
					onSelect={(whiteboardId) => {
						void confirmAppendToWhiteboard(whiteboardId);
					}}
					title={appendPickerTitle}
				/>

				<DeleteCardDialog
					open={deleteTargetIds.length > 0}
					cardCount={deleteTargetIds.length}
					onCancel={closeDeleteDialog}
					onConfirm={() => void confirmDelete()}
				/>
			</main>

			{selectionRect ? (
				<div
					data-testid="cards-selection-marquee"
					className="pointer-events-none absolute z-50 border border-[var(--sea-ink)] bg-[var(--sea-ink)]/10"
					style={{
						left: selectionRect.left,
						top: selectionRect.top,
						width: selectionRect.width,
						height: selectionRect.height,
					}}
				/>
			) : null}
		</div>
	);
}

type CardTile = Doc<"cards"> & { placementCount: number };

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
						{card.placementCount === 0
							? "Unplaced"
							: `Placed on ${card.placementCount} board${card.placementCount === 1 ? "" : "s"}`}
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
