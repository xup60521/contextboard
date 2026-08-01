import { Button } from "@contextboard/web-ui";
import { useCallback, useEffect, useState } from "react";
import { useDesktopInvoke } from "../runtime/DesktopRuntimeProvider";
import { invokeDesktop } from "../runtime/repository";

type BridgeStatus = {
	enabled: boolean;
	port: number | null;
	configuredPort: number;
};

/**
 * Settings section for the local agent bridge.
 *
 * The bridge lets an MCP server on this machine read and write the workspace,
 * and it is deliberately unauthenticated: anything already running as this user
 * can use it. That is a real grant, so it is off until asked for, and the
 * consequence is stated plainly rather than implied.
 */
export function AgentBridgeSection() {
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
				// An older shell without the command simply hides the section.
				if (active) setStatus(null);
			});
		return () => {
			active = false;
		};
	}, [invoke]);

	const toggle = useCallback(async () => {
		if (!status || busy) return;
		setBusy(true);
		setError(null);
		try {
			setStatus(
				await invokeDesktop<BridgeStatus>(
					"desktop_bridge_set_enabled",
					{ enabled: !status.enabled },
					invoke,
				),
			);
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "The agent bridge could not be changed.",
			);
		} finally {
			setBusy(false);
		}
	}, [busy, invoke, status]);

	if (!status) return null;

	const port = status.port ?? status.configuredPort;
	return (
		<section className="flex flex-col gap-2">
			<div className="flex items-start justify-between gap-4">
				<div className="min-w-0">
					<h3 className="text-sm font-medium">AI agent access</h3>
					<p className="text-xs text-[var(--muted-foreground)]">
						Let an MCP server on this computer read and write your boards.
					</p>
				</div>
				<Button
					type="button"
					variant={status.enabled ? "default" : "outline"}
					size="sm"
					disabled={busy}
					onClick={toggle}
					aria-pressed={status.enabled}
				>
					{status.enabled ? "On" : "Off"}
				</Button>
			</div>
			<p className="text-xs text-[var(--muted-foreground)]">
				{status.enabled
					? `Listening on 127.0.0.1:${port}. Any program running on this computer can now read and write your boards.`
					: `When on, ContextBoard listens on 127.0.0.1:${port} so an agent running on this computer can use your workspace. It is not reachable from anywhere else.`}
			</p>
			{error ? (
				<p className="text-xs text-red-600 dark:text-red-400" role="alert">
					{error}
				</p>
			) : null}
		</section>
	);
}
