import { createFileRoute } from "@tanstack/react-router";
import { WhiteboardCanvas } from "#/components/whiteboard/WhiteboardCanvas";

export const Route = createFileRoute("/whiteboard/")({
	ssr: false,
	component: RouteComponent,
});

function RouteComponent() {
	return <WhiteboardCanvas whiteboardId={null} />;
}
