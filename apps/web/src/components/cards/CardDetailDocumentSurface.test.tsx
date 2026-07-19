import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { CardDetailDocumentSurface } from "./CardDetailDocumentSurface";
import { DEFERRED_EDITOR_MOUNT_DELAY_MS } from "../editor/useDeferredEditorMount";

vi.mock("#/components/editor/useCardReferenceSupport", () => ({
	useCardReferenceSupport: () => ({
		support: { search: vi.fn(), onOpenPreview: vi.fn() },
		previewCardId: null,
		closePreview: vi.fn(),
	}),
}));

vi.mock("#/components/editor/ReadonlyRichTextPreview", () => ({
	ReadonlyRichTextPreview: ({
		children,
	}: {
		children?: ReactNode;
	}) => <div data-testid="readonly-preview">{children}</div>,
}));

vi.mock("#/components/editor/CardEditorPane", () => ({
	CardEditorPane: ({ cardId }: { cardId: string }) => (
		<div data-testid="card-editor-pane">{cardId}</div>
	),
}));

vi.mock("#/components/search/CardPreviewDialog", () => ({
	CardPreviewDialog: () => null,
}));

const CARD_1 = "card_1" as Id<"cards">;
const CARD_2 = "card_2" as Id<"cards">;
const BOARD_1 = "board_1" as Id<"whiteboards">;

const CONTENT = { type: "doc", content: [] };

async function flushDeferredMount() {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(16);
	});
	await act(async () => {
		await vi.advanceTimersByTimeAsync(DEFERRED_EDITOR_MOUNT_DELAY_MS);
	});
}

describe("CardDetailDocumentSurface", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.spyOn(window, "requestAnimationFrame").mockImplementation(
			(callback: FrameRequestCallback) =>
				window.setTimeout(() => callback(performance.now()), 16),
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

	test("renders the readonly preview immediately and defers the editor mount", async () => {
		render(
			<CardDetailDocumentSurface
				cardId={CARD_1}
				content={CONTENT}
				whiteboardId={BOARD_1}
			/>,
		);

		expect(screen.getByTestId("readonly-preview")).not.toBeNull();
		expect(screen.queryByTestId("card-editor-pane")).toBeNull();

		await flushDeferredMount();

		expect(screen.getByTestId("card-editor-pane").textContent).toBe("card_1");
		expect(screen.queryByTestId("readonly-preview")).toBeNull();
	});

	test("resets the deferred mount when switching cards", async () => {
		const { rerender } = render(
			<CardDetailDocumentSurface
				cardId={CARD_1}
				content={CONTENT}
				whiteboardId={BOARD_1}
			/>,
		);

		await flushDeferredMount();
		expect(screen.getByTestId("card-editor-pane").textContent).toBe("card_1");

		rerender(
			<CardDetailDocumentSurface
				cardId={CARD_2}
				content={CONTENT}
				whiteboardId={BOARD_1}
			/>,
		);

		expect(screen.getByTestId("readonly-preview")).not.toBeNull();
		expect(screen.queryByTestId("card-editor-pane")).toBeNull();

		await flushDeferredMount();

		expect(screen.getByTestId("card-editor-pane").textContent).toBe("card_2");
	});

	test("promotes the editor mount on interaction", async () => {
		render(
			<CardDetailDocumentSurface
				cardId={CARD_1}
				content={CONTENT}
				whiteboardId={BOARD_1}
			/>,
		);

		fireEvent.pointerDown(screen.getByTestId("card-detail-renderer"));

		expect(screen.getByTestId("card-editor-pane").textContent).toBe("card_1");
		expect(screen.queryByTestId("readonly-preview")).toBeNull();
	});
});
