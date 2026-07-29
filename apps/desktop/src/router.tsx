import type { CardSortOrder } from "@contextboard/application";
import { CardDetailPage } from "@contextboard/web-ui";
import {
	createHashHistory,
	createRootRoute,
	createRoute,
	createRouter,
	type RouterHistory,
	redirect,
} from "@tanstack/react-router";
import { DesktopCardLibraryRoute } from "./routes/DesktopCardLibraryRoute";
import { DesktopRootLayout } from "./routes/DesktopRootLayout";
import {
	DesktopRootWhiteboardRoute,
	DesktopWhiteboardRoute,
} from "./routes/DesktopWhiteboardRoute";

const sortOrders: CardSortOrder[] = [
	"title",
	"title_desc",
	"updated_desc",
	"updated_asc",
];

type CardLibrarySearch = {
	q?: string;
	orphanOnly?: boolean;
	sort?: CardSortOrder;
};

/**
 * Mirrors the Web card-library search shape so the shared page behaves
 * identically on both platforms.
 */
function validateCardLibrarySearch(
	search: Record<string, unknown>,
): CardLibrarySearch {
	const sort = search.sort;
	return {
		q: typeof search.q === "string" && search.q ? search.q : undefined,
		orphanOnly: search.orphanOnly === true || search.orphanOnly === "true",
		sort: sortOrders.includes(sort as CardSortOrder)
			? (sort as CardSortOrder)
			: undefined,
	};
}

const rootRoute = createRootRoute({ component: DesktopRootLayout });

const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	beforeLoad: () => {
		throw redirect({ to: "/cards" });
	},
});

const cardsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/cards",
	validateSearch: validateCardLibrarySearch,
	component: DesktopCardLibraryRoute,
});

const cardDetailRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/cards/$cardId",
	component: function DesktopCardDetailRoute() {
		const { cardId } = cardDetailRoute.useParams();
		return <CardDetailPage cardId={cardId} />;
	},
});

const whiteboardSearch = (search: Record<string, unknown>) => ({
	focus: typeof search.focus === "string" ? search.focus : undefined,
});

const rootWhiteboardRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/whiteboard",
	validateSearch: whiteboardSearch,
	component: DesktopRootWhiteboardRoute,
});

const whiteboardRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/whiteboard/$whiteboardId",
	validateSearch: whiteboardSearch,
	component: function DesktopWhiteboardIdRoute() {
		const { whiteboardId } = whiteboardRoute.useParams();
		return <DesktopWhiteboardRoute whiteboardId={whiteboardId} />;
	},
});

const routeTree = rootRoute.addChildren([
	indexRoute,
	cardsRoute,
	cardDetailRoute,
	rootWhiteboardRoute,
	whiteboardRoute,
]);

/**
 * Desktop uses hash history so a reload of the packaged `index.html` resolves
 * without a server, while route and search-param shapes stay aligned with Web.
 */
export function createDesktopRouter(
	history: RouterHistory = createHashHistory(),
) {
	return createRouter({
		routeTree,
		history,
		defaultPreload: false,
		scrollRestoration: true,
	});
}

export type DesktopRouter = ReturnType<typeof createDesktopRouter>;

declare module "@tanstack/react-router" {
	interface Register {
		router: DesktopRouter;
	}
}
