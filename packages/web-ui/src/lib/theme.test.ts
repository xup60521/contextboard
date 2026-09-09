// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from "vitest";
import { getAccent, getCustomColor, initTheme, setAccent } from "./theme.ts";

/**
 * Node 26 gates its own global `localStorage` behind `--localstorage-file`, so
 * jsdom's window has none here. The theme module only ever reads and writes
 * keys, so a Map is a faithful stand-in.
 */
const store = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
	configurable: true,
	value: {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => void store.set(key, value),
		removeItem: (key: string) => void store.delete(key),
		clear: () => store.clear(),
	},
});

describe("accent", () => {
	beforeEach(() => {
		store.clear();
		const root = document.documentElement;
		root.removeAttribute("data-accent-light");
		root.removeAttribute("data-accent-dark");
		for (const name of [
			"--brand-fill-light",
			"--brand-text-light",
			"--brand-fill-dark",
			"--brand-text-dark",
		]) {
			root.style.removeProperty(name);
		}
	});

	test("one choice applies to both appearances", () => {
		setAccent("teal");

		expect(getAccent()).toBe("teal");
		expect(document.documentElement.dataset.accentLight).toBe("teal");
		expect(document.documentElement.dataset.accentDark).toBe("teal");
	});

	test("an unknown stored value falls back to the default", () => {
		window.localStorage.setItem("theme-accent", "chartreuse");

		expect(getAccent()).toBe("indigo");
	});

	/** Anyone who had light and dark set apart keeps their light choice. */
	test("a pre-split light/dark accent migrates to the light choice", () => {
		window.localStorage.setItem("theme-accent-light", "violet");
		window.localStorage.setItem("theme-accent-dark", "pink");

		expect(getAccent()).toBe("violet");

		initTheme();
		expect(document.documentElement.dataset.accentLight).toBe("violet");
		expect(document.documentElement.dataset.accentDark).toBe("violet");
	});

	/**
	 * A stale pre-split key from before light/dark existed at all must not
	 * shadow a more specific, later per-appearance choice.
	 */
	test("a specific pre-split light choice outranks a stale single-key accent", () => {
		window.localStorage.setItem("theme-accent", "indigo");
		window.localStorage.setItem("theme-accent-light", "pink");

		expect(getAccent()).toBe("pink");
	});

	test("picking an accent through the unified control retires the old per-appearance keys", () => {
		window.localStorage.setItem("theme-accent-light", "pink");

		setAccent("teal");

		expect(getAccent()).toBe("teal");
		expect(window.localStorage.getItem("theme-accent-light")).toBeNull();
	});

	test("custom overrides only the fill, for both appearances, with the chosen colour", () => {
		setAccent("custom", "#ff00aa");

		expect(getAccent()).toBe("custom");
		expect(getCustomColor()).toBe("#ff00aa");
		const style = document.documentElement.style;
		expect(style.getPropertyValue("--brand-fill-light")).toBe("#ff00aa");
		expect(style.getPropertyValue("--brand-fill-dark")).toBe("#ff00aa");
		// Text keeps its CSS-driven shade — an arbitrary colour has no guaranteed contrast.
		expect(style.getPropertyValue("--brand-text-light")).toBe("");
		expect(style.getPropertyValue("--brand-text-dark")).toBe("");
	});

	test("switching back to a preset clears the custom fill override", () => {
		setAccent("custom", "#ff00aa");
		setAccent("indigo");

		expect(
			document.documentElement.style.getPropertyValue("--brand-fill-light"),
		).toBe("");
	});
});
