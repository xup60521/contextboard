import {
	type CardDetail,
	type WhiteboardSummary,
	useApplicationRuntime,
} from "@contextboard/application";
import { useDeferredEditorMount } from "@contextboard/editor";
import type { JSONContent } from "@tiptap/core";
import {
	Crosshair,
	Maximize2,
	MoreHorizontal,
	Plus,
	Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { CardEditorPane } from "../editor/CardEditorPane";
import { AppLink } from "../navigation/AppLink";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "../ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { WhiteboardPickerDialog } from "../whiteboard/WhiteboardPickerDialog";
import { CardInfoSection } from "./CardInfoSection";
import { DeleteCardDialog } from "./DeleteCardDialog";

const CARD_EDITOR_MAX_WIDTH = 768;

type CardPreviewDialogProps = {
	cardId: string | null;
	currentWhiteboardId: string | null;
	onClose: () => void;
};

function markPreviewPerformance(stage: string) {
	if (typeof performance === "undefined") {
		return;
	}

	performance.mark(`card-preview:${stage}`);
}

export function isInsidePreviewAllowedPortal(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) {
		return false;
	}

	return (
		target.closest("[data-slot='dropdown-menu-content']") !== null ||
		target.closest("[data-radix-popper-content-wrapper]") !== null
	);
}

