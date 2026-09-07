#!/usr/bin/env node
'use strict'

// agf — one shell entry for stream chores; agents may invoke this file directly.
//   agf new   = the `feature: <name>` sequence, minus the two steps a shell cannot
//               judge: the root STATUS pointer line (re-derived by the next
//               main-checkout session from features/*) and relocating a live session.
//   agf cleanup (aliases: clean, merge) = the `cleanup:<taskkey>` sequence, minus the root
//               devlog round — the next main-checkout `godev` round records it.
//   agf finish = two-phase preparation and delivery; the agent writes the closing
//               stream record between phases.
//   agf ditch = abandon a stream: no merge, one Y/n confirmation, then the
//               worktree (unsaved work included), remote branch, and local
//               branch are deleted.
// stdout = the folder to cd into, nothing else, so a shell function can `cd "$(...)"`.
// stderr = every human-facing message.

const { execFileSync, spawn } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { TextDecoder } = require('node:util')
const ag_settings = require('./ag-settings.js')
const install_hook = require('./install-hook.js')
const setup = require('./setup.js')

const MAX_GIT_TIMEOUT_MS = 30_000
const DELIVERY_LOCK_NAME = 'agf-delivery.lock'

const USAGE_COMMANDS = [
	{ label: 'init', syntax: 'agf init', description: 'create Agentflow records, ignore entries, and project hooks in one repeatable action' },
	{ label: 'new', syntax: 'agf new <name> [taskkey] [-m "first ask"]', description: 'open a stream and write its initial notebook; root records stay with the agent' },
	{ label: 'finish', syntax: 'agf finish --prep [taskkey]', description: 'prepare a worktree by pushing its branch and integrating the default branch' },
	{ label: 'finish', syntax: 'agf finish --deliver [taskkey]', description: 'deliver a prepared worktree through the default branch and update the main checkout' },
	{ label: 'cleanup', syntax: 'agf cleanup [taskkey] (aliases: clean, merge)', description: 'close a stream from the main checkout with the existing merge-preserving cleanup' },
	{ label: 'ditch', syntax: 'agf ditch <taskkey>', description: 'abandon one stream after confirmation; no work is merged' },
	{ label: 'uninstall', syntax: 'agf uninstall [--skills]', description: 'preview and remove owned project hooks and shell shortcuts; optionally preserve skill copies as recoverable backups' },
	{ label: 'setup', syntax: 'agf setup [--fix]', description: 'check or install the shell shortcuts used to run Agentflow' },
	{ label: 'hooks', syntax: 'agf hooks [--project|--global] [--host <name>] [--off]', description: 'install or remove verified Stop hooks and the project commit guard' },
	{ label: 'settings', syntax: 'agf settings <show|validate|change|rename|migrate-workspace> [options]', description: 'inspect or change the current project configuration' },
]


const usage_words = (text, width) => {
	const usable_width = Math.max(1, Math.floor(Number(width) || 1))
	const words = String(text).trim().split(/\s+/).filter(Boolean)
	const lines = []
	let line = ''
	for (const word of words) {
		if (!line) {
			line = word
			continue
		}
		if (line.length + 1 + word.length <= usable_width) {
			line += ` ${word}`
			continue
		}
		lines.push(line)
		line = word
	}
	if (line) lines.push(line)
	return lines
}

const render_usage = (width) => {
	const usable_width = Number.isFinite(width) && width > 0 ? Math.max(1, Math.floor(width)) : 80
	const label_width = Math.max(...USAGE_COMMANDS.map((command) => command.label.length))
	const indent = 2
	const description_column = indent + label_width + 2
	const lines = [
		...usage_words('usage:', usable_width),
		...USAGE_COMMANDS.map((command) => `  ${command.syntax}`),
		'',
		...usage_words('commands:', usable_width),
	]

	for (const command of USAGE_COMMANDS) {
		const prefix = `${' '.repeat(indent)}${command.label.padEnd(label_width)}  `
		const beside_width = usable_width - description_column
		if (beside_width >= 10) {
			const wrapped = usage_words(command.description, beside_width)
			lines.push(`${prefix}${wrapped[0]}`)
			for (const continuation of wrapped.slice(1)) lines.push(`${' '.repeat(description_column)}${continuation}`)
		} else {
			lines.push(`${' '.repeat(indent)}${command.label}`)
			const narrow_indent = Math.min(description_column, Math.max(0, usable_width - 1))
			for (const continuation of usage_words(command.description, Math.max(1, usable_width - narrow_indent))) {
				lines.push(`${' '.repeat(narrow_indent)}${continuation}`)
			}
		}
	}

	lines.push('', ...usage_words('The plan runner remains the standalone agf-looper command. Commands that change stream state do not write the configured main notebook — type "godev" there afterwards.', usable_width))
	return `${lines.join('\n')}\n`
}

// ---------- pure ----------

const kebab_case = (name) =>
	String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

const is_key = (key) => /^[a-z0-9][a-z0-9-]*$/.test(String(key))

const next_key = (base, taken) => {
	const used = new Set(taken)
	if (!used.has(base)) return base
	let n = 2
	while (used.has(`${base}-${n}`)) n += 1
	return `${base}-${n}`
}

const parse_new_args = (argv) => {
	const rest = []
	let wish = ''
	for (let i = 0; i < argv.length; i += 1) {
		if (argv[i] === '-m' || argv[i] === '--message') {
			if (argv[i + 1] === undefined) return { error: `${argv[i]} requires a message` }
			wish = argv[i + 1]
			i += 1
			continue
		}
		if (argv[i] === '-h' || argv[i] === '--help') return { help: true }
		if (argv[i].startsWith('-')) return { error: `unknown new option "${argv[i]}"` }
		rest.push(argv[i])
	}
	if (rest.length > 2) return { error: 'new accepts a name and at most one taskkey' }
	return { name: rest[0] || '', key: rest[1] || '', wish }
}

const parse_clean_args = (argv) => {
	if (argv.some((arg) => arg === '-h' || arg === '--help')) return { help: true }
	const unknown = argv.find((arg) => arg.startsWith('-'))
	if (unknown) return { error: `unknown option "${unknown}"` }
	if (argv.length > 1) return { error: 'command accepts at most one taskkey' }
	return { help: false, key: argv[0] || '' }
}

const update_ignore_file = (repo) => {
	const ignore_path = path.join(repo, '.gitignore')
	const current = fs.existsSync(ignore_path) ? fs.readFileSync(ignore_path, 'utf8') : ''
	const lines = current.split(/\r?\n/u).filter(Boolean)
	const next = [...lines]
	for (const entry of ['.claude/', '.codex/', '.worktrees/']) if (!next.includes(entry)) next.push(entry)
	const text = `${next.join('\n')}\n`
	if (text !== current) ag_settings.write_text_atomic(ignore_path, text)
	return ignore_path
}

const init_main = (argv, cwd, log) => {
	const args = parse_clean_args(argv)
	if (args.error || args.key) { log(args.error || 'init accepts no arguments'); return 1 }
	if (args.help) { log(render_usage(80)); return 1 }
	const repo = path.resolve(cwd)
	const host = active_host_for_cli(repo)
	const result = ag_settings.initialize_project({ repo_root: repo, explicit_host: host })
	update_ignore_file(repo)
	install_hook.install({ cwd: repo, quiet: true, say: () => {} })
	const notebook = path.relative(repo, result.notebook_path || path.join(repo, result.config.switches['target-doc'])).split(path.sep).join('/')
	log(`${result.created ? 'initialized' : 'ready'}: ${notebook}`)
	return { dir: repo, notebook }
}

const parse_finish_args = (argv) => {
	const phases = []
	const rest = []
	for (const arg of argv) {
		if (arg === '-h' || arg === '--help') return { help: true }
		if (arg === '--prep' || arg === '--deliver') {
			phases.push(arg.slice(2))
			continue
		}
		if (arg.startsWith('-')) return { error: `unknown finish option "${arg}"` }
		rest.push(arg)
	}
	if (phases.length !== 1) return { error: 'finish requires exactly one of --prep or --deliver' }
	if (rest.length > 1) return { error: 'finish accepts at most one taskkey' }
	const key = rest[0] || ''
	if (key && !is_key(key)) return { error: `taskkey "${key}" must be lowercase a-z0-9 and dashes` }
	return { help: false, phase: phases[0], key }
}

