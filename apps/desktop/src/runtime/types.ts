import type { DesktopWorkspaceRepository } from "@contextboard/storage-desktop";

export type DesktopBootstrap = {
	version: string;
	platform: string;
	storageAvailable: boolean;
};

export type DesktopCommandErrorCode =
	| "INVALID_ARGUMENT"
	| "UNKNOWN_DOMAIN_OPERATION"
	| "STORAGE_NOT_INITIALIZED"
	| "INTERNAL_ERROR"
	| "AUTH_TIMED_OUT"
	| "AUTH_CANCELLED"
	| "AUTH_FAILED";

export type DesktopCommandError = {
	code: DesktopCommandErrorCode;
	message: string;
};

export type DesktopRuntimeState =
	| { status: "starting" }
	| {
			status: "storage-unavailable";
			repository: DesktopWorkspaceRepository;
			reason: string;
			bootstrap: DesktopBootstrap;
	  }
	| {
			status: "ready";
			repository: DesktopWorkspaceRepository;
			workspaceId: string;
			bootstrap: DesktopBootstrap;
			/** Rebinds this device to a server-issued workspace id. */
			adoptWorkspaceId: (workspaceId: string) => Promise<void>;
			/** Switches the renderer to an existing local or account workspace. */
			setWorkspaceId: (workspaceId: string) => Promise<void>;
			/** Replays a local workspace into the active workspace. */
			mergeWorkspace: (workspaceId: string) => Promise<void>;
			/** Permanently removes a non-active local workspace from this device. */
			deleteWorkspace: (workspaceId: string) => Promise<void>;
		}
	| { status: "error"; error: Error };
