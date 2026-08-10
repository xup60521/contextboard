import { DefaultStylePanel } from "tldraw";
import { WhiteboardBacklinksPanel } from "./WhiteboardBacklinksPanel";

export function WhiteboardStylePanel() {
	return (
		<div className="flex flex-col items-end">
			<DefaultStylePanel />
			<WhiteboardBacklinksPanel />
		</div>
	);
}
