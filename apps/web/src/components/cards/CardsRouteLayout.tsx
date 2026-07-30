import { Outlet, useParams } from "@tanstack/react-router";
import {
	CardDetailPage,
	type Id,
} from "@contextboard/web-ui";

export function CardsRouteLayout() {
	const { cardId } = useParams({ strict: false });
	const typedCardId = (cardId as Id<"cards"> | undefined) ?? null;

	if (!typedCardId) {
		return <Outlet />;
	}

	return <CardDetailPage cardId={typedCardId} />;
}
