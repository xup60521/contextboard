import { useApplicationRuntime } from "@contextboard/application";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	clearUnpinnedSidebarTabs,
	closeSidebarTab,
	enforceUnpinnedTabLimit,
	getCloseFallbackTab,
	getRouteSidebarTabIdentity,
	isRootTab,
	type OpenTabInput,
	openSidebarTab,
	persistableSidebarTabs,
	pruneMissingCardTabs,
	pruneMissingWhiteboardTabs,
	readPersistedSidebarTabs,
	SIDEBAR_TABS_STORAGE_KEY,
	type SidebarTab,
	setSidebarTabPinned,
	toggleSidebarTabPinned,
} from "./sidebar-tabs";

export type SidebarTabsContextValue = {
	tabs: SidebarTab[];
	activeTabKey: string | null;
	openTab: (input: OpenTabInput) => void;
	closeTab: (key: string) => void;
	pinTab: (key: string) => void;
	unpinTab: (key: string) => void;
	togglePinned: (key: string) => void;
	reorderTabs: (nextTabs: SidebarTab[]) => void;
	clearOpenTabs: () => void;
	navigateToTab: (tab: SidebarTab) => void;
};

export const SidebarTabsContext = createContext<SidebarTabsContextValue | null>(
	null,
);

export type SidebarRouteState = {
	pathname: string;
	whiteboardId?: string;
	cardId?: string;
};

