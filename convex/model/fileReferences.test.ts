import { describe, expect, test } from "vitest";
import {
	extractCardImageRefs,
	extractTldrawImageRefs,
	normalizeCardImageFileIds,
	normalizeTldrawImageFileIds,
} from "./fileReferences";

describe("fileReferences helpers", () => {
	test("extracts and normalizes TipTap image file references", () => {
		const content = {
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [
						{
							type: "image",
							attrs: { src: "https://files.example/one" },
						},
					],
				},
				{
					type: "paragraph",
					content: [
						{
							type: "image",
							attrs: {
								src: "https://files.example/two",
								fileId: "file_2",
							},
						},
					],
				},
			],
		};

		const extracted = extractCardImageRefs(content);
		expect([...extracted.fileIds]).toEqual(["file_2"]);
		expect([...extracted.legacyUrls]).toEqual(["https://files.example/one"]);

		const normalized = normalizeCardImageFileIds(
			content,
			new Map([["https://files.example/one", "file_1" as never]]),
		);
		expect(normalized.changed).toBe(true);
		expect(
			normalized.content as {
				content: Array<{ content: Array<{ attrs: { fileId?: string } }> }>;
			},
		).toMatchObject({
			content: [
				{
					content: [{ attrs: { fileId: "file_1" } }],
				},
				{
					content: [{ attrs: { fileId: "file_2" } }],
				},
			],
		});
	});

	test("extracts and normalizes referenced tldraw asset file ids", () => {
		const snapshot = {
			store: {
				"shape:image": {
					id: "shape:image",
					typeName: "shape",
					type: "image",
					props: { assetId: "asset:image" },
				},
				"asset:image": {
					id: "asset:image",
					typeName: "asset",
					type: "image",
					props: { src: "https://files.example/one" },
					meta: {},
				},
				"asset:other": {
					id: "asset:other",
					typeName: "asset",
					type: "image",
					props: { src: "https://files.example/unused" },
					meta: {},
				},
			},
		};

		const extracted = extractTldrawImageRefs(snapshot);
		expect([...extracted.fileIds]).toEqual([]);
		expect([...extracted.legacyUrls]).toEqual(["https://files.example/one"]);

		const normalized = normalizeTldrawImageFileIds(
			snapshot,
			new Map([["https://files.example/one", "file_1" as never]]),
		);
		expect(normalized.changed).toBe(true);
		expect(normalized.snapshot).toMatchObject({
			store: {
				"asset:image": {
					meta: { fileId: "file_1" },
				},
			},
		});
		expect(normalized.snapshot).not.toMatchObject({
			store: {
				"asset:other": {
					meta: { fileId: "file_1" },
				},
			},
		});
	});
});
