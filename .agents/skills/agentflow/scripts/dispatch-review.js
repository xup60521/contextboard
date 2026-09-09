'use strict'

// CLI front end for external-runner-v1. The runner ships as a library, so a
// coordinator had to hand-roll a launcher before it could dispatch anything.
// Selection and tiering come from ag-settings so this file adds no policy of
// its own; it owns provenance, the marker, and the recorded dispatch facts.

const node_fs = require('node:fs')
const node_path = require('node:path')
const { run_external_command } = require('./external-runner.js')
const ag_settings = require('./ag-settings.js')

const REPORT_MAX_BYTES = 400_000
const DIAGNOSTIC_MAX_BYTES = 4096
const MARKER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const USAGE = [
  'usage: node dispatch-review.js --repo <path> --brief <path> --output <path>',
  '                              --stage <name> --marker <token>',
  '                              [--role <name>] [--notebook <path>] [--worker-args <json-array>]',
].join('\n')

const fail = message => {
  process.stderr.write(message + '\n')
  process.exit(1)
}

const parse_args = argv => {
  const values = {}
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    if (typeof flag !== 'string' || !flag.startsWith('--')) fail(USAGE)
    values[flag.slice(2).replaceAll('-', '_')] = argv[index + 1]
  }
  return values
}

const parse_worker_args = raw => {
  if (raw === undefined) return []
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    fail('--worker-args must be valid JSON: ' + error.message)
  }
  const valid = Array.isArray(parsed) && parsed.every(value => typeof value === 'string')
  if (!valid) fail('--worker-args must be a JSON array of strings')
  return parsed
}

const build_dispatch_facts = ({ args, dispatch, report, result }) => ({
  dispatch,
  status: result.status,
  exit_code: result.exit_code,
  timed_out: result.timed_out,
  clone: {
    independent: result.clone.independent,
    remotes: result.clone.remotes,
    changed: result.clone.changed,
  },
  stdout_bytes: result.stdout_bytes,
  stdout_truncated: result.stdout_truncated,
  stderr_excerpt: result.stderr.slice(0, DIAGNOSTIC_MAX_BYTES),
  report_bytes: Buffer.byteLength(report),
  report_path: args.output,
})

// Selection lives in ag-settings, but `active_host` only reaches family
// filtering through the third argument, so passing it in the second silently
// disables `cli-provider` for reviews. Keep the two argument objects distinct.
const select_reviewer = (config, { role = 'cross-check', active_host = 'claude', ...validation } = {}) =>
  ag_settings.resolve_worker_tier(config, { role }, { active_host, ...validation })

// The configured tier carries an effort that has to be spelled per family, or a
// review runs at the CLI default while the dispatch record claims the tier.
const family_model_flags = {
  codex: (model, effort) => ['-m', model, '-c', `model_reasoning_effort=${effort}`],
  claude: (model, effort) => ['--model', model, '--effort', effort],
}

const worker_invocation = (selected, worker_args, brief_text) => {
  const flags = family_model_flags[selected.profile.family]
  if (flags === undefined) throw new Error(`configured model and effort cannot be applied to unsupported worker family ${selected.profile.family || '<missing>'}`)
  return [...selected.args, ...flags(selected.model, selected.effort), ...worker_args, brief_text]
}

const main = async () => {
  const args = parse_args(process.argv.slice(2))
  for (const name of ['repo', 'brief', 'output', 'stage', 'marker']) {
    if (typeof args[name] !== 'string' || args[name].length === 0) fail(USAGE)
  }
  if (!MARKER_PATTERN.test(args.marker)) fail('--marker must match the delegate marker pattern')

  // A JSON array keeps caller-supplied flags literal; nothing reaches a shell.
  const worker_args = parse_worker_args(args.worker_args)
  const repository_root = node_path.resolve(args.repo)
  const brief_text = node_fs.readFileSync(node_path.resolve(args.brief), 'utf8')
  const notebook = args.notebook === undefined ? '.agentflow/devlog.md' : args.notebook
  const config_path = ag_settings.active_config_path(repository_root, notebook)
  const config = ag_settings.load_config(config_path, { host: 'claude' })

  // Fail closed on no eligible profile: resolve_worker_tier throws rather than
  // guessing, which keeps an unlaunchable worker from being selected.
  const selected = select_reviewer(config, { role: args.role })

  const dispatch = {
    stage: args.stage,
    profile: selected.profile.id,
    family: selected.profile.family,
    tier: selected.tier,
    model: selected.model,
    effort: selected.effort,
    marker: args.marker,
    worker_args,
  }
  process.stderr.write('dispatching ' + JSON.stringify(dispatch) + '\n')

  const result = await run_external_command({
    command: selected.executable,
    args: worker_invocation(selected, worker_args, brief_text),
    source_directory: repository_root,
    max_output_bytes: REPORT_MAX_BYTES,
    env: { ...process.env, AGENTFLOW_EXTERNAL_DELEGATE: args.marker },
  })

  const report = typeof result.result.value === 'string' ? result.result.value : ''
  const output_path = node_path.resolve(args.output)
  node_fs.writeFileSync(output_path, report)
  node_fs.writeFileSync(output_path + '.dispatch.json', JSON.stringify(
    build_dispatch_facts({ args, dispatch, report, result }),
    null,
    2,
  ))

  process.stderr.write([
    'status=' + result.status,
    'exit=' + result.exit_code,
    'clone_changed=' + result.clone.changed,
    'report_bytes=' + Buffer.byteLength(report),
  ].join(' ') + '\n')
  process.exit(result.status === 'completed' && result.exit_code === 0 ? 0 : 1)
}

if (require.main === module) main().catch(error => fail(error.stack === undefined ? String(error) : error.stack))

module.exports = { build_dispatch_facts, select_reviewer, worker_invocation }
