import { createFileRoute } from "@tanstack/react-router";

// The persistent canvas lives in the `/whiteboard` layout route
// (`route.tsx`); this leaf only exists as a match target for the root board.
export const Route = createFileRoute("/whiteboard/")({
	component: () => null,
});
