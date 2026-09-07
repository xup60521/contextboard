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
const USAGE = 'usage: node dispatch-review.js --repo <path> --brief <path> --output <path> --stage <name> --marker <token> [--role <name>] [--notebook <path>]'

const fail = message => {
  process.stderr.write(`${message}\n`)
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

const main = async () => {
  const args = parse_args(process.argv.slice(2))
  for (const name of ['repo', 'brief', 'output', 'stage', 'marker']) {
    if (typeof args[name] !== 'string' || args[name].length === 0) fail(USAGE)
  }
  if (!MARKER_PATTERN.test(args.marker)) fail('--marker must match the delegate marker pattern')

  const repository_root = node_path.resolve(args.repo)
  const brief_text = node_fs.readFileSync(node_path.resolve(args.brief), 'utf8')
  const notebook = args.notebook ?? '.agentflow/devlog.md'
  const config_path = ag_settings.active_config_path(repository_root, notebook)
  const config = ag_settings.load_config(config_path, { host: 'claude' })

  // Fail closed on no eligible profile: resolve_worker_tier throws rather than
  // guessing, which is what keeps an unlaunchable worker from being selected.
  const selected = ag_settings.resolve_worker_tier(config, {
    role: args.role ?? 'cross-check',
    active_host: 'claude',
  })

  const dispatch = {
    stage: args.stage,
    profile: selected.profile.id,
    family: selected.profile.family,
    tier: selected.tier,
    model: selected.model,
    effort: selected.effort,
    marker: args.marker,
  }
  process.stderr.write(`dispatching ${JSON.stringify(dispatch)}\n`)

  const result = await run_external_command({
    command: selected.executable,
    args: [...selected.args, '--model', selected.model, brief_text],
    source_directory: repository_root,
    max_output_bytes: REPORT_MAX_BYTES,
    env: { ...process.env, AGENTFLOW_EXTERNAL_DELEGATE: args.marker },
  })

  const report = typeof result.result?.value === 'string' ? result.result.value : ''
  const output_path = node_path.resolve(args.output)
  node_fs.writeFileSync(output_path, report)
  node_fs.writeFileSync(`${output_path}.dispatch.json`, JSON.stringify({
    dispatch,
    status: result.status,
    exit_code: result.exit_code,
    timed_out: result.timed_out,
    clone: {
      independent: result.clone.independent,
      remotes: result.clone.remotes,
      changed: result.clone.changed,
    },
    stdout_bytes: result.stdout.bytes,
    stdout_truncated: result.stdout_truncated,
    stderr_excerpt: result.stderr.excerpt.slice(0, DIAGNOSTIC_MAX_BYTES),
    report_bytes: Buffer.byteLength(report),
    report_path: args.output,
  }, null, 2))

  process.stderr.write(`status=${result.status} exit=${result.exit_code} clone_changed=${result.clone.changed} report_bytes=${Buffer.byteLength(report)}\n`)
  process.exit(result.status === 'completed' && result.exit_code === 0 ? 0 : 1)
}

main().catch(error => fail(error.stack ?? String(error)))
