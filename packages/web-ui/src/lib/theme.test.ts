// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from "vitest";
import { getAccents, initTheme, setAccent } from "./theme.ts";

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

describe("per-appearance accent", () => {
	beforeEach(() => {
		store.clear();
		const root = document.documentElement;
		root.removeAttribute("data-accent-light");
		root.removeAttribute("data-accent-dark");
	});

	test("light and dark hold independent accents", () => {
		setAccent("light", "rose");
		setAccent("dark", "emerald");

		expect(getAccents()).toEqual({ light: "rose", dark: "emerald" });
		expect(document.documentElement.dataset.accentLight).toBe("rose");
		expect(document.documentElement.dataset.accentDark).toBe("emerald");
	});

	test("setting one appearance leaves the other alone", () => {
		setAccent("light", "amber");

		expect(getAccents()).toEqual({ light: "amber", dark: "indigo" });
		expect(document.documentElement.dataset.accentDark).toBe("indigo");
	});

	test("an unknown stored value falls back to the default", () => {
		window.localStorage.setItem("theme-accent-light", "chartreuse");

		expect(getAccents().light).toBe("indigo");
	});

	/** Anyone who picked an accent before it split in two keeps that colour. */
	test("a single legacy accent migrates to both appearances", () => {
		window.localStorage.setItem("theme-accent", "violet");

		expect(getAccents()).toEqual({ light: "violet", dark: "violet" });

		initTheme();
		expect(document.documentElement.dataset.accentLight).toBe("violet");
		expect(document.documentElement.dataset.accentDark).toBe("violet");
	});
});
