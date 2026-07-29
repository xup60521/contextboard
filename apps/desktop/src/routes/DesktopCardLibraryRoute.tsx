import {
	CardLibraryPage,
	type CardLibrarySearchState,
} from "@contextboard/web-ui";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo } from "react";

/**
 * Desktop only supplies the route search-state adapter; every pixel of the
 * card library comes from the shared UI package.
 */
export function DesktopCardLibraryRoute() {
	const search = useSearch({ strict: false }) as Partial<CardLibrarySearchState>;
	const navigate = useNavigate();

	const adapter = useMemo(
		() => ({
			state: {
				q: search.q ?? "",
				orphanOnly: search.orphanOnly ?? false,
				sort: search.sort ?? ("updated_desc" as const),
			},
			replace(next: CardLibrarySearchState) {
				void navigate({
					to: "/cards",
					replace: true,
					search: {
						q: next.q || undefined,
						orphanOnly: next.orphanOnly || undefined,
						sort: next.sort === "updated_desc" ? undefined : next.sort,
					},
				});
			},
		}),
		[navigate, search.orphanOnly, search.q, search.sort],
	);

	return <CardLibraryPage search={adapter} />;
}
