import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";
import { ACCENTS } from "./theme.ts";

/**
 * Every accent claims its text step is readable on its surface. This holds
 * that claim to a number instead of an eye, and it reads the claim out of
 * `styles.css` rather than repeating it, so changing a step in the stylesheet
 * changes what is asserted here.
 *
 * There are three such claims, and the last two exist because the rail is no
 * longer plain white. The link step has to read on the canvas; the sidebar's
 * secondary text has to survive the accent tint mixed into that rail; and the
 * strong step has to read on the active row, whose background is made of the
 * very accent the text is drawn in. The last one is checked twice: once for
 * the ten palettes, and once by sweep for the custom accent, whose deep step
 * is computed from a hex nobody vetted.
 */

const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const palette = readFileSync(
	createRequire(import.meta.url).resolve("tailwindcss/theme.css"),
	"utf8",
);

/** WCAG asks for 4.5:1 on body text; link and label text is body text. */
const MIN_RATIO = 4.5;

type Rgb = readonly [r: number, g: number, b: number];
type Oklab = { l: number; a: number; b: number };

/** Every lookup here is a contract with the stylesheet; a miss is a test bug. */
function capture(pattern: RegExp, text: string, what: string): string {
	const match = pattern.exec(text);
	if (!match?.[1]) throw new Error(`no ${what}`);
	return match[1];
}

/** `oklch(51.1% 0.262 276.966)` and `oklch(0.205 0 0)` both occur in our CSS. */
function parseOklab(value: string): Oklab {
	const match = /oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+(-?[\d.]+)/.exec(value);
	if (!match) throw new Error(`not an oklch colour: ${value}`);
	const [, rawL, percent, chroma, hue] = match;
	const radians = (Number(hue) * Math.PI) / 180;
	return {
		l: Number(rawL) / (percent === "%" ? 100 : 1),
		a: Number(chroma) * Math.cos(radians),
		b: Number(chroma) * Math.sin(radians),
	};
}

function toRgb({ l, a, b }: Oklab): Rgb {
	return oklabToLinearRgb(l, a, b);
}

/**
 * What the browser does for `color-mix(in oklab, top weight, bottom)`: a
 * straight lerp of the three axes. Written here rather than approximated so
 * the assertion judges the colour that actually paints.
 */
function mixOklab(top: Oklab, bottom: Oklab, weight: number): Oklab {
	const lerp = (x: number, y: number) => x * weight + y * (1 - weight);
	return {
		l: lerp(top.l, bottom.l),
		a: lerp(top.a, bottom.a),
		b: lerp(top.b, bottom.b),
	};
}

/** Ottosson's inverse OKLab matrices, stopping at linear sRGB. */
function oklabToLinearRgb(l: number, a: number, b: number): Rgb {
	const long = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const medium = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const short = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
	const clamp = (channel: number) => Math.min(1, Math.max(0, channel));
	return [
		clamp(4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short),
		clamp(-1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short),
		clamp(-0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short),
	];
}

/** The same matrices forward, for the one accent that starts life as a hex. */
function linearRgbToOklab([r, g, b]: Rgb): Oklab {
	const long = Math.cbrt(
		0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b,
	);
	const medium = Math.cbrt(
		0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b,
	);
	const short = Math.cbrt(
		0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b,
	);
	return {
		l: 0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short,
		a: 1.9779984951 * long - 2.428592205 * medium + 0.4505937099 * short,
		b: 0.0259040371 * long + 0.7827717662 * medium - 0.808675766 * short,
	};
}

/** WCAG 2.x relative luminance, which wants linear-light channels. */
function luminance([r, g, b]: Rgb): number {
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: Rgb, b: Rgb): number {
	const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (high + 0.05) / (low + 0.05);
}

/** `--brand-text-light: var(--color-indigo-600)` -> the palette's oklch. */
function resolveToken(block: string, token: string): Oklab {
	const variable = capture(
		new RegExp(`${token}:\\s*var\\((--color-[\\w-]+)\\)`),
		block,
		`${token} declaration`,
	);
	return parseOklab(
		capture(
			new RegExp(`${variable}:\\s*([^;]+);`),
			palette,
			`Tailwind colour ${variable}`,
		),
	);
}

