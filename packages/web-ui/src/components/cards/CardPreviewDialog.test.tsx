// @vitest-environment jsdom

import { DEFERRED_EDITOR_MOUNT_DELAY_MS } from "@contextboard/editor";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
	CardPreviewDialog,
	isInsidePreviewAllowedPortal,
	shouldPreventPreviewOutsideDismiss,
} from "./CardPreviewDialog";

const navigateMock = vi.fn();
const appendToWhiteboardMock = vi.fn();
const getCardMock = vi.fn();
const listWhiteboardsMock = vi.fn();

// The real runtime is memoised; a fresh object per render would re-fire the
// load effects forever.
const runtimeStub = {
	cards: {
		get: getCardMock,
		appendToWhiteboard: appendToWhiteboardMock,
		delete: vi.fn(),
		subscribe: () => () => {},
	},
	whiteboards: {
		list: listWhiteboardsMock,
		subscribe: () => () => {},
	},
	navigation: {
		cardsHref: () => "/cards",
		cardHref: (id: string) => `/cards/${id}`,
		rootWhiteboardHref: () => "/whiteboard",
		whiteboardHref: (id: string, options?: { focus?: string }) =>
			`/whiteboard/${id}${options?.focus ? `?focus=${options.focus}` : ""}`,
		navigate: navigateMock,
		replace: vi.fn(),
	},
};

vi.mock("@contextboard/application", () => ({
	useApplicationRuntime: () => runtimeStub,
}));

vi.mock("./CardInfoSection", () => ({
	CardInfoSection: () => <div data-testid="card-info-section" />,
}));

vi.mock("../editor/CardEditorPane", () => ({
	CardEditorPane: ({ cardId }: { cardId: string }) => (
		<div data-testid="card-editor-pane">{cardId}</div>
	),
}));

vi.mock("../whiteboard/WhiteboardPickerDialog", () => ({
	WhiteboardPickerDialog: ({
		open,
		onSelect,
	}: {
		open: boolean;
		onSelect: (whiteboardId: string) => void;
	}) =>
		open ? (
			<div data-testid="whiteboard-picker">
				<button type="button" onClick={() => onSelect("board_1")}>
					Select whiteboard
				</button>
			</div>
		) : null,
}));

vi.mock("../ui/dialog", () => ({
	Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
		open ? <div data-testid="dialog-root">{children}</div> : null,
	DialogContent: ({ children }: { children: ReactNode }) => (
		<div data-testid="dialog-content">{children}</div>
	),
	DialogDescription: ({ children }: { children: ReactNode }) => (
		<p>{children}</p>
	),
	DialogFooter: ({ children }: { children: ReactNode }) => (
		<div data-testid="dialog-footer">{children}</div>
	),
	DialogHeader: ({ children }: { children: ReactNode }) => (
		<div data-testid="dialog-header">{children}</div>
	),
	DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

const CARD_1 = "card_1";
const CARD_2 = "card_2";
const BOARD_1 = "board_1";
const BOARD_2 = "board_2";

type Placement = {
	itemId: string;
	whiteboardId: string | null;
	shapeId: string | null;
	updatedAt: number;
};

function makeCardData(
	cardId: string,
	overrides: Partial<{
		placements: Placement[];
		backlinks: unknown[];
		boardWhiteboardId: string | null;
		shapeId: string | null;
	}> = {},
) {
	return {
		id: cardId,
		title: `Card ${cardId}`,
		preview: "",
		content: { type: "doc", content: [] },
		createdAt: 1,
		updatedAt: 1,
		version: 1,
		activePlacementCount: overrides.placements?.length ?? 0,
		placements: overrides.placements ?? [],
		backlinks: overrides.backlinks ?? [],
		preferredPlacement: null,
		boardWhiteboardId: overrides.boardWhiteboardId ?? null,
		shapeId: overrides.shapeId ?? null,
		breadcrumbs: [],
	};
}

/** The runtime loads asynchronously; let the initial fetch settle. */
async function settle() {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(0);
	});
}

async function flushDeferredMount() {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(16);
	});
	await act(async () => {
		await vi.advanceTimersByTimeAsync(DEFERRED_EDITOR_MOUNT_DELAY_MS);
	});
}

