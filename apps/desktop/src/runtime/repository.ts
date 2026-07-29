import { DesktopWorkspaceRepository } from "@contextboard/storage-desktop";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type {
	DesktopBootstrap,
	DesktopCommandError,
	DesktopCommandErrorCode,
} from "./types";

export type Invoke = (
	command: string,
	args?: Record<string, unknown>,
) => Promise<unknown>;

const defaultInvoke: Invoke = (command, args) => tauriInvoke(command, args);

const ERROR_CODES = new Set<DesktopCommandErrorCode>([
	"INVALID_ARGUMENT",
	"UNKNOWN_DOMAIN_OPERATION",
	"STORAGE_NOT_INITIALIZED",
	"INTERNAL_ERROR",
]);

export function toDesktopError(value: unknown): Error {
	if (
		value &&
		typeof value === "object" &&
		"code" in value &&
		"message" in value &&
		typeof value.code === "string" &&
		ERROR_CODES.has(value.code as DesktopCommandErrorCode) &&
		typeof value.message === "string"
	) {
		const commandError = value as DesktopCommandError;
		const error = new Error(commandError.message);
		error.name = commandError.code;
		return error;
	}
	return value instanceof Error
		? value
		: new Error("The desktop runtime returned an invalid error");
}

export async function invokeDesktop<T>(
	command: string,
	args?: Record<string, unknown>,
	invoke: Invoke = defaultInvoke,
): Promise<T> {
	try {
		return (await invoke(command, args)) as T;
	} catch (error) {
		throw toDesktopError(error);
	}
}

export async function bootstrapDesktop(invoke?: Invoke) {
	const bootstrap = await invokeDesktop<DesktopBootstrap>(
		"desktop_bootstrap",
		undefined,
		invoke,
	);
	if (
		!bootstrap ||
		typeof bootstrap.version !== "string" ||
		typeof bootstrap.platform !== "string" ||
		typeof bootstrap.storageAvailable !== "boolean"
	)
		throw new Error(
			"The desktop runtime returned an invalid bootstrap response",
		);
	return bootstrap;
}

export function createDesktopRepository(workspaceId: string, invoke?: Invoke) {
	return new DesktopWorkspaceRepository(workspaceId, (command, args) =>
		invokeDesktop(command, args, invoke),
	);
}
