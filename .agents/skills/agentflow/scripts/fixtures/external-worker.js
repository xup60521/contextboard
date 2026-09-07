'use strict'

const node_fs = require('node:fs')
const node_path = require('node:path')

const mode = process.argv[2]

if (mode === 'text') {
  process.stdout.write('FAKE_TEXT_RESULT\n')
} else if (mode === 'args') {
  process.stdout.write(JSON.stringify(process.argv.slice(3)) + '\n')
} else if (mode === 'json') {
  process.stdout.write(JSON.stringify({ kind: 'json', ok: true }) + '\n')
} else if (mode === 'result-file') {
  node_fs.writeFileSync(node_path.join(process.cwd(), 'declared-result.json'), JSON.stringify({ from: 'file', ok: true }) + '\n')
  process.stdout.write('FILE_CREATED\n')
} else if (mode === 'result-file-symlink') {
  node_fs.symlinkSync(process.argv[3], node_path.join(process.cwd(), 'declared-result.json'))
  process.stdout.write('SYMLINK_CREATED\n')
} else if (mode === 'result-file-parent-symlink') {
  node_fs.symlinkSync(process.argv[3], node_path.join(process.cwd(), 'result-dir'))
  process.stdout.write('PARENT_SYMLINK_CREATED\n')
} else if (mode === 'change') {
  node_fs.writeFileSync(node_path.join(process.cwd(), 'worker-change.txt'), 'fake worker change\n')
  process.stdout.write('CLONE_CHANGED\n')
} else if (mode === 'large') {
  process.stdout.write('O'.repeat(12_000))
  process.stderr.write('E'.repeat(12_000))
} else if (mode === 'timeout') {
  process.stdout.write('TIMEOUT_STARTED\n')
  setInterval(() => {}, 50)
} else if (mode === 'slow-output') {
  process.stdout.write('FIRST\n')
  setTimeout(() => process.stdout.write('SECOND\n'), 60)
  setTimeout(() => process.exit(0), 120)
} else if (mode === 'stdin') {
  const input = node_fs.readFileSync(0, 'utf8')
  process.stdout.write(input)
} else if (mode === 'environment') {
  const names = process.argv.slice(3)
  process.stdout.write(JSON.stringify(Object.fromEntries(names.map(name => [name, process.env[name] || null]))) + '\n')
} else {
  process.stderr.write(`unknown fake-worker mode: ${mode}\n`)
  process.exitCode = 2
}
