'use strict'

const node_path = require('node:path')

const whole_checkout_kinds = new Set(['checkout', 'repository', 'whole-checkout', 'whole_checkout'])
const MAX_OUTPUT_EXCERPT_BYTES = 4096

const is_object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const nonempty_text = value => typeof value === 'string' && value.trim().length > 0
const clone = value => JSON.parse(JSON.stringify(value))
const comparable = value => {
  if (Array.isArray(value)) return value.map(comparable)
  if (!is_object(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, comparable(value[key])]))
}
const same = (left, right) => JSON.stringify(comparable(left)) === JSON.stringify(comparable(right))

const canonical_path = (value, working_directory) => {
  if (!nonempty_text(value)) return ''
  return node_path.resolve(working_directory || process.cwd(), value)
}

const normalize_command = value => {
  if (Array.isArray(value)) {
    if (value.length === 0 || !value.every(part => typeof part === 'string') || !nonempty_text(value[0])) return null
    return { command: value[0], args: value.slice(1) }
  }
  if (typeof value === 'string' && value.trim().length > 0) return { command: value, args: [] }
  if (!is_object(value) || !nonempty_text(value.command ?? value.executable)) return null
  const args = value.args === undefined ? [] : value.args
  if (!Array.isArray(args) || !args.every(arg => typeof arg === 'string')) return null
  return { command: value.command ?? value.executable, args: [...args] }
}

const normalize_runtime = value => {
  if (!is_object(value)) return null
  if (!nonempty_text(value.executable ?? value.runtime_executable)) return null
  if (!nonempty_text(value.version ?? value.runtime_version)) return null
  return {
    executable: value.executable ?? value.runtime_executable,
    version: value.version ?? value.runtime_version,
  }
}

const normalize_process_result = value => {
  if (!is_object(value) || !Number.isInteger(value.exit_code)) return null
  if (value.signal !== null && value.signal !== undefined && !nonempty_text(value.signal)) return null
  return { exit_code: value.exit_code, signal: value.signal ?? null }
}

const normalize_output_identity = value => {
  if (!is_object(value) || !/^[0-9a-f]{64}$/i.test(value.sha256 ?? value.digest ?? '')) return null
  const byte_length = value.byte_length ?? value.bytes
  if (!Number.isInteger(byte_length) || byte_length < 0) return null
  if (value.excerpt !== undefined && typeof value.excerpt !== 'string') return null
  return {
    sha256: value.sha256 ?? value.digest,
    byte_length,
    ...(value.excerpt === undefined ? {} : { excerpt: value.excerpt }),
  }
}

const normalize_input = (value, working_directory) => {
  if (!is_object(value)) return null
  const path = canonical_path(value.path ?? value.canonical_path ?? value.file, working_directory)
  const identity = value.identity ?? value.content_identity ?? value.sha256 ?? value.digest ?? value.git_revision
  const kind = String(value.kind ?? value.input_kind ?? '').trim().toLowerCase()
  const reason = value.reason ?? ''
  if (!nonempty_text(path) || !nonempty_text(identity) || !nonempty_text(kind) || !nonempty_text(reason)) return null
  return { path, identity: String(identity), kind, reason: String(reason) }
}

const normalize_manifest = manifest => {
  if (!is_object(manifest)) return null
  const working_directory = canonical_path(manifest.working_directory ?? manifest.cwd)
  const command = normalize_command(manifest.command ?? manifest.suite_command)
  const runtime = normalize_runtime(manifest.runtime ?? {
    executable: manifest.runtime_executable,
    version: manifest.runtime_version,
  })
  const environment = manifest.environment ?? manifest.environment_facts ?? {}
  const raw_inputs = manifest.suite_inputs ?? manifest.declared_suite_inputs
  const raw_reports = manifest.report_only_paths
  if (!nonempty_text(working_directory) || command === null || !Array.isArray(raw_inputs) || !is_object(environment) || !Array.isArray(raw_reports)) return null

  const suite_inputs = raw_inputs.map(input => normalize_input(input, working_directory))
  const report_only_paths = raw_reports.map(path => canonical_path(path, working_directory))
  if (suite_inputs.some(input => input === null) || report_only_paths.some(path => !nonempty_text(path))) return null
  return {
    command,
    working_directory,
    suite_inputs,
    runtime,
    environment: clone(environment),
    report_only_paths,
    started_at: manifest.started_at ?? manifest.start_time ?? '',
    ended_at: manifest.ended_at ?? manifest.end_time ?? '',
    process_result: normalize_process_result(manifest.process_result),
    output_identity: normalize_output_identity(manifest.output_identity ?? manifest.bounded_output_identity),
  }
}

