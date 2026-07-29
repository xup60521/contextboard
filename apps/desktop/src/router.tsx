import { CardDetailView, CardListView } from "@contextboard/application";
import {
	createHashHistory,
	createRootRoute,
	createRoute,
	createRouter,
	type RouterHistory,
	redirect,
} from "@tanstack/react-router";
import { DesktopRootLayout } from "./routes/DesktopRootLayout";

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
	component: CardListView,
});

const cardDetailRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/cards/$cardId",
	component: function DesktopCardDetailRoute() {
		const { cardId } = cardDetailRoute.useParams();
		return <CardDetailView cardId={cardId} />;
	},
});

const routeTree = rootRoute.addChildren([
	indexRoute,
	cardsRoute,
	cardDetailRoute,
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
