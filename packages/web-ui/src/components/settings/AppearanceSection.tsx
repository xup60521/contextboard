import { Monitor, Moon, Palette, Pipette, Sun } from "lucide-react";
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

/** The escape hatch: any colour, applied identically to both appearances. */
function CustomAccentSwatch({
	selected,
	color,
	onChange,
}: {
	selected: boolean;
	color: string;
	onChange: (color: string) => void;
}) {
	return (
		<label
			title="Custom"
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
				type="color"
				value={color}
				onChange={(event) => onChange(event.target.value)}
				className="sr-only"
			/>
		</label>
	);
}

function AppearanceSettings() {
	const theme = useThemeMode();
	const { accent, customColor } = useAccent();
	return (
		<div className="flex flex-col gap-4">
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
				description="Colours links, focus rings and selection — one choice for both light and dark."
				control={
					<div className="flex flex-wrap items-center gap-1.5">
						<SettingsSwatches
							label="Accent"
							value={accent}
							options={accentOptions}
							onChange={(value) => setAccent(value)}
						/>
						<CustomAccentSwatch
							selected={accent === "custom"}
							color={customColor}
							onChange={(color) => setAccent("custom", color)}
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
