import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { SidebarTabsProvider, useSidebarTabs } from "./SidebarTabsContext";

const navigateMock = vi.fn();
const useQueryMock = vi.fn();

let currentPathname = "/whiteboard";
let currentParams: Record<string, string | undefined> = {};
const emptyWhiteboards: never[] = [];
const boardList = [
	{
		_id: "whiteboard-2",
		title: "Board 2",
	},
];
const cardData = {
	card: {
		derivedTitle: "Alpha card",
	},
};

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigateMock,
	useParams: () => currentParams,
	useRouterState: () => ({
		location: {
			pathname: currentPathname,
		},
	}),
}));

vi.mock("convex/react", () => ({
	useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

function ExposeTabs() {
	const { activeTabKey, clearOpenTabs, tabs } = useSidebarTabs();

	return (
		<div>
			<div data-testid="active-key">{activeTabKey ?? ""}</div>
			<div data-testid="tabs-count">{tabs.length}</div>
			<div data-testid="tabs-json">{JSON.stringify(tabs)}</div>
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
		useQueryMock.mockImplementation((_: unknown, args: unknown) => {
			if (args === "skip") {
				return undefined;
			}

			if (args === undefined) {
				return emptyWhiteboards;
			}

			if (currentPathname.startsWith("/cards/")) {
				return cardData;
			}

			return emptyWhiteboards;
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
		useQueryMock.mockImplementation((_: unknown, args: unknown) => {
			if (args === "skip") {
				return undefined;
			}

			if (args === undefined) {
				return boardList;
			}

			return cardData;
		});

		renderProvider();

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

	test("activates whiteboard tabs from route changes", async () => {
		currentPathname = "/whiteboard/whiteboard-2";
		currentParams = { whiteboardId: "whiteboard-2" };
		useQueryMock.mockImplementation((_: unknown, args: unknown) => {
			if (args === "skip") {
				return undefined;
			}

			if (args === undefined) {
				return boardList;
			}

			return undefined;
		});

		renderProvider();

		await waitFor(() => {
			expect(screen.getByTestId("active-key").textContent).toBe(
				"whiteboard:whiteboard-2",
			);
		});

		await waitFor(() => {
			expect(screen.getByTestId("tabs-count").textContent).toBe("2");
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
