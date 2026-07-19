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

export function SidebarProvider({ children }: { children: ReactNode }) {
	const [isOpen, setIsOpen] = useState(false);

	const open = useCallback(() => {
		setIsOpen(true);
	}, []);

	const close = useCallback(() => {
		setIsOpen(false);
	}, []);

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
