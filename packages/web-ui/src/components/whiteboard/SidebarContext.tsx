import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";

type SidebarContextValue = {
	isOpen: boolean;
	open: () => void;
	close: () => void;
};

export const SidebarContext = createContext<SidebarContextValue | null>(null);

const SIDEBAR_OPEN_STORAGE_KEY = "contextboard:sidebar-open";

export function SidebarProvider({
	children,
	defaultOpen = false,
}: {
	children: ReactNode;
	defaultOpen?: boolean;
}) {
	// Built once per provider instance, not at module scope: the identity is
	// what isolates one mounted sidebar's persisted state from another's (tests
	// mounting several providers, or a future second sidebar), even though both
	// read through jotai's shared default store.
	const [sidebarOpenAtom] = useState(() =>
		atomWithStorage(SIDEBAR_OPEN_STORAGE_KEY, defaultOpen),
	);
	const [isOpen, setIsOpen] = useAtom(sidebarOpenAtom);

	const open = useCallback(() => {
		setIsOpen(true);
	}, [setIsOpen]);

	const close = useCallback(() => {
		setIsOpen(false);
	}, [setIsOpen]);

	const value = useMemo(
		() => ({
			isOpen,
			open,
			close,
		}),
		[close, isOpen, open],
	);

	return (
		<SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
	);
}

export function useSidebarContext() {
	const context = useContext(SidebarContext);

	if (!context) {
		throw new Error("useSidebarContext must be used within a SidebarProvider");
	}

	return context;
}
