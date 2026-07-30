import type { CardSortOrder } from "@contextboard/application";
import { CardLibraryPage } from "@contextboard/web-ui";
import {
	createFileRoute,
	stripSearchParams,
	useRouter,
} from "@tanstack/react-router";
import {
	type CardSortBy,
	DEFAULT_CARD_SORT_BY,
	isCardSortBy,
} from "#/lib/card-sorting";

interface CardSearch {
	orphan: string;
	sort: CardSortBy;
	q: string;
}

const toSharedSort = (sort: CardSortBy): CardSortOrder =>
	sort === "updated" ? "updated_desc" : sort;

const toWebSort = (sort: CardSortOrder): CardSortBy =>
	sort === "updated_desc" ? "updated" : sort;

export const Route = createFileRoute("/cards/")({
	ssr: false,
	validateSearch: (search: Record<string, unknown>): CardSearch => ({
		orphan: typeof search.orphan === "string" ? search.orphan : "",
		sort: isCardSortBy(search.sort) ? search.sort : DEFAULT_CARD_SORT_BY,
		q: typeof search.q === "string" ? search.q : "",
	}),
	search: {
		middlewares: [stripSearchParams({ q: "" })],
	},
	component: RouteComponent,
});

function RouteComponent() {
	const router = useRouter();
	const search = Route.useSearch();
	return (
		<CardLibraryPage
			search={{
				state: {
					q: search.q,
					orphanOnly: search.orphan === "true",
					sort: toSharedSort(search.sort),
				},
				replace(next) {
					const params = new URLSearchParams({
						q: next.q,
						orphan: next.orphanOnly ? "true" : "",
						sort: toWebSort(next.sort),
					});
					router.history.replace(`/cards?${params.toString()}`);
				},
			}}
		/>
	);
}
