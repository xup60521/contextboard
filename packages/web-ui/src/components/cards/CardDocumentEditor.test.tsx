// @vitest-environment jsdom

import type {
	CardReferenceRuntime,
	ImageUploadRuntime,
} from "@contextboard/editor";
import { cleanup, render } from "@testing-library/react";
import type { JSONContent } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CardDocumentEditor } from "./CardDocumentEditor";

let richTextEditorProps: Record<string, unknown> | null = null;
const searchMock = vi.fn();
const uploadMock = vi.fn();
const resolveUrlMock = vi.fn();
const runtime = {
	cards: { search: searchMock },
	files: {
		upload: uploadMock,
		resolveUrl: resolveUrlMock,
	},
};

vi.mock("@contextboard/application", async (importOriginal) => ({
	...(await importOriginal<typeof import("@contextboard/application")>()),
	useApplicationRuntime: () => runtime,
}));

vi.mock("@contextboard/editor", async (importOriginal) => ({
	...(await importOriginal<typeof import("@contextboard/editor")>()),
	RichTextEditor: (props: Record<string, unknown>) => {
		richTextEditorProps = props;
		return <div data-testid="rich-text-editor" />;
	},
}));

const CONTENT: JSONContent = {
	type: "doc",
	content: [{ type: "paragraph", content: [{ type: "text", text: "Card" }] }],
};
const OVERRIDE_SUPPORT: CardReferenceRuntime = {
	search: vi.fn(),
	onOpenPreview: vi.fn(),
};
const OVERRIDE_UPLOAD: ImageUploadRuntime = vi.fn(async () => ({
	src: "https://example.com/image.png",
	fileId: "file-1",
	storageId: "storage-1",
}));

describe("CardDocumentEditor", () => {
	beforeEach(() => {
		richTextEditorProps = null;
		searchMock.mockReset();
		uploadMock.mockReset();
		resolveUrlMock.mockReset();
	});
	afterEach(cleanup);

	test("wires runtime image upload and card-reference support by default", async () => {
		const openPreview = vi.fn();
		searchMock.mockResolvedValue([{ id: "other", title: "Other" }]);
		uploadMock.mockResolvedValue({
			fileId: "file-1",
			name: "image.png",
			contentType: "image/png",
			size: 3,
		});
		resolveUrlMock.mockResolvedValue("blob:resolved");

		render(
			<CardDocumentEditor
				cardId="card-1"
				content={CONTENT}
				onOpenPreview={openPreview}
				placeholder="Type here"
			/>,
		);

		const support = richTextEditorProps?.cardReferenceSupport as CardReferenceRuntime;
		expect(await support.search("oth", new AbortController().signal)).toEqual([
			{ id: "other", title: "Other" },
		]);
		expect(searchMock).toHaveBeenCalledWith({
			query: "oth",
			excludeCardId: "card-1",
		});
		support.onOpenPreview?.("other");
		expect(openPreview).toHaveBeenCalledWith("other");

		const upload = richTextEditorProps?.onImageUpload as ImageUploadRuntime;
		const file = new File(["png"], "image.png", { type: "image/png" });
		expect(await upload(file)).toEqual({
			fileId: "file-1",
			storageId: "file-1",
			src: "contextboard-file:file-1",
		});
		expect(uploadMock).toHaveBeenCalledWith(file);
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
		expect(richTextEditorProps?.cardReferenceSupport).toBe(OVERRIDE_SUPPORT);
		expect(richTextEditorProps?.onImageUpload).toBe(OVERRIDE_UPLOAD);
	});
});