const validate_suite_manifest = manifest => {
  const errors = []
  const normalized = normalize_manifest(manifest)
  if (normalized === null) return { valid: false, errors: ['suite manifest must contain an exact command, working directory, suite_inputs, runtime, environment, and report_only_paths'], manifest: null }
  if (!node_path.isAbsolute(normalized.working_directory)) errors.push('suite working_directory must be absolute')
  if (normalized.runtime === null) errors.push('suite runtime must contain executable and version')
  const started_ms = Date.parse(normalized.started_at)
  const ended_ms = Date.parse(normalized.ended_at)
  if (!nonempty_text(normalized.started_at) || !Number.isFinite(started_ms)) errors.push('suite started_at must be a valid timestamp')
  if (!nonempty_text(normalized.ended_at) || !Number.isFinite(ended_ms)) errors.push('suite ended_at must be a valid timestamp')
  if (Number.isFinite(started_ms) && Number.isFinite(ended_ms) && ended_ms < started_ms) errors.push('suite ended_at must not precede started_at')
  if (normalized.process_result === null) errors.push('suite process_result must contain an integer exit_code and optional signal')
  if (normalized.output_identity === null) errors.push('suite output_identity must contain a SHA-256 digest and non-negative byte_length')
  if (normalized.output_identity && normalized.output_identity.excerpt !== undefined && Buffer.byteLength(normalized.output_identity.excerpt) > MAX_OUTPUT_EXCERPT_BYTES) errors.push('suite output_identity excerpt exceeds the bounded output limit')
  if (normalized.suite_inputs.length === 0) errors.push('suite_inputs must contain at least one declared input')
  if (new Set(normalized.suite_inputs.map(input => input.path)).size !== normalized.suite_inputs.length) errors.push('suite_inputs paths must be unique')
  if (new Set(normalized.report_only_paths).size !== normalized.report_only_paths.length) errors.push('report_only_paths must be unique')
  if (normalized.suite_inputs.some(input => whole_checkout_kinds.has(input.kind.replace(/_/g, '-')) || input.path === normalized.working_directory)) {
    errors.push('suite_inputs must not use a whole-checkout invalidation identity')
  }
  const suite_paths = new Set(normalized.suite_inputs.map(input => input.path))
  if (normalized.report_only_paths.some(path => suite_paths.has(path))) {
    errors.push('a path read by the suite must be in suite_inputs, not report_only_paths')
  }
  if (manifest.checkout_identity !== undefined || manifest.whole_checkout_identity !== undefined) {
    errors.push('suite manifest must not use a whole-checkout invalidation identity')
  }
  return { valid: errors.length === 0, errors, manifest: errors.length === 0 ? normalized : null }
}

const create_suite_manifest = input => {
  const result = validate_suite_manifest(input)
  if (!result.valid) throw new Error(result.errors.join('; '))
  return result.manifest
}

const compare_suite_manifests = (before, after) => {
  const before_result = validate_suite_manifest(before)
  const after_result = validate_suite_manifest(after)
  const reasons = []
  if (!before_result.valid) reasons.push(...before_result.errors.map(error => `before: ${error}`))
  if (!after_result.valid) reasons.push(...after_result.errors.map(error => `after: ${error}`))
  if (reasons.length > 0) return { reusable: false, reasons, changed: ['manifest'] }

  const left = before_result.manifest
  const right = after_result.manifest
  const changed = []
  if (!same(left.command, right.command)) changed.push('command')
  if (left.working_directory !== right.working_directory) changed.push('working_directory')
  if (!same(left.runtime, right.runtime)) changed.push('runtime')
  if (!same(left.environment, right.environment)) changed.push('environment')

  const left_inputs = new Map(left.suite_inputs.map(input => [input.path, input]))
  const right_inputs = new Map(right.suite_inputs.map(input => [input.path, input]))
  const all_paths = new Set([...left_inputs.keys(), ...right_inputs.keys()])
  for (const path of all_paths) {
    if (!same(left_inputs.get(path), right_inputs.get(path))) changed.push(`suite_input:${path}`)
  }

  return {
    reusable: changed.length === 0,
    reasons: changed.length === 0 ? [] : changed.map(change => `declared suite fact changed: ${change}`),
    changed,
    before: left,
    after: right,
  }
}

const compare_suite_evidence = compare_suite_manifests
const suite_evidence_reusable = (comparison_or_before, after) => {
  if (after !== undefined) return compare_suite_manifests(comparison_or_before, after).reusable === true
  return comparison_or_before !== null && typeof comparison_or_before === 'object' && comparison_or_before.reusable === true
}
const commands_match = (left, right) => {
  const normalized_left = normalize_command(left)
  const normalized_right = normalize_command(right)
  return normalized_left !== null && normalized_right !== null && same(normalized_left, normalized_right)
}

module.exports = {
  MAX_OUTPUT_EXCERPT_BYTES,
  create_suite_manifest,
  validate_suite_manifest,
  compare_suite_manifests,
  compare_suite_evidence,
  suite_evidence_reusable,
  commands_match,
}
