import { describe, expect, test } from "vitest";
import {
	clearUnpinnedSidebarTabs,
	closeSidebarTab,
	createRootTab,
	enforceUnpinnedTabLimit,
	moveSidebarTab,
	moveSidebarTabByDropTarget,
	normalizeTabs,
	openSidebarTab,
	pruneMissingWhiteboardTabs,
	setSidebarTabPinned,
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

	test("pinning moves tabs ahead of unpinned tabs in display order", () => {
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

		const next = setSidebarTabPinned([root, tabA, tabB], tabB.key, true, 500);

		expect(next.map((tab) => tab.key)).toEqual([root.key, tabB.key, tabA.key]);
		expect(next.find((tab) => tab.key === tabB.key)?.pinned).toBe(true);
	});

	test("unpinning a tab keeps the just-unpinned tab when enforcing the cap", () => {
		const root = createRootTab(100);
		const formerlyPinned = makeTab({
			key: "card:pinned",
			id: "pinned",
			title: "Pinned tab",
			pinned: true,
			order: 1,
			lastActiveAt: 1,
			createdAt: 1,
			updatedAt: 1,
		});
		const tabs = [
			root,
			formerlyPinned,
			...Array.from({ length: 12 }, (_, index) =>
				makeTab({
					key: `card:${index}`,
					id: `card-${index}`,
					title: `Card ${index}`,
					lastActiveAt: index + 10,
					createdAt: index + 10,
					updatedAt: index + 10,
					order: index + 2,
				}),
			),
		];

		const next = enforceUnpinnedTabLimit(
			setSidebarTabPinned(tabs, formerlyPinned.key, false, 500),
			["card:11", formerlyPinned.key],
			500,
		);

		expect(next.some((tab) => tab.key === formerlyPinned.key)).toBe(true);
		expect(next.some((tab) => tab.key === "card:0")).toBe(false);
	});

	test("dragging an open tab into pinned flips pinned and inserts into the pinned group", () => {
		const root = createRootTab(100);
		const pinned = makeTab({
			key: "card:pinned",
			id: "pinned",
			title: "Pinned",
			pinned: true,
			order: 1,
		});
		const open = makeTab({
			key: "card:open",
			id: "open",
			title: "Open",
			order: 2,
		});

		const next = moveSidebarTabByDropTarget(
			[root, pinned, open],
			open.key,
			pinned.key,
			"pinned",
			[],
			500,
		);

		expect(next.map((tab) => tab.key)).toEqual([root.key, open.key, pinned.key]);
		expect(next.find((tab) => tab.key === open.key)?.pinned).toBe(true);
	});

	test("dragging a pinned tab into open flips pinned and inserts into the open group", () => {
		const root = createRootTab(100);
		const pinned = makeTab({
			key: "card:pinned",
			id: "pinned",
			title: "Pinned",
			pinned: true,
			order: 1,
		});
		const open = makeTab({
			key: "card:open",
			id: "open",
			title: "Open",
			order: 2,
		});

		const next = moveSidebarTabByDropTarget(
			[root, pinned, open],
			pinned.key,
			open.key,
			"open",
			[],
			500,
		);

		expect(next.map((tab) => tab.key)).toEqual([root.key, pinned.key, open.key]);
		expect(next.find((tab) => tab.key === pinned.key)?.pinned).toBe(false);
	});

	test("dragging within pinned reorders only that section", () => {
		const root = createRootTab(100);
		const pinnedA = makeTab({
			key: "card:a",
			id: "a",
			title: "Pinned A",
			pinned: true,
			order: 1,
		});
		const pinnedB = makeTab({
			key: "card:b",
			id: "b",
			title: "Pinned B",
			pinned: true,
			order: 2,
		});
		const open = makeTab({
			key: "card:open",
			id: "open",
			title: "Open",
			order: 3,
		});

		const next = moveSidebarTabByDropTarget(
			[root, pinnedA, pinnedB, open],
			pinnedB.key,
			pinnedA.key,
			"pinned",
			[],
			500,
		);

		expect(next.map((tab) => tab.key)).toEqual([
			root.key,
			pinnedB.key,
			pinnedA.key,
			open.key,
		]);
		expect(next.find((tab) => tab.key === open.key)?.pinned).toBe(false);
	});

	test("dragging within open reorders only that section", () => {
		const root = createRootTab(100);
		const pinned = makeTab({
			key: "card:pinned",
			id: "pinned",
			title: "Pinned",
			pinned: true,
			order: 1,
		});
		const openA = makeTab({
			key: "card:a",
			id: "a",
			title: "Open A",
			order: 2,
		});
		const openB = makeTab({
			key: "card:b",
			id: "b",
			title: "Open B",
			order: 3,
		});

		const next = moveSidebarTabByDropTarget(
			[root, pinned, openA, openB],
			openB.key,
			openA.key,
			"open",
			[],
			500,
		);

		expect(next.map((tab) => tab.key)).toEqual([
			root.key,
			pinned.key,
			openB.key,
			openA.key,
		]);
		expect(next.find((tab) => tab.key === pinned.key)?.pinned).toBe(true);
	});

	test("dragging into open with a full open set preserves the dragged tab", () => {
		const root = createRootTab(100);
		const dragged = makeTab({
			key: "card:pinned",
			id: "pinned",
			title: "Pinned",
			pinned: true,
			order: 1,
			lastActiveAt: 1,
			createdAt: 1,
			updatedAt: 1,
		});
		const tabs = [
			root,
			dragged,
			...Array.from({ length: 12 }, (_, index) =>
				makeTab({
					key: `card:${index}`,
					id: `card-${index}`,
					title: `Card ${index}`,
					order: index + 2,
					lastActiveAt: index + 10,
					createdAt: index + 10,
					updatedAt: index + 10,
				}),
			),
		];

		const next = moveSidebarTabByDropTarget(
			tabs,
			dragged.key,
			null,
			"open",
			["card:11"],
			500,
		);

		expect(next.some((tab) => tab.key === dragged.key)).toBe(true);
		expect(next.find((tab) => tab.key === dragged.key)?.pinned).toBe(false);
		expect(next.some((tab) => tab.key === "card:0")).toBe(false);
	});

	test("clearing open tabs removes all unpinned tabs and returns the pinned fallback", () => {
		const root = createRootTab(100);
		const pinned = makeTab({
			key: "card:pinned",
			id: "pinned",
			title: "Pinned",
			pinned: true,
			order: 1,
			lastActiveAt: 500,
		});
		const open = makeTab({
			key: "card:open",
			id: "open",
			title: "Open",
			order: 2,
			lastActiveAt: 400,
		});

		const result = clearUnpinnedSidebarTabs([root, pinned, open], 600);

		expect(result.tabs.map((tab) => tab.key)).toEqual([root.key, pinned.key]);
		expect(result.fallbackTab.key).toBe(pinned.key);
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
