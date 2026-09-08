'use strict'

const node_child_process = require('node:child_process')
const node_fs = require('node:fs')
const node_path = require('node:path')

const find_codex_entrypoint = (path_value = process.env.PATH) => {
  for (const directory of (path_value || '').split(node_path.delimiter).filter(Boolean)) {
    const candidate = node_path.join(directory, 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
    if (node_fs.existsSync(candidate)) return candidate
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
