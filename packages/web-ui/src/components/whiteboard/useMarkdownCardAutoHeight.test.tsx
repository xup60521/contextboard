// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CardHeightMeasurementContext } from "./CardHeightMeasurementContext";
import type { MarkdownCardShape } from "./MarkdownCardShapeTypes";
import { useMarkdownCardAutoHeight } from "./useMarkdownCardAutoHeight";

const updateShape = vi.fn();

vi.mock("tldraw", async (importOriginal) => ({
	...(await importOriginal<typeof import("tldraw")>()),
	useEditor: () => ({ updateShape }),
}));

const shape = {
	id: "shape:pending-height",
	type: "markdown-card",
	props: {
		w: 576,
		h: 1200,
		contentLoaded: false,
		heightMeasurementPending: true,
	},
} as MarkdownCardShape;

describe("useMarkdownCardAutoHeight", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		updateShape.mockReset();
	});

	test("measures pending persisted content after the renderer is ready", async () => {
		const completeMeasurement = vi.fn().mockResolvedValue(true);
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
			queueMicrotask(() => callback(0));
			return 1;
		});
		const wrapper = ({ children }: { children: ReactNode }) => (
			<CardHeightMeasurementContext.Provider value={completeMeasurement}>
				{children}
			</CardHeightMeasurementContext.Provider>
		);
		const { result } = renderHook(
			() =>
				useMarkdownCardAutoHeight({
					shape,
					minHeight: 96,
					isEditing: false,
				}),
			{ wrapper },
		);
		const card = document.createElement("div");
		Object.defineProperty(card, "scrollHeight", { value: 2891 });
		card.getClientRects = () => [{ width: 576, height: 1200 }] as never;
		result.current.cardRef.current = card;

		act(() => result.current.setIsContentReady(true));

		await waitFor(() => {
			expect(completeMeasurement).toHaveBeenCalledWith(shape.id, 2891);
		});
		expect(updateShape).not.toHaveBeenCalled();
	});
});
