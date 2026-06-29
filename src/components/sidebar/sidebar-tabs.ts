export type SidebarTabKind = "whiteboard" | "card";

export type SidebarTab = {
	key: string;
	kind: SidebarTabKind;
	id: string | null;
	title: string;
	pinned: boolean;
	order: number;
	lastActiveAt: number;
	createdAt: number;
	updatedAt: number;
};

export type PersistedSidebarTabs = {
	version: 1;
	updatedAt: number;
	tabs: SidebarTab[];
};

export type OpenTabInput = {
	kind: SidebarTabKind;
	id: string | null;
	title?: string;
	pinned?: boolean;
	now?: number;
};

export const SIDEBAR_TABS_STORAGE_KEY = "contextboard.sidebarTabs.v1";
export const MAX_UNPINNED_TABS = 12;

export function whiteboardTabKey(id: string | null) {
	return id === null ? "whiteboard:root" : `whiteboard:${id}`;
}

export function cardTabKey(id: string) {
	return `card:${id}`;
}

export function createRootTab(now = Date.now()): SidebarTab {
	return {
		key: whiteboardTabKey(null),
		kind: "whiteboard",
		id: null,
		title: "Root whiteboard",
		pinned: true,
		order: 0,
		lastActiveAt: now,
		createdAt: now,
		updatedAt: now,
	};
}

export function isRootTab(tab: SidebarTab) {
	return tab.key === whiteboardTabKey(null);
}

export function getSidebarTabKey(kind: SidebarTabKind, id: string | null) {
	if (kind === "whiteboard") {
		return whiteboardTabKey(id);
	}

	if (id === null) {
		throw new Error("Card tabs require an id");
	}

	return cardTabKey(id);
}

export function getDefaultTabTitle(kind: SidebarTabKind, id: string | null) {
	if (kind === "whiteboard") {
		return id === null ? "Root whiteboard" : "Whiteboard";
	}

	return "Card";
}

export function ensureRootTab(tabs: SidebarTab[], now = Date.now()) {
	const rootIndex = tabs.findIndex(isRootTab);
	if (rootIndex >= 0) {
		return tabs.map((tab) =>
			isRootTab(tab)
				? {
						...tab,
						kind: "whiteboard",
						id: null,
						title: "Root whiteboard",
						pinned: true,
						order: 0,
					}
				: tab,
		);
	}

	return [createRootTab(now), ...tabs];
}

export function normalizeOrders(tabs: SidebarTab[]) {
	const root = tabs.find(isRootTab) ?? createRootTab();
	const rest = tabs
		.filter((tab) => !isRootTab(tab))
		.toSorted((a, b) => {
			if (a.order !== b.order) return a.order - b.order;
			if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
			return a.lastActiveAt - b.lastActiveAt;
		})
		.map((tab, i) => ({ ...tab, order: i + 1 }));

	return [{ ...root, pinned: true, order: 0 }, ...rest];
}

export function sortTabsForDisplay(tabs: SidebarTab[]) {
	const root = tabs.find(isRootTab) ?? createRootTab();
	const rest = tabs
		.filter((tab) => !isRootTab(tab))
		.toSorted((a, b) => a.order - b.order);
	return [{ ...root, pinned: true, order: 0 }, ...rest];
}

export function readPersistedSidebarTabs(
	storage: Storage | undefined,
	now = Date.now(),
): SidebarTab[] {
	if (!storage) {
		return [createRootTab(now)];
	}

	try {
		const raw = storage.getItem(SIDEBAR_TABS_STORAGE_KEY);
		if (!raw) {
			return [createRootTab(now)];
		}

		const parsed = JSON.parse(raw) as Partial<PersistedSidebarTabs>;
		if (parsed.version !== 1 || !Array.isArray(parsed.tabs)) {
			return [createRootTab(now)];
		}

		return normalizeTabs(parsed.tabs, now);
	} catch {
		return [createRootTab(now)];
	}
}

export function persistableSidebarTabs(
	tabs: SidebarTab[],
): PersistedSidebarTabs {
	return {
		version: 1,
		updatedAt: Date.now(),
		tabs: normalizeTabs(tabs),
	};
}

