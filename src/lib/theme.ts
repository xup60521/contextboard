export type ThemeMode = "light" | "dark" | "auto";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "theme";
const listeners = new Set<() => void>();
let systemListenerStarted = false;

export function getThemeMode(): ThemeMode {
	if (typeof window === "undefined") return "auto";

	const stored = window.localStorage.getItem(STORAGE_KEY);
	return stored === "light" || stored === "dark" || stored === "auto"
		? stored
		: "auto";
}

export function getResolvedTheme(): ResolvedTheme {
	if (typeof document === "undefined") return "light";
	return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function applyThemeMode(mode: ThemeMode) {
	if (typeof window === "undefined") return;

	const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
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
	if (systemListenerStarted || typeof window === "undefined") return;
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

/** Subscribe to theme changes (in-app, cross-tab, and system shifts). */
export function subscribeThemeMode(listener: () => void) {
	ensureSystemListener();
	listeners.add(listener);

	const onStorage = (event: StorageEvent) => {
		if (event.key !== STORAGE_KEY) return;
		applyThemeMode(getThemeMode());
		listener();
	};
	window.addEventListener("storage", onStorage);

	return () => {
		listeners.delete(listener);
		window.removeEventListener("storage", onStorage);
	};
}
