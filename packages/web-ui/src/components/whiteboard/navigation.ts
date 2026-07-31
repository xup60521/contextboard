import { useApplicationRuntime } from "@contextboard/application";
import { useMemo } from "react";

/**
 * The navigation the canvas needs, expressed over {@link NavigationRuntime}.
 *
 * The canvas hooks used to receive TanStack Router's `navigate`; they now
 * receive this instead, so the shared whiteboard never learns which router the
 * host application uses.
 */
/**
 * Everything an `<a>` needs to behave as an in-app link on every platform:
 * a correct `href` (so hover, middle-click and copy-link work) plus an
 * `onClick` that routes instead of reloading.
 */
export type AppLinkProps = {
	href: string;
	onClick: (event: {
		preventDefault(): void;
		defaultPrevented: boolean;
	}) => void;
};

export type WhiteboardNavigation = {
	cardHref(cardId: string): string;
	whiteboardHref(whiteboardId: string, options?: { focus?: string }): string;
	rootWhiteboardHref(): string;
	openCard(cardId: string): void;
	openWhiteboard(whiteboardId: string): void;
	openRootWhiteboard(): void;
	/** Spreads onto an `<a>` to make a router href clickable in-app. */
	linkProps(href: string): AppLinkProps;
	/**
	 * Drops the one-shot `?focus=` parameter after the canvas has framed the
	 * shape, so a reload does not re-run the animation.
	 */
	clearFocus(): void;
};

export function useWhiteboardNavigation(): WhiteboardNavigation {
	const { navigation } = useApplicationRuntime();
	return useMemo<WhiteboardNavigation>(
		() => ({
			cardHref: (cardId) => navigation.cardHref(cardId),
			whiteboardHref: (whiteboardId, options) =>
				navigation.whiteboardHref(whiteboardId, options),
			rootWhiteboardHref: () => navigation.rootWhiteboardHref(),
			openCard: (cardId) => navigation.navigate(navigation.cardHref(cardId)),
			openWhiteboard: (whiteboardId) =>
				navigation.navigate(navigation.whiteboardHref(whiteboardId)),
			openRootWhiteboard: () =>
				navigation.navigate(navigation.rootWhiteboardHref()),
			linkProps: (href) => ({
				href: navigation.hrefAttribute?.(href) ?? href,
				onClick: (event) => {
					if (event.defaultPrevented) return;
					event.preventDefault();
					navigation.navigate(href);
				},
			}),
			clearFocus: () => {
				if (typeof window === "undefined") return;
				const { pathname, search, hash } = window.location;
				// Hash history keeps the query inside the fragment, path history in
				// `search`. Strip `focus` from whichever one actually carries it.
				const usesHashRoute = hash.startsWith("#/");
				const [hashPath = "", hashQuery = ""] = usesHashRoute
					? hash.slice(1).split("?")
					: [];
				const params = new URLSearchParams(usesHashRoute ? hashQuery : search);
				if (!params.has("focus")) return;
				params.delete("focus");
				const query = params.toString();
				navigation.replace(
					usesHashRoute
						? `${hashPath}${query ? `?${query}` : ""}`
						: `${pathname}${query ? `?${query}` : ""}${hash}`,
				);
			},
		}),
		[navigation],
	);
}