export function normalizeTabs(tabs: SidebarTab[], now = Date.now()) {
	const byKey = new Map<string, SidebarTab>();
	for (const tab of tabs) {
		if (!tab || typeof tab !== "object" || typeof tab.key !== "string") {
			continue;
		}

		if (byKey.has(tab.key)) {
			continue;
		}

		if (tab.kind !== "whiteboard" && tab.kind !== "card") {
			continue;
		}

		if (tab.key === whiteboardTabKey(null)) {
			byKey.set(tab.key, {
				...tab,
				kind: "whiteboard",
				id: null,
				title: "Root whiteboard",
				pinned: true,
				order: 0,
				lastActiveAt: Number.isFinite(tab.lastActiveAt)
					? tab.lastActiveAt
					: now,
				createdAt: Number.isFinite(tab.createdAt) ? tab.createdAt : now,
				updatedAt: Number.isFinite(tab.updatedAt) ? tab.updatedAt : now,
			});
			continue;
		}

		if (tab.kind === "whiteboard" && typeof tab.id !== "string") {
			continue;
		}

		if (tab.kind === "card" && typeof tab.id !== "string") {
			continue;
		}

		byKey.set(tab.key, {
			...tab,
			id: tab.id,
			title:
				typeof tab.title === "string" && tab.title.trim().length > 0
					? tab.title
					: getDefaultTabTitle(tab.kind, tab.id),
			pinned: !!tab.pinned,
			order: Number.isFinite(tab.order) ? tab.order : 0,
			lastActiveAt: Number.isFinite(tab.lastActiveAt) ? tab.lastActiveAt : now,
			createdAt: Number.isFinite(tab.createdAt) ? tab.createdAt : now,
			updatedAt: Number.isFinite(tab.updatedAt) ? tab.updatedAt : now,
		});
	}

	const normalized = ensureRootTab([...byKey.values()], now);
	return normalizeOrders(normalized);
}

export function openSidebarTab(
	tabs: SidebarTab[],
	input: OpenTabInput,
): SidebarTab[] {
	const now = input.now ?? Date.now();
	const key = getSidebarTabKey(input.kind, input.id);
	const existing = tabs.find((tab) => tab.key === key);
	const trimmedTitle = input.title?.trim() ?? "";
	const fallbackTitle =
		trimmedTitle.length > 0
			? trimmedTitle
			: getDefaultTabTitle(input.kind, input.id);

	const next = existing
		? tabs.map((tab) =>
				tab.key !== key
					? tab
					: {
							...tab,
							title: isRootTab(tab)
								? "Root whiteboard"
								: trimmedTitle.length > 0
									? trimmedTitle
									: tab.title,
							lastActiveAt: now,
							updatedAt: now,
							pinned: isRootTab(tab) ? true : tab.pinned,
						},
			)
		: [
				...tabs,
				{
					key,
					kind: input.kind,
					id: input.id,
					title: fallbackTitle,
					pinned: key === whiteboardTabKey(null) ? true : !!input.pinned,
					order:
						key === whiteboardTabKey(null)
							? 0
							: tabs.filter((tab) => !isRootTab(tab)).length + 1,
					lastActiveAt: now,
					createdAt: now,
					updatedAt: now,
				},
			];

	return enforceUnpinnedTabLimit(normalizeTabs(next, now), key);
}

export function updateSidebarTabTitle(
	tabs: SidebarTab[],
	key: string,
	title: string,
	now = Date.now(),
) {
	const nextTitle = title.trim();

	return normalizeTabs(
		tabs.map((tab) =>
			tab.key !== key
				? tab
				: {
						...tab,
						title: nextTitle.length > 0 ? nextTitle : tab.title,
						updatedAt: now,
					},
		),
		now,
	);
}

export function setSidebarTabPinned(
	tabs: SidebarTab[],
	key: string,
	pinned: boolean,
	now = Date.now(),
) {
	const next = tabs.map((tab) =>
		tab.key !== key || isRootTab(tab)
			? tab
			: {
					...tab,
					pinned,
					updatedAt: now,
				},
	);

	return normalizeTabs(next, now);
}

export function toggleSidebarTabPinned(
	tabs: SidebarTab[],
	key: string,
	now = Date.now(),
) {
	const tab = tabs.find((item) => item.key === key);
	if (!tab || isRootTab(tab)) {
		return normalizeTabs(tabs, now);
	}

	return setSidebarTabPinned(tabs, key, !tab.pinned, now);
}

export function closeSidebarTab(tabs: SidebarTab[], key: string) {
	const root = tabs.find(isRootTab) ?? createRootTab();
	if (key === root.key) {
		return {
			tabs: normalizeTabs(tabs),
			fallbackTab: root,
		};
	}

	const remaining = normalizeTabs(tabs.filter((tab) => tab.key !== key));
	const fallbackTab = getMostRecentlyActiveTab(remaining) ?? root;

	return {
		tabs: remaining,
		fallbackTab,
	};
}

export function getMostRecentlyActiveTab(tabs: SidebarTab[]) {
	return (
		tabs.toSorted((left, right) => {
			if (left.lastActiveAt !== right.lastActiveAt) {
				return right.lastActiveAt - left.lastActiveAt;
			}

			if (left.pinned !== right.pinned) {
				return left.pinned ? -1 : 1;
			}

			return left.order - right.order;
		})[0] ?? null
	);
}

