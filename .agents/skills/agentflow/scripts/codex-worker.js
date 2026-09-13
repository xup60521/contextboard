'use strict'

// Launch shim for a Codex installed only as an npm package.
//
// Worker launch uses shell:false and literal arguments, so neither the
// codex.cmd wrapper nor the extensionless POSIX shim npm leaves beside it can
// be spawned on Windows. The package's real entrypoint is a .js file, which
// only node can run. Resolve to that file and re-exec it with the current node,
// so a machine without a native codex.exe can still dispatch Codex work.

const node_child_process = require('node:child_process')
const node_fs = require('node:fs')
const node_path = require('node:path')

const PACKAGE_ENTRYPOINT = node_path.join('@openai', 'codex', 'bin', 'codex.js')

// npm puts global packages under <prefix>/node_modules on Windows and under
// <prefix>/lib/node_modules on POSIX, and puts the matching bin directory on
// PATH in both cases.
const entrypoint_candidates = directory => [
  node_path.join(directory, 'node_modules', PACKAGE_ENTRYPOINT),
  node_path.join(directory, '..', 'lib', 'node_modules', PACKAGE_ENTRYPOINT),
]

const find_codex_entrypoint = (path_value = process.env.PATH) => {
  for (const directory of String(path_value || '').split(node_path.delimiter).filter(Boolean)) {
    for (const candidate of entrypoint_candidates(directory.replace(/^"|"$/g, ''))) {
      try {
        if (node_fs.statSync(candidate).isFile()) return node_path.resolve(candidate)
      } catch (error) {
        // The next candidate is the only useful response to a missing file.
      }
    }
  }
  return null
}

const main = () => {
  const entrypoint = find_codex_entrypoint()
  if (entrypoint === null) {
    process.stderr.write('agentflow: could not find the Codex CLI package on PATH\n')
    process.exit(1)
  }

  const result = node_child_process.spawnSync(process.execPath, [entrypoint, ...process.argv.slice(2)], {
    stdio: 'inherit',
    windowsHide: true,
  })
  if (result.error) {
    process.stderr.write(`agentflow: Codex worker failed to start: ${result.error.message}\n`)
    process.exit(1)
  }
  process.exit(result.status === null ? 1 : result.status)
}

if (require.main === module) main()

module.exports = { find_codex_entrypoint }
