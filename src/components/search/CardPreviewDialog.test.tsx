import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import {
	CARD_PREVIEW_EDITOR_MOUNT_DELAY_MS,
	CardPreviewDialog,
} from "./CardPreviewDialog";

const navigateMock = vi.fn();
const useQueryMock = vi.fn();

vi.mock("convex/react", () => ({
	useQuery: (...args: unknown[]) => useQueryMock(...args),
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

vi.mock("#/components/ui/dialog", () => ({
	Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
		open ? <div data-testid="dialog-root">{children}</div> : null,
	DialogContent: ({ children }: { children: ReactNode }) => (
		<div data-testid="dialog-content">{children}</div>
	),
	DialogDescription: ({ children }: { children: ReactNode }) => (
		<p>{children}</p>
	),
	DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

const CARD_1 = "card_1" as Id<"cards">;
const CARD_2 = "card_2" as Id<"cards">;

function makeCardData(cardId: Id<"cards">) {
	return {
		card: {
			_id: cardId,
			content: { type: "doc", content: [] },
			derivedTitle: `Card ${cardId}`,
			whiteboardId: null,
		},
		shapeId: null,
		boardWhiteboardId: null,
	};
}

async function flushDeferredMount() {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(16);
	});
	await act(async () => {
		await vi.advanceTimersByTimeAsync(CARD_PREVIEW_EDITOR_MOUNT_DELAY_MS);
	});
}

describe("CardPreviewDialog", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		useQueryMock.mockReset();
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
				CARD_PREVIEW_EDITOR_MOUNT_DELAY_MS + 50,
			);
		});

		expect(screen.queryByTestId("card-editor-pane")).toBeNull();
		expect(screen.queryByTestId("dialog-root")).toBeNull();
		expect(screen.queryByText("Preparing editor...")).toBeNull();
	});

	test("resets the deferred mount when switching cards", async () => {
		useQueryMock.mockImplementation((_: unknown, args: unknown) => {
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
});