export function SidebarTabsProvider({
	children,
	route,
}: {
	children: ReactNode;
	route: SidebarRouteState;
}) {
	const runtime = useApplicationRuntime();
	const routeTab = useMemo(
		() =>
			getRouteSidebarTabIdentity({
				pathname: route.pathname,
				whiteboardId: route.whiteboardId,
				cardId: route.cardId,
			}),
		[route.cardId, route.pathname, route.whiteboardId],
	);

	const [tabs, setTabs] = useState<SidebarTab[]>(() => {
		if (typeof window === "undefined") {
			return readPersistedSidebarTabs(undefined);
		}

		return readPersistedSidebarTabs(window.localStorage);
	});
	const tabsRef = useRef(tabs);
	const pendingCloseTabKeyRef = useRef<string | null>(null);
	const suppressedRouteTabKeyRef = useRef<string | null>(null);

	const sidebarWhiteboardIds = useMemo(() => {
		const ids = new Set<string>();

		for (const tab of tabs) {
			if (tab.kind === "whiteboard" && tab.id !== null) {
				ids.add(tab.id);
			}
		}

		if (routeTab?.kind === "whiteboard" && routeTab.id !== null) {
			ids.add(routeTab.id);
		}

		return [...ids].sort();
	}, [routeTab, tabs]);

	const sidebarCardIds = useMemo(() => {
		const ids = new Set<string>();

		for (const tab of tabs) {
			if (tab.kind === "card" && tab.id !== null) {
				ids.add(tab.id);
			}
		}

		if (routeTab?.kind === "card" && routeTab.id !== null) {
			ids.add(routeTab.id);
		}

		return [...ids].sort();
	}, [routeTab, tabs]);

	const [sidebarData, setSidebarData] = useState<{
		whiteboards: Array<{ id: string; title: string }>;
		cards: Array<{ id: string; title: string }>;
	} | null>(null);

	useEffect(() => {
		let active = true;
		const load = async () => {
			const [whiteboards, cards] = await Promise.all([
				runtime.whiteboards?.list() ?? Promise.resolve([]),
				runtime.cards.list(),
			]);
			if (!active) return;
			const wantedWhiteboards = new Set(sidebarWhiteboardIds);
			const wantedCards = new Set(sidebarCardIds);
			setSidebarData({
				whiteboards: whiteboards
					.filter((item) => wantedWhiteboards.has(item.id))
					.map(({ id, title }) => ({ id, title })),
				cards: cards
					.filter((item) => wantedCards.has(item.id))
					.map(({ id, title }) => ({ id, title })),
			});
		};
		void load();
		const unsubCards = runtime.cards.subscribe(() => void load());
		const unsubWhiteboards = runtime.whiteboards?.subscribe(() => void load());
		return () => {
			active = false;
			unsubCards();
			unsubWhiteboards?.();
		};
	}, [
		runtime.cards,
		runtime.whiteboards,
		sidebarCardIds,
		sidebarWhiteboardIds,
	]);

	useEffect(() => {
		tabsRef.current = tabs;
	}, [tabs]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		try {
			window.localStorage.setItem(
				SIDEBAR_TABS_STORAGE_KEY,
				JSON.stringify(persistableSidebarTabs(tabs)),
			);
		} catch {
			// Ignore storage quota or privacy-mode failures. The in-memory state is
			// still authoritative for this session.
		}
	}, [tabs]);

	const whiteboardTitleById = useMemo(() => {
		if (!sidebarData) {
			return null;
		}

		return new Map<string, string>(
			sidebarData.whiteboards.map((whiteboard) => [
				whiteboard.id,
				whiteboard.title,
			]),
		);
	}, [sidebarData]);

	const cardTitleById = useMemo(() => {
		if (!sidebarData) {
			return null;
		}

		return new Map<string, string>(
			sidebarData.cards.map((card) => [card.id, card.title]),
		);
	}, [sidebarData]);

	const routeTabTitle = useMemo<string | undefined>(() => {
		if (!routeTab) {
			return undefined;
		}

		if (routeTab.kind === "whiteboard") {
			return routeTab.id ? whiteboardTitleById?.get(routeTab.id) : undefined;
		}

		return routeTab.id ? cardTitleById?.get(routeTab.id) : undefined;
	}, [cardTitleById, routeTab, whiteboardTitleById]);

	useEffect(() => {
		if (!routeTab) {
			suppressedRouteTabKeyRef.current = null;
			return;
		}

		if (suppressedRouteTabKeyRef.current === routeTab.key) {
			return;
		}

		suppressedRouteTabKeyRef.current = null;

		setTabs((current) =>
			openSidebarTab(current, {
				kind: routeTab.kind,
				id: routeTab.id,
				title: routeTabTitle,
			}),
		);
	}, [routeTab, routeTabTitle]);

	useEffect(() => {
		if (!sidebarData) {
			return;
		}

		setTabs((current) => {
			const next = pruneMissingWhiteboardTabs(current, whiteboardTitleById);
			return pruneMissingCardTabs(next, cardTitleById);
		});
	}, [cardTitleById, sidebarData, whiteboardTitleById]);

	const activeTabKey = routeTab?.key ?? null;

	const openTab = useCallback((input: OpenTabInput) => {
		setTabs((current) => openSidebarTab(current, input));
	}, []);

	const navigateToTab = useCallback(
		(tab: SidebarTab) => {
			if (tab.kind === "whiteboard") {
				if (tab.id === null) {
					runtime.navigation.navigate(runtime.navigation.rootWhiteboardHref());
					return;
				}

				runtime.navigation.navigate(runtime.navigation.whiteboardHref(tab.id));
				return;
			}

			runtime.navigation.navigate(runtime.navigation.cardHref(tab.id ?? ""));
		},
		[runtime.navigation],
	);

	const closeTab = useCallback(
		(key: string) => {
			if (key === activeTabKey) {
				pendingCloseTabKeyRef.current = key;
				suppressedRouteTabKeyRef.current = key;
			}

			setTabs((current) => closeSidebarTab(current, key).tabs);
		},
		[activeTabKey],
	);

	const pinTab = useCallback((key: string) => {
		setTabs((current) => setSidebarTabPinned(current, key, true));
	}, []);

	const unpinTab = useCallback(
		(key: string) => {
			const protectedTabKeys = [activeTabKey, key].filter(
				(tabKey): tabKey is string => tabKey !== null,
			);
			setTabs((current) =>
				enforceUnpinnedTabLimit(
					setSidebarTabPinned(current, key, false),
					protectedTabKeys,
				),
			);
		},
		[activeTabKey],
	);

	const togglePinned = useCallback(
		(key: string) => {
			const protectedTabKeys = [activeTabKey, key].filter(
				(tabKey): tabKey is string => tabKey !== null,
			);
			setTabs((current) => {
				const next = toggleSidebarTabPinned(current, key);
				const tab = next.find((item) => item.key === key);
				return tab?.pinned
					? next
					: enforceUnpinnedTabLimit(next, protectedTabKeys);
			});
		},
		[activeTabKey],
	);

	const reorderTabs = useCallback((nextTabs: SidebarTab[]) => {
		setTabs(nextTabs);
	}, []);

	const clearOpenTabs = useCallback(() => {
		const current = tabsRef.current;
		const activeTab = activeTabKey
			? (current.find((tab) => tab.key === activeTabKey) ?? null)
			: null;
		const result = clearUnpinnedSidebarTabs(current);
		setTabs(result.tabs);

		if (activeTab && !activeTab.pinned && !isRootTab(activeTab)) {
			suppressedRouteTabKeyRef.current = activeTab.key;
			void navigateToTab(result.fallbackTab);
		}
	}, [activeTabKey, navigateToTab]);

	useEffect(() => {
		const pendingCloseTabKey = pendingCloseTabKeyRef.current;
		if (!pendingCloseTabKey) {
			return;
		}

		if (tabs.some((tab) => tab.key === pendingCloseTabKey)) {
			return;
		}

		pendingCloseTabKeyRef.current = null;
		void navigateToTab(getCloseFallbackTab(tabs));
	}, [navigateToTab, tabs]);

	const value = useMemo<SidebarTabsContextValue>(
		() => ({
			tabs,
			activeTabKey,
			openTab,
			closeTab,
			pinTab,
			unpinTab,
			togglePinned,
			reorderTabs,
			clearOpenTabs,
			navigateToTab,
		}),
		[
			activeTabKey,
			closeTab,
			navigateToTab,
			openTab,
			pinTab,
			clearOpenTabs,
			reorderTabs,
			tabs,
			togglePinned,
			unpinTab,
		],
	);

	return (
		<SidebarTabsContext.Provider value={value}>
			{children}
		</SidebarTabsContext.Provider>
	);
}

export function useSidebarTabs() {
	const context = useContext(SidebarTabsContext);

	if (!context) {
		throw new Error("useSidebarTabs must be used within a SidebarTabsProvider");
	}

	return context;
}
