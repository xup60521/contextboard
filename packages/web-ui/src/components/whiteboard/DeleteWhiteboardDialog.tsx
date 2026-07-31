import { Button } from "../ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";

type DeleteWhiteboardDialogProps = {
	open: boolean;
	onCancel: () => void;
	onKeepCards: () => void;
	onDeleteCards: () => void;
};

export function DeleteWhiteboardDialog({
	open,
	onCancel,
	onKeepCards,
	onDeleteCards,
}: DeleteWhiteboardDialogProps) {
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onCancel();
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Delete whiteboard</DialogTitle>
					<DialogDescription>
						This deletes this whiteboard and all nested whiteboards. What would
						you do with their cards?
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="outline" onClick={onCancel}>
						Cancel
					</Button>
					<Button variant="secondary" onClick={onKeepCards}>
						Keep cards as orphan
					</Button>
					<Button variant="destructive" onClick={onDeleteCards}>
						Delete cards too
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
