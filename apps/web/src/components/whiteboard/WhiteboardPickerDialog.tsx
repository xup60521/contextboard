import { useQuery } from "convex/react";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "#/components/ui/command";
import { Dialog, DialogContent } from "#/components/ui/dialog";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

export function WhiteboardPickerDialog({
	open,
	onOpenChange,
	onSelect,
	title = "Append to whiteboard",
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSelect: (whiteboardId: Id<"whiteboards">) => void;
	title?: string;
}) {
	const whiteboards = useQuery(api.whiteboards.listActive);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="overflow-hidden p-0" showCloseButton={false}>
				<Command>
					<CommandInput placeholder="Search whiteboards..." />
					<CommandList>
						<CommandEmpty>No whiteboards found.</CommandEmpty>
						<CommandGroup heading={title}>
							{whiteboards?.map((wb) => (
								<CommandItem
									key={wb._id}
									value={`${wb.title} ${wb.breadcrumbs.map((b) => b.title).join(" ")}`}
									onSelect={() => {
										onSelect(wb._id as Id<"whiteboards">);
									}}
								>
									<div className="flex flex-col">
										<span>{wb.title || "Untitled whiteboard"}</span>
										{wb.breadcrumbs.length > 0 && (
											<span className="text-xs text-muted-foreground">
												{wb.breadcrumbs.map((b) => b.title).join(" / ")}
											</span>
										)}
									</div>
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</DialogContent>
		</Dialog>
	);
}
