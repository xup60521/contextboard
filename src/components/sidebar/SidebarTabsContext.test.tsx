import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
	const { activeTabKey, tabs } = useSidebarTabs();

	return (
		<div>
			<div data-testid="active-key">{activeTabKey ?? ""}</div>
			<div data-testid="tabs-count">{tabs.length}</div>
			<div data-testid="tabs-json">{JSON.stringify(tabs)}</div>
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
});
