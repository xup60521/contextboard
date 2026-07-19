import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { SidebarTabsProvider, useSidebarTabs } from "./SidebarTabsContext";

const navigateMock = vi.fn();
const useQueryMock = vi.fn();

let currentPathname = "/whiteboard";
let currentParams: Record<string, string | undefined> = {};
const sidebarState = {
	whiteboards: new Map<string, string>(),
	cards: new Map<string, string>(),
};
const sidebarQueryCache = new Map<
	string,
	{
		whiteboards: Array<{ _id: string; title: string }>;
		cards: Array<{ _id: string; title: string }>;
	}
>();

function resetSidebarQueryCache() {
	sidebarQueryCache.clear();
}

function buildSidebarQueryResult(args: {
	whiteboardIds: string[];
	cardIds: string[];
}) {
	const cacheKey = JSON.stringify(args);
	const cached = sidebarQueryCache.get(cacheKey);
	if (cached) {
		return cached;
	}

	const result = {
		whiteboards: args.whiteboardIds.flatMap((id) => {
			const title = sidebarState.whiteboards.get(id);
			return title ? [{ _id: id, title }] : [];
		}),
		cards: args.cardIds.flatMap((id) => {
			const title = sidebarState.cards.get(id);
			return title ? [{ _id: id, title }] : [];
		}),
	};

	sidebarQueryCache.set(cacheKey, result);
	return result;
}

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigateMock,
	useParams: () => currentParams,
	useRouterState: () => ({
		location: {
			pathname: currentPathname,
		},
	}),
}));

