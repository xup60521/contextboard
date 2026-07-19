import { describe, expect, test } from "vitest";
import { deriveCardMetadata } from "./cardMetadata";

describe("deriveCardMetadata", () => {
	test("uses the first row when it is a heading", () => {
		const metadata = deriveCardMetadata({
			type: "doc",
			content: [
				{
					type: "heading",
					attrs: { level: 1 },
					content: [{ type: "text", text: "Project context" }],
				},
				{
					type: "paragraph",
					content: [{ type: "text", text: "Details live here." }],
				},
			],
		});

		expect(metadata.derivedTitle).toBe("Project context");
		expect(metadata.plainText).toBe("Project context\nDetails live here.");
		expect(metadata.preview).toBe("Project context\nDetails live here.");
	});

	test("uses the first row when it is normal text", () => {
		const metadata = deriveCardMetadata({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [{ type: "text", text: "First paragraph" }],
				},
				{
					type: "paragraph",
					content: [{ type: "text", text: "Second paragraph" }],
				},
			],
		});

		expect(metadata.derivedTitle).toBe("First paragraph");
		expect(metadata.plainText).toBe("First paragraph\nSecond paragraph");
	});

	test("does not prefer a heading over an earlier normal text row", () => {
		const metadata = deriveCardMetadata({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [{ type: "text", text: "Plain first line" }],
				},
				{
					type: "heading",
					attrs: { level: 1 },
					content: [{ type: "text", text: "Heading second line" }],
				},
			],
		});

		expect(metadata.derivedTitle).toBe("Plain first line");
		expect(metadata.plainText).toBe("Plain first line\nHeading second line");
	});

	test("flattens nested list text", () => {
		const metadata = deriveCardMetadata({
			type: "doc",
			content: [
				{
					type: "bulletList",
					content: [
						{
							type: "listItem",
							content: [
								{
									type: "paragraph",
									content: [{ type: "text", text: "Parent item" }],
								},
								{
									type: "bulletList",
									content: [
										{
											type: "listItem",
											content: [
												{
													type: "paragraph",
													content: [{ type: "text", text: "Child item" }],
												},
											],
										},
									],
								},
							],
						},
					],
				},
			],
		});

		expect(metadata.derivedTitle).toBe("Parent item Child item");
		expect(metadata.plainText).toBe("Parent item Child item");
	});

	test("falls back for empty content", () => {
		expect(deriveCardMetadata({ type: "doc", content: [] })).toEqual({
			derivedTitle: "Untitled card",
			plainText: "",
			preview: "",
		});
	});

	test("can derive text from math-only content", () => {
		const metadata = deriveCardMetadata({
			type: "doc",
			content: [
				{
					type: "blockMath",
					attrs: { latex: "\\int_0^1 x^2 dx" },
				},
			],
		});

		expect(metadata.derivedTitle).toBe("\\int_0^1 x^2 dx");
		expect(metadata.plainText).toBe("\\int_0^1 x^2 dx");
	});

	test("falls back for malformed content", () => {
		expect(deriveCardMetadata("not a document")).toEqual({
			derivedTitle: "Untitled card",
			plainText: "",
			preview: "",
		});
	});
});
