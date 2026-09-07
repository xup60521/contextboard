import { Monitor, Moon, Palette, Sun } from "lucide-react";
import { useAccent } from "../../hooks/useAccent.ts";
import { useThemeMode } from "../../hooks/useThemeMode.ts";
import {
	ACCENTS,
	type Accent,
	setAccent,
	setThemeMode,
	type ThemeMode,
} from "../../lib/theme.ts";
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

function AppearanceSettings() {
	const theme = useThemeMode();
	const accent = useAccent();
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
				description="Colours links, focus rings and selection."
				control={
					<SettingsSwatches
						label="Accent"
						value={accent}
						options={accentOptions}
						onChange={setAccent}
					/>
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
