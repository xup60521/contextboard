import type { RefObject } from "react";
import {
	type PointerEvent as ReactButtonPointerEvent,
	type MouseEvent as ReactMouseEvent,
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useRef,
	useState,
} from "react";
import type { Id } from "#/integrations/local/types";

export type SelectionRect = {
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

export function useCardLibrarySelection({
	visibleCardIds,
	resetKey,
	previewCardId,
	deleteDialogOpen,
	deleteDialogOpenRef,
	onPreviewCard,
}: {
	visibleCardIds: Id<"cards">[];
	resetKey: string;
	previewCardId: Id<"cards"> | null;
	deleteDialogOpen: boolean;
	deleteDialogOpenRef?: RefObject<boolean>;
	onPreviewCard: (cardId: Id<"cards">) => void;
}) {
	const [selectedCardIds, setSelectedCardIds] = useState<Id<"cards">[]>([]);
	const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(
		null,
	);
	const selectionSurfaceRef = useRef<HTMLDivElement>(null);
	const cardElementByIdRef = useRef(new Map<Id<"cards">, HTMLElement>());
	const dragStartRef = useRef<DragSelectionState | null>(null);
	const suppressedClickRef = useRef<SuppressedClick | null>(null);
	const suppressCardClickTimeoutRef = useRef<number | null>(null);
	const previousSelectionResetKeyRef = useRef(resetKey);

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

	useEffect(() => {
		if (previousSelectionResetKeyRef.current === resetKey) {
			return;
		}

		previousSelectionResetKeyRef.current = resetKey;
		setSelectedCardIds((prev) => (prev.length === 0 ? prev : []));
	}, [resetKey]);

	useEffect(() => {
		const visibleIds = new Set(visibleCardIds);
		setSelectedCardIds((prev) => {
			const next = prev.filter((id) => visibleIds.has(id));
			return next.length === prev.length ? prev : next;
		});
	}, [visibleCardIds]);

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

			if (
				deleteDialogOpen ||
				deleteDialogOpenRef?.current ||
				previewCardId !== null
			) {
				return;
			}

			setSelectedCardIds((prev) => (prev.length === 0 ? prev : []));
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [deleteDialogOpen, deleteDialogOpenRef, previewCardId]);

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

		onPreviewCard(cardId);
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

	return {
		selectedCardIds,
		setSelectedCardIds,
		selectionRect,
		selectionSurfaceRef,
		cardElementByIdRef,
		isSelected,
		clearSelection,
		selectOnly,
		getContextTargetIds,
		consumeSuppressedMarqueeClick,
		handleSelectionPointerDown,
		handleSelectionPointerMove,
		endMarqueeSelection,
		handleCardClick,
		handleCardPointerDown,
	};
}
