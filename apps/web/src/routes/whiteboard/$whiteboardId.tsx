import { createFileRoute } from "@tanstack/react-router";

// The persistent canvas lives in the `/whiteboard` layout route
// (`route.tsx`), which reads `whiteboardId` from this match. This leaf only
// exists as a match target.
export const Route = createFileRoute("/whiteboard/$whiteboardId")({
	component: () => null,
});
