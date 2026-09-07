'use strict'

const node_assert = require('node:assert/strict')
const node_fs = require('node:fs')
const node_os = require('node:os')
const node_path = require('node:path')
const node_test = require('node:test')

const suite_evidence = require('./suite-evidence.js')

const clone = value => JSON.parse(JSON.stringify(value))

const make_manifest = () => {
  const root = node_fs.realpathSync(node_fs.mkdtempSync(node_path.join(node_os.tmpdir(), 'agentflow-suite-evidence-')))
  const input = kind => ({
    path: node_path.join(root, `${kind}.js`),
    identity: `${kind}-identity-1`,
    kind,
    reason: `${kind} can affect the declared suite result`,
  })
  const manifest = suite_evidence.create_suite_manifest({
    command: { command: process.execPath, args: ['--test', 'suite.test.js'] },
    working_directory: root,
    suite_inputs: [input('source'), input('test'), input('dependency'), input('build_input'), input('other')],
    runtime: { executable: process.execPath, version: process.version },
    environment: { NODE_ENV: 'test', SUITE_MODE: 'stable' },
    report_only_paths: [node_path.join(root, 'report.md')],
    started_at: '2026-08-23T11:00:00.000Z',
    ended_at: '2026-08-23T11:00:01.000Z',
    process_result: { exit_code: 0, signal: null },
    output_identity: { sha256: 'a'.repeat(64), byte_length: 128 },
  })
  return { root, manifest }
}

const dispose = root => node_fs.rmSync(root, { recursive: true, force: true })

node_test.test('suite manifests keep declared inputs and report-only paths separate', () => {
  const { root, manifest } = make_manifest()
  try {
    const checked = suite_evidence.validate_suite_manifest(manifest)
    node_assert.equal(checked.valid, true, checked.errors.join('; '))
    node_assert.deepEqual(checked.manifest.report_only_paths, [node_path.join(root, 'report.md')])
    node_assert.equal(checked.manifest.suite_inputs.some(input => input.path.endsWith('report.md')), false)

    const whole_checkout = clone(manifest)
    whole_checkout.suite_inputs[0] = {
      path: root,
      identity: 'whole-checkout-identity',
      kind: 'whole_checkout',
      reason: 'unrelated checkout identity',
    }
    const rejected = suite_evidence.validate_suite_manifest(whole_checkout)
    node_assert.equal(rejected.valid, false)
    node_assert.match(rejected.errors.join('; '), /whole-checkout|declared input|suite input/i)
  } finally {
    dispose(root)
  }
})

node_test.test('suite manifests require complete bounded run evidence', () => {
  const { root, manifest } = make_manifest()
  try {
    for (const field of ['started_at', 'ended_at', 'process_result', 'output_identity']) {
      const incomplete = clone(manifest)
      delete incomplete[field]
      const checked = suite_evidence.validate_suite_manifest(incomplete)
      node_assert.equal(checked.valid, false, `${field} was optional`)
      node_assert.match(checked.errors.join('; '), /time|process|output|evidence/i)
    }

    const reversed = clone(manifest)
    reversed.ended_at = '2026-08-23T10:59:59.000Z'
    node_assert.equal(suite_evidence.validate_suite_manifest(reversed).valid, false)

    const unbounded = clone(manifest)
    unbounded.output_identity = { sha256: 'a'.repeat(64), byte_length: 1, excerpt: 'x'.repeat(4097) }
    node_assert.equal(suite_evidence.validate_suite_manifest(unbounded).valid, false)
  } finally {
    dispose(root)
  }
})

node_test.test('suite comparison reuses evidence after an unrelated report-only change', () => {
  const { root, manifest } = make_manifest()
  try {
    const current = clone(manifest)
    current.report_only_paths = [node_path.join(root, 'report.md')]
    const comparison = suite_evidence.compare_suite_manifests(manifest, current)
    node_assert.equal(comparison.reusable, true, comparison.reasons.join('; '))
    node_assert.deepEqual(comparison.changed, [])
  } finally {
    dispose(root)
  }
})

node_test.test('suite comparison invalidates every declared input kind, runtime fact, and environment fact', () => {
  const { root, manifest } = make_manifest()
  try {
    for (const kind of ['source', 'test', 'dependency', 'build_input', 'other']) {
      const changed = clone(manifest)
      changed.suite_inputs.find(input => input.kind === kind).identity += '-changed'
      const comparison = suite_evidence.compare_suite_manifests(manifest, changed)
      node_assert.equal(comparison.reusable, false, `${kind} change was reusable`)
    }

    const runtime_changed = clone(manifest)
    runtime_changed.runtime.version = 'different-runtime'
    node_assert.equal(suite_evidence.compare_suite_manifests(manifest, runtime_changed).reusable, false)

    const environment_changed = clone(manifest)
    environment_changed.environment.SUITE_MODE = 'different'
    node_assert.equal(suite_evidence.compare_suite_manifests(manifest, environment_changed).reusable, false)

    const command_changed = clone(manifest)
    command_changed.command.args = ['--test', 'other-suite.test.js']
    node_assert.equal(suite_evidence.compare_suite_manifests(manifest, command_changed).reusable, false)
  } finally {
    dispose(root)
  }
})

node_test.test('suite comparison invalidates a report that the suite reads', () => {
  const { root, manifest } = make_manifest()
  try {
    const report_path = node_path.join(root, 'report.md')
    const reads_report = clone(manifest)
    reads_report.report_only_paths = []
    reads_report.suite_inputs.push({
      path: report_path,
      identity: 'report-identity-1',
      kind: 'report',
      reason: 'the suite reads the report',
    })
    const checked = suite_evidence.validate_suite_manifest(reads_report)
    node_assert.equal(checked.valid, true, checked.errors.join('; '))

    const changed_report = clone(reads_report)
    changed_report.suite_inputs.find(input => input.path === report_path).identity = 'report-identity-2'
    const comparison = suite_evidence.compare_suite_manifests(reads_report, changed_report)
    node_assert.equal(comparison.reusable, false)
    node_assert.match(comparison.reasons.join('; '), /report|suite input|identity/i)

    const invalid_split = clone(reads_report)
    invalid_split.report_only_paths = [report_path]
    const rejected = suite_evidence.validate_suite_manifest(invalid_split)
    node_assert.equal(rejected.valid, false)
  } finally {
    dispose(root)
  }
})
