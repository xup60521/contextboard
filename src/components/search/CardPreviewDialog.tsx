import { Link, useNavigate } from "@tanstack/react-router";
import type { JSONContent } from "@tiptap/core";
import { useQuery } from "convex/react";
import { Crosshair, ExternalLink } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CardInfoSection } from "#/components/cards/CardInfoSection";
import { CardEditorPane } from "#/components/editor/CardEditorPane";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "#/components/ui/dialog";
import { CARD_EDITOR_MAX_WIDTH } from "#/lib/constants";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

type CardPreviewDialogProps = {
	cardId: Id<"cards"> | null;
	currentWhiteboardId: Id<"whiteboards"> | null;
	onClose: () => void;
};

export const CARD_PREVIEW_EDITOR_MOUNT_DELAY_MS = 200;

function markPreviewPerformance(stage: string) {
	if (!import.meta.env.DEV || typeof performance === "undefined") {
		return;
	}

	performance.mark(`card-preview:${stage}`);
}

/**
 * In-place preview/edit popup for a card. Takes only a `cardId`; the navigation
 * context (which board holds the card's shape) is fetched alongside the card so
 * the dialog can offer "focus on board" / "go to board" on its own. Reuses the
 * same debounced auto-save editor as the full card page; closes on backdrop
 * click or Escape (Radix).
 */
