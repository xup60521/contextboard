import { afterEach, describe, expect, test, vi } from "vitest";
import { setExternalLinkOpener } from "./external-link";
import { normalizeLinkInput } from "./link-commands";
import { followLink } from "./link-interaction";

function anchor(attributes: Record<string, string>): HTMLElement {
	const element = document.createElement("a");
	for (const [name, value] of Object.entries(attributes)) {
		element.setAttribute(name, value);
	}
	return element;
}

afterEach(() => {
	setExternalLinkOpener(null);
});

describe("followLink", () => {
	test("hands external links to the platform opener", () => {
		const open = vi.fn();
		setExternalLinkOpener(open);

		const handled = followLink(anchor({ href: "https://example.com" }), {
			onOpenPreview: null,
			onOpenWhiteboard: null,
		});

		expect(handled).toBe(true);
		expect(open).toHaveBeenCalledWith("https://example.com");
	});

	test("leaves unsupported schemes alone", () => {
		const open = vi.fn();
		setExternalLinkOpener(open);

		const handled = followLink(anchor({ href: "javascript:alert(1)" }), {
			onOpenPreview: null,
			onOpenWhiteboard: null,
		});

		expect(handled).toBe(false);
		expect(open).not.toHaveBeenCalled();
	});

	test("keeps card references on the preview gesture", () => {
		const open = vi.fn();
		const onOpenPreview = vi.fn();
		setExternalLinkOpener(open);

		const handled = followLink(
			anchor({ href: "/cards/abc123", "data-card-id": "abc123" }),
			{ onOpenPreview, onOpenWhiteboard: null },
		);

		expect(handled).toBe(true);
		expect(onOpenPreview).toHaveBeenCalledWith("abc123");
		expect(open).not.toHaveBeenCalled();
	});
});

describe("normalizeLinkInput", () => {
	test("assumes https for bare domains", () => {
		expect(normalizeLinkInput("example.com/docs")).toBe(
			"https://example.com/docs",
		);
	});

	test("keeps supported schemes and in-app routes", () => {
		expect(normalizeLinkInput(" mailto:hi@example.com ")).toBe(
			"mailto:hi@example.com",
		);
		expect(normalizeLinkInput("/cards/abc123")).toBe("/cards/abc123");
	});

	test("rejects empty input and unsupported schemes", () => {
		expect(normalizeLinkInput("   ")).toBeUndefined();
		expect(normalizeLinkInput("javascript:alert(1)")).toBeUndefined();
	});
});
