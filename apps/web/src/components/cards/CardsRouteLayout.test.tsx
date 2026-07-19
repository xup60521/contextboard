import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CardsRouteLayout } from "./CardsRouteLayout";

let currentParams: { cardId?: string } = {};

vi.mock("@tanstack/react-router", () => ({
	Outlet: () => <div data-testid="cards-route-outlet" />,
	createFileRoute:
		() =>
		(config: {
			component: unknown;
		}) =>
			config,
	useParams: () => currentParams,
}));

vi.mock("./CardDetailPage", () => ({
	CardDetailPage: ({ cardId }: { cardId: string }) => (
		<div data-testid="card-detail-page-route">{cardId}</div>
	),
}));

describe("cards route layout", () => {
	beforeEach(() => {
		currentParams = {};
	});

	afterEach(() => {
		cleanup();
	});

	test("renders the outlet for the cards library routes", () => {
		render(<CardsRouteLayout />);

		expect(screen.getByTestId("cards-route-outlet")).not.toBeNull();
		expect(screen.queryByTestId("card-detail-page-route")).toBeNull();
	});

	test("renders the persistent card detail page when a card id is active", () => {
		currentParams = { cardId: "card_1" };

		render(<CardsRouteLayout />);

		expect(screen.getByTestId("card-detail-page-route").textContent).toBe(
			"card_1",
		);
		expect(screen.queryByTestId("cards-route-outlet")).toBeNull();
	});
});
