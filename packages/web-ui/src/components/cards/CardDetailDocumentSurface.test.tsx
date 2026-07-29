// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DEFERRED_EDITOR_MOUNT_DELAY_MS } from "@contextboard/editor";
import { CardDetailDocumentSurface } from "./CardDetailDocumentSurface";

const runtime = {
	cards: {
		updateContent: vi.fn(async () => 2),
	},
	ui: {},
};
vi.mock("@contextboard/application", async (importOriginal) => ({
	...(await importOriginal<typeof import("@contextboard/application")>()),
	useApplicationRuntime: () => runtime,
}));
vi.mock("@contextboard/editor", async (importOriginal) => ({
	...(await importOriginal<typeof import("@contextboard/editor")>()),
	ReadonlyRichTextPreview: () => <div data-testid="readonly-preview" />,
}));
vi.mock("./CardDocumentEditor", () => ({
	CardDocumentEditor: ({ cardId }: { cardId: string }) => (
		<div data-testid="card-editor-pane">{cardId}</div>
	),
}));

vi.mock("./CardPreviewDialog", () => ({
	CardPreviewDialog: () => null,
}));

const CARD_1 = "card_1";
const CARD_2 = "card_2";
const BOARD_1 = "board_1";

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
				version={1}
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
				version={1}
				whiteboardId={BOARD_1}
			/>,
		);

		await flushDeferredMount();
		expect(screen.getByTestId("card-editor-pane").textContent).toBe("card_1");

		rerender(
			<CardDetailDocumentSurface
				cardId={CARD_2}
				content={CONTENT}
				version={1}
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
				version={1}
				whiteboardId={BOARD_1}
			/>,
		);

		fireEvent.pointerDown(screen.getByTestId("card-detail-renderer"));

		expect(screen.getByTestId("card-editor-pane").textContent).toBe("card_1");
		expect(screen.queryByTestId("readonly-preview")).toBeNull();
	});
});
