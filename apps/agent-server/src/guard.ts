export type AgentGuardError = {
	status: 403 | 404 | 405 | 415;
	code:
		| "FORBIDDEN_ORIGIN"
		| "FORBIDDEN_HOST"
		| "NOT_FOUND"
		| "METHOD_NOT_ALLOWED"
		| "UNSUPPORTED_MEDIA_TYPE";
	message: string;
};

const API_PREFIX = "/api/v1";
const HEALTH_PATH = `${API_PREFIX}/_health`;
const TOOLS_PATH = `${API_PREFIX}/_tools`;
const SKILL_PATH = `${API_PREFIX}/_skill`;

function failure(
	status: AgentGuardError["status"],
	code: AgentGuardError["code"],
	message: string,
): AgentGuardError {
	return { status, code, message };
}

function isLoopbackHost(host: string, port: number) {
	const value = host.trim();
	let name: string;
	let hostPort: number | null;
	if (value.startsWith("[")) {
		const match = /^\[([^\]]+)\]:(\d+)$/.exec(value);
		name = match?.[1] ?? "";
		hostPort = match ? Number(match[2]) : null;
	} else {
		const separator = value.lastIndexOf(":");
		name = separator >= 0 ? value.slice(0, separator) : value;
		hostPort = separator >= 0 ? Number(value.slice(separator + 1)) : null;
	}
	return (
		hostPort === port &&
		(name === "127.0.0.1" ||
			name === "localhost" ||
			name === "[::1]" ||
			name === "::1")
	);
}

function isToolPath(pathname: string) {
	return (
		pathname.startsWith(`${API_PREFIX}/`) &&
		pathname !== HEALTH_PATH &&
		pathname !== TOOLS_PATH &&
		pathname !== SKILL_PATH
	);
}

function isDiscoveryPath(pathname: string) {
	return (
		pathname === HEALTH_PATH ||
		pathname === TOOLS_PATH ||
		pathname === SKILL_PATH
	);
}

/**
 * Applies the same loopback assumptions as the Rust desktop agent server twin.
 * Keep this guard in sync with `apps/desktop/src-tauri/src/agent.rs`.
 */
export function guardRequest(
	request: Request,
	port: number,
): AgentGuardError | null {
	const pathname = new URL(request.url).pathname;
	const isDiscovery = isDiscoveryPath(pathname);
	const isTool = isToolPath(pathname);
	if (!isDiscovery && !isTool)
		return failure(404, "NOT_FOUND", "Unknown agent endpoint");

	// GET is refused even for discovery: an <img> or <script> cannot read the
	// response, but it can still time it and probe whether ContextBoard is
	// running on the loopback port.
	if (request.method.toUpperCase() !== "POST")
		return failure(
			405,
			"METHOD_NOT_ALLOWED",
			isTool
				? "Agent tools accept POST only"
				: "Agent discovery accepts POST only",
		);

	if (request.headers.has("origin"))
		return failure(
			403,
			"FORBIDDEN_ORIGIN",
			"The local agent server does not serve browser origins",
		);
	if (!isLoopbackHost(request.headers.get("host") ?? "", port))
		return failure(
			403,
			"FORBIDDEN_HOST",
			"The local agent server only serves loopback hosts",
		);

	const mediaType = (request.headers.get("content-type") ?? "")
		.split(";", 1)[0]
		.trim()
		.toLowerCase();
	if (mediaType !== "application/json")
		return failure(
			415,
			"UNSUPPORTED_MEDIA_TYPE",
			"Content-Type must be application/json",
		);
	return null;
}
