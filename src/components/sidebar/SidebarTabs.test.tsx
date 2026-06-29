import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { SidebarTabs } from "./SidebarTabs";
import type { SidebarTab } from "./sidebar-tabs";

const useSidebarTabsMock = vi.fn();

let currentPathname = "/whiteboard";

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		...props
	}: {
		children: ReactNode;
		to: string;
	}) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
	useRouterState: () => ({
		location: {
			pathname: currentPathname,
		},
	}),
}));

vi.mock("./SidebarTabsContext", () => ({
	useSidebarTabs: () => useSidebarTabsMock(),
}));

function makeTab(overrides: Partial<SidebarTab>): SidebarTab {
	const now = 100;
	return {
		key: "card:card-1",
		kind: "card",
		id: "card-1",
		title: "Card 1",
		pinned: false,
		order: 0,
		lastActiveAt: now,
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

describe("SidebarTabs", () => {
	beforeEach(() => {
		currentPathname = "/whiteboard";
		useSidebarTabsMock.mockReset();
	});

	afterEach(() => {
		cleanup();
	});

	test("shows the clear action for open tabs and confirms before clearing", () => {
		const clearOpenTabs = vi.fn();
		useSidebarTabsMock.mockReturnValue({
			tabs: [
				makeTab({
					key: "whiteboard:root",
					kind: "whiteboard",
					id: null,
					title: "Root whiteboard",
					pinned: true,
				}),
				makeTab({
					key: "card:open",
					id: "open",
					title: "Open tab",
					order: 1,
				}),
			],
			activeTabKey: "whiteboard:root",
			navigateToTab: vi.fn(),
			closeTab: vi.fn(),
			togglePinned: vi.fn(),
			reorderTabs: vi.fn(),
			clearOpenTabs,
		});

		render(<SidebarTabs />);

		fireEvent.click(screen.getByRole("button", { name: "Clear" }));

		expect(screen.getByText("Clear open tabs")).toBeTruthy();
		expect(
			screen.getByText("This will close 1 open tab. Pinned tabs will stay."),
		).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Clear tabs" }));

		expect(clearOpenTabs).toHaveBeenCalledTimes(1);
	});

	test("renders the empty pinned drop target when only open tabs exist", () => {
		useSidebarTabsMock.mockReturnValue({
			tabs: [
				makeTab({
					key: "whiteboard:root",
					kind: "whiteboard",
					id: null,
					title: "Root whiteboard",
					pinned: true,
				}),
				makeTab({
					key: "card:open",
					id: "open",
					title: "Open tab",
					order: 1,
				}),
			],
			activeTabKey: "whiteboard:root",
			navigateToTab: vi.fn(),
			closeTab: vi.fn(),
			togglePinned: vi.fn(),
			reorderTabs: vi.fn(),
			clearOpenTabs: vi.fn(),
		});

		render(<SidebarTabs />);

		expect(screen.getByText("Drag tabs here to pin them")).toBeTruthy();
	});

	test("hides the clear action and shows the empty open drop target when only pinned tabs exist", () => {
		useSidebarTabsMock.mockReturnValue({
			tabs: [
				makeTab({
					key: "whiteboard:root",
					kind: "whiteboard",
					id: null,
					title: "Root whiteboard",
					pinned: true,
				}),
				makeTab({
					key: "card:pinned",
					id: "pinned",
					title: "Pinned tab",
					pinned: true,
					order: 1,
				}),
			],
			activeTabKey: "whiteboard:root",
			navigateToTab: vi.fn(),
			closeTab: vi.fn(),
			togglePinned: vi.fn(),
			reorderTabs: vi.fn(),
			clearOpenTabs: vi.fn(),
		});

		render(<SidebarTabs />);

		expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
		expect(screen.getByText("Drop pinned tabs here to unpin them")).toBeTruthy();
	});
});
