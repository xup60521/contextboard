import { PanelLeft } from "lucide-react";
import { Button } from "../ui/button.tsx";
import { useSidebarContext } from "../whiteboard/SidebarContext.tsx";

export function SidebarOpenButton() {
	const { isOpen, open } = useSidebarContext();

	if (isOpen) return null;

	return (
		<Button
			type="button"
			variant="outline"
			size="xs"
			className="shrink-0"
			onClick={open}
			aria-label="Open sidebar"
		>
			<PanelLeft className="size-4" />
		</Button>
	);
}