const resolve_key = ({ name, key }) => {
	if (key) {
		if (!is_key(key)) throw new Error(`taskkey "${key}" must be lowercase a-z0-9 and dashes`)
		return key
	}
	const derived = kebab_case(name)
	if (!derived) throw new Error(`"${name}" gives no usable key — pass one: agf new "${name}" <taskkey>`)
	return derived
}

const devlog_template = ({ taskkey, name, project_line, config_path, feature_root = 'features', root_notebook = 'devlog.md', host, date, wish }) => {
	const doc = `${feature_root}/${taskkey}/${taskkey}.devlog.md`
	const ask = wish
		? `# → Ask / A-001\n\n+ ${wish}\n\n---\n\n# → Ask / A-002\n\n+ \n`
		: `# → Ask / A-001\n\n+ \n`
	const status = ag_settings.format_status({
		project: project_line.replace(/^Project:\s*/, ''),
		notebook: doc,
		notebook_kind: 'stream',
		current_commit: 'stream-open only, no code commits yet',
		tests_scenarios: 'none',
		config_path: config_path || `${feature_root}/${taskkey}/ag.json`,
		host: host || 'unknown',
		validation: 'validated',
		proven: 'the stream configuration was copied from the root configuration',
		open: 'none',
		next: 'reply to the first Ask below',
		artifacts: 'none',
		archived_eras: 'none',
		streams: [],
	})
	return `${status}\nBacklink: main notebook \`${root_notebook}\` (main checkout)\n\nFeature: ${taskkey} — active — ${name}\n\nOpened by the \`agf\` shell shortcut on ${date}, not by an agent round. The main-notebook \`stream:\` pointer line was deliberately NOT written — the next main-checkout session re-derives it from \`${feature_root}/*/*devlog.md\`.\n\n---\n\n${ask}`
}

// .../<repo>/.worktrees/<key>[/deeper] → <key>; anything else → ''
const key_from_path = (cwd) => {
	const parts = String(cwd).split(path.sep)
	const at = parts.lastIndexOf('.worktrees')
	return at >= 0 && parts[at + 1] ? parts[at + 1] : ''
}

// `main` when refs/remotes/origin/HEAD points at origin/main; '' when it points nowhere.
const default_from_origin_head = (ref) => {
	const m = /^origin\/(.+)$/.exec(String(ref).trim())
	return m ? m[1] : ''
}

// (Y/n): Enter or y/yes = yes; EOF, a read error (null), or anything else = no.
const is_yes = (answer) => answer !== null && /^\s*(y|yes|)\s*$/i.test(String(answer))

// Keys close enough to be a typo of `key`: shares its first two characters, or it shares theirs.
const near_keys = (key, known) => {
	const head = String(key).slice(0, 2)
	return [...new Set(known)].filter((k) => head && (k.startsWith(head) || String(key).startsWith(k.slice(0, 2)))).sort()
}

// ---------- io ----------

const git_timeout_ms = () => {
	const requested = Number(process.env.AGF_TEST_GIT_TIMEOUT_MS)
	return Number.isFinite(requested) && requested > 0
		? Math.min(MAX_GIT_TIMEOUT_MS, Math.floor(requested))
		: MAX_GIT_TIMEOUT_MS
}

const sanitize_diagnostic = (value) => String(value || '')
	.replace(/\u001b\][\s\S]*?(?:\u0007|\u001b\\|$)/g, '')
	.replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|[ -/]*[@-~])/g, '')
	.replace(/\u001b/g, '')
	.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
	.replace(/\b([a-z][a-z0-9+.-]*:\/\/)([^/\s@]+)@/gi, '$1[redacted]@')
	.trim()

const git_failure_detail = (operation, result, { network = false } = {}) => {
	if (result.timed_out) return `${operation} timed out after ${git_timeout_ms()}ms; the result is unknown`
	if (network) return `${operation} failed`
	return `${operation} failed${result.out ? `: ${sanitize_diagnostic(result.out)}` : ''}`
}

const git = (cwd, args, { preserve_nul = false } = {}) => {
	try {
		return {
			ok: true,
			out: preserve_nul
				? String(execFileSync('git', args, {
					cwd,
					encoding: 'utf8',
					stdio: ['ignore', 'pipe', 'pipe'],
					timeout: git_timeout_ms(),
				})).replace(/\0$/, '')
				: sanitize_diagnostic(execFileSync('git', args, {
				cwd,
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'pipe'],
				timeout: git_timeout_ms(),
			})),
		}
	} catch (err) {
		const timed_out = err.code === 'ETIMEDOUT' || /timed out/i.test(String(err.message || ''))
		return {
			ok: false,
			out: sanitize_diagnostic(`${String(err.stdout || '')}${String(err.stderr || err.message || '')}`),
			timed_out,
			mutation_unknown: timed_out,
		}
	}
}

// A committed notebook is data, not a diagnostic. Keep its successful stdout as
// the original bytes until the closing-record validator has checked it.
const git_blob = (cwd, args) => {
	try {
		return {
			ok: true,
			out: execFileSync('git', args, {
				cwd,
				stdio: ['ignore', 'pipe', 'pipe'],
				timeout: git_timeout_ms(),
			}),
		}
	} catch (err) {
		const timed_out = err.code === 'ETIMEDOUT' || /timed out/i.test(String(err.message || ''))
		return {
			ok: false,
			out: sanitize_diagnostic(`${String(err.stdout || '')}${String(err.stderr || err.message || '')}`),
			timed_out,
			mutation_unknown: timed_out,
		}
	}
}

const dirs = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => !n.startsWith('.')) : [])

