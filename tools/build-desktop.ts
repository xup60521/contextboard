import { resolve } from "node:path";

const args = process.argv.slice(2);
const production = args.includes("--production");
const unknownArgs = args.filter((arg) => arg !== "--production");
const productionFlagCount = args.filter((arg) => arg === "--production").length;

if (unknownArgs.length > 0 || productionFlagCount > 1) {
	console.error("Usage: bun run build:desktop [--production]");
	process.exit(1);
}

const repositoryRoot = resolve(import.meta.dir, "..");
const productionEnvFile = resolve(
	repositoryRoot,
	"apps/desktop/.env.production",
);

if (production && !(await Bun.file(productionEnvFile).exists())) {
	console.error(`Production env file not found: ${productionEnvFile}`);
	process.exit(1);
}

const bunArgs = [
	...(production
		? ["--no-env-file", `--env-file=${productionEnvFile}`]
		: []),
	"run",
	"--filter",
	"@contextboard/desktop",
	"tauri:build",
];

const child = Bun.spawn(["bun", ...bunArgs], {
	cwd: repositoryRoot,
	env: process.env,
	stdout: "inherit",
	stderr: "inherit",
});

process.exitCode = await child.exited;
