import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { RouteComponent } from "./index";

const navigateMock = vi.fn();
const usePaginatedQueryMock = vi.fn();
const useMutationMock = vi.fn();
const archiveCardsMock = vi.fn();
const previewDialogMock = vi.fn();
const deleteDialogMock = vi.fn();

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
	useMutation: (...args: unknown[]) => useMutationMock(...args),
	usePaginatedQuery: (...args: unknown[]) => usePaginatedQueryMock(...args),
}));

vi.mock("#/components/navigation/SidebarOpenButton", () => ({
	SidebarOpenButton: () => <button type="button">Sidebar</button>,
}));

vi.mock("#/components/search/CardPreviewDialog", () => ({
	CardPreviewDialog: (props: {
		cardId: string | null;
		currentWhiteboardId: string | null;
		onClose: () => void;
	}) => {
		previewDialogMock(props);
		return <div data-card-id={props.cardId ?? ""} data-testid="preview-dialog" />;
	},
}));

vi.mock("#/components/cards/DeleteCardDialog", () => ({
	DeleteCardDialog: (props: {
		open: boolean;
		cardCount?: number;
		onCancel: () => void;
		onConfirm: () => void;
	}) => {
		deleteDialogMock(props);
		if (!props.open) return null;

		return (
			<div data-count={String(props.cardCount ?? 1)} data-testid="delete-dialog">
				<button type="button" onClick={props.onConfirm}>
					Confirm delete
				</button>
				<button type="button" onClick={props.onCancel}>
					Cancel delete
				</button>
			</div>
		);
	},
}));

vi.mock("#/components/ui/context-menu", async () => {
	const React = await vi.importActual<typeof import("react")>("react");
	const ReactDOM = await vi.importActual<typeof import("react-dom")>("react-dom");
	const ContextMenuState = React.createContext<{
		open: boolean;
		setOpen: (open: boolean) => void;
	} | null>(null);

	const useContextMenuState = () => {
		const state = React.useContext(ContextMenuState);
		if (!state) {
			throw new Error("context-menu mock used outside provider");
		}

		return state;
	};

	return {
		ContextMenu: ({ children }: { children: React.ReactNode }) => {
			const [open, setOpen] = React.useState(false);
			return (
				<ContextMenuState.Provider value={{ open, setOpen }}>
					{children}
				</ContextMenuState.Provider>
			);
		},
		ContextMenuTrigger: ({
			children,
			asChild,
		}: {
			children: React.ReactNode;
			asChild?: boolean;
		}) => {
			const { setOpen } = useContextMenuState();
			if (!React.isValidElement(children)) {
				return asChild ? children : <>{children}</>;
			}

			const childProps = children.props as {
				onContextMenu?: (event: MouseEvent) => void;
			};

			return React.cloneElement(children, {
				onContextMenu: (event: MouseEvent) => {
					childProps.onContextMenu?.(event);
					setOpen(true);
				},
			});
		},
		ContextMenuContent: ({ children }: { children: React.ReactNode }) => {
			const { open } = useContextMenuState();
			if (!open) {
				return null;
			}

			return ReactDOM.createPortal(<div role="menu">{children}</div>, document.body);
		},
		ContextMenuItem: ({
			children,
			onSelect,
			disabled,
			className,
		}: {
			children: React.ReactNode;
			onSelect?: () => void;
			disabled?: boolean;
			className?: string;
		}) => {
			const { setOpen } = useContextMenuState();
			return (
				<button
					type="button"
					role="menuitem"
					disabled={disabled}
					className={className}
					onClick={() => {
						if (disabled) {
							return;
						}

						onSelect?.();
						setOpen(false);
					}}
				>
					{children}
				</button>
			);
		},
	};
});

function makeCard(overrides?: Partial<Record<string, unknown>>) {
	return {
		_id: "card-1",
		creationTime: 1,
		derivedTitle: "Alpha card",
		preview: "Alpha preview",
		placementCount: 0,
		...(overrides ?? {}),
	};
}

function setCardRects(
	rects: Array<{ left: number; top: number; right: number; bottom: number }>,
) {
	const tiles = Array.from(document.querySelectorAll("[data-card-tile='true']"));
	for (const [index, tile] of tiles.entries()) {
		const rect = rects[index];
		Object.defineProperty(tile, "getBoundingClientRect", {
			configurable: true,
			value: () => ({
				x: rect.left,
				y: rect.top,
				left: rect.left,
				top: rect.top,
				right: rect.right,
				bottom: rect.bottom,
				width: rect.right - rect.left,
				height: rect.bottom - rect.top,
				toJSON: () => rect,
			}),
		});
	}
}