const branch_names = (repo) => {
	const r = git(repo, ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes'])
	return r.ok ? r.out.split('\n').filter(Boolean).map((n) => n.replace(/^origin\//, '')).filter((n) => n !== 'HEAD') : []
}

const workspace_features = (repo) => {
	try {
		const config = JSON.parse(fs.readFileSync(path.join(repo, 'ag.json'), 'utf8'))
		return ag_settings.workspace_paths(config).features || 'features'
	} catch {
		return 'features'
	}
}

const main_notebook = (repo) => {
	try {
		const config = JSON.parse(fs.readFileSync(path.join(repo, 'ag.json'), 'utf8'))
		return ag_settings.workspace_paths(config).notebook || 'devlog.md'
	} catch {
		return 'devlog.md'
	}
}

const known_keys = (repo) => [
	...branch_names(repo),
	...dirs(path.join(repo, workspace_features(repo))),
	...dirs(path.join(repo, '.worktrees')),
]

const first_line_starting = (text, prefix) =>
	text.split('\n').find((line) => line.startsWith(prefix)) || ''

const write_all_sync = (descriptor, text, write = fs.writeSync) => {
	const bytes = Buffer.from(String(text), 'utf8')
	let offset = 0
	while (offset < bytes.length) {
		const written = write(descriptor, bytes, offset, bytes.length - offset)
		if (!Number.isInteger(written) || written <= 0) throw new Error('terminal output write did not make progress')
		offset += written
	}
}

const host_from_root_status = (repo) => {
	let notebook = path.join(repo, 'devlog.md')
	try {
		const config = JSON.parse(fs.readFileSync(path.join(repo, 'ag.json'), 'utf8'))
		notebook = path.join(repo, ag_settings.workspace_paths(config).notebook)
	} catch {}
	if (!fs.existsSync(notebook)) return ''
	const text = fs.readFileSync(notebook, 'utf8')
	if (!ag_settings.validate_status_projection(text).valid) return ''
	const match = /^Configuration:\s+[^\r\n]+\s+for\s+(codex|claude)\s+this round\.$/mu.exec(ag_settings.status_region(text).body)
	return match ? match[1] : ''
}

const active_host_for_cli = (repo) => {
	try {
		return ag_settings.detect_host()
	} catch (error) {
		if (!(error instanceof ag_settings.SettingsError) || error.code !== 'AG_HOST_UNKNOWN') throw error
		const recorded_host = host_from_root_status(repo)
		if (recorded_host) return recorded_host
		throw new ag_settings.SettingsError('agf could not identify the project host from the current STATUS; run godev once from Codex or Claude, then retry', { code: 'AG_HOST_UNKNOWN' })
	}
}

// The stream notebook, current name or legacy name; '' when neither exists.
const stream_doc = (repo, key) => {
	const features = workspace_features(repo)
	const candidates = [
		path.join(features, key, `${key}.devlog.md`),
		path.join(features, key, 'devlog.md'),
	]
	return candidates.find((rel) => fs.existsSync(path.join(repo, rel))) || ''
}

const registered_worktrees = (repo) => {
	const result = git(repo, ['worktree', 'list', '--porcelain'])
	if (!result.ok) return []
	return result.out.split('\n')
		.filter((line) => line.startsWith('worktree '))
		.map((line) => line.slice('worktree '.length).trim())
		.filter(Boolean)
}

const real_path = (value) => {
	try { return fs.realpathSync(value) } catch { return path.resolve(value) }
}

const shell_quote = (value) => `'${String(value).replace(/'/g, "'\\''")}'`

const local_branches = (repo) => {
	const result = git(repo, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
	return result.ok ? result.out.split('\n').filter(Boolean) : []
}

const finish_default_branch = (repo, has_remote) => {
	const origin_head = has_remote
		? git(repo, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'])
		: { ok: false, out: '' }
	const from_origin = origin_head.ok
		? default_from_origin_head(origin_head.out.replace(/^refs\/remotes\//, ''))
		: ''
	const branches = local_branches(repo)
	const detected = from_origin || ['main', 'master'].find((branch) => branches.includes(branch)) || ''
	return detected && branches.includes(detected) ? detected : ''
}

const finish_context = (cwd, supplied_key) => {
	const top = git(cwd, ['rev-parse', '--show-toplevel'])
	if (!top.ok) return { error: 'not a git repository — run agf finish inside a stream worktree' }
	const common = git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
	if (!common.ok) return { error: `cannot locate the main checkout:\n${common.out}` }
	const git_common_dir = real_path(common.out)
	const repo = path.dirname(git_common_dir)
	const worktree = real_path(top.out)
	const inferred_key = key_from_path(worktree)
	if (!inferred_key) return { error: 'agf finish runs only inside a .worktrees/<taskkey> stream worktree' }
	if (supplied_key && supplied_key !== inferred_key) {
		return { error: `taskkey "${supplied_key}" does not match the current worktree "${inferred_key}"` }
	}
	const key = supplied_key || inferred_key
	if (!is_key(key)) return { error: `taskkey "${key}" must be lowercase a-z0-9 and dashes` }
	const expected_worktree = real_path(path.join(repo, '.worktrees', key))
	if (worktree !== expected_worktree) {
		return { error: `finish requires the matching registered worktree .worktrees/${key}` }
	}
	if (!registered_worktrees(repo).some((candidate) => real_path(candidate) === worktree)) {
		return { error: `worktree .worktrees/${key} is not registered with Git` }
	}
	const branch = git(worktree, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
	if (!branch.ok || branch.out !== key) {
		return { error: `worktree .worktrees/${key} is not on branch "${key}"` }
	}
	const status = git(worktree, ['status', '--porcelain', '--untracked-files=all'])
	if (!status.ok) return { error: `cannot inspect worktree state:\n${status.out}` }
	if (status.out !== '') return { error: `worktree .worktrees/${key} has unsaved changes — commit or stash them before running agf finish` }
	const remotes = git(repo, ['remote'])
	const has_remote = remotes.ok && remotes.out.split('\n').includes('origin')
	const def = finish_default_branch(repo, has_remote)
	if (!def) return { error: 'cannot tell which branch is the default line of work — keep a local main or master branch and try again' }
	return { repo, git_common_dir, worktree, key, def, has_remote }
}

const merge_and_abort = (context, source, log) => {
	const merged = git(context.worktree, ['merge', '--no-edit', source])
	if (merged.ok) return true
	const aborted = git(context.worktree, ['merge', '--abort'])
	const abort_note = aborted.ok
		? 'the merge was aborted'
		: `the merge abort also failed: ${git_failure_detail('merge abort', aborted)}`
	const merge_note = git_failure_detail(`merging ${source} into "${context.key}"`, merged)
	log(`${merge_note} — ${abort_note}; no default-branch delivery was attempted`)
	return false
}

const main_recovery = (context) =>
	`git -C ${shell_quote(context.repo)} switch ${shell_quote(context.def)} && git -C ${shell_quote(context.repo)} fetch origin && git -C ${shell_quote(context.repo)} merge --ff-only ${shell_quote(`origin/${context.def}`)}`

const local_main_recovery = (context, source = context.key) =>
	`git -C ${shell_quote(context.repo)} switch ${shell_quote(context.def)} && git -C ${shell_quote(context.repo)} merge --ff-only ${shell_quote(source)}`

const tree_paths = (repo, ref) => {
	const result = git(repo, ['ls-tree', '-r', '-z', '--name-only', ref], { preserve_nul: true })
	return result.ok
		? { paths: new Set(result.out.split('\0').filter(Boolean)) }
		: { error: git_failure_detail(`reading ${ref}`, result) }
}

const added_paths = (repo, base, target) => {
	const result = git(repo, ['diff', '--name-only', '-z', '--diff-filter=A', base, target], { preserve_nul: true })
	return result.ok
		? { paths: result.out.split('\0').filter(Boolean) }
		: { error: git_failure_detail(`checking changes from ${base} to ${target}`, result) }
}

const main_checkout_identity = (repo) => {
	const branch = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])
	if (!branch.ok) return { error: git_failure_detail('reading the main checkout branch', branch) }
	const tip = git(repo, ['rev-parse', 'HEAD'])
	if (!tip.ok) return { error: git_failure_detail('reading the main checkout tip', tip) }
	return { branch: branch.out, tip: tip.out }
}

const delivery_lock_path = (context) => path.join(context.git_common_dir, DELIVERY_LOCK_NAME)

const stat_identity = (stat) => ({ dev: stat.dev, ino: stat.ino })

const same_stat_identity = (left, right) =>
	Boolean(left && right && left.dev === right.dev && left.ino === right.ino)

const owner_token_from_lock = (details) => {
	const match = /(?:^|\n)owner-token: ([0-9a-f]{64})(?:\n|$)/.exec(String(details))
	return match ? match[1] : ''
}

const close_delivery_lock_fd = (lock) => {
	if (!lock || lock.fd === null || lock.fd === undefined) return null
	const fd = lock.fd
	lock.fd = null
	try {
		fs.closeSync(fd)
		return null
	} catch (error) {
		return sanitize_diagnostic(error.message)
	}
}

const remove_owned_lock_path = (lock) => {
	if (!lock || !lock.stat) return 'the acquired lock identity was not recorded'
	let current
	try {
		current = fs.lstatSync(lock.path)
	} catch (error) {
		return `could not verify the lock pathname: ${sanitize_diagnostic(error.message)}`
	}
	if (!same_stat_identity(lock.stat, stat_identity(current))) {
		return 'the lock pathname no longer refers to the acquired lock'
	}
	let details
	try {
		details = fs.readFileSync(lock.path, 'utf8')
	} catch (error) {
		return `could not verify the lock owner token: ${sanitize_diagnostic(error.message)}`
	}
	if (owner_token_from_lock(details) !== lock.owner_token) return 'the lock owner token does not match'
	try {
		fs.unlinkSync(lock.path)
		return null
	} catch (error) {
		return sanitize_diagnostic(error.message)
	}
}

const acquire_delivery_lock = (context) => {
	const lock_path = delivery_lock_path(context)
	let owner_token
	try {
		owner_token = randomBytes(32).toString('hex')
	} catch (error) {
		return { error: `delivery could not create an owner token for the lock at ${lock_path}: ${sanitize_diagnostic(error.message)}` }
	}
	let fd
	try {
		fd = fs.openSync(lock_path, 'wx', 0o600)
	} catch (error) {
		if (error.code === 'EEXIST') {
			return {
				error: `delivery refused: another Agentflow delivery owns the lock at ${lock_path}; inspect that file and remove it only after confirming its recorded process has stopped`,
			}
		}
		return { error: `delivery could not create the lock at ${lock_path}: ${sanitize_diagnostic(error.message)}` }
	}

	const details = [
		'Agentflow delivery lock',
		`pid: ${process.pid}`,
		`started: ${new Date().toISOString()}`,
		`owner-token: ${owner_token}`,
		`repository: ${context.repo}`,
		`worktree: ${context.worktree}`,
		`taskkey: ${context.key}`,
		`recovery: inspect this file and remove it only after confirming pid ${process.pid} has stopped`,
		'',
	].join('\n')
	const lock = { path: lock_path, fd, owner_token, stat: null }

	try {
		lock.stat = stat_identity(fs.fstatSync(fd))
		fs.writeSync(fd, details, null, 'utf8')
		fs.fsyncSync(fd)
	} catch (error) {
		const close_error = close_delivery_lock_fd(lock)
		const remove_error = remove_owned_lock_path(lock)
		const cleanup = [close_error ? `closing the lock descriptor also failed: ${close_error}` : '', remove_error ? `the lock was kept: ${remove_error}` : '']
			.filter(Boolean).join('; ')
		return { error: `delivery could not write the lock at ${lock_path}: ${sanitize_diagnostic(error.message)}${cleanup ? `; ${cleanup}` : ''}` }
	}

	return lock
}

const release_delivery_lock = (lock) => {
	const release_error = remove_owned_lock_path(lock)
	const close_error = close_delivery_lock_fd(lock)
	return [release_error ? `lock release refused or failed: ${release_error}` : '', close_error ? `closing the lock descriptor failed: ${close_error}` : '']
		.filter(Boolean).join('; ') || null
}

const local_delivery_collision = (context, target, expected_tip = '') => {
	const base = expected_tip
		? { ok: true, out: expected_tip }
		: git(context.repo, ['rev-parse', 'HEAD'])
	if (!base.ok) return { error: git_failure_detail('reading the main checkout tip', base) }
	const additions = added_paths(context.repo, base.out, target)
	if (additions.error) return additions
	const base_tree = tree_paths(context.repo, base.out)
	if (base_tree.error) return base_tree

	for (const relative of additions.paths) {
		const parts = relative.split('/')
		for (let index = 0; index < parts.length; index += 1) {
			const candidate = parts.slice(0, index + 1).join('/')
			const absolute = path.join(context.repo, ...parts.slice(0, index + 1))
			let stat
			try { stat = fs.lstatSync(absolute) } catch { continue }
			if (index < parts.length - 1 && stat.isDirectory()) continue
			if (base_tree.paths.has(candidate)) continue
			return { path: candidate }
		}
	}

	return null
}

const closing_marker_error = (context, doc) =>
	({ error: `delivery requires exactly one fixed stream-state marker "Feature: ${context.key} — closed" in ${doc}` })

const valid_closing_blob = (blob, key) => {
	if (!Buffer.isBuffer(blob)) return false

	const marker = Buffer.from(`Feature: ${key} — closed`, 'utf8')
	const state_prefix = Buffer.from(`Feature: ${key} — `, 'utf8')
	const lines = []
	let line_start = 0
	let line_ending = ''

	for (let index = 0; index < blob.length; index += 1) {
		const byte = blob[index]
		if (byte === 0x0d) {
			if (blob[index + 1] !== 0x0a) return false
			if (line_ending && line_ending !== 'crlf') return false
			line_ending = 'crlf'
			lines.push(blob.subarray(line_start, index))
			index += 1
			line_start = index + 1
			continue
		}
		if (byte === 0x0a) {
			if (line_ending && line_ending !== 'lf') return false
			line_ending = 'lf'
			lines.push(blob.subarray(line_start, index))
			line_start = index + 1
			continue
		}
		if ((byte < 0x20 && byte !== 0x09) || byte === 0x7f) return false
	}
	lines.push(blob.subarray(line_start))

	let text
	try {
		text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(blob)
	} catch {
		return false
	}
	if (!Buffer.from(text, 'utf8').equals(blob)) return false
	for (const character of text) {
		const code = character.codePointAt(0)
		if ((code <= 0x1f && ![0x09, 0x0a, 0x0d].includes(code)) || code === 0x7f || (code >= 0x80 && code <= 0x9f)) return false
	}

	let marker_count = 0
	for (const line of lines) {
		if (line.equals(marker)) {
			marker_count += 1
			continue
		}
		if (line.length >= state_prefix.length && line.subarray(0, state_prefix.length).equals(state_prefix)) return false
	}
	return marker_count === 1
}

const stream_source_identity = (context) => {
	const branch = git(context.worktree, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
	if (!branch.ok) return { error: git_failure_detail('reading the stream worktree branch', branch) }
	const tip = git(context.worktree, ['rev-parse', 'HEAD'])
	if (!tip.ok) return { error: git_failure_detail('reading the stream worktree tip', tip) }
	return { branch: branch.out, tip: tip.out }
}

const delivery_source_error = (context, record) => {
	const source = stream_source_identity(context)
	if (source.error) return source.error
	if (source.branch !== context.key || source.tip !== record.head) {
		return `the stream worktree changed before default-ref mutation (expected branch "${context.key}" at ${record.head}, found "${source.branch}" at ${source.tip})`
	}
	return ''
}

const closing_record = (context) => {
	const doc = stream_doc(context.worktree, context.key)
	if (!doc) {
		const features = workspace_features(context.worktree)
		return { error: `delivery requires the stream notebook ${features}/${context.key}/${context.key}.devlog.md or ${features}/${context.key}/devlog.md` }
	}
	const head = git(context.worktree, ['rev-parse', 'HEAD'])
	if (!head.ok) return { error: git_failure_detail('reading the stream tip', head) }
	const tree = git(context.worktree, ['ls-tree', '-z', head.out, '--', doc], { preserve_nul: true })
	const entry = tree.ok
		? tree.out.split('\0').filter(Boolean).map((record) => {
			const tab = record.indexOf('\t')
			const [mode, type] = record.slice(0, tab).split(' ')
			return { mode, type, path: record.slice(tab + 1) }
		}).find((record) => record.path === doc)
		: undefined
	if (!tree.ok || !entry || entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)) {
		return { error: `delivery requires the stream notebook ${doc} at HEAD:${doc} to be a regular committed file, not a symlink or other non-regular entry` }
	}
	const blob = git_blob(context.worktree, ['show', `${head.out}:${doc}`])
	if (!blob.ok) return { error: `delivery could not read the committed stream notebook HEAD:${doc}: ${git_failure_detail('reading the closing notebook blob', blob)}` }
	if (!valid_closing_blob(blob.out, context.key)) return closing_marker_error(context, doc)
	if (context.has_remote) {
		const remote = git(context.worktree, ['rev-parse', '--verify', `refs/remotes/origin/${context.key}`])
		if (!remote.ok || remote.out !== head.out) {
			return { error: `delivery requires origin/${context.key} to equal the current stream HEAD` }
		}
	}
	return { doc, head: head.out }
}

// ---------- agf finish ----------

const finish_main = (argv, cwd, log, _ask, width = 80) => {
	const args = parse_finish_args(argv)
	if (args.help) { log(render_usage(width)); return 1 }
	if (args.error) { log(`${args.error}\n\n${render_usage(width)}`); return 1 }
	const context = finish_context(cwd, args.key)
	if (context.error) { log(context.error); return 1 }

	if (args.phase === 'prep') {
		if (context.has_remote) {
			const pushed = git(context.worktree, ['push', 'origin', `HEAD:${context.key}`])
			if (!pushed.ok) {
				log(pushed.timed_out
					? `stream push timed out after ${git_timeout_ms()}ms; the remote stream result is unknown and preparation stopped before default-branch integration`
					: 'stream push failed; preparation stopped before default-branch integration')
				return 1
			}
			log(`pushed stream branch ${context.key} to origin`)
			const fetched = git(context.worktree, ['fetch', 'origin'])
			if (!fetched.ok) {
				log(fetched.timed_out
					? `stream branch ${context.key} was pushed, but origin fetch timed out after ${git_timeout_ms()}ms and its local result is unknown`
					: `stream branch ${context.key} was pushed, but origin fetch failed; preparation stopped`)
				return 1
			}
			if (!merge_and_abort(context, `origin/${context.def}`, log)) return 1
		} else {
			log('no remote configured — the merge is local only')
			if (!merge_and_abort(context, context.def, log)) return 1
		}
		log('phase 1 complete — write the closing round and commit it, then run agf finish --deliver')
		if (context.has_remote) log(`before running agf finish --deliver, push the committed closing record to origin/${context.key}`)
		return 0
	}

	const lock = acquire_delivery_lock(context)
	if (lock.error) { log(lock.error); return 1 }

	const delivery_state = {
		remote_default: context.has_remote ? 'not_attempted' : 'not_configured',
		local_checkout: 'not_attempted',
	}
	const delivery_status = (label, state) => {
		if (state === 'completed') return `${label} completed`
		if (state === 'unknown') return `${label} result is unknown`
		if (state === 'failed') return `${label} did not complete`
		if (state === 'not_configured') return `${label} was not configured`
		return `${label} was not attempted`
	}
	let outcome = 1
	try {
		outcome = (() => {
		const record = closing_record(context)
		if (record.error) { log(record.error); return 1 }
		const expected = main_checkout_identity(context.repo)
		if (expected.error) { log(`delivery stopped — ${expected.error}`); return 1 }

		if (context.has_remote) {
			const source_error = delivery_source_error(context, record)
			if (source_error) {
				log(`delivery stopped before remote default-ref mutation — ${source_error}`)
				return 1
			}
			delivery_state.remote_default = 'unknown'
			const pushed = git(context.worktree, ['push', 'origin', `${record.head}:${context.def}`])
			if (!pushed.ok) {
				delivery_state.remote_default = pushed.timed_out ? 'unknown' : 'failed'
				log(pushed.timed_out
					? `delivery push timed out after ${git_timeout_ms()}ms; the remote default-branch result is unknown and local delivery was not attempted`
					: 'delivery push failed; origin rejected the update. The stream branch is unchanged. If the default branch moved, run agf finish --prep again; if direct pushes are blocked, open a pull request from the stream branch.')
				return 1
			}
			delivery_state.remote_default = 'completed'
			log(`pushed validated stream commit ${record.head} to origin/${context.def}`)
			const fetched = git(context.repo, ['fetch', 'origin'])
			if (!fetched.ok) {
				log(fetched.timed_out
					? `remote default branch was updated, but origin fetch timed out after ${git_timeout_ms()}ms and the main-checkout delivery result is unknown`
					: 'remote default branch was updated but the main checkout was not — origin fetch failed')
				log(`recover with: ${main_recovery(context)}`)
				return 1
			}
			const collision = local_delivery_collision(context, record.head, expected.tip)
			if (collision && collision.error) {
				log(`remote default branch was updated but the main checkout was not — ${collision.error}`)
				log(`recover with: ${main_recovery(context)}`)
				return 1
			}
			if (collision) {
				log(`remote default branch was updated but the main checkout was not — local delivery would replace an untracked or ignored entry at "${sanitize_diagnostic(collision.path)}"`)
				log(`recover with: ${main_recovery(context)}`)
				return 1
			}
			const before_merge = main_checkout_identity(context.repo)
			if (before_merge.error || before_merge.branch !== expected.branch || before_merge.tip !== expected.tip) {
				log(`remote default branch was updated but the main checkout was not — the checkout changed during delivery (expected "${expected.branch}" at ${expected.tip}, found "${before_merge.branch || 'unknown'}" at ${before_merge.tip || 'unknown'})`)
				log(`recover with: ${main_recovery(context)}`)
				return 1
			}
			if (before_merge.branch !== context.def) {
				log(`remote default branch was updated but the main checkout was not — it is on "${before_merge.branch}", not "${context.def}"`)
				log(`recover with: ${main_recovery(context)}`)
				return 1
			}
			const local_source_error = delivery_source_error(context, record)
			if (local_source_error) {
				log(`remote default branch was updated but the main checkout was not — delivery stopped before local default-ref mutation: ${local_source_error}`)
				log(`recover with: ${main_recovery(context)}`)
				return 1
			}
			delivery_state.local_checkout = 'unknown'
			const merged = git(context.repo, ['merge', '--ff-only', record.head])
			if (!merged.ok) {
				delivery_state.local_checkout = merged.timed_out ? 'unknown' : 'failed'
				log(merged.timed_out
					? `remote default branch was updated, but local fast-forward delivery timed out after ${git_timeout_ms()}ms and its result is unknown`
					: `remote default branch was updated but the main checkout was not — fast-forward delivery failed: ${sanitize_diagnostic(merged.out)}`)
				log(`recover with: ${main_recovery(context)}`)
				return 1
			}
			delivery_state.local_checkout = 'completed'
			const after_merge = main_checkout_identity(context.repo)
			if (after_merge.error || after_merge.branch !== context.def || after_merge.tip !== record.head) {
				log(`remote default branch was updated, but post-success checkout verification failed — expected "${context.def}" at ${record.head}, found "${after_merge.branch || 'unknown'}" at ${after_merge.tip || 'unknown'}`)
				log(`recover with: ${main_recovery(context)}`)
				return 1
			}
			log(`delivered origin/${context.def} to the main checkout`)
			return { dir: context.repo }
		}

		log('no remote configured — delivery is local only')
		if (expected.branch !== context.def) {
			log(`the main checkout is on "${expected.branch}", not "${context.def}" — nothing was changed`)
			log(`recover with: ${local_main_recovery(context)}`)
			return 1
		}
		const collision = local_delivery_collision(context, record.head, expected.tip)
		if (collision && collision.error) {
			log(`local delivery stopped — ${collision.error}`)
			log(`recover with: ${local_main_recovery(context, record.head)}`)
			return 1
		}
		if (collision) {
			log(`local delivery stopped — it would replace an untracked or ignored entry at "${sanitize_diagnostic(collision.path)}"`)
			log(`recover with: ${local_main_recovery(context, record.head)}`)
			return 1
		}
		const before_merge = main_checkout_identity(context.repo)
		if (before_merge.error || before_merge.branch !== expected.branch || before_merge.tip !== expected.tip) {
			log(`local delivery stopped — the checkout changed during delivery (expected "${expected.branch}" at ${expected.tip}, found "${before_merge.branch || 'unknown'}" at ${before_merge.tip || 'unknown'})`)
			log(`recover with: ${local_main_recovery(context, record.head)}`)
			return 1
		}
		if (before_merge.branch !== context.def) {
			log(`the main checkout is on "${before_merge.branch}", not "${context.def}" — nothing was changed`)
			log(`recover with: ${local_main_recovery(context, record.head)}`)
			return 1
		}
		const source_error = delivery_source_error(context, record)
		if (source_error) {
			log(`local delivery stopped before default-ref mutation — ${source_error}`)
			log(`recover with: ${local_main_recovery(context, record.head)}`)
			return 1
		}
		delivery_state.local_checkout = 'unknown'
		const merged = git(context.repo, ['merge', '--ff-only', record.head])
		if (!merged.ok) {
			log(merged.timed_out
				? `local fast-forward delivery timed out after ${git_timeout_ms()}ms; the result is unknown`
				: `local delivery failed — the main checkout was not changed: ${sanitize_diagnostic(merged.out)}`)
			delivery_state.local_checkout = merged.timed_out ? 'unknown' : 'failed'
			log(`recover with: ${local_main_recovery(context, record.head)}`)
			return 1
		}
		delivery_state.local_checkout = 'completed'
		const after_merge = main_checkout_identity(context.repo)
		if (after_merge.error || after_merge.branch !== context.def || after_merge.tip !== record.head) {
			log(`local delivery completed, but post-success checkout verification failed — expected "${context.def}" at ${record.head}, found "${after_merge.branch || 'unknown'}" at ${after_merge.tip || 'unknown'}`)
			log(`recover with: ${local_main_recovery(context, record.head)}`)
			return 1
		}
		log(`delivered ${context.key} to the local main checkout`)
		return { dir: context.repo }
		})()
	} finally {
		const release_error = release_delivery_lock(lock)
		if (release_error) {
			const remote_note = context.has_remote
				? delivery_status('remote default-ref delivery', delivery_state.remote_default)
				: 'remote default-ref delivery was not configured'
			const local_note = delivery_status('local main-checkout delivery', delivery_state.local_checkout)
			log(`delivery lock could not be released at ${lock.path}: ${release_error}; Git delivery status: ${remote_note}; ${local_note}; lifecycle cleanup did not complete`)
			outcome = 1
		}
	}
	return outcome
}

// ---------- agf new ----------

const new_main = (argv, cwd, log, ask, width = 80) => {
	const args = parse_new_args(argv)
	if (args.error) { log(`${args.error}\n\n${render_usage(width)}`); return 1 }
	if (args.help || !args.name) { log(render_usage(width)); return 1 }

	const root = git(cwd, ['rev-parse', '--show-toplevel'])
	if (!root.ok) { log('not a git repository — run agf inside your project'); return 1 }
	const repo = root.out

	// A worktree's .git is a file; only the main checkout may add worktrees and own the configured main notebook.
	if (!fs.statSync(path.join(repo, '.git')).isDirectory()) {
		log('this is a worktree, not the main checkout — run agf from the main project folder')
		return 1
	}

	const taskkey = next_key(resolve_key(args), known_keys(repo))
	const wt_rel = path.join('.worktrees', taskkey)
	const wt = path.join(repo, wt_rel)
	let feature_root = 'features'
	let root_notebook = 'devlog.md'

	if (!git(repo, ['check-ignore', '-q', '--no-index', '.worktrees/agentflow-ignore-probe']).ok) {
		log('warning: `.worktrees/` is not in .gitignore — add it, or the new folder shows up as untracked')
	}

	let root_config
	let active_host
	try {
		active_host = active_host_for_cli(repo)
		const configured = ag_settings.ensure_configuration({ repo_root: repo, active_host })
		root_config = configured.config
		feature_root = ag_settings.workspace_paths(root_config).features || 'features'
		root_notebook = ag_settings.workspace_paths(root_config).notebook
	} catch (error) {
		log(`configuration blocked: ${error.message}`)
		return 1
	}

	const added = git(repo, ['worktree', 'add', wt_rel, '-b', taskkey])
	if (!added.ok) { log(`git worktree add failed:\n${added.out}`); return 1 }

	const doc_rel = path.join(feature_root, taskkey, `${taskkey}.devlog.md`)
	const config_rel = path.join(feature_root, taskkey, 'ag.json')
	const root_devlog = fs.existsSync(path.join(repo, root_notebook))
		? fs.readFileSync(path.join(repo, root_notebook), 'utf8')
		: ''
	const date = new Date().toISOString().slice(0, 10)
	const body = devlog_template({
		taskkey,
		name: args.name,
		project_line: first_line_starting(root_devlog, 'Project:') || `Project: ${path.basename(repo)}`,
		config_path: config_rel.split(path.sep).join('/'),
		feature_root: feature_root.split(path.sep).join('/'),
		root_notebook: root_notebook.split(path.sep).join('/'),
		host: active_host,
		date,
		wish: args.wish,
	})
	fs.mkdirSync(path.join(wt, feature_root, taskkey), { recursive: true })
	try {
		const stream_config = ag_settings.copy_for_notebook(root_config, doc_rel, { repo_root: wt, active_host })
		ag_settings.write_config_atomic(path.join(wt, config_rel), stream_config, { repo_root: wt, active_host })
	} catch (error) {
		log(`stream configuration could not be created: ${error.message}`)
		return 1
	}
	fs.writeFileSync(path.join(wt, doc_rel), body)

	for (const step of [['add', doc_rel, config_rel], ['commit', '-m', `devlog: open stream ${taskkey} (agf)`]]) {
		const r = git(wt, step)
		if (!r.ok) { log(`git ${step[0]} failed:\n${r.out}`); return 1 }
	}

	const has_remote = git(repo, ['remote']).out !== ''
	if (has_remote) {
		const pushed = git(wt, ['push', '-u', 'origin', taskkey])
		log(pushed.ok
			? `pushed branch ${taskkey} to origin`
			: pushed.timed_out
				? `stream branch push timed out after ${git_timeout_ms()}ms; remote branch state is unknown and the local branch remains available`
				: 'stream branch push failed; the local branch remains available')
	} else {
		log('no remote configured — nothing pushed')
	}

	log('')
	log(`stream: ${taskkey} open`)
	log(`branch: ${taskkey}`)
	log(`notebook: ${wt_rel}/${doc_rel}`)
	log('')
	log('open new notebook in your editor:')
	log(path.join(wt, doc_rel))
	log('')
	log('root stream pointer not written — the next `godev` in the main project folder adds it')

	const agf_open = process.env.AGF_OPEN
	if (agf_open) {
		try {
			const child = spawn(agf_open, [path.join(wt, doc_rel)], { detached: true, stdio: 'ignore' })
			child.on('error', () => {})
			child.unref()
		} catch (err) {
			log(`warning: AGF_OPEN="${agf_open}" could not open the notebook: ${err.message}`)
		}
	}

	return { dir: wt }
}

// ---------- agf clean ----------

const clean_main = (argv, cwd, log, ask, width = 80) => {
	const args = parse_clean_args(argv)
	if (args.error) { log(`${args.error}\n\n${render_usage(width)}`); return 1 }
	if (args.help) { log(render_usage(width)); return 1 }

	const top = git(cwd, ['rev-parse', '--show-toplevel'])
	if (!top.ok) { log('not a git repository — run agf inside your project'); return 1 }

	// --git-common-dir is the MAIN checkout's .git, from a worktree as well as from the main folder.
	const common = git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
	if (!common.ok) { log(`cannot locate the main checkout:\n${common.out}`); return 1 }
	const repo = path.dirname(common.out)

	const key = args.key || key_from_path(cwd)
	if (!key) { log('no feature name given, and you are not standing in a .worktrees/<name> folder\n\n' + render_usage(width)); return 1 }

	// Guard 1 — the main checkout must sit on the default branch.
	const origin_head = git(repo, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'])
	const known = known_keys(repo)
	const fallback = ['main', 'master'].find((b) => known.includes(b)) || ''
	const def = (origin_head.ok ? default_from_origin_head(origin_head.out.replace('refs/remotes/', '')) : '') || fallback
	if (!def) { log('cannot tell which branch is the main line of work — switch to it and try again'); return 1 }

	const on = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])
	if (!on.ok || on.out !== def) {
		log(`the main project folder is on branch "${on.out}", not "${def}" — nothing was changed`)
		log(`get there with:  cd ${shell_quote(repo)} && git switch ${shell_quote(def)}`)
		return 1
	}

	// Guard 2 — the name must point at exactly one stream.
	if (!known.includes(key)) {
		const near = near_keys(key, known)
		log(`no feature called "${key}" — nothing was changed`)
		log(near.length ? `did you mean: ${near.join(', ')}` : `known names: ${[...new Set(known)].sort().join(', ') || '(none)'}`)
		return 1
	}

	const wt_rel = path.join('.worktrees', key)
	const wt = path.join(repo, wt_rel)

	// Guard 3 — never remove the folder still used by the running host. A shell
	// function can cd after this child exits, but an AI host runs its Stop hook
	// first; deleting cwd prevents the operating system from starting that hook. — I-058.
	if (path.resolve(top.out) === path.resolve(wt)) {
		log(`${wt_rel} is still using this running host as its current folder — nothing was changed`)
		log(`exit this session, then clean up from the main project folder with:  cd ${shell_quote(repo)} && agf cleanup ${shell_quote(key)}`)
		return 1
	}

	// Guard 4 — an unsaved worktree is never swept.
	if (fs.existsSync(wt)) {
		const dirty = git(wt, ['status', '--porcelain'])
		if (dirty.ok && dirty.out !== '') {
			log(`${wt_rel} still has unsaved changes — nothing was changed`)
			log(dirty.out.split('\n').map((l) => `  ${l}`).join('\n'))
			log('save them (or throw them away) in that folder first, then run agf cleanup again')
			return 1
		}
	}

	const has_remote = git(repo, ['remote']).out !== ''

	// Step 1 — level the default branch with the server.
	if (has_remote) {
		const fetched = git(repo, ['fetch', 'origin'])
		if (!fetched.ok) {
			log(fetched.timed_out
				? `main checkout fetch timed out after ${git_timeout_ms()}ms; cleanup stopped before merging or sweeping and the result is unknown`
				: 'main checkout fetch failed; cleanup stopped before merging or sweeping')
			return 1
		}
		const ff = git(repo, ['merge', '--ff-only', `origin/${def}`])
		if (!ff.ok && !/Already up to date|up to date/i.test(ff.out)) {
			log(ff.timed_out
				? `bringing the main folder level with origin timed out after ${git_timeout_ms()}ms; the local result is unknown and cleanup stopped before sweeping`
				: `your main folder could not be brought level with the server — nothing was swept: ${sanitize_diagnostic(ff.out)}`)
			return 1
		}
	}

	// Step 2 — merge the stream in.
	const has_local = git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${key}`]).ok
	const source = has_local ? key : `origin/${key}`
	const merged = git(repo, ['merge', '--no-ff', source, '-m', `merge: ${key} — feature closed (agf cleanup)`])
	if (!merged.ok) {
		const aborted = git(repo, ['merge', '--abort'])
		const abort_note = aborted.ok
			? 'the merge was undone and nothing was deleted'
			: aborted.timed_out
				? `merge abort timed out after ${git_timeout_ms()}ms; merge state is unknown and nothing was swept`
				: `merge abort failed: ${sanitize_diagnostic(aborted.out)}; nothing was swept`
		const merge_note = merged.timed_out
			? `merging "${key}" timed out after ${git_timeout_ms()}ms; the merge result is unknown`
			: `merging "${key}" hit a conflict`
		log(`${merge_note} — ${abort_note}: ${sanitize_diagnostic(merged.out)}`)
		log(`open ${repo} and merge it by hand, or type godev there and ask for cleanup: ${key}`)
		return 1
	}
	log(/Already up to date/i.test(merged.out) ? `"${key}" was already merged — only the sweeping-up runs` : `merged "${key}" into ${def}`)

	// Step 3 — push the merge.
	if (has_remote) {
		const pushed = git(repo, ['push'])
		if (!pushed.ok) {
			log(pushed.timed_out
				? `default-branch push timed out after ${git_timeout_ms()}ms; the remote result is unknown and cleanup stopped before sweeping`
				: 'default-branch push failed; the local merge remains, and cleanup stopped before sweeping')
			return 1
		}
		log(`pushed ${def} to origin`)
	} else {
		log('no remote configured — nothing pushed')
	}

	// Step 4 — sweep, each step refusing rather than destroying.
	if (fs.existsSync(wt)) {
		const removed = git(repo, ['worktree', 'remove', wt_rel])
		log(removed.ok
			? `removed folder ${wt_rel}`
			: removed.timed_out
				? `removing folder ${wt_rel} timed out after ${git_timeout_ms()}ms; folder state is unknown`
				: `folder ${wt_rel} kept — git refused to remove it: ${sanitize_diagnostic(removed.out)}`)
	}
	// Remote first: while origin/<key> still exists, `git branch -d` compares the branch against
	// THAT ref and refuses a branch already merged into HEAD but never pushed to its own upstream —
	// exactly what merge_back leaves behind. With the upstream gone, -d falls back to the HEAD check,
	// which is the safety we actually want and which still refuses genuinely unmerged work.
	if (has_remote && git(repo, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${key}`]).ok) {
		const del = git(repo, ['push', 'origin', '--delete', key])
		log(del.ok
			? `deleted branch ${key} on origin`
			: del.timed_out
				? `deleting branch ${key} on origin timed out after ${git_timeout_ms()}ms; remote state is unknown`
				: `branch ${key} on origin kept — remote deletion failed`)
	}
	if (has_local) {
		const del = git(repo, ['branch', '-d', key])
		log(del.ok
			? `deleted branch ${key}`
			: del.timed_out
				? `deleting branch ${key} timed out after ${git_timeout_ms()}ms; local branch state is unknown`
				: `branch ${key} kept — git refused to delete it: ${sanitize_diagnostic(del.out)}`)
	}

	// Step 5 — the one thing a shell cannot do.
	const doc = stream_doc(repo, key)
	if (doc) log(`the feature notebook stays as the record: ${doc}`)
	log(`main notebook ${main_notebook(repo)} was NOT written — type godev in ${path.basename(repo)} and the next round records this close-out`)
	return { dir: repo }
}

// ---------- agf ditch ----------

// Blocking one-line prompt on stderr (stdout is reserved for the cd path).
// Returns the raw answer, or null on EOF / a closed stdin — which is_yes treats as no.
const ask_tty = (question) => {
	write_all_sync(process.stderr.fd, question)
	try {
		const buf = Buffer.alloc(1024)
		const n = fs.readSync(0, buf, 0, 1024)
		return n === 0 ? null : buf.slice(0, n).toString('utf8')
	} catch { return null }
}

const ditch_main = (argv, cwd, log, ask = ask_tty, width = 80) => {
	const args = parse_clean_args(argv)
	if (args.error) { log(`${args.error}\n\n${render_usage(width)}`); return 1 }
	if (args.help) { log(render_usage(width)); return 1 }

	const top = git(cwd, ['rev-parse', '--show-toplevel'])
	if (!top.ok) { log('not a git repository — run agf inside your project'); return 1 }
	const common = git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
	if (!common.ok) { log(`cannot locate the main checkout:\n${common.out}`); return 1 }
	const repo = path.dirname(common.out)

	// Never inferred from the folder — for a delete, you type exactly what goes.
	const key = args.key
	if (!key) { log('ditch needs the feature name written out — you type what you delete\n\n' + render_usage(width)); return 1 }

	const known = known_keys(repo)
	if (!known.includes(key)) {
		const near = near_keys(key, known)
		log(`no feature called "${key}" — nothing was changed`)
		log(near.length ? `did you mean: ${near.join(', ')}` : `known names: ${[...new Set(known)].sort().join(', ') || '(none)'}`)
		return 1
	}

	// The default branch and the branch under the main checkout's feet are never ditched.
	const origin_head = git(repo, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'])
	const def = (origin_head.ok ? default_from_origin_head(origin_head.out.replace('refs/remotes/', '')) : '')
		|| ['main', 'master'].find((b) => known.includes(b)) || ''
	if (key === def) { log(`"${key}" is the main line of work, not a feature — nothing was changed`); return 1 }
	const on = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])
	if (on.ok && on.out === key) { log(`the main project folder is standing on branch "${key}" — switch it away first; nothing was changed`); return 1 }

	const wt_rel = path.join('.worktrees', key)
	const wt = path.join(repo, wt_rel)
	const has_wt = fs.existsSync(wt)
	const has_local = git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${key}`]).ok
	const has_remote_branch = git(repo, ['remote']).out !== ''
		&& git(repo, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${key}`]).ok
	if (!has_wt && !has_local && !has_remote_branch) { log(`"${key}" has no branch or folder left to delete — nothing to ditch`); return 1 }

	const doomed = [
		has_wt ? `folder ${wt_rel}, including any unsaved work inside it` : '',
		has_remote_branch ? `branch ${key} on origin` : '',
		has_local ? `local branch ${key}` : '',
	].filter(Boolean)
	log(`feature branch "${key}" will be deleted — nothing is merged first, unmerged work is lost:`)
	log(doomed.map((d) => `  - ${d}`).join('\n'))
	if (!is_yes(ask('are you sure? (Y/n) '))) { log('nothing was changed'); return 1 }

	if (has_wt) {
		const removed = git(repo, ['worktree', 'remove', '--force', wt_rel])
		log(removed.ok
			? `removed folder ${wt_rel}`
			: removed.timed_out
				? `removing folder ${wt_rel} timed out after ${git_timeout_ms()}ms; folder state is unknown`
				: `folder ${wt_rel} kept — git refused to remove it: ${sanitize_diagnostic(removed.out)}`)
	}
	if (has_remote_branch) {
		const del = git(repo, ['push', 'origin', '--delete', key])
		log(del.ok
			? `deleted branch ${key} on origin`
			: del.timed_out
				? `deleting branch ${key} on origin timed out after ${git_timeout_ms()}ms; remote state is unknown`
				: `branch ${key} on origin kept — remote deletion failed`)
	}
	if (has_local) {
		const del = git(repo, ['branch', '-D', key])
		log(del.ok
			? `deleted branch ${key}`
			: del.timed_out
				? `deleting branch ${key} timed out after ${git_timeout_ms()}ms; local branch state is unknown`
				: `branch ${key} kept — git refused to delete it: ${sanitize_diagnostic(del.out)}`)
	}

	const doc = stream_doc(repo, key)
	if (doc) log(`the notebook ${doc} is already on ${def || 'the main line'} and stays — remove it by hand if you want it gone`)
	log(`main notebook ${main_notebook(repo)} was NOT written — type godev in ${path.basename(repo)} and the next round records this ditch`)
	return { dir: repo }
}

