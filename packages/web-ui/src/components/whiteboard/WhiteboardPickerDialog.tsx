import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "../ui/command";
import { Dialog, DialogContent } from "../ui/dialog";
import { useApplicationRuntime } from "@contextboard/application";
import { useEffect, useState } from "react";

export function WhiteboardPickerDialog<WhiteboardId extends string = string>({
	open,
	onOpenChange,
	onSelect,
	title = "Append to whiteboard",
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSelect: (whiteboardId: WhiteboardId) => void;
	title?: string;
}) {
	const { whiteboards } = useApplicationRuntime();
	const [items, setItems] = useState<
		Array<{ id: string; title: string; ancestorIds: string[] }>
	>([]);

	useEffect(() => {
		if (!open || !whiteboards) return;
		let active = true;
		const load = () =>
			whiteboards.list().then((rows) => {
				if (active) setItems(rows);
			});
		void load();
		const unsubscribe = whiteboards.subscribe(() => void load());
		return () => {
			active = false;
			unsubscribe();
		};
	}, [open, whiteboards]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="overflow-hidden p-0" showCloseButton={false}>
				<Command>
					<CommandInput placeholder="Search whiteboards..." />
					<CommandList>
						<CommandEmpty>No whiteboards found.</CommandEmpty>
						<CommandGroup heading={title}>
							{items.map((whiteboard) => (
								<CommandItem
									key={whiteboard.id}
									value={whiteboard.title}
									onSelect={() => onSelect(whiteboard.id as WhiteboardId)}
								>
									<span>{whiteboard.title || "Untitled whiteboard"}</span>
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</DialogContent>
		</Dialog>
	);
}