vi.mock("#/integrations/local/react", () => ({
	useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

function ExposeTabs() {
	const { activeTabKey, clearOpenTabs, closeTab, tabs } = useSidebarTabs();

	return (
		<div>
			<div data-testid="active-key">{activeTabKey ?? ""}</div>
			<div data-testid="tabs-count">{tabs.length}</div>
			<div data-testid="tabs-json">{JSON.stringify(tabs)}</div>
			<div>
				{tabs.map((tab) => (
					<button
						key={tab.key}
						type="button"
						onClick={() => closeTab(tab.key)}
						aria-label={`close ${tab.key}`}
					>
						Close {tab.key}
					</button>
				))}
			</div>
			<button type="button" onClick={clearOpenTabs}>
				Clear open tabs
			</button>
		</div>
	);
}

function renderProvider(children: ReactNode = <ExposeTabs />) {
	return render(<SidebarTabsProvider>{children}</SidebarTabsProvider>);
}

describe("SidebarTabsProvider", () => {
	beforeEach(() => {
		navigateMock.mockReset();
		useQueryMock.mockReset();
		window.localStorage.clear();
		currentPathname = "/whiteboard";
		currentParams = {};
		sidebarState.whiteboards.clear();
		sidebarState.cards.clear();
		sidebarState.whiteboards.set("whiteboard-2", "Board 2");
		sidebarState.cards.set("card-1", "Alpha card");
		sidebarState.cards.set("card-2", "Beta card");
		sidebarState.cards.set("pinned", "Pinned card");
		resetSidebarQueryCache();
		useQueryMock.mockImplementation((_: unknown, args: unknown) => {
			if (!args) {
				return undefined;
			}

			const { whiteboardIds = [], cardIds = [] } = args as {
				whiteboardIds: string[];
				cardIds: string[];
			};

			return buildSidebarQueryResult({ whiteboardIds, cardIds });
		});
	});

	afterEach(() => {
		cleanup();
	});

	test("hydrates from localStorage and writes route-created tabs back", async () => {
		window.localStorage.setItem(
			"contextboard.sidebarTabs.v1",
			JSON.stringify({
				version: 1,
				updatedAt: 1,
				tabs: [
					{
						key: "whiteboard:root",
						kind: "whiteboard",
						id: null,
						title: "Root whiteboard",
						pinned: true,
						order: 0,
						lastActiveAt: 1,
						createdAt: 1,
						updatedAt: 1,
					},
				],
			}),
		);

		currentPathname = "/cards/card-1";
		currentParams = { cardId: "card-1" };

		renderProvider();

		await waitFor(() => {
			expect(useQueryMock).toHaveBeenCalled();
		});

		expect(useQueryMock.mock.calls.at(-1)?.[1]).toEqual({
			whiteboardIds: [],
			cardIds: ["card-1"],
		});

		await waitFor(() => {
			expect(screen.getByTestId("active-key").textContent).toBe("card:card-1");
		});

		await waitFor(() => {
			expect(screen.getByTestId("tabs-count").textContent).toBe("2");
		});

		expect(
			window.localStorage.getItem("contextboard.sidebarTabs.v1"),
		).toContain("Alpha card");
	});

	test("closing the active card tab removes it and navigates to the latest fallback", async () => {
		window.localStorage.setItem(
			"contextboard.sidebarTabs.v1",
			JSON.stringify({
				version: 1,
				updatedAt: 1,
				tabs: [
					{
						key: "whiteboard:root",
						kind: "whiteboard",
						id: null,
						title: "Root whiteboard",
						pinned: true,
						order: 0,
						lastActiveAt: 1,
						createdAt: 1,
						updatedAt: 1,
					},
					{
						key: "card:card-2",
						kind: "card",
						id: "card-2",
						title: "Beta card",
						pinned: false,
						order: 1,
						lastActiveAt: 10,
						createdAt: 10,
						updatedAt: 10,
					},
				],
			}),
		);

		currentPathname = "/cards/card-1";
		currentParams = { cardId: "card-1" };

		renderProvider();

		await waitFor(() => {
			expect(screen.getByTestId("active-key").textContent).toBe("card:card-1");
		});
		await waitFor(() => {
			expect(screen.getByTestId("tabs-json").textContent).toContain(
				"Alpha card",
			);
		});

		fireEvent.click(screen.getByRole("button", { name: "close card:card-1" }));

		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({
				to: "/cards/$cardId",
				params: { cardId: "card-2" },
			});
		});

		await waitFor(() => {
			expect(screen.getByTestId("tabs-count").textContent).toBe("2");
		});

		expect(screen.getByTestId("tabs-json").textContent).not.toContain(
			'"title":"Card"',
		);
		expect(screen.getByTestId("tabs-json").textContent).not.toContain(
			'"key":"card:card-1"',
		);
	});

	test("closing a non-active card tab removes it without navigating away", async () => {
		window.localStorage.setItem(
			"contextboard.sidebarTabs.v1",
			JSON.stringify({
				version: 1,
				updatedAt: 1,
				tabs: [
					{
						key: "whiteboard:root",
						kind: "whiteboard",
						id: null,
						title: "Root whiteboard",
						pinned: true,
						order: 0,
						lastActiveAt: 1,
						createdAt: 1,
						updatedAt: 1,
					},
					{
						key: "card:card-2",
						kind: "card",
						id: "card-2",
						title: "Beta card",
						pinned: false,
						order: 1,
						lastActiveAt: 10,
						createdAt: 10,
						updatedAt: 10,
					},
				],
			}),
		);

		currentPathname = "/cards/card-1";
		currentParams = { cardId: "card-1" };

		renderProvider();

		await waitFor(() => {
			expect(screen.getByTestId("active-key").textContent).toBe("card:card-1");
		});

		fireEvent.click(screen.getByRole("button", { name: "close card:card-2" }));

		await waitFor(() => {
			expect(screen.getByTestId("tabs-count").textContent).toBe("2");
		});

		expect(navigateMock).not.toHaveBeenCalled();
		expect(screen.getByTestId("tabs-json").textContent).not.toContain(
			'"key":"card:card-2"',
		);
		expect(screen.getByTestId("active-key").textContent).toBe("card:card-1");
	});

	test("activates whiteboard tabs from route changes", async () => {
		currentPathname = "/whiteboard/whiteboard-2";
		currentParams = { whiteboardId: "whiteboard-2" };

		renderProvider();

		await waitFor(() => {
			expect(useQueryMock).toHaveBeenCalled();
		});

		expect(useQueryMock.mock.calls.at(-1)?.[1]).toEqual({
			whiteboardIds: ["whiteboard-2"],
			cardIds: [],
		});

		await waitFor(() => {
			expect(screen.getByTestId("active-key").textContent).toBe(
				"whiteboard:whiteboard-2",
			);
		});

		await waitFor(() => {
			expect(screen.getByTestId("tabs-count").textContent).toBe("2");
		});

		await waitFor(() => {
			expect(screen.getByTestId("tabs-json").textContent).toContain("Board 2");
		});
	});

	test("removes deleted card tabs and marks missing whiteboards", async () => {
		window.localStorage.setItem(
			"contextboard.sidebarTabs.v1",
			JSON.stringify({
				version: 1,
				updatedAt: 1,
				tabs: [
					{
						key: "whiteboard:root",
						kind: "whiteboard",
						id: null,
						title: "Root whiteboard",
						pinned: true,
						order: 0,
						lastActiveAt: 1,
						createdAt: 1,
						updatedAt: 1,
					},
					{
						key: "whiteboard:whiteboard-2",
						kind: "whiteboard",
						id: "whiteboard-2",
						title: "Board 2",
						pinned: true,
						order: 1,
						lastActiveAt: 2,
						createdAt: 2,
						updatedAt: 2,
					},
					{
						key: "card:pinned",
						kind: "card",
						id: "pinned",
						title: "Pinned card",
						pinned: true,
						order: 2,
						lastActiveAt: 3,
						createdAt: 3,
						updatedAt: 3,
					},
				],
			}),
		);

		const view = renderProvider();

		await waitFor(() => {
			expect(screen.getByTestId("tabs-json").textContent).toContain("Board 2");
		});
		await waitFor(() => {
			expect(screen.getByTestId("tabs-json").textContent).toContain(
				"Pinned card",
			);
		});

		expect(useQueryMock.mock.calls.at(-1)?.[1]).toEqual({
			whiteboardIds: ["whiteboard-2"],
			cardIds: ["pinned"],
		});

		sidebarState.whiteboards.delete("whiteboard-2");
		sidebarState.cards.delete("pinned");
		resetSidebarQueryCache();
		view.rerender(
			<SidebarTabsProvider>
				<ExposeTabs />
			</SidebarTabsProvider>,
		);

		await waitFor(() => {
			expect(useQueryMock.mock.calls.map((call) => call[1])).toContainEqual({
				whiteboardIds: ["whiteboard-2"],
				cardIds: [],
			});
		});

		await waitFor(() => {
			expect(screen.getByTestId("tabs-json").textContent).toContain(
				"Missing whiteboard",
			);
		});
		await waitFor(() => {
			expect(screen.getByTestId("tabs-json").textContent).not.toContain(
				"Pinned card",
			);
		});
	});

	test("subscribes to open whiteboard tabs and prunes missing tabs", async () => {
		window.localStorage.setItem(
			"contextboard.sidebarTabs.v1",
			JSON.stringify({
				version: 1,
				updatedAt: 1,
				tabs: [
					{
						key: "whiteboard:root",
						kind: "whiteboard",
						id: null,
						title: "Root whiteboard",
						pinned: true,
						order: 0,
						lastActiveAt: 1,
						createdAt: 1,
						updatedAt: 1,
					},
					{
						key: "whiteboard:whiteboard-1",
						kind: "whiteboard",
						id: "whiteboard-1",
						title: "Board A",
						pinned: false,
						order: 1,
						lastActiveAt: 10,
						createdAt: 10,
						updatedAt: 10,
					},
					{
						key: "whiteboard:missing",
						kind: "whiteboard",
						id: "whiteboard-missing",
						title: "Ghost board",
						pinned: false,
						order: 2,
						lastActiveAt: 11,
						createdAt: 11,
						updatedAt: 11,
					},
				],
			}),
		);

		currentPathname = "/whiteboard/whiteboard-1";
		currentParams = { whiteboardId: "whiteboard-1" };
		sidebarState.whiteboards.set("whiteboard-1", "Board A");

		renderProvider();

		await waitFor(() => {
			expect(useQueryMock).toHaveBeenCalled();
		});

		expect(useQueryMock.mock.calls.map((call) => call[1])).toContainEqual({
			whiteboardIds: ["whiteboard-1", "whiteboard-missing"],
			cardIds: [],
		});

		await waitFor(() => {
			expect(screen.getByTestId("tabs-json").textContent).toContain("Board A");
		});

		await waitFor(() => {
			expect(screen.getByTestId("tabs-json").textContent).not.toContain(
				"whiteboard-missing",
			);
		});
	});

	test("clearing open tabs navigates when the active tab is unpinned", async () => {
		window.localStorage.setItem(
			"contextboard.sidebarTabs.v1",
			JSON.stringify({
				version: 1,
				updatedAt: 1,
				tabs: [
					{
						key: "whiteboard:root",
						kind: "whiteboard",
						id: null,
						title: "Root whiteboard",
						pinned: true,
						order: 0,
						lastActiveAt: 1,
						createdAt: 1,
						updatedAt: 1,
					},
					{
						key: "card:pinned",
						kind: "card",
						id: "pinned",
						title: "Pinned card",
						pinned: true,
						order: 1,
						lastActiveAt: 5,
						createdAt: 5,
						updatedAt: 5,
					},
					{
						key: "card:card-1",
						kind: "card",
						id: "card-1",
						title: "Card 1",
						pinned: false,
						order: 2,
						lastActiveAt: 10,
						createdAt: 10,
						updatedAt: 10,
					},
				],
			}),
		);

		currentPathname = "/cards/card-1";
		currentParams = { cardId: "card-1" };

		renderProvider();

		await waitFor(() => {
			expect(screen.getByTestId("active-key").textContent).toBe("card:card-1");
		});

		fireEvent.click(screen.getByText("Clear open tabs"));

		await waitFor(() => {
			expect(screen.getByTestId("tabs-count").textContent).toBe("2");
		});

		expect(navigateMock).toHaveBeenCalledWith({
			to: "/cards/$cardId",
			params: { cardId: "pinned" },
		});
	});

	test("clearing open tabs does not navigate when the active route is root", async () => {
		window.localStorage.setItem(
			"contextboard.sidebarTabs.v1",
			JSON.stringify({
				version: 1,
				updatedAt: 1,
				tabs: [
					{
						key: "whiteboard:root",
						kind: "whiteboard",
						id: null,
						title: "Root whiteboard",
						pinned: true,
						order: 0,
						lastActiveAt: 1,
						createdAt: 1,
						updatedAt: 1,
					},
					{
						key: "card:pinned",
						kind: "card",
						id: "pinned",
						title: "Pinned card",
						pinned: true,
						order: 1,
						lastActiveAt: 5,
						createdAt: 5,
						updatedAt: 5,
					},
					{
						key: "card:card-1",
						kind: "card",
						id: "card-1",
						title: "Card 1",
						pinned: false,
						order: 2,
						lastActiveAt: 10,
						createdAt: 10,
						updatedAt: 10,
					},
				],
			}),
		);

		renderProvider();

		fireEvent.click(screen.getByText("Clear open tabs"));

		await waitFor(() => {
			expect(screen.getByTestId("tabs-count").textContent).toBe("2");
		});

		expect(navigateMock).not.toHaveBeenCalled();
	});
});