describe("CardPreviewDialog", () => {
	test("treats dropdown menu content as an allowed portal target", () => {
		const dropdownContent = document.createElement("div");
		dropdownContent.setAttribute("data-slot", "dropdown-menu-content");

		expect(isInsidePreviewAllowedPortal(dropdownContent)).toBe(true);
	});

	test("treats Radix popper wrappers as an allowed portal target", () => {
		const popperWrapper = document.createElement("div");
		popperWrapper.setAttribute("data-radix-popper-content-wrapper", "");

		const child = document.createElement("button");
		popperWrapper.appendChild(child);

		expect(isInsidePreviewAllowedPortal(child)).toBe(true);
	});

	test("rejects unrelated targets and null", () => {
		expect(isInsidePreviewAllowedPortal(document.createElement("div"))).toBe(
			false,
		);
		expect(isInsidePreviewAllowedPortal(null)).toBe(false);
	});

	test("prevents outside dismiss while the actions dropdown is open", () => {
		expect(
			shouldPreventPreviewOutsideDismiss(document.createElement("div"), {
				showDeleteDialog: false,
				dropdownOpen: true,
				appendPickerOpen: false,
			}),
		).toBe(true);
	});

	test("prevents outside dismiss while the append picker is open", () => {
		expect(
			shouldPreventPreviewOutsideDismiss(document.createElement("div"), {
				showDeleteDialog: false,
				dropdownOpen: false,
				appendPickerOpen: true,
			}),
		).toBe(true);
	});

	test("prevents outside dismiss for allowed portal targets", () => {
		const dropdownContent = document.createElement("div");
		dropdownContent.setAttribute("data-slot", "dropdown-menu-content");

		expect(
			shouldPreventPreviewOutsideDismiss(dropdownContent, {
				showDeleteDialog: false,
				dropdownOpen: false,
				appendPickerOpen: false,
			}),
		).toBe(true);
	});

	test("allows outside dismiss when no nested overlay is open", () => {
		expect(
			shouldPreventPreviewOutsideDismiss(document.createElement("div"), {
				showDeleteDialog: false,
				dropdownOpen: false,
				appendPickerOpen: false,
			}),
		).toBe(false);
	});

	beforeEach(() => {
		vi.useFakeTimers();
		getCardMock.mockReset();
		listWhiteboardsMock.mockReset();
		listWhiteboardsMock.mockResolvedValue([]);
		appendToWhiteboardMock.mockReset();
		navigateMock.mockReset();
		vi.spyOn(window, "requestAnimationFrame").mockImplementation(
			(callback: FrameRequestCallback) => {
				return window.setTimeout(() => callback(performance.now()), 16);
			},
		);
		vi.spyOn(window, "cancelAnimationFrame").mockImplementation(
			(handle: number) => {
				window.clearTimeout(handle);
			},
		);
	});

	afterEach(() => {
		cleanup();
		vi.runOnlyPendingTimers();
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	test("opens immediately but defers mounting the editor", async () => {
		getCardMock.mockImplementation((id: string) =>
			Promise.resolve(makeCardData(id)),
		);
		listWhiteboardsMock.mockResolvedValue([]);

		render(
			<CardPreviewDialog
				cardId={CARD_1}
				currentWhiteboardId={null}
				onClose={() => {}}
			/>,
		);
		await settle();

		expect(screen.getByText("Card card_1")).not.toBeNull();
		expect(screen.getByText("Preparing editor...")).not.toBeNull();
		expect(screen.queryByTestId("card-editor-pane")).toBeNull();

		await flushDeferredMount();

		expect(screen.getByTestId("card-editor-pane").textContent).toBe("card_1");
	});

	test("cancels a deferred mount when the dialog closes early", async () => {
		getCardMock.mockImplementation((id: string) =>
			Promise.resolve(makeCardData(id)),
		);
		listWhiteboardsMock.mockResolvedValue([]);

		const { rerender } = render(
			<CardPreviewDialog
				cardId={CARD_1}
				currentWhiteboardId={null}
				onClose={() => {}}
			/>,
		);
		await settle();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(16);
		});

		rerender(
			<CardPreviewDialog
				cardId={null}
				currentWhiteboardId={null}
				onClose={() => {}}
			/>,
		);
		await settle();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(
				DEFERRED_EDITOR_MOUNT_DELAY_MS + 50,
			);
		});

		expect(screen.queryByTestId("card-editor-pane")).toBeNull();
		expect(screen.queryByTestId("dialog-root")).toBeNull();
		expect(screen.queryByText("Preparing editor...")).toBeNull();
	});

	test("resets the deferred mount when switching cards", async () => {
		getCardMock.mockImplementation((id: string) =>
			Promise.resolve(makeCardData(id)),
		);
		listWhiteboardsMock.mockResolvedValue([]);

		const { rerender } = render(
			<CardPreviewDialog
				cardId={CARD_1}
				currentWhiteboardId={null}
				onClose={() => {}}
			/>,
		);

		await flushDeferredMount();
		expect(screen.getByTestId("card-editor-pane").textContent).toBe("card_1");

		rerender(
			<CardPreviewDialog
				cardId={CARD_2}
				currentWhiteboardId={null}
				onClose={() => {}}
			/>,
		);
		await settle();

		expect(screen.queryByTestId("card-editor-pane")).toBeNull();
		expect(screen.getByText("Preparing editor...")).not.toBeNull();

		await flushDeferredMount();

		expect(screen.getByTestId("card-editor-pane").textContent).toBe("card_2");
	});

	test("global cards page keeps append action disabled when no boards are available", async () => {
		getCardMock.mockImplementation((id: string) =>
			Promise.resolve(makeCardData(CARD_1, {
				placements: [
					{
						itemId: "item_1",
						whiteboardId: BOARD_1,
						shapeId: "shape:card_1",
						updatedAt: 1,
					},
				],
				boardWhiteboardId: BOARD_1,
				shapeId: "shape:card_1",
			})),
		);
		listWhiteboardsMock.mockResolvedValue([]);

		render(
			<CardPreviewDialog
				cardId={CARD_1}
				currentWhiteboardId={null}
				onClose={() => {}}
			/>,
		);
		await settle();

		expect(screen.queryByText("Go to board")).toBeNull();
		expect(screen.queryByText("Focus on board")).toBeNull();
		expect(
			screen
				.getByRole("button", { name: "Append to board" })
				.getAttribute("disabled"),
		).toBe("");
	});

	test("current board placement should show Focus on board", async () => {
		getCardMock.mockImplementation((id: string) =>
			Promise.resolve(makeCardData(CARD_1, {
				placements: [
					{
						itemId: "item_1",
						whiteboardId: BOARD_1,
						shapeId: "shape:card_1",
						updatedAt: 1,
					},
				],
			})),
		);
		listWhiteboardsMock.mockResolvedValue([]);

		render(
			<CardPreviewDialog
				cardId={CARD_1}
				currentWhiteboardId={BOARD_1}
				onClose={() => {}}
			/>,
		);
		await settle();

		expect(screen.getByText("Focus on board")).not.toBeNull();
		expect(screen.queryByText("Go to board")).toBeNull();
	});

	test("clicking Focus on board navigates to current board with shape focus", async () => {
		const onCloseMock = vi.fn();

		getCardMock.mockImplementation((id: string) =>
			Promise.resolve(makeCardData(CARD_1, {
				placements: [
					{
						itemId: "item_1",
						whiteboardId: BOARD_1,
						shapeId: "shape:card_1",
						updatedAt: 1,
					},
				],
			})),
		);
		listWhiteboardsMock.mockResolvedValue([]);

		render(
			<CardPreviewDialog
				cardId={CARD_1}
				currentWhiteboardId={BOARD_1}
				onClose={onCloseMock}
			/>,
		);
		await settle();

		const button = screen.getByText("Focus on board");
		button.click();

		expect(onCloseMock).toHaveBeenCalledOnce();
		expect(navigateMock).toHaveBeenCalledWith(
			"/whiteboard/board_1?focus=shape:card_1",
		);
	});

	test("placed elsewhere but not on current board should show Append to board", async () => {
		getCardMock.mockImplementation((id: string) =>
			Promise.resolve(makeCardData(CARD_1, {
				placements: [
					{
						itemId: "item_1",
						whiteboardId: BOARD_1,
						shapeId: "shape:card_1",
						updatedAt: 1,
					},
				],
				boardWhiteboardId: BOARD_1,
				shapeId: "shape:card_1",
			})),
		);
		listWhiteboardsMock.mockResolvedValue([]);

		render(
			<CardPreviewDialog
				cardId={CARD_1}
				currentWhiteboardId={BOARD_2}
				onClose={() => {}}
			/>,
		);
		await settle();

		expect(screen.queryByText("Go to board")).toBeNull();
		expect(screen.queryByText("Focus on board")).toBeNull();
		expect(screen.getByText("Append to board")).not.toBeNull();
	});

	test("multiple placements should not create a single header Go to board", async () => {
		getCardMock.mockImplementation((id: string) =>
			Promise.resolve(makeCardData(CARD_1, {
				placements: [
					{
						itemId: "item_1",
						whiteboardId: BOARD_1,
						shapeId: "shape:card_1_a",
						updatedAt: 1,
					},
					{
						itemId: "item_2",
						whiteboardId: BOARD_2,
						shapeId: "shape:card_1_b",
						updatedAt: 2,
					},
				],
				boardWhiteboardId: BOARD_2,
				shapeId: "shape:card_1_b",
			})),
		);
		listWhiteboardsMock.mockResolvedValue([]);

		render(
			<CardPreviewDialog
				cardId={CARD_1}
				currentWhiteboardId={null}
				onClose={() => {}}
			/>,
		);
		await settle();

		expect(screen.queryByText("Go to board")).toBeNull();
		expect(screen.queryByText("Focus on board")).toBeNull();
	});

	test("shows Append to board for orphan card on current board", async () => {
		getCardMock.mockImplementation((id: string) =>
			Promise.resolve(makeCardData(CARD_1, { placements: [] })),
		);
		listWhiteboardsMock.mockResolvedValue([]);

		render(
			<CardPreviewDialog
				cardId={CARD_1}
				currentWhiteboardId={BOARD_1}
				onClose={() => {}}
			/>,
		);
		await settle();

		expect(screen.getByText("Append to board")).not.toBeNull();
		expect(screen.queryByText("Focus on board")).toBeNull();
	});

	test("does not show Append to board while data is loading", async () => {
		getCardMock.mockImplementation((id: string) =>
			new Promise(() => {}),
		);
		listWhiteboardsMock.mockResolvedValue([]);

		render(
			<CardPreviewDialog
				cardId={CARD_1}
				currentWhiteboardId={BOARD_1}
				onClose={() => {}}
			/>,
		);
		await settle();

		expect(screen.queryByText("Append to board")).toBeNull();
	});

	test("clicking Append to board opens the whiteboard picker", async () => {
		getCardMock.mockImplementation((id: string) =>
			Promise.resolve(makeCardData(CARD_1, { placements: [] })),
		);
		listWhiteboardsMock.mockResolvedValue([{ id: BOARD_1, title: 'Board 1' }]);

		render(
			<CardPreviewDialog
				cardId={CARD_1}
				currentWhiteboardId={BOARD_1}
				onClose={() => {}}
			/>,
		);
		await settle();

		await act(async () => {
			screen.getByText("Append to board").click();
		});

		expect(screen.getByTestId("whiteboard-picker")).not.toBeNull();
		expect(appendToWhiteboardMock).not.toHaveBeenCalled();
	});

	test("selecting a whiteboard from the picker calls mutation and navigates with returned shape id", async () => {
		const onCloseMock = vi.fn();
		appendToWhiteboardMock.mockResolvedValue({
			itemId: "item_new",
			whiteboardId: BOARD_1,
			shapeId: "shape:card-returned-from-server",
			created: true,
		});

		getCardMock.mockImplementation((id: string) =>
			Promise.resolve(makeCardData(CARD_1, { placements: [] })),
		);
		listWhiteboardsMock.mockResolvedValue([{ id: BOARD_1, title: 'Board 1' }]);

		render(
			<CardPreviewDialog
				cardId={CARD_1}
				currentWhiteboardId={BOARD_1}
				onClose={onCloseMock}
			/>,
		);
		await settle();

		await act(async () => {
			screen.getByText("Append to board").click();
		});
		await act(async () => {
			screen.getByText("Select whiteboard").click();
		});

		await vi.waitFor(() => {
			expect(appendToWhiteboardMock).toHaveBeenCalledWith({
				cardId: CARD_1,
				whiteboardId: BOARD_1,
			});
			expect(onCloseMock).toHaveBeenCalledOnce();
			expect(navigateMock).toHaveBeenCalledWith(
				"/whiteboard/board_1?focus=shape:card-returned-from-server",
			);
		});
	});

	test("append failure shows error and keeps dialog open", async () => {
		const onCloseMock = vi.fn();
		appendToWhiteboardMock.mockRejectedValue(new Error("Whiteboard not found"));

		getCardMock.mockImplementation((id: string) =>
			Promise.resolve(makeCardData(CARD_1, { placements: [] })),
		);
		listWhiteboardsMock.mockResolvedValue([{ id: BOARD_1, title: 'Board 1' }]);

		render(
			<CardPreviewDialog
				cardId={CARD_1}
				currentWhiteboardId={BOARD_1}
				onClose={onCloseMock}
			/>,
		);
		await settle();

		await act(async () => {
			screen.getByText("Append to board").click();
		});
		await act(async () => {
			screen.getByText("Select whiteboard").click();
		});

		await vi.waitFor(() => {
			expect(screen.getByText("Whiteboard not found")).not.toBeNull();
		});

		expect(onCloseMock).not.toHaveBeenCalled();
	});
});