/**
 * A theme token that forwards to a brand step: `--lagoon-strong` reads
 * `--brand-strong-light` in light but reuses `--brand-text-dark` in dark.
 * Following the same indirection the stylesheet does keeps this honest when
 * an appearance shares a step instead of declaring its own.
 */
function resolveDerived(theme: string, block: string, token: string): Oklab {
	const brand = capture(
		new RegExp(`${token}:\\s*var\\((--brand-[\\w-]+)\\)`),
		theme,
		`${token} declaration`,
	);
	return resolveToken(block, brand);
}

/**
 * The declarations of the rule a selector leads. Anchored to the start of a
 * line so `.dark` finds its own rule rather than the mention inside
 * `@custom-variant`, and tolerant of the rest of a selector list, since the
 * theme blocks are shared with `[data-accent-scope]`.
 */
function ruleBody(selector: string): string {
	return capture(
		new RegExp(`^\\${selector}[^{}]*\\{([^}]*)\\}`, "m"),
		styles,
		`rule for ${selector}`,
	);
}

const BACKGROUND = /--background:\s*(oklch\([^)]*\))/;

/**
 * The two blocks that derive everything from the accent. Light leads with
 * `:root`, which the brand-fill defaults also use, so it is found by the
 * scope selector it shares instead.
 */
const THEMES = {
	light: ruleBody("[data-accent-scope]"),
	dark: ruleBody(".dark"),
} as const;

/** The surface each pair is judged against, read from the theme itself. */
const SURFACES = {
	light: toRgb(parseOklab(capture(BACKGROUND, styles, "light --background"))),
	dark: toRgb(
		parseOklab(capture(BACKGROUND, THEMES.dark, "dark --background")),
	),
} as const;

const SIDEBAR =
	/--sidebar:\s*color-mix\(in oklab, var\(--lagoon\) ([\d.]+)%, (oklch\([^)]*\))\)/;
const MUTED = /--muted-foreground:\s*(oklch\([^)]*\))/;

const ROW_ACTIVE =
	/--sidebar-row-active:\s*color-mix\(in oklab, var\(--lagoon\) ([\d.]+)%, transparent\)/;

/** The rail as it paints under one accent: that accent's fill mixed into the base. */
function sidebarSurface(theme: string, fill: Oklab): Oklab {
	const match = SIDEBAR.exec(theme);
	if (!match) throw new Error("no --sidebar colour-mix");
	const [, tint, base] = match;
	return mixOklab(fill, parseOklab(base), Number(tint) / 100);
}

/**
 * The sRGB transfer function. Row states are translucent, and a translucent
 * layer composites in gamma-encoded space the way the browser paints it —
 * while WCAG luminance wants linear light, so the blend round-trips.
 */
const encode = (channel: number) =>
	channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;
const decode = (channel: number) =>
	channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

/** The row you are looking at: the accent laid over the rail at the row's alpha. */
function activeRowSurface(theme: string, fill: Oklab): Rgb {
	const match = ROW_ACTIVE.exec(theme);
	if (!match) throw new Error("no --sidebar-row-active colour-mix");
	const alpha = Number(match[1]) / 100;
	const top = toRgb(fill);
	const bottom = toRgb(sidebarSurface(theme, fill));
	const blend = (t: number, b: number) =>
		decode(alpha * encode(t) + (1 - alpha) * encode(b));
	return [
		blend(top[0], bottom[0]),
		blend(top[1], bottom[1]),
		blend(top[2], bottom[2]),
	];
}

