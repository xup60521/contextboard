import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";
import { ACCENTS } from "./theme.ts";

/**
 * Every accent claims its text step is readable on its surface. This holds
 * that claim to a number instead of an eye, and it reads the claim out of
 * `styles.css` rather than repeating it, so changing a step in the stylesheet
 * changes what is asserted here.
 */

const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const palette = readFileSync(
	createRequire(import.meta.url).resolve("tailwindcss/theme.css"),
	"utf8",
);

/** WCAG asks for 4.5:1 on body text; link and label text is body text. */
const MIN_RATIO = 4.5;

type Rgb = readonly [r: number, g: number, b: number];

/** Every lookup here is a contract with the stylesheet; a miss is a test bug. */
function capture(pattern: RegExp, text: string, what: string): string {
	const match = pattern.exec(text);
	if (!match?.[1]) throw new Error(`no ${what}`);
	return match[1];
}

/** `oklch(51.1% 0.262 276.966)` and `oklch(0.205 0 0)` both occur in our CSS. */
function parseOklch(value: string): Rgb {
	const match = /oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+(-?[\d.]+)/.exec(value);
	if (!match) throw new Error(`not an oklch colour: ${value}`);
	const [, rawL, percent, chroma, hue] = match;
	const l = Number(rawL) / (percent === "%" ? 100 : 1);
	const radians = (Number(hue) * Math.PI) / 180;
	return oklabToLinearRgb(
		l,
		Number(chroma) * Math.cos(radians),
		Number(chroma) * Math.sin(radians),
	);
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

/** WCAG 2.x relative luminance, which wants linear-light channels. */
function luminance([r, g, b]: Rgb): number {
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: Rgb, b: Rgb): number {
	const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (high + 0.05) / (low + 0.05);
}

/** `--brand-text-light: var(--color-indigo-600)` -> the palette's oklch. */
function resolveToken(block: string, token: string): Rgb {
	const variable = capture(
		new RegExp(`${token}:\\s*var\\((--color-[\\w-]+)\\)`),
		block,
		`${token} declaration`,
	);
	return parseOklch(
		capture(
			new RegExp(`${variable}:\\s*([^;]+);`),
			palette,
			`Tailwind colour ${variable}`,
		),
	);
}

function ruleBody(selector: string): string {
	return capture(
		new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`),
		styles,
		`rule for ${selector}`,
	);
}

const BACKGROUND = /--background:\s*(oklch\([^)]*\))/;

/** The surface each pair is judged against, read from the theme itself. */
const SURFACES = {
	light: parseOklch(capture(BACKGROUND, styles, "light --background")),
	dark: parseOklch(capture(BACKGROUND, ruleBody(".dark"), "dark --background")),
} as const;

describe("accent contrast", () => {
	test.each(ACCENTS)("%s reads on both surfaces", (accent) => {
		for (const appearance of ["light", "dark"] as const) {
			const block = ruleBody(`[data-accent-${appearance}='${accent}']`);
			const text = resolveToken(block, `--brand-text-${appearance}`);
			const ratio = contrastRatio(text, SURFACES[appearance]);

			expect(
				ratio,
				`${accent} ${appearance} text is ${ratio.toFixed(2)}:1, needs ${MIN_RATIO}:1`,
			).toBeGreaterThanOrEqual(MIN_RATIO);
		}
	});

	/** A ninth accent with no palette block would silently fall back to indigo. */
	test("every accent declares both appearances", () => {
		for (const accent of ACCENTS) {
			expect(styles).toContain(`[data-accent-light='${accent}']`);
			expect(styles).toContain(`[data-accent-dark='${accent}']`);
		}
	});
});
