import { cleanup, render } from "@testing-library/react";
import type { JSONContent } from "@tiptap/core";
import type { ImageUploadHandler } from "#/components/editor/ImageUploadExtension";
import type { CardReferenceSupport } from "#/components/editor/card-reference/types";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Id } from "#/integrations/local/types";
import { CardDocumentEditor } from "./CardDocumentEditor";

let richTextEditorProps: Record<string, unknown> | null = null;
const useCardReferenceSupportMock = vi.fn();
const imageUploadHandlerMock = vi.fn();

vi.mock("#/components/editor/RichTextEditor", () => ({
	RichTextEditor: (props: Record<string, unknown>) => {
		richTextEditorProps = props;
		return <div data-testid="rich-text-editor" />;
	},
}));

vi.mock("#/components/editor/useCardReferenceSupport", () => ({
	useCardReferenceSupport: (...args: unknown[]) =>
		useCardReferenceSupportMock(...args),
}));

vi.mock("#/components/editor/useImageUpload", () => ({
	useImageUpload: () => imageUploadHandlerMock,
}));

const CONTENT: JSONContent = {
	type: "doc",
	content: [{ type: "paragraph", content: [{ type: "text", text: "Card" }] }],
};

const INTERNAL_SUPPORT: CardReferenceSupport = {
	search: vi.fn(),
	onOpenPreview: vi.fn(),
};

const OVERRIDE_SUPPORT: CardReferenceSupport = {
	search: vi.fn(),
	onOpenPreview: vi.fn(),
};

const OVERRIDE_UPLOAD: ImageUploadHandler = vi.fn(async () => ({
	src: "https://example.com/image.png",
	fileId: "file-1" as Id<"files">,
	storageId: "storage-1" as Id<"_storage">,
}));

describe("CardDocumentEditor", () => {
	beforeEach(() => {
		richTextEditorProps = null;
		useCardReferenceSupportMock.mockReset();
		useCardReferenceSupportMock.mockReturnValue({
			support: INTERNAL_SUPPORT,
			previewCardId: null,
			closePreview: vi.fn(),
		});
	});

	afterEach(() => {
		cleanup();
	});

	test("wires internal image upload and card-reference support by default", () => {
		const openPreview = vi.fn();

		render(
			<CardDocumentEditor
				content={CONTENT}
				whiteboardId={"wb-1" as Id<"whiteboards">}
				onOpenPreview={openPreview}
				placeholder="Type here"
			/>,
		);

		expect(useCardReferenceSupportMock).toHaveBeenCalledWith(
			"wb-1",
			expect.objectContaining({
				onOpenPreview: openPreview,
			}),
		);
		expect(richTextEditorProps).not.toBeNull();
		expect(richTextEditorProps?.cardReferenceSupport).toBe(INTERNAL_SUPPORT);
		expect(richTextEditorProps?.onImageUpload).toBe(imageUploadHandlerMock);
		expect(richTextEditorProps?.placeholder).toBe("Type here");
	});

	test("prefers explicit overrides for support and image upload", () => {
		render(
			<CardDocumentEditor
				content={CONTENT}
				cardReferenceSupport={OVERRIDE_SUPPORT}
				onImageUpload={OVERRIDE_UPLOAD}
			/>,
		);

		expect(richTextEditorProps).not.toBeNull();
		expect(richTextEditorProps?.cardReferenceSupport).toBe(OVERRIDE_SUPPORT);
		expect(richTextEditorProps?.onImageUpload).toBe(OVERRIDE_UPLOAD);
	});
});
