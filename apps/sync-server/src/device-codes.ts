import { createHash, randomBytes } from "node:crypto";
import { parseAgentTokenName } from "./agent-tokens";

export const DEVICE_CODE_PREFIX = "cbdc_";
export const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
export const USER_CODE_LENGTH = 8;
export const DEVICE_CODE_TTL_MS = 10 * 60_000;
export const DEVICE_CODE_INTERVAL_SECONDS = 5;
export const DEVICE_CODE_SLOW_DOWN_STEP_SECONDS = 5;
export const DEVICE_CODE_MAX_POLLS = 200;

export type DeviceFlowErrorBody = {
	error: string;
	error_description?: string;
	interval?: number;
};

export class DeviceFlowError extends Error {
	constructor(
		readonly status: number,
		readonly body: DeviceFlowErrorBody,
	) {
		super(body.error_description ?? body.error);
		this.name = "DeviceFlowError";
	}
}

export function generateDeviceCode() {
	return `${DEVICE_CODE_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function hashDeviceCode(code: string) {
	return createHash("sha256").update(code).digest("hex");
}

export function generateUserCode() {
	let result = "";
	const alphabetLength = USER_CODE_ALPHABET.length;
	const rejectionLimit = 256 - (256 % alphabetLength);
	while (result.length < USER_CODE_LENGTH) {
		for (const byte of randomBytes(USER_CODE_LENGTH)) {
			if (byte >= rejectionLimit) continue;
			result += USER_CODE_ALPHABET[byte % alphabetLength];
			if (result.length === USER_CODE_LENGTH) break;
		}
	}
	return result;
}

export function normalizeUserCode(value: string) {
	// Keep digits long enough to reject them explicitly. Hyphens, spaces, and
	// other non-ASCII formatting marks are harmless separators.
	const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
	if (
		normalized.length !== USER_CODE_LENGTH ||
		[...normalized].some((character) => !USER_CODE_ALPHABET.includes(character))
	)
		throw new Error("Invalid user code");
	return normalized;
}

export function formatUserCode(value: string) {
	const normalized = normalizeUserCode(value);
	return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}

/** Builds the name shown in the existing agent-token management UI. */
export function deviceTokenName(clientName: string, deviceName?: string | null) {
	const client = clientName.trim() || "contextboard-cli";
	const device = deviceName?.trim() || "";
	if (!device) return parseAgentTokenName(client.slice(0, 64));

	const available = 64 - client.length - 3;
	const name =
		available > 0
			? `${client} (${device.slice(0, available)})`
			: client.slice(0, 64);
	return parseAgentTokenName(name.slice(0, 64));
}
