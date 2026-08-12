import { Monitor, Moon, Palette, Sun } from "lucide-react";
import { useThemeMode } from "../../hooks/useThemeMode.ts";
import { setThemeMode, type ThemeMode } from "../../lib/theme.ts";
import type { SettingsSection } from "./SettingsDialog.tsx";
import {
	SettingsChoice,
	type SettingsChoiceOption,
	SettingsRow,
} from "./SettingsPrimitives.tsx";

export const themeOptions: ReadonlyArray<SettingsChoiceOption<ThemeMode>> = [
	{ value: "light", label: "Light", icon: Sun },
	{ value: "dark", label: "Dark", icon: Moon },
	{ value: "auto", label: "System", icon: Monitor },
];

function AppearanceSettings() {
	const theme = useThemeMode();
	return (
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
