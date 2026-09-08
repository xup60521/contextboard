'use strict'

const node_assert = require('node:assert/strict')
const node_fs = require('node:fs')
const node_os = require('node:os')
const node_path = require('node:path')
const node_test = require('node:test')

const { find_codex_entrypoint } = require('./codex-worker.js')

node_test.test('Codex worker resolves the JavaScript entrypoint behind an npm shim', () => {
  const root = node_fs.mkdtempSync(node_path.join(node_os.tmpdir(), 'agentflow-codex-worker-'))
  const bin = node_path.join(root, 'bin')
  const entrypoint = node_path.join(bin, 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
  try {
    node_fs.mkdirSync(node_path.dirname(entrypoint), { recursive: true })
    node_fs.writeFileSync(entrypoint, '')
    node_assert.equal(find_codex_entrypoint([node_path.join(root, 'missing'), bin].join(node_path.delimiter)), entrypoint)
  } finally {
    node_fs.rmSync(root, { recursive: true, force: true })
  }
})

node_test.test('Codex worker fails closed when the package is absent', () => {
  node_assert.equal(find_codex_entrypoint(''), null)
})