export function enforceUnpinnedTabLimit(
	tabs: SidebarTab[],
	activeTabKey: string,
	now = Date.now(),
) {
	const normalized = normalizeTabs(tabs, now);
	let openTabs = normalized.filter((tab) => !tab.pinned && !isRootTab(tab));
	if (openTabs.length <= MAX_UNPINNED_TABS) {
		return normalized;
	}

	const victims = new Set<string>();
	while (openTabs.length > MAX_UNPINNED_TABS) {
		const candidate = openTabs
			.filter((tab) => tab.key !== activeTabKey)
			.toSorted((left, right) => {
				if (left.lastActiveAt !== right.lastActiveAt) {
					return left.lastActiveAt - right.lastActiveAt;
				}

				if (left.updatedAt !== right.updatedAt) {
					return left.updatedAt - right.updatedAt;
				}

				return left.createdAt - right.createdAt;
			})[0];

		if (!candidate) {
			break;
		}

		victims.add(candidate.key);
		openTabs = openTabs.filter((tab) => tab.key !== candidate.key);
	}

	if (victims.size === 0) {
		return normalized;
	}

	return normalizeTabs(
		normalized.filter((tab) => !victims.has(tab.key)),
		now,
	);
}

export function pruneMissingWhiteboardTabs(
	tabs: SidebarTab[],
	whiteboardTitleById: ReadonlyMap<string, string> | null | undefined,
	now = Date.now(),
) {
	if (!whiteboardTitleById) {
		return normalizeTabs(tabs, now);
	}

	const next = tabs.flatMap((tab) => {
		if (isRootTab(tab) || tab.kind !== "whiteboard" || tab.id === null) {
			return [tab];
		}

		const title = whiteboardTitleById.get(tab.id);
		if (!title) {
			return tab.pinned
				? [
						{
							...tab,
							title: "Missing whiteboard",
							updatedAt: now,
						},
					]
				: [];
		}

		return [
			{
				...tab,
				title,
				updatedAt: tab.title === title ? tab.updatedAt : now,
			},
		];
	});

	return normalizeTabs(next, now);
}

export function syncActiveCardTabTitle(
	tabs: SidebarTab[],
	cardTab: SidebarTab | null,
	title: string | null,
	now = Date.now(),
) {
	if (!cardTab) {
		return normalizeTabs(tabs, now);
	}

	if (title === null) {
		return updateSidebarTabTitle(tabs, cardTab.key, "Card not found", now);
	}

	return updateSidebarTabTitle(tabs, cardTab.key, title, now);
}

export function getRouteSidebarTabIdentity(args: {
	pathname: string;
	whiteboardId: string | null | undefined;
	cardId: string | null | undefined;
}) {
	const { pathname, whiteboardId, cardId } = args;

	if (pathname === "/whiteboard") {
		return {
			key: whiteboardTabKey(null),
			kind: "whiteboard" as const,
			id: null,
		};
	}

	if (whiteboardId) {
		return {
			key: whiteboardTabKey(whiteboardId),
			kind: "whiteboard" as const,
			id: whiteboardId,
		};
	}

	if (
		cardId &&
		pathname.startsWith("/cards/") &&
		pathname !== "/cards/orphans"
	) {
		return {
			key: cardTabKey(cardId),
			kind: "card" as const,
			id: cardId,
		};
	}

	return null;
}

export function isCardLibraryRoute(pathname: string) {
	return (
		pathname === "/cards" ||
		pathname === "/cards/" ||
		pathname === "/cards/orphans"
	);
}

export function getCloseFallbackTab(tabs: SidebarTab[]) {
	return getMostRecentlyActiveTab(tabs) ?? createRootTab();
}

export function moveSidebarTab(
	tabs: SidebarTab[],
	activeKey: string,
	overId?: string | null,
	now = Date.now(),
) {
	const normalized = normalizeTabs(tabs, now);
	const activeTab = normalized.find((tab) => tab.key === activeKey);
	if (!activeTab || isRootTab(activeTab)) return normalized;
	if (!overId || overId === activeKey) return normalized;

	const withoutActive = normalized.filter((tab) => tab.key !== activeKey);
	const overIndex = withoutActive.findIndex((tab) => tab.key === overId);
	if (overIndex < 0) return normalized;

	// Never insert before the root (index 0)
	const insertAt = Math.max(1, overIndex);
	withoutActive.splice(insertAt, 0, activeTab);

	// Reassign order by position so normalizeOrders preserves this arrangement
	const reordered = withoutActive.map((tab, i) => ({
		...tab,
		order: isRootTab(tab) ? 0 : i,
	}));

	return enforceUnpinnedTabLimit(normalizeTabs(reordered, now), activeKey, now);
}
