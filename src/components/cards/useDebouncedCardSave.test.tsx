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

function Harness({ children }: { children?: ReactNode }) {
	const { scheduleSave, flushSave } = useDebouncedCardSave(CARD_ID);

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
});
