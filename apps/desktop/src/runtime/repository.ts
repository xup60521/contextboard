import { DesktopWorkspaceRepository } from "@contextboard/storage-desktop";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
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

/** Native event subscription, injectable so tests need no Tauri host. */
export type Listen = (
	event: string,
	listener: () => void,
) => Promise<() => void>;

const defaultListen: Listen = (event, listener) =>
	tauriListen(event, () => listener());

const ERROR_CODES = new Set<DesktopCommandErrorCode>([
	"INVALID_ARGUMENT",
	"UNKNOWN_DOMAIN_OPERATION",
	"STORAGE_NOT_INITIALIZED",
	"INTERNAL_ERROR",
	"AUTH_TIMED_OUT",
	"AUTH_CANCELLED",
	"AUTH_FAILED",
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

export function createDesktopRepository(
	workspaceId: string,
	invoke?: Invoke,
	listen: Listen = defaultListen,
) {
	return new DesktopWorkspaceRepository(
		workspaceId,
		(command, args) => invokeDesktop(command, args, invoke),
		listen,
	);
}

export function readDesktopSetting(key: "workspaceId", invoke?: Invoke) {
	return invokeDesktop<string | null>("desktop_setting", { key }, invoke);
}

export async function writeDesktopSetting(
	key: "workspaceId",
	value: string,
	invoke?: Invoke,
) {
	await invokeDesktop("desktop_set_setting", { key, value }, invoke);
}

export type DesktopAuthHandoff = {
	redirectUri: string;
	authorizeUrl: string;
};

/** Opens the browser at the sign-in page and arms the loopback listener. */
export function startDesktopAuth(baseUrl: string, invoke?: Invoke) {
	return invokeDesktop<DesktopAuthHandoff>(
		"desktop_auth_start",
		{ baseUrl },
		invoke,
	);
}

/** Resolves with the one-time token the browser redirect carried back. */
export function awaitDesktopAuthToken(invoke?: Invoke) {
	return invokeDesktop<string>("desktop_auth_wait", undefined, invoke);
}

export async function cancelDesktopAuth(invoke?: Invoke) {
	await invokeDesktop("desktop_auth_cancel", undefined, invoke);
}

export async function storeDesktopSessionToken(token: string, invoke?: Invoke) {
	await invokeDesktop("desktop_auth_store_token", { token }, invoke);
}

export function readDesktopSessionToken(invoke?: Invoke) {
	return invokeDesktop<string | null>("desktop_auth_token", undefined, invoke);
}

export async function clearDesktopSessionToken(invoke?: Invoke) {
	await invokeDesktop("desktop_auth_clear", undefined, invoke);
}
