import type { ConflictRecord } from "@contextboard/sync-protocol";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ConflictInbox } from "./ConflictInbox";

const makeConflict = (conflictId: string): ConflictRecord => ({
	conflictId,
	entityType: "card",
	entityId: `card-${conflictId}`,
	localValue: { id: conflictId, side: "local" },
	remoteValue: { id: conflictId, side: "remote" },
	createdAt: 1,
	resolvedAt: null,
	resolution: null,
	revision: 1,
	updatedAt: 1,
	updatedByDeviceId: "device-1",
});

afterEach(() => {
	cleanup();
});

describe("ConflictInbox", () => {
	test("selects individual conflicts and resolves the selection together", () => {
		const onResolve = vi.fn();
		render(
			<ConflictInbox
				conflicts={[makeConflict("conflict-1"), makeConflict("conflict-2")]}
				resolving={false}
				onResolve={onResolve}
			/>,
		);

		fireEvent.click(
			screen.getByRole("checkbox", {
				name: "Select conflict conflict-1",
			}),
		);
		expect(screen.getByText("1 selected")).toBeTruthy();

		fireEvent.click(
			screen.getByRole("button", { name: "Keep local selected conflicts" }),
		);
		expect(onResolve).toHaveBeenCalledWith(["conflict-1"], "keep-local");
	});

	test("selects every visible conflict and can clear the selection", () => {
		const onResolve = vi.fn();
		render(
			<ConflictInbox
				conflicts={[makeConflict("conflict-1"), makeConflict("conflict-2")]}
				resolving={false}
				onResolve={onResolve}
			/>,
		);

		fireEvent.click(
			screen.getByRole("checkbox", { name: "Select all conflicts" }),
		);
		expect(screen.getByText("2 selected")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
		expect(screen.queryByText("2 selected")).toBeNull();
	});
});
