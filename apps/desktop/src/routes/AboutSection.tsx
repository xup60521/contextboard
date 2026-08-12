import { SettingsFact, SettingsMessage } from "@contextboard/web-ui";
import { useDesktopRuntime } from "../runtime/DesktopRuntimeProvider";

/**
 * The build identity a user is asked for when reporting a problem, plus the one
 * startup fault worth surfacing here: storage that never came up.
 */
export function AboutSection() {
	const desktop = useDesktopRuntime();
	const bootstrap =
		desktop.status === "ready" || desktop.status === "storage-unavailable"
			? desktop.bootstrap
			: null;

	return (
		<>
			<SettingsFact label="Version" value={bootstrap?.version ?? "Unknown"} />
			<SettingsFact label="Platform" value={bootstrap?.platform ?? "Unknown"} />
			{desktop.status === "storage-unavailable" ? (
				<SettingsMessage tone="error" role="alert">
					{desktop.reason}. Changes are not being saved to this device.
				</SettingsMessage>
			) : null}
		</>
	);
}
