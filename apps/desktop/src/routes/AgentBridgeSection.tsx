import { Button, SettingsMessage, SettingsRow } from "@contextboard/web-ui";
import { useCallback, useEffect, useState } from "react";
import { useDesktopInvoke } from "../runtime/DesktopRuntimeProvider";
import { invokeDesktop } from "../runtime/repository";

type BridgeStatus = {
	enabled: boolean;
	port: number | null;
	configuredPort: number;
};

export type AgentBridge = ReturnType<typeof useAgentBridge>;

/**
 * Local agent server state. A null status means this shell predates the
 * commands, which the settings dialog reads as "this section does not exist
 * here" rather than rendering a control that cannot work.
 */
export function useAgentBridge() {
	const invoke = useDesktopInvoke();
	const [status, setStatus] = useState<BridgeStatus | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let active = true;
		void invokeDesktop<BridgeStatus>("desktop_bridge_status", {}, invoke)
			.then((next) => {
				if (active) setStatus(next);
			})
			.catch(() => {
				if (active) setStatus(null);
			});
		return () => {
			active = false;
		};
	}, [invoke]);

	const setEnabled = useCallback(
		async (enabled: boolean) => {
			if (busy) return;
			setBusy(true);
			setError(null);
			try {
				setStatus(
					await invokeDesktop<BridgeStatus>(
						"desktop_bridge_set_enabled",
						{ enabled },
						invoke,
					),
				);
			} catch (cause) {
				setError(
					cause instanceof Error
						? cause.message
						: "The local agent server could not be changed.",
				);
			} finally {
				setBusy(false);
			}
		},
		[busy, invoke],
	);

	return { status, busy, error, setEnabled };
}

/**
 * The local agent API lets an agent on this machine read and write the
 * workspace, and it is deliberately unauthenticated: anything already running
 * as this user can use it. That is a real grant, so it is off until asked for,
 * and the consequence is stated plainly rather than implied.
 */
export function AgentBridgeSection({ bridge }: { bridge: AgentBridge }) {
	const { status, busy, error, setEnabled } = bridge;
	if (!status) return null;

	const port = status.port ?? status.configuredPort;
	return (
		<>
			<SettingsRow
				title="Local agent server"
				description="Let a local agent on this computer read and write your boards."
				control={
					<Button
						type="button"
						variant={status.enabled ? "default" : "outline"}
						size="sm"
						disabled={busy}
						onClick={() => void setEnabled(!status.enabled)}
						aria-pressed={status.enabled}
					>
						{status.enabled ? "On" : "Off"}
					</Button>
				}
			>
				<SettingsMessage tone={status.enabled ? "warning" : "info"}>
					{status.enabled
						? `Listening on 127.0.0.1:${port}. Any program running on this computer can now read and write your boards.`
						: `When on, ContextBoard listens on 127.0.0.1:${port} so an agent running on this computer can use your workspace. It is not reachable from anywhere else.`}
				</SettingsMessage>
			</SettingsRow>
			{error ? (
				<SettingsMessage tone="error" role="alert">
					{error}
				</SettingsMessage>
			) : null}
		</>
	);
}
