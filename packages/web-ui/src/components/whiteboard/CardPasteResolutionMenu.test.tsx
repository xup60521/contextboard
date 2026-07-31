// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CardPasteResolutionMenu } from "./CardPasteResolutionMenu";

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

const pending = {
	cards: 2,
	anchor: { x: 40, y: 80 },
};

describe("CardPasteResolutionMenu", () => {
	test("keeps the decision open without a timeout", () => {
		vi.useFakeTimers();
		const onResolve = vi.fn();

		render(<CardPasteResolutionMenu pending={pending} onResolve={onResolve} />);
		vi.advanceTimersByTime(30_000);

		expect(screen.getByRole("menu")).toBeTruthy();
		expect(onResolve).not.toHaveBeenCalled();
	});

	test("defaults to linking when the user clicks outside", () => {
		const onResolve = vi.fn();
		render(<CardPasteResolutionMenu pending={pending} onResolve={onResolve} />);

		fireEvent.pointerDown(document.body);

		expect(onResolve).toHaveBeenCalledWith("link");
	});

	test("allows an explicit duplicate choice", () => {
		const onResolve = vi.fn();
		render(<CardPasteResolutionMenu pending={pending} onResolve={onResolve} />);

		fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate cards" }));

		expect(onResolve).toHaveBeenCalledWith("duplicate");
	});

	test("defaults to linking on Escape", () => {
		const onResolve = vi.fn();
		render(<CardPasteResolutionMenu pending={pending} onResolve={onResolve} />);

		fireEvent.keyDown(document, { key: "Escape" });

		expect(onResolve).toHaveBeenCalledWith("link");
	});
});
