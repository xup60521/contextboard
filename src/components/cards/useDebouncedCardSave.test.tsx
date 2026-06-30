import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { JSONContent } from "@tiptap/core";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { useDebouncedCardSave } from "./useDebouncedCardSave";

const updateContentMock = vi.fn();

vi.mock("convex/react", () => ({
	useMutation: () => updateContentMock,
}));

const CARD_ID = "card-1" as Id<"cards">;
const FIRST_CONTENT: JSONContent = {
	type: "doc",
	content: [{ type: "paragraph", content: [{ type: "text", text: "First" }] }],
};
const SECOND_CONTENT: JSONContent = {
	type: "doc",
	content: [{ type: "paragraph", content: [{ type: "text", text: "Second" }] }],
};

function Harness({
	cardId = CARD_ID,
	initialContent,
	children,
}: {
	cardId?: Id<"cards">;
	initialContent?: JSONContent | null;
	children?: ReactNode;
}) {
	const { scheduleSave, flushSave } = useDebouncedCardSave(cardId, 450, {
		initialContent,
	});

	return (
		<div>
			<button type="button" onClick={() => scheduleSave(FIRST_CONTENT)}>
				schedule first
			</button>
			<button type="button" onClick={() => scheduleSave(SECOND_CONTENT)}>
				schedule second
			</button>
			<button type="button" onClick={flushSave}>
				flush
			</button>
			{children}
		</div>
	);
}

describe("useDebouncedCardSave", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		updateContentMock.mockReset();
	});

	afterEach(() => {
		cleanup();
		vi.runOnlyPendingTimers();
		vi.useRealTimers();
	});

	test("debounces saves and persists only the latest content", async () => {
		render(<Harness />);

		fireEvent.click(screen.getByText("schedule first"));
		fireEvent.click(screen.getByText("schedule second"));

		await vi.advanceTimersByTimeAsync(449);
		expect(updateContentMock).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);
		expect(updateContentMock).toHaveBeenCalledTimes(1);
		expect(updateContentMock).toHaveBeenCalledWith({
			cardId: CARD_ID,
			content: SECOND_CONTENT,
		});
	});

	test("flushes pending content when unmounted", () => {
		const { unmount } = render(<Harness />);

		fireEvent.click(screen.getByText("schedule first"));
		unmount();

		expect(updateContentMock).toHaveBeenCalledTimes(1);
		expect(updateContentMock).toHaveBeenCalledWith({
			cardId: CARD_ID,
			content: FIRST_CONTENT,
		});
	});

	test("flushes pending content for the previous card before switching ids", () => {
		const { rerender } = render(<Harness cardId={CARD_ID} />);

		fireEvent.click(screen.getByText("schedule first"));
		rerender(<Harness cardId={"card-2" as Id<"cards">} />);

		expect(updateContentMock).toHaveBeenCalledTimes(1);
		expect(updateContentMock).toHaveBeenCalledWith({
			cardId: CARD_ID,
			content: FIRST_CONTENT,
		});
	});

	test("does not schedule a save when content matches the initial persisted snapshot", async () => {
		render(<Harness initialContent={FIRST_CONTENT} />);

		fireEvent.click(screen.getByText("schedule first"));
		await vi.advanceTimersByTimeAsync(450);

		expect(updateContentMock).not.toHaveBeenCalled();
	});

	test("does not persist the same content twice after a successful save", async () => {
		updateContentMock.mockResolvedValue(undefined);
		render(<Harness initialContent={FIRST_CONTENT} />);

		fireEvent.click(screen.getByText("schedule second"));
		await vi.advanceTimersByTimeAsync(450);
		expect(updateContentMock).toHaveBeenCalledTimes(1);

		fireEvent.click(screen.getByText("schedule second"));
		await vi.advanceTimersByTimeAsync(450);
		expect(updateContentMock).toHaveBeenCalledTimes(1);
	});

	test("resets the persisted snapshot when switching cards", async () => {
		const { rerender } = render(
			<Harness cardId={CARD_ID} initialContent={FIRST_CONTENT} />,
		);

		fireEvent.click(screen.getByText("schedule first"));
		await vi.advanceTimersByTimeAsync(450);
		expect(updateContentMock).not.toHaveBeenCalled();

		rerender(
			<Harness
				cardId={"card-2" as Id<"cards">}
				initialContent={SECOND_CONTENT}
			/>,
		);

		fireEvent.click(screen.getByText("schedule second"));
		await vi.advanceTimersByTimeAsync(450);
		expect(updateContentMock).not.toHaveBeenCalled();
	});

	test("does not flush a no-op save when unmounted", () => {
		const { unmount } = render(<Harness initialContent={FIRST_CONTENT} />);

		fireEvent.click(screen.getByText("schedule first"));
		unmount();

		expect(updateContentMock).not.toHaveBeenCalled();
	});
});