describe("accent contrast", () => {
	test.each(ACCENTS)("%s reads on both surfaces", (accent) => {
		for (const appearance of ["light", "dark"] as const) {
			const block = ruleBody(`[data-accent-${appearance}='${accent}']`);
			const text = resolveToken(block, `--brand-text-${appearance}`);
			const ratio = contrastRatio(toRgb(text), SURFACES[appearance]);

			expect(
				ratio,
				`${accent} ${appearance} text is ${ratio.toFixed(2)}:1, needs ${MIN_RATIO}:1`,
			).toBeGreaterThanOrEqual(MIN_RATIO);
		}
	});

	/**
	 * The rail tints towards the accent, which costs it lightness, and the
	 * labels riding on it are `--muted-foreground`. A bolder accent, or a
	 * heavier tint, spends that headroom — this is what stops it going
	 * unnoticed until someone squints at a sidebar full of grey text.
	 */
	test.each(ACCENTS)("%s keeps sidebar labels readable", (accent) => {
		for (const appearance of ["light", "dark"] as const) {
			const theme = THEMES[appearance];
			const block = ruleBody(`[data-accent-${appearance}='${accent}']`);
			const fill = resolveToken(block, `--brand-fill-${appearance}`);
			const muted = parseOklab(
				capture(MUTED, theme, `${appearance} --muted-foreground`),
			);
			const ratio = contrastRatio(
				toRgb(muted),
				toRgb(sidebarSurface(theme, fill)),
			);

			expect(
				ratio,
				`${accent} ${appearance} sidebar label is ${ratio.toFixed(2)}:1, needs ${MIN_RATIO}:1`,
			).toBeGreaterThanOrEqual(MIN_RATIO);
		}
	});

	/**
	 * The active row is the theme's hardest case: its label, icon and edge
	 * indicator are all drawn in the accent, on a surface tinted with that
	 * same accent, so a bolder hue darkens the background as fast as the mark.
	 * The fill step loses outright — amber's reads 1.79:1 there — and the link
	 * step is not enough either, at 3.95:1 for orange. This is the assertion
	 * that `--brand-strong-*` exists to satisfy. It is body text, so 4.5:1.
	 */
	test.each(ACCENTS)("%s marks the active row readably", (accent) => {
		for (const appearance of ["light", "dark"] as const) {
			const theme = THEMES[appearance];
			const block = ruleBody(`[data-accent-${appearance}='${accent}']`);
			const fill = resolveDerived(theme, block, "--lagoon");
			const mark = resolveDerived(theme, block, "--lagoon-strong");
			const ratio = contrastRatio(toRgb(mark), activeRowSurface(theme, fill));

			expect(
				ratio,
				`${accent} ${appearance} active-row mark is ${ratio.toFixed(2)}:1, needs ${MIN_RATIO}:1`,
			).toBeGreaterThanOrEqual(MIN_RATIO);
		}
	});

	/**
	 * The custom accent is the only one whose deep step is computed instead of
	 * picked off a vetted scale, so it is the only one that has to hold for
	 * colours nobody looked at. Every hex a colour input can return is swept
	 * against the row its own tint paints. The extremes are the worst cases,
	 * and they are why the mix keeps as little of the colour as it does — the
	 * percentage in `styles.css` is the number this test defends.
	 */
	test.each([
		"light",
		"dark",
	] as const)("a custom accent stays readable in %s", (appearance) => {
		const theme = THEMES[appearance];
		const match = new RegExp(
			`--lagoon-strong:\\s*color-mix\\(in oklab, var\\(--brand-fill-${appearance}\\) ([\\d.]+)%, (black|white)\\)`,
		).exec(styles);
		if (!match) throw new Error(`no custom deep step for ${appearance}`);
		const keep = Number(match[1]) / 100;
		const towards: Oklab =
			match[2] === "black" ? { l: 0, a: 0, b: 0 } : { l: 1, a: 0, b: 0 };

		let worst = Number.POSITIVE_INFINITY;
		let worstAt = "";
		for (let r = 0; r <= 255; r += 15) {
			for (let g = 0; g <= 255; g += 15) {
				for (let b = 0; b <= 255; b += 15) {
					const fill = linearRgbToOklab([
						decode(r / 255),
						decode(g / 255),
						decode(b / 255),
					]);
					const ratio = contrastRatio(
						toRgb(mixOklab(fill, towards, keep)),
						activeRowSurface(theme, fill),
					);
					if (ratio < worst) {
						worst = ratio;
						worstAt = `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
					}
				}
			}
		}

		expect(
			worst,
			`${appearance} custom accent bottoms out at ${worst.toFixed(2)}:1 on ${worstAt}, needs ${MIN_RATIO}:1`,
		).toBeGreaterThanOrEqual(MIN_RATIO);
	});

	/** A ninth accent with no palette block would silently fall back to indigo. */
	test("every accent declares both appearances", () => {
		for (const accent of ACCENTS) {
			expect(styles).toContain(`[data-accent-light='${accent}']`);
			expect(styles).toContain(`[data-accent-dark='${accent}']`);
		}
	});
});
