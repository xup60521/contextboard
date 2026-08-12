import type { SyncRuntimeState } from "@contextboard/application";

const labels = {
	idle: "Up to date",
	syncing: "Syncing",
	offline: "Offline",
	"local-only": "Local only",
	error: "Sync error",
	unavailable: "Sync unavailable",
} satisfies Record<SyncRuntimeState, string>;

/** The one wording of each sync state, shared by the sidebar and settings. */
export function syncStateLabel(state: SyncRuntimeState) {
	return labels[state];
}

export function isDisconnected(state: SyncRuntimeState) {
	return state !== "idle" && state !== "syncing";
}
