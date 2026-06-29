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
	closeSidebarTab,
	enforceUnpinnedTabLimit,
	getRouteSidebarTabIdentity,
	type OpenTabInput,
	openSidebarTab,
	persistableSidebarTabs,
	pruneMissingWhiteboardTabs,
	readPersistedSidebarTabs,
	SIDEBAR_TABS_STORAGE_KEY,
	type SidebarTab,
	setSidebarTabPinned,
	syncActiveCardTabTitle,
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

	const whiteboards = useQuery(api.whiteboards.listActive);
	const activeCard = useQuery(
		api.cards.get,
		routeTab?.kind === "card" ? { cardId: routeTab.id as Id<"cards"> } : "skip",
	);

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
		if (!whiteboards) {
			return null;
		}

		return new Map(
			whiteboards.map((whiteboard) => [
				String(whiteboard._id),
				whiteboard.title,
			]),
		);
	}, [whiteboards]);

	useEffect(() => {
		if (whiteboards === undefined) {
			return;
		}

		setTabs((current) =>
			pruneMissingWhiteboardTabs(current, whiteboardTitleById),
		);
	}, [whiteboardTitleById, whiteboards]);

	useEffect(() => {
		if (routeTab?.kind !== "card") {
			return;
		}

		if (activeCard === undefined) {
			return;
		}

		setTabs((current) => {
			const cardTab = current.find((tab) => tab.key === routeTab.key) ?? null;
			return syncActiveCardTabTitle(
				current,
				cardTab,
				activeCard ? activeCard.card.derivedTitle || "Untitled card" : null,
			);
		});
	}, [activeCard, routeTab]);

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
			setTabs((current) =>
				enforceUnpinnedTabLimit(
					setSidebarTabPinned(current, key, false),
					activeTabKey ?? key,
				),
			);
		},
		[activeTabKey],
	);

	const togglePinned = useCallback(
		(key: string) => {
			setTabs((current) => {
				const next = toggleSidebarTabPinned(current, key);
				const tab = next.find((item) => item.key === key);
				return tab?.pinned
					? next
					: enforceUnpinnedTabLimit(next, activeTabKey ?? key);
			});
		},
		[activeTabKey],
	);

	const reorderTabs = useCallback(
		(nextTabs: SidebarTab[]) => {
			setTabs(enforceUnpinnedTabLimit(nextTabs, activeTabKey ?? ""));
		},
		[activeTabKey],
	);

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
			navigateToTab,
		}),
		[
			activeTabKey,
			closeTab,
			navigateToTab,
			openTab,
			pinTab,
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
