import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const SKILL_FILE = new URL(
	"../../../skills/contextboard/SKILL.md",
	import.meta.url,
);

export type AgentSkill = {
	markdown: string;
	etag: string;
};

/** Loads the canonical agent instructions once when the local server starts. */
export function loadAgentSkill(): AgentSkill {
	const markdown = readFileSync(SKILL_FILE, "utf8");
	const etag = `"${createHash("sha256").update(markdown, "utf8").digest("hex")}"`;
	return { markdown, etag };
}
