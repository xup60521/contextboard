import { describe, expect, test } from "vitest";
import {
	closeSidebarTab,
	createRootTab,
	enforceUnpinnedTabLimit,
	moveSidebarTab,
	normalizeTabs,
	openSidebarTab,
	pruneMissingWhiteboardTabs,
	type SidebarTab,
	whiteboardTabKey,
} from "./sidebar-tabs";

function makeTab(overrides: Partial<SidebarTab>): SidebarTab {
	const now = 1_000;
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

describe("sidebarTabs", () => {
	test("normalizeTabs always guarantees the root whiteboard", () => {
		const tabs = normalizeTabs([]);

		expect(tabs).toHaveLength(1);
		expect(tabs[0]).toMatchObject({
			key: whiteboardTabKey(null),
			kind: "whiteboard",
			id: null,
			title: "Root whiteboard",
			pinned: true,
			order: 0,
		});
	});

	test("opening an existing tab updates lastActiveAt", () => {
		const root = createRootTab(100);
		const tab = makeTab({
			lastActiveAt: 10,
			createdAt: 10,
			updatedAt: 10,
		});

		const next = openSidebarTab([root, tab], {
			kind: "card",
			id: "card-1",
			now: 250,
		});

		expect(next).toHaveLength(2);
		expect(next.find((item) => item.key === tab.key)?.lastActiveAt).toBe(250);
	});

	test("opening a new tab adds it to the state", () => {
		const next = openSidebarTab([createRootTab(100)], {
			kind: "whiteboard",
			id: "whiteboard-1",
			title: "Board A",
			now: 250,
		});

		expect(next).toHaveLength(2);
		expect(
			next.find((item) => item.key === "whiteboard:whiteboard-1"),
		).toMatchObject({
			kind: "whiteboard",
			id: "whiteboard-1",
			title: "Board A",
			pinned: false,
			lastActiveAt: 250,
		});
	});

	test("unpinned tabs are capped without evicting pinned tabs", () => {
		const root = createRootTab(100);
		const pinned = makeTab({
			key: "card:pinned",
			title: "Pinned tab",
			pinned: true,
			order: 1,
		});
		const tabs = [
			root,
			pinned,
			...Array.from({ length: 13 }, (_, index) =>
				makeTab({
					key: `card:${index}`,
					id: `card-${index}`,
					title: `Card ${index}`,
					lastActiveAt: index + 1,
					createdAt: index + 1,
					updatedAt: index + 1,
					order: index,
				}),
			),
		];

		const next = enforceUnpinnedTabLimit(tabs, "card:12", 500);
		const openTabs = next.filter(
			(tab) => !tab.pinned && tab.key !== whiteboardTabKey(null),
		);

		expect(next.find((tab) => tab.key === pinned.key)).toMatchObject({
			pinned: true,
			title: "Pinned tab",
		});
		expect(openTabs).toHaveLength(12);
		expect(openTabs.some((tab) => tab.key === "card:0")).toBe(false);
	});

	test("closing the active tab returns the fallback target", () => {
		const root = createRootTab(100);
		const pinned = makeTab({
			key: "card:pinned",
			title: "Pinned tab",
			pinned: true,
			order: 1,
			lastActiveAt: 400,
		});
		const active = makeTab({
			key: "card:active",
			title: "Active tab",
			lastActiveAt: 300,
			order: 0,
		});
		const open = makeTab({
			key: "card:open",
			title: "Open tab",
			lastActiveAt: 200,
			order: 1,
		});

		const result = closeSidebarTab([root, pinned, active, open], active.key);

		expect(result.tabs.some((tab) => tab.key === active.key)).toBe(false);
		expect(result.fallbackTab.key).toBe(pinned.key);
	});

	test("pruning missing whiteboard tabs keeps pinned tabs and removes unpinned ones", () => {
		const root = createRootTab(100);
		const pinnedMissing = makeTab({
			key: "whiteboard:missing-pinned",
			kind: "whiteboard",
			id: "missing-pinned",
			title: "Old title",
			pinned: true,
			order: 1,
		});
		const openMissing = makeTab({
			key: "whiteboard:missing-open",
			kind: "whiteboard",
			id: "missing-open",
			title: "Old title",
			pinned: false,
			order: 0,
		});
		const present = makeTab({
			key: "whiteboard:present",
			kind: "whiteboard",
			id: "present",
			title: "Present board",
			pinned: false,
			order: 1,
		});

		const next = pruneMissingWhiteboardTabs(
			[root, pinnedMissing, openMissing, present],
			new Map([["present", "Present board"]]),
			500,
		);

		expect(next.some((tab) => tab.key === openMissing.key)).toBe(false);
		expect(next.find((tab) => tab.key === pinnedMissing.key)).toMatchObject({
			title: "Missing whiteboard",
			pinned: true,
		});
		expect(next.find((tab) => tab.key === present.key)).toMatchObject({
			title: "Present board",
		});
	});

	test("moving a tab reorders it and the new order sticks", () => {
		const root = createRootTab(100);
		const tabA = makeTab({
			key: "card:a",
			id: "a",
			title: "Tab A",
			order: 1,
		});
		const tabB = makeTab({
			key: "card:b",
			id: "b",
			title: "Tab B",
			order: 2,
		});

		// Move B before A
		const next = moveSidebarTab([root, tabA, tabB], tabB.key, tabA.key, 500);

		const keys = next.map((t) => t.key);
		expect(keys[0]).toBe(root.key);
		expect(keys[1]).toBe(tabB.key);
		expect(keys[2]).toBe(tabA.key);
	});
});
