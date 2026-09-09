import { Monitor, Moon, Palette, Pipette, Sun } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccent } from "../../hooks/useAccents.ts";
import { useThemeMode } from "../../hooks/useThemeMode.ts";
import {
	ACCENTS,
	type Accent,
	setAccent,
	setThemeMode,
	type ThemeMode,
} from "../../lib/theme.ts";
import { cn } from "../../lib/utils.ts";
import { AppearancePreview } from "./AppearancePreview.tsx";
import type { SettingsSection } from "./SettingsDialog.tsx";
import {
	SettingsChoice,
	type SettingsChoiceOption,
	SettingsRow,
	SettingsSwatches,
	type SettingsSwatchOption,
} from "./SettingsPrimitives.tsx";

export const themeOptions: ReadonlyArray<SettingsChoiceOption<ThemeMode>> = [
	{ value: "light", label: "Light", icon: Sun },
	{ value: "dark", label: "Dark", icon: Moon },
	{ value: "auto", label: "System", icon: Monitor },
];

/** Accents name themselves; the label is the palette with a capital letter. */
export const accentOptions: ReadonlyArray<SettingsSwatchOption<Accent>> =
	ACCENTS.map((accent) => ({
		value: accent,
		label: accent[0].toUpperCase() + accent.slice(1),
	}));

/**
 * The escape hatch: any colour, applied identically to both appearances.
 *
 * `color` is the colour to show, which is the draft while one is being picked
 * — the input has to stay controlled on it, or React restores the committed
 * value under the pointer on the next render and fights the picker.
 */
function CustomAccentSwatch({
	selected,
	color,
	onDraft,
	onCommit,
	onPreview,
}: {
	selected: boolean;
	color: string;
	onDraft: (color: string) => void;
	onCommit: (color: string) => void;
	onPreview: (accent: Accent | null) => void;
}) {
	const input = useRef<HTMLInputElement>(null);

	/*
	 * The OS picker streams `input` for the whole drag and fires `change` once,
	 * when it is dismissed. React maps `onChange` to the former, so the commit
	 * has to come off the native event: adopting an accent rewrites the
	 * document's custom properties and every `color-mix` that reads them, which
	 * is far too much work to repeat per pointer move.
	 */
	useEffect(() => {
		const element = input.current;
		if (!element) return;

		const commit = () => onCommit(element.value);
		element.addEventListener("change", commit);
		return () => element.removeEventListener("change", commit);
	}, [onCommit]);

	return (
		<label
			title="Custom"
			onPointerEnter={() => onPreview("custom")}
			onPointerLeave={() => onPreview(null)}
			onFocus={() => onPreview("custom")}
			onBlur={() => onPreview(null)}
			style={{ backgroundColor: color, color }}
			className={cn(
				"flex size-5 cursor-pointer items-center justify-center rounded-full outline-2 outline-offset-2 transition-transform hover:scale-110",
				selected ? "outline-current" : "outline-transparent",
			)}
		>
			<span className="sr-only">Custom accent colour</span>
			<Pipette
				aria-hidden="true"
				className="size-3 text-white mix-blend-difference"
			/>
			<input
				ref={input}
				type="color"
				value={color}
				onChange={(event) => onDraft(event.target.value)}
				className="sr-only"
			/>
		</label>
	);
}

function AppearanceSettings() {
	const theme = useThemeMode();
	const { accent, customColor } = useAccent();
	// Null whenever the pointer is off the swatches, which is when the applied
	// accent is the honest thing to show.
	const [hovered, setHovered] = useState<Accent | null>(null);
	// Non-null only while the colour picker is open. The draft never reaches
	// the document; it goes to the preview, which is one small subtree rather
	// than every surface in the app.
	const [draft, setDraft] = useState<string | null>(null);
	const commitCustom = useCallback((color: string) => {
		setDraft(null);
		setAccent("custom", color);
	}, []);

	const previewColor = draft ?? customColor;
	return (
		<div className="flex flex-col gap-4">
			<AppearancePreview
				accent={draft === null ? (hovered ?? accent) : "custom"}
				customColor={previewColor}
			/>
			<SettingsRow
				title="Theme"
				description="Applies to the app and the whiteboard canvas."
				control={
					<SettingsChoice
						label="Theme"
						value={theme}
						options={themeOptions}
						onChange={setThemeMode}
					/>
				}
			/>
			<SettingsRow
				title="Accent"
				description="Tints the sidebar and every hover surface, and colours links, focus rings and selection — one choice for both light and dark."
				control={
					<div className="flex flex-wrap items-center gap-1.5">
						<SettingsSwatches
							label="Accent"
							value={accent}
							options={accentOptions}
							onChange={(value) => setAccent(value)}
							onPreview={setHovered}
						/>
						<CustomAccentSwatch
							selected={accent === "custom"}
							color={previewColor}
							onDraft={setDraft}
							onCommit={commitCustom}
							onPreview={setHovered}
						/>
					</div>
				}
			/>
		</div>
	);
}

/** Appearance is identical on every platform, so both shells use this section. */
export const appearanceSettingsSection: SettingsSection = {
	id: "appearance",
	label: "Appearance",
	icon: Palette,
	description: "How ContextBoard looks on this device.",
	content: <AppearanceSettings />,
};
