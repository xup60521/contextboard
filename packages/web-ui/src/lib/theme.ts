export type ThemeMode = "light" | "dark" | "auto";
export type ResolvedTheme = "light" | "dark";

/**
 * The preset accents on offer, each a Tailwind palette wired up in
 * `styles.css`. One choice sets both appearances at once; only its concrete
 * shade differs per appearance, not the hue itself.
 */
export const ACCENTS = [
	"red",
	"orange",
	"amber",
	"emerald",
	"teal",
	"sky",
	"indigo",
	"violet",
	"purple",
	"pink",
] as const;

export type PresetAccent = (typeof ACCENTS)[number];
/** `"custom"` escapes the presets for any colour, via `getCustomColor`. */
export type Accent = PresetAccent | "custom";

export const DEFAULT_ACCENT: Accent = "indigo";
export const DEFAULT_CUSTOM_COLOR = "#6366f1";

const STORAGE_KEY = "theme";
const ACCENT_KEY = "theme-accent";
const CUSTOM_COLOR_KEY = "theme-accent-custom";
/** Written back when light and dark accents could still diverge. */
const LEGACY_LIGHT_ACCENT_KEY = "theme-accent-light";
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
	return value === "custom" || ACCENTS.includes(value as PresetAccent);
}

/** One accent for both appearances. */
export function getAccent(): Accent {
	if (typeof window === "undefined") return DEFAULT_ACCENT;

	const stored = window.localStorage.getItem(ACCENT_KEY);
	if (isAccent(stored)) return stored;

	// Anyone who had light and dark set apart keeps their light choice.
	const legacy = window.localStorage.getItem(LEGACY_LIGHT_ACCENT_KEY);
	return isAccent(legacy) ? legacy : DEFAULT_ACCENT;
}

export function getCustomColor(): string {
	if (typeof window === "undefined") return DEFAULT_CUSTOM_COLOR;
	return window.localStorage.getItem(CUSTOM_COLOR_KEY) ?? DEFAULT_CUSTOM_COLOR;
}

/**
 * Apply the accent to both appearances at once. A preset lets `styles.css`
 * pick each appearance's concrete shade; `"custom"` overrides every brand
 * variable directly, since an arbitrary colour has no per-appearance tuning.
 */
export function applyAccent(
	accent: Accent,
	customColor: string = getCustomColor(),
) {
	if (typeof document === "undefined") return;

	const root = document.documentElement;
	root.setAttribute("data-accent-light", accent);
	root.setAttribute("data-accent-dark", accent);

	const overrides = [
		"--brand-fill-light",
		"--brand-text-light",
		"--brand-fill-dark",
		"--brand-text-dark",
	];
	for (const name of overrides) {
		if (accent === "custom") root.style.setProperty(name, customColor);
		else root.style.removeProperty(name);
	}
}

/** Persist + apply the accent (and its colour, when custom) and notify every subscriber. */
export function setAccent(accent: Accent, customColor?: string) {
	if (typeof window === "undefined") return;

	window.localStorage.setItem(ACCENT_KEY, accent);
	if (accent === "custom" && customColor) {
		window.localStorage.setItem(CUSTOM_COLOR_KEY, customColor);
	}
	applyAccent(accent, customColor ?? getCustomColor());
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
		else if (event.key === null || event.key.startsWith("theme-accent"))
			applyAccent(getAccent());
		else return;
		listener();
	};
	window.addEventListener("storage", onStorage);

	return () => {
		listeners.delete(listener);
		window.removeEventListener("storage", onStorage);
	};
}
