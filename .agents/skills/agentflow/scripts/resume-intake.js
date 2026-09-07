#!/usr/bin/env node
'use strict'

// Bounded local facts for the first `godev` response. This command deliberately
// performs no network request, hook installation, archive read, or write.

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const settings = require('./ag-settings.js')

const MAX_NOTEBOOK_BYTES = 64 * 1024
const MAX_ASK_BYTES = 16 * 1024
const MAX_STATUS_BYTES = 32 * 1024
const MAX_CURRENT_ROUND_BYTES = 64 * 1024

const git = (repo_root, args) => {
  try {
    return execFileSync('git', args, { cwd: repo_root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    const detail = String(error.stderr || error.message || '').trim()
    throw new Error(detail || `git ${args[0]} failed`)
  }
}

const bounded_git = (repo_root, args) => {
  try {
    return execFileSync('git', args, { cwd: repo_root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: MAX_CURRENT_ROUND_BYTES })
  } catch {
    return null
  }
}

const read_bounded = file => {
  const stat = fs.statSync(file)
  if (!stat.isFile()) throw new Error(`notebook is not a regular file: ${file}`)
  if (stat.size <= MAX_NOTEBOOK_BYTES) return { text: fs.readFileSync(file, 'utf8'), complete: true }
  const descriptor = fs.openSync(file, 'r')
  try {
    const head_size = Math.min(stat.size, MAX_STATUS_BYTES)
    const tail_size = Math.min(stat.size, MAX_CURRENT_ROUND_BYTES)
    const head = Buffer.alloc(head_size)
    const tail = Buffer.alloc(tail_size)
    fs.readSync(descriptor, head, 0, head_size, 0)
    fs.readSync(descriptor, tail, 0, tail_size, stat.size - tail_size)
    return { head: head.toString('utf8'), tail: tail.toString('utf8'), complete: false }
  } finally {
    fs.closeSync(descriptor)
  }
}

const status_block = text => {
  const end = text.indexOf('\n---\n')
  if (end < 0) throw new Error('notebook has no STATUS separator')
  return text.slice(0, end).trimEnd()
}

const final_ask_span = text => {
  const matches = [...text.matchAll(/^# → Ask \/ (A-\d+)$/gmu)]
  if (matches.length === 0) return null
  const match = matches[matches.length - 1]
  const body_start = match.index + match[0].length
  const following = text.slice(body_start)
  const next_ask = following.search(/^# → Ask \/ /mu)
  const round = next_ask < 0 ? following : following.slice(0, next_ask)
  if (/^# ← Reply \/ /mu.test(round)) return null
  const progress_record = round.search(/^(?:---\n\s*)?## \[(?:RUN-\d+\] Event|WIP-\d+\] Checkpoint)/mu)
  const body = (progress_record < 0 ? round : round.slice(0, progress_record)).trim()
  if (Buffer.byteLength(body, 'utf8') > MAX_ASK_BYTES) throw new Error(`current Ask exceeds the ${MAX_ASK_BYTES}-byte fast-intake limit`)
  return { id: match[1], text: body, body_start }
}

const final_ask = text => {
  const span = final_ask_span(text)
  return span === null ? null : { id: span.id, text: span.text }
}

const changed_paths = repo_root => {
  const records = git(repo_root, ['status', '--porcelain=v1', '--untracked-files=all', '-z']).split('\0').filter(Boolean)
  const paths = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (record.length < 4) continue
    const code = record.slice(0, 2)
    paths.push(record.slice(3))
    if (/[RC]/u.test(code)) index += 1
  }
  return [...new Set(paths)].sort()
}

const head_text = (repo_root, notebook_path) => {
  try {
    return git(repo_root, ['show', `HEAD:${notebook_path}`])
  } catch {
    return null
  }
}

const expected_owner_input = ({ repo_root, notebook_path, notebook_text, current_ask, changed }) => {
  if (changed.length !== 1 || changed[0] !== notebook_path || current_ask === null || current_ask.text === '+') return false
  const base = head_text(repo_root, notebook_path)
  if (base === null) return false
  const base_ask = final_ask_span(base)
  const working_ask = final_ask_span(notebook_text)
  return base_ask !== null && working_ask !== null &&
    base_ask.id === current_ask.id && base_ask.text === '+' &&
    base.slice(0, base_ask.body_start) === notebook_text.slice(0, working_ask.body_start)
}

const expected_large_owner_input = ({ repo_root, notebook_path, current_ask, changed }) => {
  if (changed.length !== 1 || changed[0] !== notebook_path || current_ask === null || current_ask.text === '+') return false
  const diff = bounded_git(repo_root, ['diff', '--no-ext-diff', '--unified=0', '--', notebook_path])
  if (diff === null) return false
  const hunks = [...diff.matchAll(/^@@ [^\r\n]+@@.*$/gmu)]
  if (hunks.length !== 1) return false
  const changes = diff.slice(hunks[0].index + hunks[0][0].length).split(/\r?\n/).filter(line => /^[+-]/u.test(line))
  const expected = ['-+', ...current_ask.text.split(/\r?\n/).map(line => `+${line}`)]
  return changes.length === expected.length && changes.every((line, index) => line === expected[index])
}

const collect_intake = ({ repo_root = process.cwd(), notebook_path, active_host = 'codex' } = {}) => {
	const root = fs.realpathSync(repo_root)
	const root_config_path = path.join(root, 'ag.json')
	const root_config = settings.read_json_config(root_config_path, { repo_root: root, active_host })
	notebook_path = notebook_path || root_config.switches['target-doc']
	const notebook = path.resolve(root, notebook_path)
  const relative_notebook = path.relative(root, notebook).split(path.sep).join('/')
  if (relative_notebook === '' || relative_notebook.startsWith('../') || path.isAbsolute(relative_notebook)) throw new Error('notebook must stay inside the repository')
	const config_path = relative_notebook === root_config.switches['target-doc'] ? root_config_path : settings.resolve_config_path(root, relative_notebook)
  const config = settings.read_json_config(config_path, { repo_root: root, notebook_path: relative_notebook, active_host })
  const bounded = read_bounded(notebook)
  const text = bounded.complete ? bounded.text : bounded.tail
  const current_ask = final_ask(text)
  if (!bounded.complete && current_ask === null) throw new Error(`current round exceeds the ${MAX_CURRENT_ROUND_BYTES}-byte fast-intake limit or has no complete final Ask boundary`)
  const changed = changed_paths(root)
  const expected = bounded.complete
    ? expected_owner_input({ repo_root: root, notebook_path: relative_notebook, notebook_text: text, current_ask, changed })
    : expected_large_owner_input({ repo_root: root, notebook_path: relative_notebook, current_ask, changed })
  return {
    repository: root,
    notebook: relative_notebook,
    configuration: { valid: true, path: settings.display_path(config_path, root), language: config.switches.lang },
    branch: git(root, ['branch', '--show-current']).trim() || 'detached',
    changed_paths: changed,
    expected_owner_input: expected,
    stream_rulebook_required: changed.length > 0 && !expected,
    status: status_block(bounded.complete ? text : bounded.head),
    current_ask,
  }
}

const parse_args = argv => {
	const result = { repo_root: process.cwd(), notebook_path: undefined, active_host: 'codex' }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (!['--repo', '--notebook', '--host'].includes(flag) || index + 1 >= argv.length) throw new Error('usage: node resume-intake.js [--repo <path>] [--notebook <path>] [--host <codex|claude>]')
    const value = argv[++index]
    if (flag === '--repo') result.repo_root = value
    if (flag === '--notebook') result.notebook_path = value
    if (flag === '--host') result.active_host = value
  }
  if (!['codex', 'claude'].includes(result.active_host)) throw new Error('host must be codex or claude')
  return result
}

const main = argv => {
  process.stdout.write(`${JSON.stringify(collect_intake(parse_args(argv)), null, 2)}\n`)
}

module.exports = { collect_intake, final_ask, expected_owner_input, status_block }

if (require.main === module) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
