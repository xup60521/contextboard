'use strict'

const node_assert = require('node:assert/strict')
const node_test = require('node:test')

const { build_dispatch_facts } = require('./dispatch-review.js')

node_test.test('review dispatch records the external runner result shape', () => {
  const facts = build_dispatch_facts({
    args: { output: 'review.md' },
    dispatch: { stage: 'cross-check' },
    report: 'PASS',
    result: {
      status: 'failed',
      exit_code: 1,
      timed_out: false,
      clone: { independent: true, remotes: [], changed: false },
      stdout_bytes: 12,
      stdout_truncated: false,
      stderr: 'provider unavailable',
    },
  })

  node_assert.equal(facts.stdout_bytes, 12)
  node_assert.equal(facts.stderr_excerpt, 'provider unavailable')
  node_assert.equal(facts.report_bytes, 4)
})

// Both cases below are regressions this file failed to catch: the dispatch
// recorded a model and effort it never passed, and host-family selection never
// applied because active_host reached the wrong argument.

const ag_settings = require('./ag-settings.js')
const { select_reviewer, worker_invocation } = require('./dispatch-review.js')

const codex_first_config = () => {
  const config = JSON.parse(JSON.stringify(ag_settings.make_template('claude')))
  config['external-workers'].reverse()
  return config
}

node_test.test('reviewer selection honours cli-provider off by restricting to the host family', () => {
  const config = codex_first_config()
  node_assert.equal(config['external-workers'][0].family, 'codex')

  const selected = select_reviewer(config, { executables: ['codex', 'claude'] })

  node_assert.equal(selected.profile.family, 'claude')
  node_assert.equal(selected.profile.id, 'claude-default')
})

node_test.test('reviewer selection still crosses families when cli-provider is on', () => {
  const config = codex_first_config()
  config.switches['cli-provider'] = 'on'

  const selected = select_reviewer(config, { executables: ['codex', 'claude'] })

  node_assert.equal(selected.profile.family, 'codex')
})

node_test.test('worker invocation passes the configured effort for each supported family', () => {
  const brief = 'review this'
  const codex = worker_invocation(
    { profile: { family: 'codex' }, args: ['exec'], model: 'gpt-5.6-terra', effort: 'high' },
    [],
    brief,
  )
  node_assert.deepEqual(codex, ['exec', '-m', 'gpt-5.6-terra', '-c', 'model_reasoning_effort=high', brief])

  const claude = worker_invocation(
    { profile: { family: 'claude' }, args: ['-p'], model: 'claude-opus-4-6', effort: 'high' },
    ['--verbose'],
    brief,
  )
  node_assert.deepEqual(claude, ['-p', '--model', 'claude-opus-4-6', '--effort', 'high', '--verbose', brief])
})

node_test.test('worker invocation refuses an unsupported family rather than silently dropping the effort', () => {
  node_assert.throws(
    () => worker_invocation({ profile: { family: 'gemini' }, args: [], model: 'm', effort: 'high' }, [], 'brief'),
    /unsupported worker family gemini/u,
  )
})

// The gate requires the worker stamp on line 1, but a chat-style CLI prepends a
// sentence, so five dispatches were spent on framing rather than substance.

const { normalize_report } = require('./dispatch-review.js')

const stamp = '* _2026-09-09 15:28:21 (claude-opus-4-6/high)_'

node_test.test('report normalization drops a chat preamble so the stamp lands on line one', () => {
  const raw = ['Now I have everything. Here is the report:', '', stamp, '', 'Verdict: PASS'].join('\n')

  const { report, trimmed_bytes } = normalize_report(raw)

  node_assert.equal(report.split('\n')[0], stamp)
  node_assert.equal(report, [stamp, '', 'Verdict: PASS'].join('\n'))
  node_assert.equal(trimmed_bytes, Buffer.byteLength('Now I have everything. Here is the report:\n\n'))
})

node_test.test('report normalization leaves an already-clean report byte-identical', () => {
  const raw = [stamp, '', 'Verdict: PASS'].join('\n')

  const { report, trimmed_bytes } = normalize_report(raw)

  node_assert.equal(report, raw)
  node_assert.equal(trimmed_bytes, 0)
})

node_test.test('report normalization leaves a stampless report untouched rather than mangling a failure', () => {
  const raw = 'ERROR: you have hit your usage limit\n'

  const { report, trimmed_bytes } = normalize_report(raw)

  node_assert.equal(report, raw)
  node_assert.equal(trimmed_bytes, 0)
})

node_test.test('report normalization tolerates carriage returns from a Windows worker', () => {
  const raw = ['Here is the report:', '', stamp, '', 'Verdict: PASS'].join('\r\n')

  const { report } = normalize_report(raw)

  node_assert.equal(report.split('\r\n')[0], stamp)
})

node_test.test('dispatch facts record the trimmed preamble so the raw output stays auditable', () => {
  const result = {
    status: 'completed',
    exit_code: 0,
    timed_out: false,
    clone: { independent: true, remotes: [], changed: false },
    stdout_bytes: 120,
    stdout_truncated: false,
    stderr: '',
  }

  node_assert.equal(build_dispatch_facts({ args: { output: 'r.md' }, dispatch: {}, report: 'x', result, trimmed_bytes: 44 }).preamble_trimmed_bytes, 44)
  node_assert.equal(build_dispatch_facts({ args: { output: 'r.md' }, dispatch: {}, report: 'x', result }).preamble_trimmed_bytes, 0)
})
