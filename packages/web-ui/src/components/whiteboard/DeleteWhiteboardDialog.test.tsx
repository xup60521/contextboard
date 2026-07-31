// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { DeleteWhiteboardDialog } from "./DeleteWhiteboardDialog";

describe("DeleteWhiteboardDialog", () => {
	test("offers the recursive card choices", () => {
		const onKeepCards = vi.fn();
		const onDeleteCards = vi.fn();

		render(
			<DeleteWhiteboardDialog
				open
				onCancel={vi.fn()}
				onKeepCards={onKeepCards}
				onDeleteCards={onDeleteCards}
			/>,
		);

		expect(screen.getByText(/all nested whiteboards/i)).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: "Keep cards as orphan" }),
		);
		expect(onKeepCards).toHaveBeenCalledOnce();

		fireEvent.click(screen.getByRole("button", { name: "Delete cards too" }));
		expect(onDeleteCards).toHaveBeenCalledOnce();
	});
});
