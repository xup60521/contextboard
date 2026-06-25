import { createFileRoute } from "@tanstack/react-router";
import { WhiteboardCanvas } from "#/components/whiteboard/WhiteboardCanvas";
import type { Id } from "../../../convex/_generated/dataModel";

export const Route = createFileRoute("/whiteboard/$whiteboardId")({
	ssr: false,
	component: RouteComponent,
});

function RouteComponent() {
	const { whiteboardId } = Route.useParams();

	return <WhiteboardCanvas whiteboardId={whiteboardId as Id<"whiteboards">} />;
}
