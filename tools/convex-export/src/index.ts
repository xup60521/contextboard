import { mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const outputArg = process.argv[2] ?? `contextboard-convex-${new Date().toISOString().replaceAll(":", "-")}.zip`;
const output = resolve(outputArg);
await mkdir(dirname(output), { recursive: true });

const toolRoot = dirname(fileURLToPath(import.meta.url));
const toolPackageRoot = resolve(toolRoot, "..");
const deployment = process.env.CONVEX_DEPLOYMENT;
const exportArgs = ["convex", "export", "--path", output, "--include-file-storage"];
if (deployment) exportArgs.push("--deployment", deployment);
const result = spawnSync(
  "bunx",
  exportArgs,
  { cwd: toolPackageRoot, stdio: "inherit", shell: process.platform === "win32" },
);

if (result.status !== 0) process.exit(result.status ?? 1);
const exported = await stat(output);
if (!exported.isFile() || exported.size === 0) throw new Error(`Convex export was not created at ${output}`);
console.info(`Created ${output} (${exported.size} bytes). Keep this archive until the local importer has verified it.`);
