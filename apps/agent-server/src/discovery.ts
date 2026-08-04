import { randomUUID } from "node:crypto";
import {
	chmod,
	mkdir,
	readFile,
	rename,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
export const AGENT_SERVER_FILENAME = "agent-server.json";

export type AgentMode = "desktop" | "replica";

export type DiscoveryIdentity = {
	dev: number;
	ino: number;
	ctimeMs: number;
	mtimeMs: number;
	size: number;
};

export type AgentServerDiscoveryLease = {
	path: string;
	identity: DiscoveryIdentity;
};

export function agentServerPath(home = homedir()) {
	return join(home, ".contextboard", AGENT_SERVER_FILENAME);
}

export async function writeAgentServerDiscovery(
	port: number,
	mode: AgentMode,
	home = homedir(),
) {
	const path = agentServerPath(home);
	const directory = join(home, ".contextboard");
	await mkdir(directory, { recursive: true, mode: 0o700 });
	await chmod(directory, 0o700).catch(() => undefined);
	const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporaryPath, `${JSON.stringify({ port, mode })}\n`, {
			encoding: "utf8",
			flag: "wx",
			mode: 0o600,
		});
		await chmod(temporaryPath, 0o600).catch(() => undefined);
		await rename(temporaryPath, path);
	} finally {
		await unlink(temporaryPath).catch(() => undefined);
	}
	return {
		path,
		identity: await discoveryIdentity(path),
	} satisfies AgentServerDiscoveryLease;
}

async function discoveryIdentity(path: string): Promise<DiscoveryIdentity> {
	const file = await stat(path);
	return {
		dev: file.dev,
		ino: file.ino,
		ctimeMs: file.ctimeMs,
		mtimeMs: file.mtimeMs,
		size: file.size,
	};
}

export async function readAgentServerDiscovery(home = homedir()) {
	const raw = await readFile(agentServerPath(home), "utf8");
	const parsed = JSON.parse(raw) as { port?: unknown; mode?: unknown };
	if (
		typeof parsed.port !== "number" ||
		!Number.isInteger(parsed.port) ||
		parsed.port < 1 ||
		parsed.port > 65535 ||
		(parsed.mode !== "desktop" && parsed.mode !== "replica")
	)
		throw new Error("Invalid agent-server discovery file");
	return { port: parsed.port, mode: parsed.mode } as {
		port: number;
		mode: AgentMode;
	};
}

export async function removeAgentServerDiscovery(
	port: number,
	mode: AgentMode,
	home = homedir(),
	expectedIdentity?: DiscoveryIdentity,
) {
	const path = agentServerPath(home);
	try {
		if (expectedIdentity) {
			const currentIdentity = await discoveryIdentity(path);
			if (
				currentIdentity.dev !== expectedIdentity.dev ||
				currentIdentity.ino !== expectedIdentity.ino ||
				currentIdentity.ctimeMs !== expectedIdentity.ctimeMs ||
				currentIdentity.mtimeMs !== expectedIdentity.mtimeMs ||
				currentIdentity.size !== expectedIdentity.size
			)
				return false;
		}
		const current = await readAgentServerDiscovery(home);
		if (current.port !== port || current.mode !== mode) return false;
		await unlink(path);
		return true;
	} catch {
		return false;
	}
}
