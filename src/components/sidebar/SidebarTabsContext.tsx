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
	pruneMissingWhiteboardTabs,
	readPersistedSidebarTabs,
	SIDEBAR_TABS_STORAGE_KEY,
	type SidebarTab,
	setSidebarTabPinned,
	syncActiveCardTabTitle,
	syncActiveWhiteboardTabTitle,
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

	const sidebarData = useQuery(api.sidebar.get, {
		activeCardId:
			routeTab?.kind === "card" ? (routeTab.id as Id<"cards">) : null,
	});
	const sidebarWhiteboards = sidebarData?.whiteboards;
	const activeCardTitle = sidebarData?.activeCardTitle;

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
		if (!sidebarWhiteboards) {
			return null;
		}

		return new Map(
			sidebarWhiteboards.map((whiteboard) => [
				String(whiteboard._id),
				whiteboard.title,
			]),
		);
	}, [sidebarWhiteboards]);

	useEffect(() => {
		if (sidebarWhiteboards === undefined) {
			return;
		}

		setTabs((current) =>
			pruneMissingWhiteboardTabs(current, whiteboardTitleById),
		);
	}, [sidebarWhiteboards, whiteboardTitleById]);

	useEffect(() => {
		if (routeTab?.kind !== "whiteboard" || routeTab.id === null) {
			return;
		}

		if (sidebarWhiteboards === undefined) {
			return;
		}

		setTabs((current) => {
			const whiteboardTab =
				current.find((tab) => tab.key === routeTab.key) ?? null;
			return syncActiveWhiteboardTabTitle(
				current,
				whiteboardTab,
				whiteboardTitleById?.get(routeTab.id) ?? null,
			);
		});
	}, [routeTab, sidebarWhiteboards, whiteboardTitleById]);

	useEffect(() => {
		if (routeTab?.kind !== "card") {
			return;
		}

		if (activeCardTitle === undefined) {
			return;
		}

		setTabs((current) => {
			const cardTab = current.find((tab) => tab.key === routeTab.key) ?? null;
			return syncActiveCardTabTitle(current, cardTab, activeCardTitle);
		});
	}, [activeCardTitle, routeTab]);

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
