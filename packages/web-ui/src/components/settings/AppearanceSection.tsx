import { Monitor, Moon, Palette, Sun } from "lucide-react";
import { useAccents } from "../../hooks/useAccents.ts";
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
	const accents = useAccents();
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
				title="Light accent"
				description="Colours links, focus rings and selection in light mode."
				control={
					<SettingsSwatches
						appearance="light"
						label="Light accent"
						value={accents.light}
						options={accentOptions}
						onChange={(accent) => setAccent("light", accent)}
					/>
				}
			/>
			<SettingsRow
				title="Dark accent"
				description="The same, for dark mode — a hue that suits one rarely suits both."
				control={
					<SettingsSwatches
						appearance="dark"
						label="Dark accent"
						value={accents.dark}
						options={accentOptions}
						onChange={(accent) => setAccent("dark", accent)}
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
