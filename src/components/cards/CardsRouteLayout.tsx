import { Outlet, useParams } from "@tanstack/react-router";
import type { Id } from "../../../convex/_generated/dataModel";
import { CardDetailPage } from "./CardDetailPage";

export function CardsRouteLayout() {
	const { cardId } = useParams({ strict: false });
	const typedCardId = (cardId as Id<"cards"> | undefined) ?? null;

	if (!typedCardId) {
		return <Outlet />;
	}

	return <CardDetailPage cardId={typedCardId} />;
}
