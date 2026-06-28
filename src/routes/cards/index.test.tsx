import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { RouteComponent } from "./index";

const navigateMock = vi.fn();
const usePaginatedQueryMock = vi.fn();

let currentSearch = {
	orphan: "",
	sort: "created" as const,
};

vi.mock("@tanstack/react-pacer", () => ({
	useDebouncedValue: (value: string) => [value, value] as const,
}));

vi.mock("@tanstack/react-router", () => ({
	createFileRoute:
		() =>
		(config: {
			component: unknown;
			validateSearch?: (search: Record<string, unknown>) => unknown;
		}) => ({
			...config,
			useNavigate: () => navigateMock,
			useSearch: () => currentSearch,
		}),
}));

vi.mock("convex/react", () => ({
	useMutation: () => vi.fn(),
	usePaginatedQuery: (...args: unknown[]) => usePaginatedQueryMock(...args),
}));

vi.mock("#/components/navigation/SidebarOpenButton", () => ({
	SidebarOpenButton: () => <button type="button">Sidebar</button>,
}));

vi.mock("#/components/search/CardPreviewDialog", () => ({
	CardPreviewDialog: () => null,
}));

vi.mock("#/components/cards/DeleteCardDialog", () => ({
	DeleteCardDialog: () => null,
}));

vi.mock("#/components/ui/context-menu", () => ({
	ContextMenu: ({ children }: { children: React.ReactNode }) => children,
	ContextMenuTrigger: ({
		children,
		asChild,
	}: { children: React.ReactNode; asChild?: boolean }) =>
		asChild ? children : <>{children}</>,
	ContextMenuContent: () => null,
	ContextMenuItem: ({
		children,
		onSelect,
	}: { children: React.ReactNode; onSelect?: () => void }) => null,
}));

describe("cards library sorting", () => {
	beforeEach(() => {
		navigateMock.mockReset();
		usePaginatedQueryMock.mockReset();
		currentSearch = {
			orphan: "",
			sort: "created",
		};
		usePaginatedQueryMock.mockReturnValue({
			status: "CanLoadMore",
			results: [],
			loadMore: vi.fn(),
		});
	});

	afterEach(() => {
		cleanup();
	});

	test("passes the selected sort into the query and updates the URL when changed", () => {
		render(<RouteComponent />);

		expect(usePaginatedQueryMock).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				sortBy: "created",
			}),
			expect.objectContaining({
				initialNumItems: 50,
			}),
		);

		const trigger = screen.getByRole("button", {
			name: /sort cards by newest first/i,
		});
		fireEvent.pointerDown(trigger, { button: 0 });

		const titleItem = screen.getByRole("menuitemradio", {
			name: /title a-z/i,
		});
		fireEvent.click(titleItem);

		expect(navigateMock).toHaveBeenCalledTimes(1);
		const navigateOptions = navigateMock.mock.calls[0][0] as {
			search: (search: typeof currentSearch) => typeof currentSearch;
		};
		expect(navigateOptions.search(currentSearch)).toEqual({
			orphan: "",
			sort: "title",
		});
	});

	test("keeps the active sort visible and preserves it when toggling orphans", () => {
		currentSearch = {
			orphan: "",
			sort: "updated_asc",
		};

		render(<RouteComponent />);

		expect(
			screen.getByRole("button", {
				name: /sort cards by least recently updated/i,
			}),
		).not.toBeNull();

		fireEvent.pointerDown(
			screen.getByRole("button", {
				name: /sort cards by least recently updated/i,
			}),
			{ button: 0 },
		);

		const activeItem = screen.getByRole("menuitemradio", {
			name: /least recently updated/i,
		});
		expect(activeItem.getAttribute("aria-checked")).toBe("true");

		fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });

		fireEvent.click(screen.getByRole("button", { name: /orphan only/i }));

		expect(navigateMock).toHaveBeenCalledTimes(1);
		const navigateOptions = navigateMock.mock.calls[0][0] as {
			search: (search: typeof currentSearch) => typeof currentSearch;
		};
		expect(navigateOptions.search(currentSearch)).toEqual({
			orphan: "true",
			sort: "updated_asc",
		});
	});
});
