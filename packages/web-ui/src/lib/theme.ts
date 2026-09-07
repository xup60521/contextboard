export type ThemeMode = "light" | "dark" | "auto";
export type ResolvedTheme = "light" | "dark";

/**
 * The accents on offer, each a Tailwind palette wired up in `styles.css`. The
 * order is the order they appear in Settings: cool hues first, then warm, then
 * the neutral for people who want no colour at all.
 */
export const ACCENTS = [
	"indigo",
	"violet",
	"blue",
	"cyan",
	"emerald",
	"amber",
	"rose",
	"slate",
] as const;

export type Accent = (typeof ACCENTS)[number];

export const DEFAULT_ACCENT: Accent = "indigo";

const STORAGE_KEY = "theme";
const ACCENT_KEY = "theme-accent";
const listeners = new Set<() => void>();
let systemListenerStarted = false;

export function getThemeMode(): ThemeMode {
	if (typeof window === "undefined") return "auto";

	const stored = window.localStorage.getItem(STORAGE_KEY);
	return stored === "light" || stored === "dark" || stored === "auto"
		? stored
		: "auto";
}

function isAccent(value: string | null): value is Accent {
	return ACCENTS.includes(value as Accent);
}

export function getAccent(): Accent {
	if (typeof window === "undefined") return DEFAULT_ACCENT;

	const stored = window.localStorage.getItem(ACCENT_KEY);
	return isAccent(stored) ? stored : DEFAULT_ACCENT;
}

export function applyAccent(accent: Accent) {
	if (typeof document === "undefined") return;
	document.documentElement.setAttribute("data-accent", accent);
}

/** Persist + apply an accent and notify every subscriber. */
export function setAccent(accent: Accent) {
	if (typeof window === "undefined") return;

	window.localStorage.setItem(ACCENT_KEY, accent);
	applyAccent(accent);
	notify();
}

/**
 * Apply the stored mode and accent to the document. The web shell does this in
 * an inline script to beat first paint; shells without one (Desktop) call this
 * before rendering.
 */
export function initTheme() {
	applyThemeMode(getThemeMode());
	applyAccent(getAccent());
}

export function getResolvedTheme(): ResolvedTheme {
	if (typeof document === "undefined") return "light";
	return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function applyThemeMode(mode: ThemeMode) {
	if (typeof window === "undefined") return;

	const prefersDark =
		typeof window.matchMedia === "function" &&
		window.matchMedia("(prefers-color-scheme: dark)").matches;
	const resolved = mode === "auto" ? (prefersDark ? "dark" : "light") : mode;
	const root = document.documentElement;

	root.classList.remove("light", "dark");
	root.classList.add(resolved);

	if (mode === "auto") {
		root.removeAttribute("data-theme");
	} else {
		root.setAttribute("data-theme", mode);
	}

	root.style.colorScheme = resolved;
}

function notify() {
	for (const listener of listeners) listener();
}

/** Persist + apply a theme mode and notify every subscriber. */
export function setThemeMode(mode: ThemeMode) {
	if (typeof window === "undefined") return;

	window.localStorage.setItem(STORAGE_KEY, mode);
	applyThemeMode(mode);
	notify();
}

function ensureSystemListener() {
	if (
		systemListenerStarted ||
		typeof window === "undefined" ||
		typeof window.matchMedia !== "function"
	)
		return;
	systemListenerStarted = true;

	const media = window.matchMedia("(prefers-color-scheme: dark)");
	media.addEventListener("change", () => {
		// Re-resolve only while following the system preference.
		if (getThemeMode() === "auto") {
			applyThemeMode("auto");
			notify();
		}
	});
}

/**
 * Subscribe to theme changes — mode or accent — from anywhere: in-app,
 * another tab, or the system flipping to dark.
 */
export function subscribeThemeMode(listener: () => void) {
	ensureSystemListener();
	listeners.add(listener);

	const onStorage = (event: StorageEvent) => {
		if (event.key === STORAGE_KEY) applyThemeMode(getThemeMode());
		else if (event.key === ACCENT_KEY) applyAccent(getAccent());
		else return;
		listener();
	};
	window.addEventListener("storage", onStorage);

	return () => {
		listeners.delete(listener);
		window.removeEventListener("storage", onStorage);
	};
}
