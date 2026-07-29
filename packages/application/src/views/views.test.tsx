// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ApplicationRuntimeProvider } from "../ApplicationRuntimeProvider";
import { createRepositoryCardsService } from "../cards/repository-cards-service";
import type { ApplicationRuntime } from "../runtime";
import { createMemoryWorkspaceRepository } from "../testing";
import { ApplicationShell } from "./ApplicationShell";
import { CardDetailView } from "./CardDetailView";
import { CardListView } from "./CardListView";

vi.mock("@contextboard/editor", () => ({
	RichTextEditor: ({
		onChange,
	}: {
		onChange?: (content: unknown) => void;
	}) => (
		<textarea
			aria-label="Card content"
			onChange={(event) =>
				onChange?.({
					type: "doc",
					content: [
						{
							type: "heading",
							attrs: { level: 1 },
							content: [{ type: "text", text: event.target.value }],
						},
					],
				})
			}
		/>
	),
}));

function setup(children: ReactNode) {
	let clock = 1_000;
	let counter = 0;
	const repository = createMemoryWorkspaceRepository({ now: () => ++clock });
	const navigate = vi.fn();
	const runtime: ApplicationRuntime = {
		platform: "desktop",
		workspaceId: "workspace-1",
		cards: createRepositoryCardsService(repository, {
			now: () => ++clock,
			createId: () => `card-${++counter}`,
		}),
		navigation: {
			cardsHref: () => "/cards",
			cardHref: (cardId) => `/cards/${cardId}`,
			navigate,
		},
		sync: { state: "local-only" },
	};
	render(
		<ApplicationRuntimeProvider runtime={runtime}>
			{children}
		</ApplicationRuntimeProvider>,
	);
	return { runtime, navigate };
}

afterEach(cleanup);

describe("shared card list view", () => {
	test("creates a card and navigates to it", async () => {
		const { navigate } = setup(<CardListView />);
		expect(await screen.findByText("No cards yet")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "New card" }));
		await waitFor(() => expect(navigate).toHaveBeenCalledWith("/cards/card-1"));
		expect(
			await screen.findByRole("heading", { name: "New card" }),
		).toBeTruthy();
	});

	test("filters the list by search term", async () => {
		const { runtime } = setup(<CardListView />);
		await runtime.cards.create();
		await screen.findByRole("heading", { name: "New card" });
		fireEvent.change(screen.getByLabelText("Search cards"), {
			target: { value: "nothing" },
		});
		await waitFor(() =>
			expect(screen.getByText('No results for "nothing"')).toBeTruthy(),
		);
	});
});

describe("shared card detail view", () => {
	test("edits, autosaves and deletes a card", async () => {
		const { runtime, navigate } = setup(<CardDetailView cardId="card-1" />);
		await runtime.cards.create();
		const editor = await screen.findByLabelText("Card content");
		fireEvent.change(editor, { target: { value: "Renamed card" } });
		await waitFor(
			() =>
				expect(screen.getByTestId("cb-save-state").textContent).toBe(
					"All changes saved",
				),
			{ timeout: 3_000 },
		);
		expect((await runtime.cards.get("card-1"))?.title).toBe("Renamed card");

		fireEvent.click(screen.getByRole("button", { name: "Delete card" }));
		fireEvent.click(screen.getByRole("button", { name: "Delete" }));
		await waitFor(() => expect(navigate).toHaveBeenCalledWith("/cards"));
		expect(await runtime.cards.get("card-1")).toBeNull();
	});

	test("reports a missing card instead of rendering an empty editor", async () => {
		setup(<CardDetailView cardId="card-404" />);
		expect(await screen.findByText("This card no longer exists.")).toBeTruthy();
	});
});

describe("application shell", () => {
	test("renders shared navigation and sync state", () => {
		const { navigate } = setup(
			<ApplicationShell activeHref="/cards">
				<p>Body</p>
			</ApplicationShell>,
		);
		expect(screen.getByText("Local only")).toBeTruthy();
		const link = screen.getByRole("link", { name: "Cards" });
		expect(link.getAttribute("aria-current")).toBe("page");
		fireEvent.click(link);
		expect(navigate).toHaveBeenCalledWith("/cards");
	});
});
