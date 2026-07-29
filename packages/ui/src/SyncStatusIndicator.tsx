export type SyncStatusState =
	| "idle"
	| "syncing"
	| "offline"
	| "error"
	| "unavailable";

export type SyncStatusIndicatorProps = {
	state: SyncStatusState;
	message?: string;
	onSyncNow?: () => void;
};

const DEFAULT_MESSAGES: Record<SyncStatusState, string> = {
	idle: "Up to date",
	syncing: "Syncing",
	offline: "Working offline",
	error: "Sync needs attention",
	unavailable: "Sync is not available",
};

export function SyncStatusIndicator({
	state,
	message,
	onSyncNow,
}: SyncStatusIndicatorProps) {
	const disabled = state === "syncing" || state === "unavailable" || !onSyncNow;
	return (
		<div className="contextboard-sync-status" data-state={state}>
			<span aria-hidden="true" className="contextboard-sync-status__dot" />
			<span role={state === "error" ? "alert" : "status"}>
				{message ?? DEFAULT_MESSAGES[state]}
			</span>
			<button
				disabled={disabled}
				onClick={onSyncNow}
				title={
					state === "unavailable"
						? "Desktop storage must be ready before syncing"
						: undefined
				}
				type="button"
			>
				Sync now
			</button>
		</div>
	);
}
