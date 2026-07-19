import { createFileRoute, redirect } from "@tanstack/react-router";
import {
	type CardSortBy,
	DEFAULT_CARD_SORT_BY,
	isCardSortBy,
} from "#/lib/card-sorting";

type OrphansSearch = {
	sort?: CardSortBy;
};

export const Route = createFileRoute("/cards/orphans")({
	ssr: false,
	validateSearch: (search: Record<string, unknown>): OrphansSearch => ({
		sort: isCardSortBy(search.sort) ? search.sort : DEFAULT_CARD_SORT_BY,
	}),
	beforeLoad: ({ search }) => {
		throw redirect({
			to: "/cards",
			search: {
				orphan: "true",
				q: "",
				sort: search.sort ?? DEFAULT_CARD_SORT_BY,
			},
			replace: true,
		});
	},
});