export function CardPreviewDialog({
	cardId,
	currentWhiteboardId,
	onClose,
}: CardPreviewDialogProps) {
	const navigate = useNavigate();
	const open = cardId !== null;
	const data = useQuery(api.cards.get, cardId ? { cardId } : "skip");
	const whiteboards = useQuery(api.whiteboards.listActive);
	const mountFrameRef = useRef<number | null>(null);
	const mountTimerRef = useRef<number | null>(null);
	const [shouldMountEditor, setShouldMountEditor] = useState(false);
	const [isOpening, setIsOpening] = useState(false);
	const [mountedCardId, setMountedCardId] = useState<Id<"cards"> | null>(null);

	const currentPlacement =
		currentWhiteboardId == null
			? null
			: data?.placements?.find(
					(placement) =>
						placement.whiteboardId === currentWhiteboardId &&
						placement.shapeId != null,
				) ?? null;

	const canFocusCurrentBoard = currentPlacement != null;
	const whiteboardTitleById = new Map(
		(whiteboards ?? []).map((wb) => [wb._id, wb.title]),
	);

	const clearDeferredMount = useCallback(() => {
		if (mountFrameRef.current !== null) {
			window.cancelAnimationFrame(mountFrameRef.current);
			mountFrameRef.current = null;
		}
		if (mountTimerRef.current !== null) {
			window.clearTimeout(mountTimerRef.current);
			mountTimerRef.current = null;
		}
	}, []);

	useEffect(() => {
		clearDeferredMount();
		setShouldMountEditor(false);
		setMountedCardId(null);

		if (!open || !cardId) {
			setIsOpening(false);
			return;
		}

		setIsOpening(true);
		markPreviewPerformance(`open-requested:${cardId}`);
		mountFrameRef.current = window.requestAnimationFrame(() => {
			markPreviewPerformance(`shell-painted:${cardId}`);
			mountFrameRef.current = null;
			mountTimerRef.current = window.setTimeout(() => {
				markPreviewPerformance(`editor-mount-start:${cardId}`);
				setMountedCardId(cardId);
				setShouldMountEditor(true);
				setIsOpening(false);
				mountTimerRef.current = null;
			}, CARD_PREVIEW_EDITOR_MOUNT_DELAY_MS);
		});

		return clearDeferredMount;
	}, [cardId, clearDeferredMount, open]);

	const focusOnCurrentBoard = useCallback(() => {
		if (!currentPlacement || !currentWhiteboardId || !currentPlacement.shapeId) {
			return;
		}

		onClose();

		void navigate({
			to: "/whiteboard/$whiteboardId",
			params: { whiteboardId: currentWhiteboardId },
			search: { focus: currentPlacement.shapeId },
		});
	}, [currentPlacement, currentWhiteboardId, navigate, onClose]);

	const canRenderEditor =
		data !== undefined &&
		data !== null &&
		shouldMountEditor &&
		mountedCardId === data.card._id;

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<DialogContent
				showCloseButton={false}
				className="flex max-h-[85vh] w-full flex-col gap-0 overflow-hidden p-0"
				style={{ maxWidth: CARD_EDITOR_MAX_WIDTH }}
			>
				<DialogTitle className="sr-only">Card preview</DialogTitle>
				<DialogDescription className="sr-only">
					Edit this card inline. Press Escape or click outside to close.
				</DialogDescription>
				<header className="flex items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-2.5">
					<span className="truncate text-sm font-semibold text-[var(--sea-ink)]">
						{data?.card.derivedTitle || "Untitled card"}
					</span>
					<div className="flex shrink-0 items-center gap-1.5">
					{canFocusCurrentBoard ? (
						<button
							type="button"
							onClick={focusOnCurrentBoard}
							className="flex items-center gap-1 rounded border border-[var(--line)] px-2 py-1 text-xs font-semibold text-[var(--sea-ink)] hover:bg-[var(--surface-strong)]"
						>
							<Crosshair className="size-3.5" />
							Focus on board
						</button>
					) : null}
						{cardId ? (
							<Link
								to="/cards/$cardId"
								params={{ cardId }}
								onClick={onClose}
								className="flex items-center gap-1 rounded border border-[var(--line)] px-2 py-1 text-xs font-semibold text-[var(--sea-ink)] hover:bg-[var(--surface-strong)]"
							>
								<ExternalLink className="size-3.5" />
								Open page
							</Link>
						) : null}
					</div>
				</header>
				<div className="h-[75vh] overflow-y-auto px-6 py-5">
					{data === undefined ? (
						<div className="flex flex-col gap-4">
							<div className="h-5 w-32 rounded bg-[var(--line)]" />
							<div className="flex flex-col gap-2.5">
								<div className="h-3.5 w-full rounded bg-[var(--line)]" />
								<div className="h-3.5 w-[90%] rounded bg-[var(--line)]" />
								<div className="h-3.5 w-[75%] rounded bg-[var(--line)]" />
								<div className="h-3.5 w-[60%] rounded bg-[var(--line)]" />
							</div>
							<div className="flex flex-col gap-2.5">
								<div className="h-3.5 w-[85%] rounded bg-[var(--line)]" />
								<div className="h-3.5 w-[95%] rounded bg-[var(--line)]" />
								<div className="h-3.5 w-[40%] rounded bg-[var(--line)]" />
							</div>
						</div>
					) : data === null ? (
						<p className="text-sm text-[var(--sea-ink-soft)]">
							Card not found.
						</p>
					) : !canRenderEditor ? (
						<div className="flex min-h-[50vh] items-center justify-center rounded-md border border-dashed border-[var(--line)] bg-[var(--surface-strong)]/35 px-4 py-8 text-sm text-[var(--sea-ink-soft)]">
							{isOpening ? "Preparing editor..." : "Loading editor..."}
						</div>
				) : (
						<>
							<CardEditorPane
								cardId={data.card._id}
								content={data.card.content as JSONContent}
								whiteboardId={currentWhiteboardId ?? data.boardWhiteboardId}
								contentClassName="min-h-[50vh] bg-transparent"
								onEditorReady={() =>
									markPreviewPerformance(`editor-ready:${data.card._id}`)
								}
							/>
							<CardInfoSection
								placements={data.placements}
								backlinks={data.backlinks}
								whiteboardTitleById={whiteboardTitleById}
								createdAt={data.card._creationTime}
								updatedAt={data.card.updatedAt}
								plainText={data.card.plainText}
								onNavigate={onClose}
							/>
						</>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
