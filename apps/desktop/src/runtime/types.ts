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
	| "INTERNAL_ERROR";

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
	  }
	| { status: "error"; error: Error };