const uninstall_help = width => `${usage_words('usage: agf uninstall [--skills]', width).join('\n')}\n\n${usage_words('--skills also moves verified formal skill installations to recoverable sibling backup folders.', width).join('\n')}\n`

const uninstall_main = (argv, cwd, log, ask, width = 80) => {
	if (argv.some(argument => argument === '-h' || argument === '--help')) {
		log(uninstall_help(width))
		return 0
	}
	const unknown = argv.find(argument => argument !== '--skills')
	if (unknown) {
		log(`unknown uninstall option "${unknown}"\n\n${uninstall_help(width)}`)
		return 1
	}
	const top = git(cwd, ['rev-parse', '--show-toplevel'])
	if (!top.ok) {
		log('not a git repository — run agf uninstall inside your project')
		return 1
	}
	const repo = top.out
	const hook_preview = install_hook.inspect({ cwd: repo, scope: 'project' })
	return setup.uninstall_main({
		argv,
		shell: process.env.SHELL,
		home: process.env.HOME,
		skill_dir: path.resolve(__dirname, '..'),
		ask,
		say: log,
		extra_preview: hook_preview,
		after_confirm: hook_preview.length === 0 ? undefined : () => {
			try {
				install_hook.install({ cwd: repo, scope: 'project', off: true, quiet: false, say: log })
				return 0
			} catch (error) {
				log(`hook removal failed: ${error.message}`)
				return 1
			}
		},
	})
}

