import { useApplicationRuntime, type CardDetail } from "@contextboard/application";
import { ReadonlyRichTextPreview } from "@contextboard/editor";
import { Maximize2, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "../ui/dialog";
import { WhiteboardPickerDialog } from "../whiteboard/WhiteboardPickerDialog";
import { DeleteCardDialog } from "./DeleteCardDialog";

export function CardPreviewDialog({
	cardId,
	currentWhiteboardId: _currentWhiteboardId,
	onClose,
}: {
	cardId: string | null;
	currentWhiteboardId: string | null;
	onClose: () => void;
}) {
	const { cards, navigation } = useApplicationRuntime();
	const [data, setData] = useState<CardDetail | null | undefined>();
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [pickerOpen, setPickerOpen] = useState(false);
	useEffect(() => {
		if (!cardId) {
			setData(undefined);
			return;
		}
		let active = true;
		const load = () =>
			cards.get(cardId).then((value) => active && setData(value));
		void load();
		const unsubscribe = cards.subscribe(() => void load());
		return () => {
			active = false;
			unsubscribe();
		};
	}, [cardId, cards]);

	return (
		<Dialog open={cardId !== null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent
				showCloseButton={false}
				className="flex max-h-[85vh] w-full max-w-3xl flex-col gap-0 overflow-hidden p-0"
			>
				<DialogTitle className="sr-only">Card preview</DialogTitle>
				<DialogDescription className="sr-only">
					Preview this card.
				</DialogDescription>
				<header className="flex items-center gap-2 border-b border-[var(--line)] px-3 py-2.5">
					<button
						type="button"
						aria-label="Open page"
						onClick={() =>
							cardId &&
							navigation.navigate(navigation.cardHref(cardId))
						}
					>
						<Maximize2 className="size-4" />
					</button>
					<span className="min-w-0 flex-1 truncate text-sm font-semibold">
						{data?.title ?? "Untitled card"}
					</span>
					<button
						type="button"
						onClick={() => setPickerOpen(true)}
						className="flex items-center gap-1 rounded border px-2 py-1 text-xs"
					>
						<Plus className="size-3.5" />
						Append to board
					</button>
					<button
						type="button"
						aria-label="Delete card"
						onClick={() => setDeleteOpen(true)}
					>
						<Trash2 className="size-4" />
					</button>
				</header>
				<div className="h-[75vh] overflow-y-auto px-6 py-5">
					{data === undefined ? (
						"Loading card…"
					) : data === null ? (
						"Card not found."
					) : (
						<ReadonlyRichTextPreview
							content={data.content as never}
							contentClassName="min-h-[50vh] bg-transparent"
						/>
					)}
				</div>
				<DeleteCardDialog
					open={deleteOpen}
					onCancel={() => setDeleteOpen(false)}
					onConfirm={() => {
						if (!cardId) return;
						void cards.delete(cardId).then(onClose);
					}}
				/>
				<WhiteboardPickerDialog
					open={pickerOpen}
					onOpenChange={setPickerOpen}
					onSelect={(whiteboardId) => {
						if (!cardId) return;
						void cards
							.appendToWhiteboard({ cardId, whiteboardId })
							.then((placement) => {
								if (placement)
									navigation.navigate(
										navigation.whiteboardHref(whiteboardId, {
											focus: placement.shapeId,
										}),
									);
							});
					}}
				/>
			</DialogContent>
		</Dialog>
	);
}
