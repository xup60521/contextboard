'use strict'

const node_assert = require('node:assert/strict')
const node_fs = require('node:fs')
const node_os = require('node:os')
const node_path = require('node:path')
const node_test = require('node:test')

const { find_codex_entrypoint } = require('./codex-worker.js')

const make_package = (root, ...segments) => {
  const entrypoint = node_path.join(root, ...segments, '@openai', 'codex', 'bin', 'codex.js')
  node_fs.mkdirSync(node_path.dirname(entrypoint), { recursive: true })
  node_fs.writeFileSync(entrypoint, '')
  return entrypoint
}

node_test.test('Codex worker resolves the JavaScript entrypoint behind a Windows npm shim', () => {
  const root = node_fs.mkdtempSync(node_path.join(node_os.tmpdir(), 'agentflow-codex-worker-'))
  const bin = node_path.join(root, 'bin')
  try {
    const entrypoint = make_package(bin, 'node_modules')
    node_assert.equal(find_codex_entrypoint([node_path.join(root, 'missing'), bin].join(node_path.delimiter)), entrypoint)
  } finally {
    node_fs.rmSync(root, { recursive: true, force: true })
  }
})

// POSIX npm puts global packages under <prefix>/lib/node_modules while only
// <prefix>/bin is on PATH, so the remote Linux side needs this layout too.
node_test.test('Codex worker resolves the entrypoint through a POSIX global prefix layout', () => {
  const root = node_fs.mkdtempSync(node_path.join(node_os.tmpdir(), 'agentflow-codex-worker-'))
  try {
    const entrypoint = make_package(root, 'lib', 'node_modules')
    node_fs.mkdirSync(node_path.join(root, 'bin'), { recursive: true })
    node_assert.equal(find_codex_entrypoint(node_path.join(root, 'bin')), entrypoint)
  } finally {
    node_fs.rmSync(root, { recursive: true, force: true })
  }
})

node_test.test('Codex worker fails closed when the package is absent', () => {
  const root = node_fs.mkdtempSync(node_path.join(node_os.tmpdir(), 'agentflow-codex-worker-'))
  try {
    node_assert.equal(find_codex_entrypoint(''), null)
    node_assert.equal(find_codex_entrypoint(root), null)
  } finally {
    node_fs.rmSync(root, { recursive: true, force: true })
  }
})