describe("cards library", () => {
	beforeEach(() => {
		navigateMock.mockReset();
		usePaginatedQueryMock.mockReset();
		useMutationMock.mockReset();
		archiveCardsMock.mockReset();
		archiveCardsMock.mockResolvedValue(undefined);
		previewDialogMock.mockReset();
		deleteDialogMock.mockReset();
		useMutationMock.mockReturnValue(archiveCardsMock);
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

	test("shift-click toggles selection without opening preview", () => {
		usePaginatedQueryMock.mockReturnValue({
			status: "Idle",
			results: [makeCard()],
			loadMore: vi.fn(),
		});

		render(<RouteComponent />);

		const cardButton = screen.getByRole("button", { name: /alpha card/i });
		fireEvent.click(cardButton, { shiftKey: true });

		expect(cardButton.getAttribute("aria-pressed")).toBe("true");
		expect(cardButton.className).toContain("outline-1");
		expect(cardButton.className).toContain("outline-offset-2");
		expect(cardButton.className).toContain("outline-[var(--sea-ink)]");
		expect(screen.getByTestId("preview-dialog").getAttribute("data-card-id")).toBe("");

		fireEvent.click(cardButton, { shiftKey: true });
		expect(cardButton.getAttribute("aria-pressed")).toBe("false");
		expect(cardButton.className).not.toContain("outline-1");
		expect(cardButton.className).not.toContain("outline-offset-2");
		expect(cardButton.className).not.toContain("outline-[var(--sea-ink)]");
	});

	test("right-click on an unselected card selects only that card for delete", () => {
		usePaginatedQueryMock.mockReturnValue({
			status: "Idle",
			results: [
				makeCard(),
				makeCard({
					_id: "card-2",
					derivedTitle: "Beta card",
					preview: "Beta preview",
				}),
			],
			loadMore: vi.fn(),
		});

		render(<RouteComponent />);

		const alphaButton = screen.getByRole("button", { name: /alpha card/i });
		const betaButton = screen.getByRole("button", { name: /beta card/i });

		fireEvent.click(alphaButton, { shiftKey: true });
		expect(alphaButton.getAttribute("aria-pressed")).toBe("true");

		fireEvent.contextMenu(betaButton, { button: 2 });

		expect(alphaButton.getAttribute("aria-pressed")).toBe("false");
		expect(betaButton.getAttribute("aria-pressed")).toBe("true");

		fireEvent.click(screen.getByRole("menuitem", { name: /delete card/i }));
		expect(screen.getByTestId("delete-dialog").getAttribute("data-count")).toBe("1");
	});

	test("right-click on a selected card preserves the group and deletes all selected cards", async () => {
		usePaginatedQueryMock.mockReturnValue({
			status: "Idle",
			results: [
				makeCard(),
				makeCard({
					_id: "card-2",
					derivedTitle: "Beta card",
					preview: "Beta preview",
				}),
			],
			loadMore: vi.fn(),
		});

		render(<RouteComponent />);

		const alphaButton = screen.getByRole("button", { name: /alpha card/i });
		const betaButton = screen.getByRole("button", { name: /beta card/i });

		fireEvent.click(alphaButton);
		expect(screen.getByTestId("preview-dialog").getAttribute("data-card-id")).toBe(
			"card-1",
		);

		fireEvent.click(alphaButton, { shiftKey: true });
		fireEvent.click(betaButton, { shiftKey: true });
		fireEvent.contextMenu(betaButton, { button: 2 });

		expect(alphaButton.getAttribute("aria-pressed")).toBe("true");
		expect(betaButton.getAttribute("aria-pressed")).toBe("true");

		expect(
			screen.getByRole("menuitem", { name: /preview/i }).hasAttribute("disabled"),
		).toBe(true);
		expect(
			screen.getByRole("menuitem", { name: /fullscreen/i }).hasAttribute("disabled"),
		).toBe(true);

		fireEvent.click(screen.getByRole("menuitem", { name: /delete 2 cards/i }));
		fireEvent.click(screen.getByRole("button", { name: /confirm delete/i }));

		await waitFor(() => {
			expect(archiveCardsMock).toHaveBeenCalledWith({
				cardIds: ["card-1", "card-2"],
			});
		});
		await waitFor(() => {
			expect(screen.getByTestId("preview-dialog").getAttribute("data-card-id")).toBe(
				"",
			);
		});

		expect(alphaButton.getAttribute("aria-pressed")).toBe("false");
		expect(betaButton.getAttribute("aria-pressed")).toBe("false");
	});

	test("clears selection when toggling filters", () => {
		usePaginatedQueryMock.mockReturnValue({
			status: "Idle",
			results: [makeCard()],
			loadMore: vi.fn(),
		});

		render(<RouteComponent />);

		const cardButton = screen.getByRole("button", { name: /alpha card/i });
		fireEvent.click(cardButton, { shiftKey: true });
		expect(cardButton.getAttribute("aria-pressed")).toBe("true");

		fireEvent.click(screen.getByRole("button", { name: /orphan only/i }));
		expect(cardButton.getAttribute("aria-pressed")).toBe("false");
	});

	test("pressing a portaled context-menu item keeps the card selected", () => {
		usePaginatedQueryMock.mockReturnValue({
			status: "Idle",
			results: [
				makeCard(),
				makeCard({
					_id: "card-2",
					derivedTitle: "Beta card",
					preview: "Beta preview",
				}),
			],
			loadMore: vi.fn(),
		});

		render(<RouteComponent />);

		const alphaButton = screen.getByRole("button", { name: /alpha card/i });
		const betaButton = screen.getByRole("button", { name: /beta card/i });

		fireEvent.contextMenu(betaButton, { button: 2 });

		expect(alphaButton.getAttribute("aria-pressed")).toBe("false");
		expect(betaButton.getAttribute("aria-pressed")).toBe("true");

		const deleteItem = screen.getByRole("menuitem", { name: /delete card/i });

		fireEvent.pointerDown(deleteItem, {
			button: 0,
			isPrimary: true,
			pointerId: 1,
		});
		expect(betaButton.getAttribute("aria-pressed")).toBe("true");

		fireEvent.pointerUp(deleteItem, {
			button: 0,
			isPrimary: true,
			pointerId: 1,
		});
		expect(betaButton.getAttribute("aria-pressed")).toBe("true");
	});

	test("rectangle drag selects intersected cards and shift-drag toggles from the base selection", () => {
		usePaginatedQueryMock.mockReturnValue({
			status: "Idle",
			results: [
				makeCard(),
				makeCard({
					_id: "card-2",
					derivedTitle: "Beta card",
					preview: "Beta preview",
				}),
				makeCard({
					_id: "card-3",
					derivedTitle: "Gamma card",
					preview: "Gamma preview",
				}),
			],
			loadMore: vi.fn(),
		});

		render(<RouteComponent />);
		setCardRects([
			{ left: 10, top: 10, right: 110, bottom: 110 },
			{ left: 130, top: 10, right: 230, bottom: 110 },
			{ left: 250, top: 10, right: 350, bottom: 110 },
		]);

		const alphaButton = screen.getByRole("button", { name: /alpha card/i });
		const betaButton = screen.getByRole("button", { name: /beta card/i });
		const gammaButton = screen.getByRole("button", { name: /gamma card/i });
		const gridWrapper = screen.getByRole("list").parentElement;
		if (!gridWrapper) {
			throw new Error("expected grid wrapper");
		}

		fireEvent.pointerDown(gridWrapper, {
			button: 0,
			clientX: 0,
			clientY: 0,
			isPrimary: true,
			pointerId: 1,
		});
		fireEvent.pointerMove(gridWrapper, {
			clientX: 220,
			clientY: 120,
			isPrimary: true,
			pointerId: 1,
		});
		fireEvent.pointerUp(gridWrapper, {
			clientX: 220,
			clientY: 120,
			isPrimary: true,
			pointerId: 1,
		});

		expect(alphaButton.getAttribute("aria-pressed")).toBe("true");
		expect(betaButton.getAttribute("aria-pressed")).toBe("true");
		expect(gammaButton.getAttribute("aria-pressed")).toBe("false");

		fireEvent.pointerDown(gridWrapper, {
			button: 0,
			clientX: 0,
			clientY: 0,
			isPrimary: true,
			pointerId: 2,
			shiftKey: true,
		});
		fireEvent.pointerMove(gridWrapper, {
			clientX: 220,
			clientY: 120,
			isPrimary: true,
			pointerId: 2,
			shiftKey: true,
		});
		fireEvent.pointerUp(gridWrapper, {
			clientX: 220,
			clientY: 120,
			isPrimary: true,
			pointerId: 2,
			shiftKey: true,
		});

		expect(alphaButton.getAttribute("aria-pressed")).toBe("false");
		expect(betaButton.getAttribute("aria-pressed")).toBe("false");
		expect(gammaButton.getAttribute("aria-pressed")).toBe("false");
	});
});
