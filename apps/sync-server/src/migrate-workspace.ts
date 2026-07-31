import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { dataRoot } from "./configuration";
import { SyncStore } from "./store";

function argument(name: string) {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

const source = argument("--source");
const target = argument("--target");
const apply = process.argv.includes("--apply");
const dryRun = process.argv.includes("--dry-run");

if (!source || !target || apply === dryRun) {
	console.error(
		"Usage: bun src/migrate-workspace.ts --source <id> --target <id> --dry-run|--apply",
	);
	process.exit(2);
}

const databasePath = join(dataRoot, "sync.sqlite");
const blobRoot = join(dataRoot, "blobs");
let backupPath: string | undefined;

if (apply) {
	backupPath = join(
		dataRoot,
		"backups",
		`workspace-merge-${new Date().toISOString().replace(/[:.]/g, "-")}`,
	);
	mkdirSync(backupPath, { recursive: true });
	for (const suffix of ["", "-wal", "-shm"]) {
		const path = `${databasePath}${suffix}`;
		if (existsSync(path))
			cpSync(path, join(backupPath, `sync.sqlite${suffix}`));
	}
	if (existsSync(blobRoot))
		cpSync(blobRoot, join(backupPath, "blobs"), { recursive: true });
}

const store = new SyncStore(databasePath, blobRoot);
try {
	const report = store.mergeWorkspaces(source, target, { dryRun });
	console.log(
		JSON.stringify({
			event: dryRun ? "workspace_merge_dry_run" : "workspace_merge_complete",
			...report,
			backupPath,
		}),
	);
} finally {
	store.close();
}
