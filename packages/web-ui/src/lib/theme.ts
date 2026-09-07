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

export type Accents = Readonly<Record<ResolvedTheme, Accent>>;

const STORAGE_KEY = "theme";
const ACCENT_KEYS: Readonly<Record<ResolvedTheme, string>> = {
	light: "theme-accent-light",
	dark: "theme-accent-dark",
};
/** Written when the accent was one value for both appearances. */
const LEGACY_ACCENT_KEY = "theme-accent";
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

function readAccent(appearance: ResolvedTheme): Accent {
	const stored = window.localStorage.getItem(ACCENT_KEYS[appearance]);
	if (isAccent(stored)) return stored;

	// Anyone who chose an accent before it split in two keeps that colour.
	const legacy = window.localStorage.getItem(LEGACY_ACCENT_KEY);
	return isAccent(legacy) ? legacy : DEFAULT_ACCENT;
}

/** Light and dark carry their own accent, so a hue can suit one and not the other. */
export function getAccents(): Accents {
	if (typeof window === "undefined")
		return { light: DEFAULT_ACCENT, dark: DEFAULT_ACCENT };

	return { light: readAccent("light"), dark: readAccent("dark") };
}

export function applyAccents(accents: Accents) {
	if (typeof document === "undefined") return;

	const root = document.documentElement;
	root.setAttribute("data-accent-light", accents.light);
	root.setAttribute("data-accent-dark", accents.dark);
}

/** Persist + apply one appearance's accent and notify every subscriber. */
export function setAccent(appearance: ResolvedTheme, accent: Accent) {
	if (typeof window === "undefined") return;

	window.localStorage.setItem(ACCENT_KEYS[appearance], accent);
	applyAccents({ ...getAccents(), [appearance]: accent });
	notify();
}

/**
 * Apply the stored mode and accent to the document. The web shell does this in
 * an inline script to beat first paint; shells without one (Desktop) call this
 * before rendering.
 */
export function initTheme() {
	applyThemeMode(getThemeMode());
	applyAccents(getAccents());
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
		else if (event.key === null || event.key.startsWith("theme-accent"))
			applyAccents(getAccents());
		else return;
		listener();
	};
	window.addEventListener("storage", onStorage);

	return () => {
		listeners.delete(listener);
		window.removeEventListener("storage", onStorage);
	};
}
