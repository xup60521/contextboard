import { createFileRoute } from "@tanstack/react-router";
import { CardsRouteLayout } from "#/components/cards/CardsRouteLayout";

export const Route = createFileRoute("/cards")({
	ssr: false,
	component: CardsRouteLayout,
});
