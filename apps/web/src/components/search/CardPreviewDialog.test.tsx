import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Id } from "#/integrations/local/types";
import {
	CardPreviewDialog,
	isInsidePreviewAllowedPortal,
	shouldPreventPreviewOutsideDismiss,
} from "./CardPreviewDialog";
import { DEFERRED_EDITOR_MOUNT_DELAY_MS } from "../editor/useDeferredEditorMount";

const navigateMock = vi.fn();
const useQueryMock = vi.fn();
const useMutationMock = vi.fn();

vi.mock("#/integrations/local/react", () => ({
	useMutation: () => useMutationMock,
	useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("#/components/cards/CardInfoSection", () => ({
	CardInfoSection: () => <div data-testid="card-info-section" />,
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		...props
	}: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
		<a {...props}>{children}</a>
	),
	useNavigate: () => navigateMock,
}));

vi.mock("#/components/editor/CardEditorPane", () => ({
	CardEditorPane: ({ cardId }: { cardId: string }) => (
		<div data-testid="card-editor-pane">{cardId}</div>
	),
}));

vi.mock("#/components/whiteboard/WhiteboardPickerDialog", () => ({
	WhiteboardPickerDialog: ({
		open,
		onSelect,
	}: {
		open: boolean;
		onSelect: (whiteboardId: Id<"whiteboards">) => void;
	}) =>
		open ? (
			<div data-testid="whiteboard-picker">
				<button
					type="button"
					onClick={() => onSelect("board_1" as Id<"whiteboards">)}
				>
					Select whiteboard
				</button>
			</div>
		) : null,
}));

vi.mock("#/components/ui/dialog", () => ({
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

const CARD_1 = "card_1" as Id<"cards">;
const CARD_2 = "card_2" as Id<"cards">;
const BOARD_1 = "board_1" as Id<"whiteboards">;
const BOARD_2 = "board_2" as Id<"whiteboards">;

function makeCardData(
	cardId: Id<"cards">,
	overrides: Partial<{
		placements: Array<{
			itemId: string;
			whiteboardId: Id<"whiteboards"> | null;
			shapeId: string | null;
			updatedAt: number;
		}>;
		backlinks: Array<unknown>;
		boardWhiteboardId: Id<"whiteboards"> | null;
		shapeId: string | null;
	}> = {},
) {
	return {
		card: {
			_id: cardId,
			_creationTime: 1,
			content: { type: "doc", content: [] },
			derivedTitle: `Card ${cardId}`,
			plainText: "",
			preview: "",
			updatedAt: 1,
			version: 1,
			archivedAt: null,
			whiteboardId: null,
		},
		whiteboard: null,
		breadcrumbs: [],
		placements: overrides.placements ?? [],
		backlinks: overrides.backlinks ?? [],
		boardWhiteboardId: overrides.boardWhiteboardId ?? null,
		shapeId: overrides.shapeId ?? null,
	};
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
		useQueryMock.mockReset();
		useMutationMock.mockReset();
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
		useQueryMock.mockImplementation((_: unknown, args: unknown) => {
			if (args === undefined) {
				return [];
			}
			if (args === "skip") {
				return undefined;
			}

			return makeCardData((args as { cardId: Id<"cards"> }).cardId);
		});

		render(
			<CardPreviewDialog
				cardId={CARD_1}
				currentWhiteboardId={null}
				onClose={() => {}}
			/>,
		);

		expect(screen.getByText("Card card_1")).not.toBeNull();
		expect(screen.getByText("Preparing editor...")).not.toBeNull();
		expect(screen.queryByTestId("card-editor-pane")).toBeNull();

		await flushDeferredMount();

		expect(screen.getByTestId("card-editor-pane").textContent).toBe("card_1");
	});

	test("cancels a deferred mount when the dialog closes early", async () => {
		useQueryMock.mockImplementation((_: unknown, args: unknown) => {
			if (args === undefined) {
				return [];
			}
			if (args === "skip") {
				return undefined;
			}

			return makeCardData((args as { cardId: Id<"cards"> }).cardId);
		});

		const { rerender } = render(
			<CardPreviewDialog
				cardId={CARD_1}
				currentWhiteboardId={null}
				onClose={() => {}}
			/>,
		);

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
		useQueryMock.mockImplementation((_: unknown, args: unknown) => {
			if (args === undefined) {
				return [];
			}
			if (args === "skip") {
				return undefined;
			}

			const cardId = (args as { cardId: Id<"cards"> }).cardId;
			return makeCardData(cardId);
		});

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

		expect(screen.queryByTestId("card-editor-pane")).toBeNull();
		expect(screen.getByText("Preparing editor...")).not.toBeNull();

		await flushDeferredMount();

		expect(screen.getByTestId("card-editor-pane").textContent).toBe("card_2");
	});

	test("global cards page keeps append action disabled when no boards are available", async () => {
		useQueryMock.mockImplementation((_: unknown, args: unknown) => {
			if (args === undefined) {
				return [];
			}
			if (args === "skip") {
				return undefined;
			}

			return makeCardData(CARD_1, {
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
			});
		});

		render(
			<CardPreviewDialog
				cardId={CARD_1}
				currentWhiteboardId={null}
				onClose={() => {}}
			/>,
		);

		expect(screen.queryByText("Go to board")).toBeNull();
		expect(screen.queryByText("Focus on board")).toBeNull();
		expect(
			screen
				.getByRole("button", { name: "Append to board" })
				.getAttribute("disabled"),
		).toBe("");
	});

	test("current board placement should show Focus on board", async () => {
		useQueryMock.mockImplementation((_: unknown, args: unknown) => {
			if (args === undefined) {
				return [];
			}
			if (args === "skip") {
				return undefined;
			}

			return makeCardData(CARD_1, {
				placements: [
					{
						itemId: "item_1",
						whiteboardId: BOARD_1,
						shapeId: "shape:card_1",
						updatedAt: 1,
					},
				],
			});
		});

		render(
			<CardPreviewDialog
				cardId={CARD_1}
				currentWhiteboardId={BOARD_1}
				onClose={() => {}}
			/>,
		);

		expect(screen.getByText("Focus on board")).not.toBeNull();
		expect(screen.queryByText("Go to board")).toBeNull();
	});

	test("clicking Focus on board navigates to current board with shape focus", async () => {
		const onCloseMock = vi.fn();

		useQueryMock.mockImplementation((_: unknown, args: unknown) => {
			if (args === undefined) {
				return [];
			}
			if (args === "skip") {
				return undefined;
			}

			return makeCardData(CARD_1, {
				placements: [
					{
						itemId: "item_1",
						whiteboardId: BOARD_1,
						shapeId: "shape:card_1",
						updatedAt: 1,
					},
				],
			});
		});

		render(
			<CardPreviewDialog
				cardId={CARD_1}
				currentWhiteboardId={BOARD_1}
				onClose={onCloseMock}
			/>,
		);

		const button = screen.getByText("Focus on board");
		button.click();

		expect(onCloseMock).toHaveBeenCalledOnce();
		expect(navigateMock).toHaveBeenCalledWith({
			to: "/whiteboard/$whiteboardId",
			params: { whiteboardId: BOARD_1 },
			search: { focus: "shape:card_1" },
		});
	});

	test("placed elsewhere but not on current board should show Append to board", async () => {
		useQueryMock.mockImplementation((_: unknown, args: unknown) => {
			if (args === undefined) {
				return [];
			}
			if (args === "skip") {
				return undefined;
			}

			return makeCardData(CARD_1, {
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
			});
		});

		render(
			<CardPreviewDialog
				cardId={CARD_1}
				currentWhiteboardId={BOARD_2}
				onClose={() => {}}
			/>,
		);

		expect(screen.queryByText("Go to board")).toBeNull();
		expect(screen.queryByText("Focus on board")).toBeNull();
		expect(screen.getByText("Append to board")).not.toBeNull();
	});

	test("multiple placements should not create a single header Go to board", async () => {
		useQueryMock.mockImplementation((_: unknown, args: unknown) => {
			if (args === undefined) {
				return [];
			}
			if (args === "skip") {
				return undefined;
			}

			return makeCardData(CARD_1, {
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
			});
		});

		render(
			<CardPreviewDialog
				cardId={CARD_1}
				currentWhiteboardId={null}
				onClose={() => {}}
			/>,
		);

		expect(screen.queryByText("Go to board")).toBeNull();
		expect(screen.queryByText("Focus on board")).toBeNull();
	});

	test("shows Append to board for orphan card on current board", async () => {
		useQueryMock.mockImplementation((_: unknown, args: unknown) => {
			if (args === undefined) {
				return [];
			}
			if (args === "skip") {
				return undefined;
			}

			return makeCardData(CARD_1, { placements: [] });
		});

		render(
			<CardPreviewDialog
				cardId={CARD_1}
				currentWhiteboardId={BOARD_1}
				onClose={() => {}}
			/>,
		);

		expect(screen.getByText("Append to board")).not.toBeNull();
		expect(screen.queryByText("Focus on board")).toBeNull();
	});

	test("does not show Append to board while data is loading", async () => {
		useQueryMock.mockImplementation((_: unknown, args: unknown) => {
			if (args === undefined) {
				return [];
			}
			if (args === "skip") {
				return undefined;
			}

			return undefined; // still loading
		});

		render(
			<CardPreviewDialog
				cardId={CARD_1}
				currentWhiteboardId={BOARD_1}
				onClose={() => {}}
			/>,
		);

		expect(screen.queryByText("Append to board")).toBeNull();
	});

	test("clicking Append to board opens the whiteboard picker", async () => {
		useQueryMock.mockImplementation((_: unknown, args: unknown) => {
			if (args === undefined) {
				return [{ _id: BOARD_1, title: "Board 1", breadcrumbs: [] }];
			}
			if (args === "skip") {
				return undefined;
			}

			return makeCardData(CARD_1, { placements: [] });
		});

		render(
			<CardPreviewDialog
				cardId={CARD_1}
				currentWhiteboardId={BOARD_1}
				onClose={() => {}}
			/>,
		);

		await act(async () => {
			screen.getByText("Append to board").click();
		});

		expect(screen.getByTestId("whiteboard-picker")).not.toBeNull();
		expect(useMutationMock).not.toHaveBeenCalled();
	});

	test("selecting a whiteboard from the picker calls mutation and navigates with returned shape id", async () => {
		const onCloseMock = vi.fn();
		useMutationMock.mockResolvedValue({
			itemId: "item_new",
			whiteboardId: BOARD_1,
			shapeId: "shape:card-returned-from-server",
			created: true,
		});

		useQueryMock.mockImplementation((_: unknown, args: unknown) => {
			if (args === undefined) {
				return [{ _id: BOARD_1, title: "Board 1", breadcrumbs: [] }];
			}
			if (args === "skip") {
				return undefined;
			}

			return makeCardData(CARD_1, { placements: [] });
		});

		render(
			<CardPreviewDialog
				cardId={CARD_1}
				currentWhiteboardId={BOARD_1}
				onClose={onCloseMock}
			/>,
		);

		await act(async () => {
			screen.getByText("Append to board").click();
		});
		await act(async () => {
			screen.getByText("Select whiteboard").click();
		});

		await vi.waitFor(() => {
			expect(useMutationMock).toHaveBeenCalledWith({
				cardId: CARD_1,
				whiteboardId: BOARD_1,
			});
			expect(onCloseMock).toHaveBeenCalledOnce();
			expect(navigateMock).toHaveBeenCalledWith({
				to: "/whiteboard/$whiteboardId",
				params: { whiteboardId: BOARD_1 },
				search: { focus: "shape:card-returned-from-server" },
			});
		});
	});

	test("append failure shows error and keeps dialog open", async () => {
		const onCloseMock = vi.fn();
		useMutationMock.mockRejectedValue(new Error("Whiteboard not found"));

		useQueryMock.mockImplementation((_: unknown, args: unknown) => {
			if (args === undefined) {
				return [{ _id: BOARD_1, title: "Board 1", breadcrumbs: [] }];
			}
			if (args === "skip") {
				return undefined;
			}

			return makeCardData(CARD_1, { placements: [] });
		});

		render(
			<CardPreviewDialog
				cardId={CARD_1}
				currentWhiteboardId={BOARD_1}
				onClose={onCloseMock}
			/>,
		);

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