export function shouldPreventPreviewOutsideDismiss(
	target: EventTarget | null,
	{
		showDeleteDialog,
		dropdownOpen,
		appendPickerOpen,
	}: {
		showDeleteDialog: boolean;
		dropdownOpen: boolean;
		appendPickerOpen: boolean;
	},
) {
	return (
		showDeleteDialog ||
		dropdownOpen ||
		appendPickerOpen ||
		isInsidePreviewAllowedPortal(target)
	);
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
	const runtime = useApplicationRuntime();
	const open = cardId !== null;
	const [data, setData] = useState<CardDetail | null | undefined>();
	const [whiteboards, setWhiteboards] = useState<WhiteboardSummary[]>([]);
	const [isAppending, setIsAppending] = useState(false);
	const [appendError, setAppendError] = useState<string | null>(null);
	const [showDeleteDialog, setShowDeleteDialog] = useState(false);
	const [dropdownOpen, setDropdownOpen] = useState(false);
	const [appendPickerOpen, setAppendPickerOpen] = useState(false);
	const { shouldMountEditor, isPending } = useDeferredEditorMount(
		cardId,
		open,
		{
			onShellPaint: (activeCardId) =>
				markPreviewPerformance(`shell-painted:${activeCardId}`),
			onMountStart: (activeCardId) =>
				markPreviewPerformance(`editor-mount-start:${activeCardId}`),
		},
	);

	useEffect(() => {
		if (!cardId) {
			setData(undefined);
			return;
		}
		let active = true;
		setData(undefined);
		const load = () =>
			runtime.cards.get(cardId).then((value) => {
				if (active) setData(value);
			});
		void load();
		const unsubscribe = runtime.cards.subscribe(() => void load());
		return () => {
			active = false;
			unsubscribe();
		};
	}, [cardId, runtime.cards]);

	useEffect(() => {
		const boards = runtime.whiteboards;
		if (!boards) return;
		let active = true;
		const load = () =>
			boards.list().then((value) => {
				if (active) setWhiteboards(value);
			});
		void load();
		const unsubscribe = boards.subscribe(() => void load());
		return () => {
			active = false;
			unsubscribe();
		};
	}, [runtime.whiteboards]);

	const currentPlacement =
		currentWhiteboardId == null
			? null
			: (data?.placements?.find(
					(placement) =>
						placement.whiteboardId === currentWhiteboardId &&
						placement.shapeId != null,
				) ?? null);

	const canFocusCurrentBoard = currentPlacement != null;

	const canAppendToCurrentBoard =
		currentWhiteboardId != null &&
		data !== undefined &&
		data !== null &&
		currentPlacement == null;

	const whiteboardTitleById = new Map<string, string>(
		whiteboards.map((board) => [board.id, board.title]),
	);

	useEffect(() => {
		if (open && cardId) {
			markPreviewPerformance(`open-requested:${cardId}`);
		}
	}, [cardId, open]);

	useEffect(() => {
		if (!cardId) {
			return;
		}

		setAppendError(null);
		setIsAppending(false);
	}, [cardId]);

	const focusOnCurrentBoard = useCallback(() => {
		if (
			!currentPlacement ||
			!currentWhiteboardId ||
			!currentPlacement.shapeId
		) {
			return;
		}

		onClose();

		runtime.navigation.navigate(
			runtime.navigation.whiteboardHref(currentWhiteboardId, {
				focus: currentPlacement.shapeId,
			}),
		);
	}, [currentPlacement, currentWhiteboardId, onClose, runtime.navigation]);

	const handleAppendToBoard = useCallback(
		async (targetWhiteboardId: string) => {
			if (!cardId || isAppending) return;

			setIsAppending(true);
			setAppendError(null);

			try {
				const placement = await runtime.cards.appendToWhiteboard({
					cardId,
					whiteboardId: targetWhiteboardId,
				});

				if (!placement?.shapeId) {
					throw new Error("Card was appended, but no shape id was returned.");
				}

				onClose();

				runtime.navigation.navigate(
					runtime.navigation.whiteboardHref(targetWhiteboardId, {
						focus: placement.shapeId,
					}),
				);
			} catch (error) {
				setAppendError(
					error instanceof Error
						? error.message
						: "Failed to append card to board.",
				);
			} finally {
				setIsAppending(false);
			}
		},
		[cardId, isAppending, onClose, runtime.cards, runtime.navigation],
	);

	const handleDeleteCard = useCallback(async () => {
		if (!cardId) return;
		await runtime.cards.delete(cardId);
		setShowDeleteDialog(false);
		onClose();
	}, [cardId, onClose, runtime.cards]);

	const hasAppendableWhiteboards = whiteboards.length > 0;
	const openPageHref = cardId ? runtime.navigation.cardHref(cardId) : null;

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
				onPointerDownOutside={(e) => {
					if (
						shouldPreventPreviewOutsideDismiss(e.target, {
							showDeleteDialog,
							dropdownOpen,
							appendPickerOpen,
						})
					) {
						e.preventDefault();
					}
				}}
				onFocusOutside={(e) => {
					if (
						shouldPreventPreviewOutsideDismiss(e.target, {
							showDeleteDialog,
							dropdownOpen,
							appendPickerOpen,
						})
					) {
						e.preventDefault();
					}
				}}
				onEscapeKeyDown={(e) => {
					if (showDeleteDialog || dropdownOpen || appendPickerOpen) {
						e.preventDefault();
					}
				}}
			>
				<DialogTitle className="sr-only">Card preview</DialogTitle>
				<DialogDescription className="sr-only">
					Edit this card inline. Press Escape or click outside to close.
				</DialogDescription>
				<header className="flex items-center gap-2 border-b border-[var(--line)] px-3 py-2.5">
					{openPageHref ? (
						<AppLink
							href={openPageHref}
							onClick={onClose}
							title="Open page"
							className="shrink-0 rounded p-1 text-[var(--sea-ink-soft)] hover:bg-[var(--surface-strong)] hover:text-[var(--sea-ink)]"
						>
							<Maximize2 className="size-4" />
						</AppLink>
					) : (
						<div className="size-6 shrink-0" />
					)}
					<span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--sea-ink)]">
						{data?.title || "Untitled card"}
					</span>
					<div className="flex shrink-0 items-center gap-1.5">
						{currentWhiteboardId !== null ? (
							canFocusCurrentBoard ? (
								<button
									type="button"
									onClick={focusOnCurrentBoard}
									className="flex items-center gap-1 rounded border border-[var(--line)] px-2 py-1 text-xs font-semibold text-[var(--sea-ink)] hover:bg-[var(--surface-strong)]"
								>
									<Crosshair className="size-3.5" />
									Focus on board
								</button>
							) : canAppendToCurrentBoard ? (
								<button
									type="button"
									onClick={() => setAppendPickerOpen(true)}
									disabled={isAppending || !hasAppendableWhiteboards}
									className="flex items-center gap-1 rounded border border-[var(--line)] px-2 py-1 text-xs font-semibold text-[var(--sea-ink)] hover:bg-[var(--surface-strong)] disabled:cursor-not-allowed disabled:opacity-60"
								>
									<Plus className="size-3.5" />
									{isAppending ? "Appending..." : "Append to board"}
								</button>
							) : null
						) : (
							<button
								type="button"
								onClick={() => setAppendPickerOpen(true)}
								disabled={isAppending || !hasAppendableWhiteboards}
								className="flex items-center gap-1 rounded border border-[var(--line)] px-2 py-1 text-xs font-semibold text-[var(--sea-ink)] hover:bg-[var(--surface-strong)] disabled:cursor-not-allowed disabled:opacity-60"
							>
								<Plus className="size-3.5" />
								{isAppending ? "Appending..." : "Append to board"}
							</button>
						)}
						<DropdownMenu
							modal={false}
							open={dropdownOpen}
							onOpenChange={setDropdownOpen}
						>
							<DropdownMenuTrigger asChild>
								<button
									type="button"
									onClick={(event) => {
										event.stopPropagation();
									}}
									className="rounded p-1 text-[var(--sea-ink-soft)] hover:bg-[var(--surface-strong)] hover:text-[var(--sea-ink)]"
								>
									<MoreHorizontal className="size-4" />
								</button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								{data !== undefined && data !== null && (
									<>
										<DropdownMenuItem onClick={() => setAppendPickerOpen(true)}>
											<Plus className="size-4" />
											Place on whiteboard...
										</DropdownMenuItem>
										<DropdownMenuSeparator />
									</>
								)}
								<DropdownMenuItem
									onClick={() => setShowDeleteDialog(true)}
									className="text-red-600 focus:text-red-600"
								>
									<Trash2 className="size-4" />
									Delete card
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</header>
				{appendError ? (
					<div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs font-medium text-red-700">
						{appendError}
					</div>
				) : null}
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
					) : !shouldMountEditor ? (
						<div className="flex min-h-[50vh] items-center justify-center rounded-md border border-dashed border-[var(--line)] bg-[var(--surface-strong)]/35 px-4 py-8 text-sm text-[var(--sea-ink-soft)]">
							{isPending ? "Preparing editor..." : "Loading editor..."}
						</div>
					) : (
						<>
							<CardEditorPane
								cardId={data.id}
								content={data.content as JSONContent}
								whiteboardId={currentWhiteboardId ?? data.boardWhiteboardId}
								contentClassName="min-h-[50vh] bg-transparent"
								onEditorReady={() =>
									markPreviewPerformance(`editor-ready:${data.id}`)
								}
							/>
							<CardInfoSection
								placements={data.placements}
								backlinks={data.backlinks}
								whiteboardTitleById={whiteboardTitleById}
								createdAt={data.createdAt}
								updatedAt={data.updatedAt}
								plainText={data.preview}
								onNavigate={onClose}
							/>
						</>
					)}
				</div>
				<DeleteCardDialog
					open={showDeleteDialog}
					onCancel={() => setShowDeleteDialog(false)}
					onConfirm={() => void handleDeleteCard()}
				/>
				<WhiteboardPickerDialog
					open={appendPickerOpen}
					onOpenChange={setAppendPickerOpen}
					onSelect={(whiteboardId) => void handleAppendToBoard(whiteboardId)}
				/>
			</DialogContent>
		</Dialog>
	);
}
