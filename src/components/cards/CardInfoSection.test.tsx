import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
	CardInfoSection,
	groupPlacementsByWhiteboard,
	type Placement,
} from "./CardInfoSection";

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		params,
		search,
		...props
	}: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
		to?: string;
		params?: unknown;
		search?: unknown;
	}) => (
		<a
			{...props}
			href="#"
			data-to={typeof to === "string" ? to : ""}
			data-params={JSON.stringify(params ?? null)}
			data-search={JSON.stringify(search ?? null)}
		>
			{children}
		</a>
	),
}));

const BOARD_HISTORY = "board_history" as never;
const BOARD_IDEAS = "board_ideas" as never;

afterEach(() => {
	cleanup();
});

describe("groupPlacementsByWhiteboard", () => {
	test("returns empty array for no placements", () => {
		const result = groupPlacementsByWhiteboard([], new Map());
		expect(result).toEqual([]);
	});

	test("groups single placement", () => {
		const placements: Placement[] = [
			{
				itemId: "item_1",
				whiteboardId: BOARD_HISTORY,
				shapeId: "shape:history_a",
				updatedAt: 100,
			},
		];
		const titles = new Map([[BOARD_HISTORY, "history"]]);
		const result = groupPlacementsByWhiteboard(placements, titles);

		expect(result).toHaveLength(1);
		expect(result[0].title).toBe("history");
		expect(result[0].count).toBe(1);
		expect(result[0].primaryPlacement.shapeId).toBe("shape:history_a");
	});

	test("merges duplicate placements on same whiteboard", () => {
		const placements: Placement[] = [
			{
				itemId: "item_1",
				whiteboardId: BOARD_HISTORY,
				shapeId: "shape:history_a",
				updatedAt: 100,
			},
			{
				itemId: "item_2",
				whiteboardId: BOARD_HISTORY,
				shapeId: "shape:history_b",
				updatedAt: 200,
			},
		];
		const titles = new Map([[BOARD_HISTORY, "history"]]);
		const result = groupPlacementsByWhiteboard(placements, titles);

		expect(result).toHaveLength(1);
		expect(result[0].title).toBe("history");
		expect(result[0].count).toBe(2);
		expect(result[0].primaryPlacement.shapeId).toBe("shape:history_b");
	});

	test("splits placements across different whiteboards", () => {
		const placements: Placement[] = [
			{
				itemId: "item_1",
				whiteboardId: BOARD_HISTORY,
				shapeId: "shape:history_a",
				updatedAt: 100,
			},
			{
				itemId: "item_2",
				whiteboardId: BOARD_IDEAS,
				shapeId: "shape:ideas_a",
				updatedAt: 200,
			},
		];
		const titles = new Map([
			[BOARD_HISTORY, "history"],
			[BOARD_IDEAS, "ideas"],
		]);
		const result = groupPlacementsByWhiteboard(placements, titles);

		expect(result).toHaveLength(2);
		expect(result[0].title).toBe("ideas");
		expect(result[0].count).toBe(1);
		expect(result[1].title).toBe("history");
		expect(result[1].count).toBe(1);
	});

	test("groups root (null) placements together", () => {
		const placements: Placement[] = [
			{
				itemId: "item_1",
				whiteboardId: null,
				shapeId: null,
				updatedAt: 100,
			},
			{
				itemId: "item_2",
				whiteboardId: null,
				shapeId: null,
				updatedAt: 200,
			},
		];
		const result = groupPlacementsByWhiteboard(placements, new Map());

		expect(result).toHaveLength(1);
		expect(result[0].title).toBe("Root");
		expect(result[0].count).toBe(2);
	});

	test("falls back to whiteboard id when title is missing", () => {
		const placements: Placement[] = [
			{
				itemId: "item_1",
				whiteboardId: BOARD_HISTORY,
				shapeId: "shape:history_a",
				updatedAt: 100,
			},
		];
		const result = groupPlacementsByWhiteboard(placements, new Map());

		expect(result).toHaveLength(1);
		expect(result[0].title).toBe(BOARD_HISTORY);
	});
});

describe("CardInfoSection", () => {
	test("shows no placements state", () => {
		render(
			<CardInfoSection
				placements={[]}
				backlinks={[]}
				whiteboardTitleById={new Map()}
				createdAt={1}
				updatedAt={1}
				plainText=""
			/>,
		);

		expect(screen.getByText("Whiteboards (0)")).not.toBeNull();
		expect(
			screen.getByText("Not placed on any whiteboard."),
		).not.toBeNull();
	});

	test("renders single placement", () => {
		render(
			<CardInfoSection
				placements={[
					{
						itemId: "item_1",
						whiteboardId: BOARD_HISTORY,
						shapeId: "shape:history_a",
						updatedAt: 100,
					},
				]}
				backlinks={[]}
				whiteboardTitleById={new Map([[BOARD_HISTORY, "history"]])}
				createdAt={1}
				updatedAt={1}
				plainText=""
			/>,
		);

		expect(screen.getByText("Whiteboards (1)")).not.toBeNull();
		expect(screen.getByText("history")).not.toBeNull();
		expect(screen.queryByText("history (1)")).toBeNull();
	});

	test("merges duplicate placements on same whiteboard", () => {
		render(
			<CardInfoSection
				placements={[
					{
						itemId: "item_1",
						whiteboardId: BOARD_HISTORY,
						shapeId: "shape:history_a",
						updatedAt: 100,
					},
					{
						itemId: "item_2",
						whiteboardId: BOARD_HISTORY,
						shapeId: "shape:history_b",
						updatedAt: 200,
					},
				]}
				backlinks={[]}
				whiteboardTitleById={new Map([[BOARD_HISTORY, "history"]])}
				createdAt={1}
				updatedAt={1}
				plainText=""
			/>,
		);

		expect(screen.getByText("Whiteboards (1)")).not.toBeNull();
		expect(screen.getByText("history (2)")).not.toBeNull();

		const link = screen.getByText("history (2)").closest("a");
		expect(link).not.toBeNull();
		expect(link?.getAttribute("data-search")).toBe(
			JSON.stringify({ focus: "shape:history_b" }),
		);
	});

	test("shows separate entries for different whiteboards", () => {
		render(
			<CardInfoSection
				placements={[
					{
						itemId: "item_1",
						whiteboardId: BOARD_HISTORY,
						shapeId: "shape:history_a",
						updatedAt: 100,
					},
					{
						itemId: "item_1",
						whiteboardId: BOARD_HISTORY,
						shapeId: "shape:history_b",
						updatedAt: 200,
					},
					{
						itemId: "item_2",
						whiteboardId: BOARD_IDEAS,
						shapeId: "shape:ideas_a",
						updatedAt: 300,
					},
				]}
				backlinks={[]}
				whiteboardTitleById={new Map([
					[BOARD_HISTORY, "history"],
					[BOARD_IDEAS, "ideas"],
				])}
				createdAt={1}
				updatedAt={1}
				plainText=""
			/>,
		);

		expect(screen.getByText("Whiteboards (2)")).not.toBeNull();
		expect(screen.getByText("history (2)")).not.toBeNull();
		expect(screen.getByText("ideas")).not.toBeNull();

		const historyLinks = screen.getAllByText("history (2)");
		expect(historyLinks).toHaveLength(1);
	});
});
