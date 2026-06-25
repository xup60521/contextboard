import { createFileRoute, useParams } from "@tanstack/react-router";
import { WhiteboardCanvas } from "#/components/whiteboard/WhiteboardCanvas";
import type { Id } from "../../../convex/_generated/dataModel";

export const Route = createFileRoute("/whiteboard")({
	ssr: false,
	component: RouteComponent,
});

function RouteComponent() {
	// Read the active whiteboard id loosely from the matched child route so a
	// single persistent <WhiteboardCanvas> (and thus tldraw editor) survives
	// navigation between the root list and any board. Only the prop changes.
	const { whiteboardId } = useParams({ strict: false });

	return (
		<WhiteboardCanvas
			whiteboardId={(whiteboardId as Id<"whiteboards"> | undefined) ?? null}
		/>
	);
}