const setup_help = width => `${usage_words('usage: agf setup [--fix]', width).join('\n')}\n\n${usage_words('--fix previews and offers to install or update the managed agf and agf-looper shell shortcuts.', width).join('\n')}\n`

const setup_main = (argv, cwd, log, ask, width = 80) => {
	if (argv.some(argument => argument === '-h' || argument === '--help')) {
		log(setup_help(width))
		return 0
	}
	const unknown = argv.find(argument => argument !== '--fix')
	if (unknown) {
		log(`unknown setup option "${unknown}"\n\n${setup_help(width)}`)
		return 1
	}
	return setup.main({ argv, ask, say: log })
}

const hooks_help = width => `${usage_words('usage: agf hooks [--project|--global] [--host <claude|codex|all>] [--off]', width).join('\n')}\n\n${usage_words('Project scope is the default. --off removes only hooks whose Agentflow ownership can be verified.', width).join('\n')}\n`

const hooks_main = (argv, cwd, log, ask, width = 80) => {
	if (argv.some(argument => argument === '-h' || argument === '--help')) {
		log(hooks_help(width))
		return 0
	}
	if (argv.includes('--project') && argv.includes('--global')) {
		log(`hooks accepts only one scope\n\n${hooks_help(width)}`)
		return 1
	}
	const allowed = new Set(['--project', '--global', '--off'])
	let host = 'all'
	for (let index = 0; index < argv.length; index += 1) {
		if (argv[index] === '--host') {
			host = argv[index + 1]
			index += 1
			continue
		}
		if (!allowed.has(argv[index])) {
			log(`unknown hooks option "${argv[index]}"\n\n${hooks_help(width)}`)
			return 1
		}
	}
	if (!['all', 'claude', 'codex'].includes(host)) {
		log(`unknown --host value "${host}"\n\n${hooks_help(width)}`)
		return 1
	}
	install_hook.install({
		cwd,
		scope: argv.includes('--global') ? 'global' : 'project',
		off: argv.includes('--off'),
		hosts: host === 'all' ? ['claude', 'codex'] : [host],
		say: log,
	})
	return 0
}

