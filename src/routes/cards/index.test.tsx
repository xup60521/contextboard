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
const appendToWhiteboardMock = vi.fn();
const previewDialogMock = vi.fn();
const deleteDialogMock = vi.fn();
const whiteboardPickerDialogMock = vi.fn();

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
		return (
			<div data-card-id={props.cardId ?? ""} data-testid="preview-dialog" />
		);
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
			<div
				data-count={String(props.cardCount ?? 1)}
				data-testid="delete-dialog"
			>
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

vi.mock("#/components/whiteboard/WhiteboardPickerDialog", () => ({
	WhiteboardPickerDialog: (props: {
		open: boolean;
		onOpenChange: (open: boolean) => void;
		onSelect: (whiteboardId: string) => void;
		title?: string;
	}) => {
		whiteboardPickerDialogMock(props);

		if (!props.open) return null;

		return (
			<div data-testid="whiteboard-picker">
				<button
					type="button"
					onClick={() => props.onSelect("whiteboard-1")}
				>
					Pick History board
				</button>
				<button type="button" onClick={() => props.onOpenChange(false)}>
					Close picker
				</button>
			</div>
		);
	},
}));

vi.mock("#/components/ui/context-menu", async () => {
	const React = await vi.importActual<typeof import("react")>("react");
	const ReactDOM =
		await vi.importActual<typeof import("react-dom")>("react-dom");
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
		}: {
			children: React.ReactNode;
			asChild?: boolean;
		}) => {
			const { setOpen } = useContextMenuState();
			if (!React.isValidElement(children)) {
				return children;
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

			return ReactDOM.createPortal(
				<div role="menu">{children}</div>,
				document.body,
			);
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
	const tiles = Array.from(
		document.querySelectorAll("[data-card-tile='true']"),
	);
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
		appendToWhiteboardMock.mockReset();
		appendToWhiteboardMock.mockResolvedValue({
			itemId: "item-1",
			whiteboardId: "whiteboard-1",
			shapeId: "shape:card-card-1",
			created: true,
		});
		previewDialogMock.mockReset();
		deleteDialogMock.mockReset();
		whiteboardPickerDialogMock.mockReset();
		useMutationMock.mockImplementation(() => {
			return useMutationMock.mock.calls.length % 2 === 0
				? appendToWhiteboardMock
				: archiveCardsMock;
		});
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

	test("shift pointer-down toggles selection synchronously and suppresses the generated click", () => {
		usePaginatedQueryMock.mockReturnValue({
			status: "Idle",
			results: [makeCard()],
			loadMore: vi.fn(),
		});

		render(<RouteComponent />);

		const cardButton = screen.getByRole("button", { name: /alpha card/i });
		fireEvent.pointerDown(cardButton, {
			button: 0,
			isPrimary: true,
			pointerId: 1,
			shiftKey: true,
		});

		expect(cardButton.getAttribute("aria-pressed")).toBe("true");
		expect(cardButton.className).toContain("outline-1");
		expect(cardButton.className).toContain("outline-offset-2");
		expect(cardButton.className).toContain("outline-[var(--sea-ink)]");
		expect(cardButton.className).toContain("focus:outline-none");
		expect(cardButton.className).toContain("focus-visible:ring-2");
		expect(cardButton.className).toContain(
			"focus-visible:ring-[var(--lagoon)]",
		);
		expect(
			screen.getByTestId("preview-dialog").getAttribute("data-card-id"),
		).toBe("");

		fireEvent.click(cardButton, { detail: 1, shiftKey: true });
		expect(cardButton.getAttribute("aria-pressed")).toBe("true");
		expect(
			screen.getByTestId("preview-dialog").getAttribute("data-card-id"),
		).toBe("");

		fireEvent.pointerDown(cardButton, {
			button: 0,
			isPrimary: true,
			pointerId: 2,
			shiftKey: true,
		});
		expect(cardButton.getAttribute("aria-pressed")).toBe("false");
		expect(cardButton.className).not.toContain("outline-1");
		expect(cardButton.className).not.toContain("outline-offset-2");
		expect(cardButton.className).not.toContain("outline-[var(--sea-ink)]");
	});

	test("shift pointer-down still suppresses preview if shift is released before click", () => {
		usePaginatedQueryMock.mockReturnValue({
			status: "Idle",
			results: [makeCard()],
			loadMore: vi.fn(),
		});

		render(<RouteComponent />);

		const cardButton = screen.getByRole("button", { name: /alpha card/i });
		fireEvent.pointerDown(cardButton, {
			button: 0,
			isPrimary: true,
			pointerId: 1,
			shiftKey: true,
		});

		expect(cardButton.getAttribute("aria-pressed")).toBe("true");
		expect(cardButton.className).toContain("outline-1");

		fireEvent.click(cardButton, { detail: 1, shiftKey: false });

		expect(cardButton.getAttribute("aria-pressed")).toBe("true");
		expect(cardButton.className).toContain("outline-1");
		expect(
			screen.getByTestId("preview-dialog").getAttribute("data-card-id"),
		).toBe("");
	});

	test("shift click without a preceding pointer event toggles selection without opening preview", () => {
		usePaginatedQueryMock.mockReturnValue({
			status: "Idle",
			results: [makeCard()],
			loadMore: vi.fn(),
		});

		render(<RouteComponent />);

		const cardButton = screen.getByRole("button", { name: /alpha card/i });
		fireEvent.click(cardButton, { detail: 0, shiftKey: true });

		expect(cardButton.getAttribute("aria-pressed")).toBe("true");
		expect(cardButton.className).toContain("outline-1");
		expect(
			screen.getByTestId("preview-dialog").getAttribute("data-card-id"),
		).toBe("");
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
		expect(screen.getByTestId("delete-dialog").getAttribute("data-count")).toBe(
			"1",
		);
	});

	test("right-click append opens the whiteboard picker for a single card", () => {
		usePaginatedQueryMock.mockReturnValue({
			status: "Idle",
			results: [makeCard()],
			loadMore: vi.fn(),
		});

		render(<RouteComponent />);

		const cardButton = screen.getByRole("button", { name: /alpha card/i });

		fireEvent.contextMenu(cardButton, { button: 2 });

		fireEvent.click(
			screen.getByRole("menuitem", { name: /append to whiteboard/i }),
		);

		expect(screen.getByTestId("whiteboard-picker")).not.toBeNull();
	});

	test("appends the card to the selected whiteboard and focuses the returned shape", async () => {
		appendToWhiteboardMock.mockResolvedValue({
			itemId: "item-1",
			whiteboardId: "whiteboard-1",
			shapeId: "shape:card-card-1",
			created: true,
		});

		usePaginatedQueryMock.mockReturnValue({
			status: "Idle",
			results: [makeCard()],
			loadMore: vi.fn(),
		});

		render(<RouteComponent />);

		const cardButton = screen.getByRole("button", { name: /alpha card/i });

		fireEvent.contextMenu(cardButton, { button: 2 });

		fireEvent.click(
			screen.getByRole("menuitem", { name: /append to whiteboard/i }),
		);
		fireEvent.click(screen.getByRole("button", { name: /pick history board/i }));

		await waitFor(() => {
			expect(appendToWhiteboardMock).toHaveBeenCalledWith({
				cardId: "card-1",
				whiteboardId: "whiteboard-1",
			});
		});

		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({
				to: "/whiteboard/$whiteboardId",
				params: { whiteboardId: "whiteboard-1" },
				search: { focus: "shape:card-card-1" },
			});
		});
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
		expect(
			screen.getByTestId("preview-dialog").getAttribute("data-card-id"),
		).toBe("card-1");

		fireEvent.click(alphaButton, { shiftKey: true });
		fireEvent.click(betaButton, { shiftKey: true });
		fireEvent.contextMenu(betaButton, { button: 2 });

		expect(alphaButton.getAttribute("aria-pressed")).toBe("true");
		expect(betaButton.getAttribute("aria-pressed")).toBe("true");

		expect(
			screen
				.getByRole("menuitem", { name: /preview/i })
				.hasAttribute("disabled"),
		).toBe(true);
		expect(
			screen
				.getByRole("menuitem", { name: /fullscreen/i })
				.hasAttribute("disabled"),
		).toBe(true);
		expect(
			screen
				.getByRole("menuitem", { name: /append to whiteboard/i })
				.hasAttribute("disabled"),
		).toBe(true);

		fireEvent.click(screen.getByRole("menuitem", { name: /delete 2 cards/i }));
		fireEvent.click(screen.getByRole("button", { name: /confirm delete/i }));

		await waitFor(() => {
			expect(archiveCardsMock).toHaveBeenCalledWith({
				cardIds: ["card-1", "card-2"],
			});
		});
		await waitFor(() => {
			expect(
				screen.getByTestId("preview-dialog").getAttribute("data-card-id"),
			).toBe("");
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
		const selectionSurface = screen.getByTestId("cards-selection-surface");

		fireEvent.pointerDown(selectionSurface, {
			button: 0,
			clientX: 0,
			clientY: 0,
			isPrimary: true,
			pointerId: 1,
		});
		fireEvent.pointerMove(selectionSurface, {
			clientX: 220,
			clientY: 120,
			isPrimary: true,
			pointerId: 1,
		});
		fireEvent.pointerUp(selectionSurface, {
			clientX: 220,
			clientY: 120,
			isPrimary: true,
			pointerId: 1,
		});

		expect(alphaButton.getAttribute("aria-pressed")).toBe("true");
		expect(betaButton.getAttribute("aria-pressed")).toBe("true");
		expect(gammaButton.getAttribute("aria-pressed")).toBe("false");

		fireEvent.pointerDown(selectionSurface, {
			button: 0,
			clientX: 0,
			clientY: 0,
			isPrimary: true,
			pointerId: 2,
			shiftKey: true,
		});
		fireEvent.pointerMove(selectionSurface, {
			clientX: 220,
			clientY: 120,
			isPrimary: true,
			pointerId: 2,
			shiftKey: true,
		});
		fireEvent.pointerUp(selectionSurface, {
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

	test("header controls do not clear selection or start marquee selection", () => {
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
		setCardRects([
			{ left: 10, top: 160, right: 110, bottom: 260 },
			{ left: 130, top: 160, right: 230, bottom: 260 },
		]);

		const alphaButton = screen.getByRole("button", { name: /alpha card/i });
		const searchInput = screen.getByPlaceholderText("Find a card...");

		fireEvent.click(alphaButton, { shiftKey: true });
		expect(alphaButton.getAttribute("aria-pressed")).toBe("true");

		fireEvent.pointerDown(searchInput, {
			button: 0,
			isPrimary: true,
			pointerId: 1,
		});
		expect(screen.queryByTestId("cards-selection-marquee")).toBeNull();
		fireEvent.pointerMove(searchInput, {
			clientX: 220,
			clientY: 120,
			isPrimary: true,
			pointerId: 1,
		});
		expect(screen.queryByTestId("cards-selection-marquee")).toBeNull();
		fireEvent.pointerUp(searchInput, {
			clientX: 220,
			clientY: 120,
			isPrimary: true,
			pointerId: 1,
		});

		expect(alphaButton.getAttribute("aria-pressed")).toBe("true");
		expect(screen.queryByTestId("cards-selection-marquee")).toBeNull();
	});
});
