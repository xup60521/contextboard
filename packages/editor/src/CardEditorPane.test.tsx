import { cleanup, render } from "@testing-library/react";
import type { JSONContent } from "@tiptap/core";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Id } from "#/integrations/local/types";
import { CardEditorPane } from "./CardEditorPane";

const useDebouncedCardSaveMock = vi.fn();
const useCardReferenceSupportMock = vi.fn();

let cardDocumentEditorProps: Record<string, unknown> | null = null;

vi.mock("#/components/cards/useDebouncedCardSave", () => ({
	useDebouncedCardSave: (...args: unknown[]) => useDebouncedCardSaveMock(...args),
}));

vi.mock("#/components/editor/useCardReferenceSupport", () => ({
	useCardReferenceSupport: (...args: unknown[]) =>
		useCardReferenceSupportMock(...args),
}));

vi.mock("#/components/cards/CardDocumentEditor", () => ({
	CardDocumentEditor: (props: Record<string, unknown>) => {
		cardDocumentEditorProps = props;
		return <div data-testid="card-document-editor" />;
	},
}));

vi.mock("#/components/search/CardPreviewDialog", () => ({
	CardPreviewDialog: ({
		children,
	}: {
		children?: ReactNode;
	}) => <div data-testid="card-preview-dialog">{children}</div>,
}));

const CONTENT: JSONContent = {
	type: "doc",
	content: [{ type: "paragraph", content: [{ type: "text", text: "Alpha" }] }],
};

describe("CardEditorPane", () => {
	beforeEach(() => {
		cardDocumentEditorProps = null;
		useDebouncedCardSaveMock.mockReset();
		useDebouncedCardSaveMock.mockReturnValue({
			scheduleSave: vi.fn(),
			flushSave: vi.fn(),
		});
		useCardReferenceSupportMock.mockReset();
		useCardReferenceSupportMock.mockReturnValue({
			support: { search: vi.fn(), onOpenPreview: vi.fn() },
			previewCardId: null,
			closePreview: vi.fn(),
		});
	});

	afterEach(() => {
		cleanup();
	});

	test("passes the current persisted content into the shared autosave hook", () => {
		render(
			<CardEditorPane
				cardId={"card-1" as Id<"cards">}
				content={CONTENT}
				whiteboardId={"board-1" as Id<"whiteboards">}
			/>,
		);

		expect(useDebouncedCardSaveMock).toHaveBeenCalledWith(
			"card-1",
			450,
			expect.objectContaining({
				initialContent: CONTENT,
			}),
		);
		expect(cardDocumentEditorProps?.content).toEqual(CONTENT);
	});
});
