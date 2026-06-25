import { Link } from "@tanstack/react-router";
import type { JSONContent } from "@tiptap/core";
import { useQuery } from "convex/react";
import { ArrowUpRight, Crosshair, ExternalLink } from "lucide-react";
import { CardEditorPane } from "#/components/editor/CardEditorPane";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "#/components/ui/dialog";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { CardSearchResult } from "../../../convex/search";

type CardPreviewDialogProps = {
	card: CardSearchResult | null;
	currentWhiteboardId: Id<"whiteboards"> | null;
	onClose: () => void;
	onFocus: (card: CardSearchResult) => void;
};

/**
 * In-place preview/edit popup for a card. Reuses the same debounced auto-save
 * editor as the full card page; closes on backdrop click or Escape (Radix).
 */
export function CardPreviewDialog({
	card,
	currentWhiteboardId,
	onClose,
	onFocus,
}: CardPreviewDialogProps) {
	const open = card !== null;
	const data = useQuery(api.cards.get, card ? { cardId: card.id } : "skip");
	// A card placed on a board has a shape we can navigate to. If that board is
	// the one currently open we "Focus" (zoom in place); otherwise we "Go to" it.
	const canNavigate = card?.shapeId != null;
	const isOnCurrentBoard =
		canNavigate && card.boardWhiteboardId === currentWhiteboardId;

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<DialogContent
				showCloseButton={false}
				className="flex max-h-[85vh] w-full max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
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
						{card && canNavigate ? (
							<button
								type="button"
								onClick={() => onFocus(card)}
								className="flex items-center gap-1 rounded border border-[var(--line)] px-2 py-1 text-xs font-semibold text-[var(--sea-ink)] hover:bg-[var(--surface-strong)]"
							>
								{isOnCurrentBoard ? (
									<>
										<Crosshair className="size-3.5" />
										Focus on board
									</>
								) : (
									<>
										<ArrowUpRight className="size-3.5" />
										Go to board
									</>
								)}
							</button>
						) : null}
						{card ? (
							<Link
								to="/cards/$cardId"
								params={{ cardId: card.id }}
								onClick={onClose}
								className="flex items-center gap-1 rounded border border-[var(--line)] px-2 py-1 text-xs font-semibold text-[var(--sea-ink)] hover:bg-[var(--surface-strong)]"
							>
								<ExternalLink className="size-3.5" />
								Open page
							</Link>
						) : null}
					</div>
				</header>
				<div className="overflow-y-auto px-6 py-5">
					{data === undefined ? (
						<p className="text-sm text-[var(--sea-ink-soft)]">Loading…</p>
					) : data === null ? (
						<p className="text-sm text-[var(--sea-ink-soft)]">
							Card not found.
						</p>
					) : (
						<CardEditorPane
							cardId={data.card._id}
							content={data.card.content as JSONContent}
							contentClassName="min-h-[50vh] bg-transparent"
						/>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
