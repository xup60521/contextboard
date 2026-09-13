'use strict'

const node_assert = require('node:assert/strict')
const node_fs = require('node:fs')
const node_os = require('node:os')
const node_path = require('node:path')
const node_test = require('node:test')

const ag_settings = require('./ag-settings.js')
const {
  build_dispatch_facts, normalize_report, resolve_host, resolve_launch, select_reviewer, worker_availability, worker_invocation,
} = require('./dispatch-review.js')

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

// v8.2 added nested-worker detection and containment. A record that omits it
// cannot tell a clean run from a contained violation.
node_test.test('dispatch facts carry the nested-worker verdict and its visibility', () => {
  const nested_worker = {
    visible: false,
    detected: false,
    processes: [],
    containment: { attempted: false, actions: [] },
    poll_count: 3,
  }
  const acceptance = { accepted: false, reason: 'Process exit and captured output do not prove coordinator acceptance.' }
  const result = {
    status: 'completed',
    exit_code: 0,
    timed_out: false,
    clone: { independent: true, remotes: [], changed: false },
    stdout_bytes: 1,
    stdout_truncated: false,
    stderr: '',
    nested_worker,
    acceptance,
  }

  const facts = build_dispatch_facts({ args: { output: 'r.md' }, dispatch: {}, report: 'x', result })

  node_assert.equal(facts.nested_worker.visible, false)
  node_assert.equal(facts.nested_worker.detected, false)
  node_assert.deepEqual(facts.acceptance, acceptance)
  node_assert.equal(build_dispatch_facts({ args: { output: 'r.md' }, dispatch: {}, report: 'x', result: { ...result, nested_worker: undefined, acceptance: undefined } }).nested_worker, null)
})

// Both cases below are regressions this file failed to catch: the dispatch
// recorded a model and effort it never passed, and host-family selection never
// applied because active_host reached the wrong argument.

// v8.2 defaults cli-provider to 'on', so host-family restriction has to be
// asked for explicitly; reversing the profiles makes a family mistake visible
// because the wrong family is also the higher-priority one.
const codex_first_config = (cli_provider = 'off') => {
  const config = JSON.parse(JSON.stringify(ag_settings.make_template('claude')))
  config['external-workers'].reverse()
  config.switches['cli-provider'] = cli_provider
  return config
}

node_test.test('reviewer selection honours cli-provider off by restricting to the host family', () => {
  const config = codex_first_config()
  node_assert.equal(config['external-workers'][0].family, 'codex')

  const selected = select_reviewer(config, { active_host: 'claude', executables: ['codex', 'claude'] })

  node_assert.equal(selected.profile.family, 'claude')
  node_assert.equal(selected.profile.id, 'claude-default')
})

node_test.test('reviewer selection follows the coordinator host rather than a built-in default', () => {
  const config = codex_first_config()

  node_assert.equal(select_reviewer(config, { active_host: 'codex', executables: ['codex', 'claude'] }).profile.family, 'codex')
  node_assert.equal(select_reviewer(config, { active_host: 'claude', executables: ['codex', 'claude'] }).profile.family, 'claude')
})

node_test.test('reviewer selection still crosses families when cli-provider is on', () => {
  const config = codex_first_config('on')

  const selected = select_reviewer(config, { active_host: 'claude', executables: ['codex', 'claude'] })

  node_assert.equal(selected.profile.family, 'codex')
})

// An explicit --host wins, and an absent one falls back to the runtime markers
// ag-settings already trusts rather than to a built-in guess. The refusal path
// is a process exit, so it is exercised by the CLI rather than here.
node_test.test('the coordinator host is taken explicitly, then from runtime markers', () => {
  node_assert.equal(resolve_host('codex'), 'codex')
  node_assert.equal(resolve_host('claude'), 'claude')
  node_assert.equal(resolve_host(undefined, { env: { CODEX_SESSION_ID: 'session' } }), 'codex')
  node_assert.equal(resolve_host(undefined, { env: { CLAUDE_SESSION_ID: 'session' } }), 'claude')
})

// A machine whose only Codex is an npm package used to be judged unavailable
// before the launch shim was ever consulted, so Codex review simply vanished.
node_test.test('an npm-only Codex counts as available and launches through the shim', () => {
  const root = node_fs.mkdtempSync(node_path.join(node_os.tmpdir(), 'agentflow-dispatch-'))
  const bin = node_path.join(root, 'bin')
  const entrypoint = node_path.join(bin, 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
  try {
    node_fs.mkdirSync(node_path.dirname(entrypoint), { recursive: true })
    node_fs.writeFileSync(entrypoint, '')

    const available = worker_availability({ path_value: bin })
    node_assert.equal(available('codex'), true)
    node_assert.equal(available('claude'), false)

    const launch = resolve_launch('codex', { path_value: bin })
    node_assert.equal(launch.via, 'npm-package')
    node_assert.equal(launch.executable, process.execPath)
    node_assert.equal(node_path.basename(launch.prefix_args[0]), 'codex-worker.js')
  } finally {
    node_fs.rmSync(root, { recursive: true, force: true })
  }
})

node_test.test('an explicit executables answer is not widened by a filesystem probe', () => {
  const available = worker_availability({ executables: ['claude'] })
  node_assert.equal(available('claude'), true)
  node_assert.equal(available('codex'), false)
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
