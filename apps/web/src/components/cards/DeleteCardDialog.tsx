import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";

type DeleteCardDialogProps = {
	open: boolean;
	onCancel: () => void;
	onConfirm: () => void;
	cardCount?: number;
};

export function DeleteCardDialog({
	open,
	onCancel,
	onConfirm,
	cardCount = 1,
}: DeleteCardDialogProps) {
	const isPlural = cardCount > 1;
	const title = isPlural ? "Delete cards" : "Delete card";
	const confirmLabel = isPlural ? "Delete cards" : "Delete card";
	const description = isPlural
		? `This will permanently delete ${cardCount} cards and remove them from all whiteboards. This action cannot be undone.`
		: "This will permanently delete the card and remove it from all whiteboards. This action cannot be undone.";

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onCancel();
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="outline" onClick={onCancel}>
						Cancel
					</Button>
					<Button variant="destructive" onClick={onConfirm}>
						{confirmLabel}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
