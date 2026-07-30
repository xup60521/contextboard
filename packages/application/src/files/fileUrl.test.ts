import { describe, expect, test } from "vitest";
import {
	fileSrc,
	normalizeImageSources,
	parseFileSrc,
} from "./fileUrl";

describe("file URLs", () => {
	test("round-trips encoded file IDs and rejects malformed sources", () => {
		expect(parseFileSrc(fileSrc("file/a b"))).toBe("file/a b");
		expect(parseFileSrc("contextboard-file:")).toBeNull();
		expect(parseFileSrc("contextboard-file:%")).toBeNull();
		expect(parseFileSrc("https://example.test/image.png")).toBeNull();
	});

	test("normalizes editor and tldraw blob sources without mutating input", () => {
		const input = {
			content: [
				{ attrs: { fileId: "card-file", src: "blob:card" } },
				{
					props: { src: "blob:asset" },
					meta: { fileId: "asset-file" },
				},
				{ attrs: { fileId: "remote", src: "https://example.test/a.png" } },
				{ attrs: { fileId: "inline", src: "data:image/png;base64,AA==" } },
			],
		};
		const result = normalizeImageSources(input);
		expect(result).not.toBe(input);
		expect(result).toMatchObject({
			content: [
				{ attrs: { src: "contextboard-file:card-file" } },
				{ props: { src: "contextboard-file:asset-file" } },
				{ attrs: { src: "https://example.test/a.png" } },
				{ attrs: { src: "data:image/png;base64,AA==" } },
			],
		});
		expect(input.content[0]).toMatchObject({
			attrs: { src: "blob:card" },
		});
	});
});
