import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";

type ClearOpenTabsDialogProps = {
	open: boolean;
	openTabCount: number;
	onCancel: () => void;
	onConfirm: () => void;
};

export function ClearOpenTabsDialog({
	open,
	openTabCount,
	onCancel,
	onConfirm,
}: ClearOpenTabsDialogProps) {
	const isPlural = openTabCount !== 1;

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onCancel();
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Clear open tabs</DialogTitle>
					<DialogDescription>
						{isPlural
							? `This will close ${openTabCount} open tabs. Pinned tabs will stay.`
							: "This will close 1 open tab. Pinned tabs will stay."}
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="outline" onClick={onCancel}>
						Cancel
					</Button>
					<Button variant="destructive" onClick={onConfirm}>
						Clear tabs
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
