import type { RefObject } from "react";
import {
	type PointerEvent as ReactButtonPointerEvent,
	type MouseEvent as ReactMouseEvent,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { type CardGridMetrics, hitTestCardIds } from "./cardGridGeometry";
export type SelectionRect = {
	left: number;
	top: number;
	width: number;
	height: number;
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
const AUTO_SCROLL_EDGE = 48;
const AUTO_SCROLL_MAX_SPEED = 20;

export function useCardLibrarySelection<CardId extends string>({
	gridElement,
	gridMetrics,
	visibleCardIds,
	resetKey,
	previewCardId,
	deleteDialogOpen,
	deleteDialogOpenRef,
	onPreviewCard,
}: {
	gridElement: HTMLUListElement | null;
	gridMetrics: CardGridMetrics;
	visibleCardIds: CardId[];
	resetKey: string;
	previewCardId: CardId | null;
	deleteDialogOpen: boolean;
	deleteDialogOpenRef?: RefObject<boolean>;
	onPreviewCard: (cardId: CardId) => void;
}) {
	const [selectedCardIds, setSelectedCardIds] = useState<CardId[]>([]);
	const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(
		null,
	);
	const selectionSurfaceRef = useRef<HTMLDivElement>(null);
	const dragStartRef = useRef<DragSelectionState | null>(null);
	const pointerPositionRef = useRef<{ x: number; y: number } | null>(null);
	const autoScrollFrameRef = useRef<number | null>(null);
	const suppressedClickRef = useRef<SuppressedClick | null>(null);
	const suppressCardClickTimeoutRef = useRef<number | null>(null);
	const previousSelectionResetKeyRef = useRef(resetKey);

	const stopAutoScroll = useCallback(() => {
		if (autoScrollFrameRef.current !== null) {
			window.cancelAnimationFrame(autoScrollFrameRef.current);
			autoScrollFrameRef.current = null;
		}
	}, []);

	const isSelected = (cardId: CardId) => selectedCardIds.includes(cardId);

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

	const selectOnly = (cardId: CardId) => {
		setSelectedCardIds((prev) =>
			prev.length === 1 && prev[0] === cardId ? prev : [cardId],
		);
	};

	const toggleSelection = (cardId: CardId) => {
		setSelectedCardIds((prev) =>
			prev.includes(cardId)
				? prev.filter((id) => id !== cardId)
				: [...prev, cardId],
		);
	};

	const getContextTargetIds = (cardId: CardId) => {
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
			stopAutoScroll();
			suppressedClickRef.current = null;
			if (suppressCardClickTimeoutRef.current !== null) {
				window.clearTimeout(suppressCardClickTimeoutRef.current);
				suppressCardClickTimeoutRef.current = null;
			}
		};
	}, [stopAutoScroll]);

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
		const gridRect = gridElement?.getBoundingClientRect();
		if (!surfaceRect || !gridRect) {
			return;
		}

		const contentX = currentX - surfaceRect.left;
		const contentY = currentY - surfaceRect.top;
		const left = Math.min(startState.startX, contentX);
		const top = Math.min(startState.startY, contentY);
		const right = Math.max(startState.startX, contentX);
		const bottom = Math.max(startState.startY, contentY);
		const intersectedIds = hitTestCardIds(
			visibleCardIds,
			{ left, right, top, bottom },
			gridMetrics,
			{
				left: gridRect.left - surfaceRect.left,
				top: gridRect.top - surfaceRect.top,
			},
		);

		setSelectionRect({
			left,
			top,
			width: right - left,
			height: bottom - top,
		});
		setSelectedCardIds(intersectedIds);
	};

	const startAutoScroll = () => {
		if (autoScrollFrameRef.current !== null) return;

		const tick = () => {
			autoScrollFrameRef.current = null;
			const dragState = dragStartRef.current;
			const pointer = pointerPositionRef.current;
			const scrollHost = selectionSurfaceRef.current?.closest<HTMLElement>(
				"[data-app-scroll-host='true']",
			);
			if (!dragState || !pointer || !scrollHost) return;

			const hostRect = scrollHost.getBoundingClientRect();
			const topDistance = pointer.y - hostRect.top;
			const bottomDistance = hostRect.bottom - pointer.y;
			const rawDirection =
				topDistance < AUTO_SCROLL_EDGE
					? -1 + topDistance / AUTO_SCROLL_EDGE
					: bottomDistance < AUTO_SCROLL_EDGE
						? 1 - bottomDistance / AUTO_SCROLL_EDGE
						: 0;
			const direction = Math.max(-1, Math.min(1, rawDirection));
			if (direction === 0) return;

			const previousScrollTop = scrollHost.scrollTop;
			scrollHost.scrollTop += direction * AUTO_SCROLL_MAX_SPEED;
			if (scrollHost.scrollTop !== previousScrollTop) {
				updateMarqueeSelection(dragState, pointer.x, pointer.y);
			}
			if (scrollHost.scrollTop !== previousScrollTop) {
				autoScrollFrameRef.current = window.requestAnimationFrame(tick);
			}
		};

		autoScrollFrameRef.current = window.requestAnimationFrame(tick);
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
			startX: event.clientX - surfaceRect.left,
			startY: event.clientY - surfaceRect.top,
			hasMoved: false,
		};
		pointerPositionRef.current = { x: event.clientX, y: event.clientY };
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

		pointerPositionRef.current = { x: event.clientX, y: event.clientY };
		const surfaceRect = selectionSurfaceRef.current?.getBoundingClientRect();
		if (
			surfaceRect &&
			Math.hypot(
				event.clientX - surfaceRect.left - dragState.startX,
				event.clientY - surfaceRect.top - dragState.startY,
			) >= MARQUEE_DRAG_THRESHOLD
		) {
			dragState.hasMoved = true;
		}
		updateMarqueeSelection(dragState, event.clientX, event.clientY);
		startAutoScroll();
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
		stopAutoScroll();
		dragStartRef.current = null;
		pointerPositionRef.current = null;
		setSelectionRect(null);
		if (dragState.hasMoved) {
			armMarqueeClickSuppression(currentX, currentY);
		}
		event.currentTarget.releasePointerCapture?.(event.pointerId);
	};

	const handleCardClick = (
		cardId: CardId,
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
		cardId: CardId,
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
