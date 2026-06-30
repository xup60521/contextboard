import { useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { useQuery } from "convex/react";
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
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
	clearUnpinnedSidebarTabs,
	closeSidebarTab,
	enforceUnpinnedTabLimit,
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

export function SidebarTabsProvider({ children }: { children: ReactNode }) {
	const navigate = useNavigate();
	const params = useParams({ strict: false }) as {
		whiteboardId?: string;
		cardId?: string;
	};
	const { location } = useRouterState();
	const routeTab = useMemo(
		() =>
			getRouteSidebarTabIdentity({
				pathname: location.pathname,
				whiteboardId: (params.whiteboardId as string | undefined) ?? undefined,
				cardId: (params.cardId as string | undefined) ?? undefined,
			}),
		[location.pathname, params.cardId, params.whiteboardId],
	);

	const [tabs, setTabs] = useState<SidebarTab[]>(() => {
		if (typeof window === "undefined") {
			return readPersistedSidebarTabs(undefined);
		}

		return readPersistedSidebarTabs(window.localStorage);
	});
	const tabsRef = useRef(tabs);

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

		return [...ids].sort() as Id<"whiteboards">[];
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

		return [...ids].sort() as Id<"cards">[];
	}, [routeTab, tabs]);

	const sidebarData = useQuery(api.sidebar.get, {
		whiteboardIds: sidebarWhiteboardIds,
		cardIds: sidebarCardIds,
	});

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

	useEffect(() => {
		if (!routeTab) {
			return;
		}

		setTabs((current) =>
			openSidebarTab(current, {
				kind: routeTab.kind,
				id: routeTab.id,
			}),
		);
	}, [routeTab]);

	const whiteboardTitleById = useMemo(() => {
		if (!sidebarData) {
			return null;
		}

		return new Map(
			sidebarData.whiteboards.map((whiteboard) => [
				String(whiteboard._id),
				whiteboard.title,
			]),
		);
	}, [sidebarData]);

	const cardTitleById = useMemo(() => {
		if (!sidebarData) {
			return null;
		}

		return new Map(
			sidebarData.cards.map((card) => [String(card._id), card.title]),
		);
	}, [sidebarData]);

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
					void navigate({
						to: "/whiteboard",
						search: { focus: undefined },
					});
					return;
				}

				void navigate({
					to: "/whiteboard/$whiteboardId",
					params: { whiteboardId: tab.id },
					search: { focus: undefined },
				});
				return;
			}

			void navigate({
				to: "/cards/$cardId",
				params: { cardId: tab.id ?? "" },
			});
		},
		[navigate],
	);

	const closeTab = useCallback(
		(key: string) => {
			const current = tabsRef.current;
			const result = closeSidebarTab(current, key);
			setTabs(result.tabs);

			if (key === activeTabKey && result.fallbackTab.key !== key) {
				void navigateToTab(result.fallbackTab);
			}
		},
		[activeTabKey, navigateToTab],
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
			void navigateToTab(result.fallbackTab);
		}
	}, [activeTabKey, navigateToTab]);

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