const settings_help = width => `${usage_words('usage: agf settings <show|validate|change|rename|migrate-workspace> [options]', width).join('\n')}\n\n${usage_words('Use --set "key: value" with change. Use --from and --to with rename.', width).join('\n')}\n`

const settings_main = (argv, cwd, log, ask, width = 80) => {
	if (argv.length === 0 || argv.some(argument => argument === '-h' || argument === '--help')) {
		log(settings_help(width))
		return 0
	}
	try {
		return ag_settings.cli_main(argv, { cwd, output: log, error: log })
	} catch (error) {
		log(error instanceof ag_settings.SettingsError ? error.message : 'settings command failed')
		return 1
	}
}

// ---------- dispatch ----------

const COMMANDS = { init: init_main, new: new_main, finish: finish_main, cleanup: clean_main, clean: clean_main, merge: clean_main, ditch: ditch_main, uninstall: uninstall_main, setup: setup_main, hooks: hooks_main, settings: settings_main }

const main = (argv, cwd, log, ask, width = 80) => {
	const cmd = COMMANDS[argv[0]]
	if (!cmd) {
		if (argv[0] && argv[0] !== '-h' && argv[0] !== '--help') log(`unknown subcommand "${argv[0]}"\n`)
		log(render_usage(width))
		return 1
	}
	return cmd(argv.slice(1), cwd, log, ask, width)
}

module.exports = {
	kebab_case, is_key, next_key, parse_new_args, parse_clean_args, parse_finish_args, resolve_key,
	render_usage, devlog_template, key_from_path, default_from_origin_head,
	is_yes, near_keys, stream_doc, host_from_root_status, active_host_for_cli, sanitize_diagnostic, git_timeout_ms, delivery_lock_path, write_all_sync, update_ignore_file, init_main, new_main, finish_main, clean_main, ditch_main, uninstall_main, setup_main, hooks_main, settings_main, main,
}

if (require.main === module) {
	try {
		const usage_width = process.stderr.isTTY && Number.isFinite(process.stderr.columns) && process.stderr.columns > 0
			? process.stderr.columns
			: 80
		const r = main(process.argv.slice(2), process.cwd(), (m) => write_all_sync(process.stderr.fd, `${m}\n`), undefined, usage_width)
		if (typeof r === 'number') process.exit(r)
		write_all_sync(process.stdout.fd, `${r.dir}\n`)
	} catch (err) {
		write_all_sync(process.stderr.fd, `${err.message}\n`)
		process.exit(1)
	}
}
