// @vitest-environment jsdom

import {
	ApplicationRuntimeProvider,
	type ApplicationRuntime,
	type NavigationRuntime,
} from "@contextboard/application";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";
import { useWhiteboardNavigation } from "./navigation";

function setup(overrides: Partial<NavigationRuntime> = {}) {
	const navigate = vi.fn();
	const replace = vi.fn();
	const runtime = {
		platform: "desktop",
		workspaceId: "test",
		cards: {} as ApplicationRuntime["cards"],
		navigation: {
			cardsHref: () => "/cards",
			cardHref: (id: string) => `/cards/${id}`,
			rootWhiteboardHref: () => "/whiteboard",
			whiteboardHref: (id: string) => `/whiteboard/${id}`,
			navigate,
			replace,
			...overrides,
		},
	} as ApplicationRuntime;
	const wrapper = ({ children }: { children: ReactNode }) => (
		<ApplicationRuntimeProvider runtime={runtime}>
			{children}
		</ApplicationRuntimeProvider>
	);
	const { result } = renderHook(() => useWhiteboardNavigation(), { wrapper });
	return { navigation: result.current, navigate, replace };
}

function clickEvent() {
	let defaultPrevented = false;
	return {
		get defaultPrevented() {
			return defaultPrevented;
		},
		preventDefault() {
			defaultPrevented = true;
		},
	};
}

describe("whiteboard link navigation", () => {
	test("routes in-app instead of letting the browser follow the href", () => {
		const { navigation, navigate } = setup();
		const link = navigation.linkProps("/whiteboard/board-1");
		const event = clickEvent();

		link.onClick(event);

		expect(event.defaultPrevented).toBe(true);
		expect(navigate).toHaveBeenCalledWith("/whiteboard/board-1");
	});

	test("prefixes the href for a hash-history platform", () => {
		// Regression: a bare `/whiteboard` href left the SPA, reloaded at `/`
		// and redirected to the card library, so every breadcrumb click on
		// Desktop landed on /cards.
		const { navigation } = setup({ hrefAttribute: (href) => `#${href}` });
		expect(navigation.linkProps("/whiteboard").href).toBe("#/whiteboard");
	});

	test("leaves the href untouched when the platform uses path history", () => {
		const { navigation } = setup();
		expect(navigation.linkProps("/whiteboard").href).toBe("/whiteboard");
	});

	test("respects a caller that already handled the click", () => {
		const { navigation, navigate } = setup();
		const event = clickEvent();
		event.preventDefault();

		navigation.linkProps("/cards").onClick(event);

		expect(navigate).not.toHaveBeenCalled();
	});

	test("clears only the focus param from a hash route", () => {
		const { navigation, replace } = setup({ hrefAttribute: (h) => `#${h}` });
		window.location.hash = "#/whiteboard/board-1?focus=shape:a&zoom=2";

		navigation.clearFocus();

		expect(replace).toHaveBeenCalledWith("/whiteboard/board-1?zoom=2");
	});
});
