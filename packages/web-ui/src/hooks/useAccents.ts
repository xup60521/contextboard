import { useEffect, useState } from "react";
import {
	type Accent,
	DEFAULT_ACCENT,
	DEFAULT_CUSTOM_COLOR,
	getAccent,
	getCustomColor,
	subscribeThemeMode,
} from "../lib/theme.ts";

type AccentState = { accent: Accent; customColor: string };

const INITIAL: AccentState = {
	accent: DEFAULT_ACCENT,
	customColor: DEFAULT_CUSTOM_COLOR,
};

/**
 * Returns the live accent — one value for both appearances — plus the stored
 * custom colour. Starts at the default to keep SSR/first paint stable, then
 * syncs to the persisted values and any change.
 */
export function useAccent(): AccentState {
	const [state, setState] = useState<AccentState>(INITIAL);

	useEffect(() => {
		const read = () =>
			setState({ accent: getAccent(), customColor: getCustomColor() });
		read();
		return subscribeThemeMode(read);
	}, []);

	return state;
}
