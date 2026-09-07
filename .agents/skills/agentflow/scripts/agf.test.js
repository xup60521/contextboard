'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')

const agf = require('./agf.js')
const ag_settings = require('./ag-settings.js')
const setup = require('./setup.js')
const install_hook = require('./install-hook.js')

test('complete output retries when a write accepts only part of the text', () => {
	const accepted = []
	const write = (_descriptor, bytes, offset, length) => {
		const count = Math.min(7, length)
		accepted.push(bytes.subarray(offset, offset + count))
		return count
	}
	const message = 'root stream pointer not written — the next `godev` in the main project folder adds it\n'

	agf.write_all_sync(2, message, write)

	assert.equal(Buffer.concat(accepted).toString('utf8'), message)
})

// ---------- dispatch ----------

test('main prints usage on a missing or unknown subcommand', () => {
	let logs = []
	assert.equal(agf.main([], '/tmp', (m) => logs.push(m)), 1)
	assert.ok(logs.join('\n').startsWith('usage:'))
	logs = []
	assert.equal(agf.main(['frobnicate'], '/tmp', (m) => logs.push(m)), 1)
	assert.ok(logs.some((l) => l.includes('unknown subcommand "frobnicate"')))
	assert.ok(logs.some((l) => l.startsWith('usage:')))
})

test('main accepts clean as an alias of cleanup', () => {
	const { dir } = make_repo()
	const wt = open_stream(dir, 'login page')
	const r = agf.main(['clean', 'login-page'], dir, () => {})
	assert.equal(r.dir, dir)
	assert.ok(!fs.existsSync(wt))
	drop(dir)
})

test('main accepts merge as a second alias of cleanup', () => {
	const { dir } = make_repo()
	const wt = open_stream(dir, 'login page')
	const r = agf.main(['merge', 'login-page'], dir, () => {})
	assert.equal(r.dir, dir)
	assert.ok(!fs.existsSync(wt))
	drop(dir)
})

test('render_usage wraps descriptions without splitting command labels', () => {
	const rendered = agf.render_usage(40)
	const lines = rendered.split('\n')
	const command_line = lines.findIndex((line) => line.includes('  finish'))

	assert.ok(command_line >= 0)
	assert.ok(lines.some((line) => line.includes('agf finish --prep')))
	assert.ok(lines.some((line) => line.includes('prepare')))
	assert.doesNotMatch(rendered, /agf\s+fi\nsh/)

	const description_start = lines[command_line].indexOf('prepare')
	assert.ok(description_start > 0)
	const continuation = lines[command_line + 1]
	assert.equal(continuation.slice(0, description_start), ' '.repeat(description_start))
	for (const line of lines) {
		if (line && !/^\s+agf /.test(line)) assert.ok(line.length <= 40, `ordinary help prose exceeds width: ${line}`)
	}
	assert.match(rendered, /Commands that change\s+stream state do not write the configured\s+main\s+notebook/)
	assert.match(rendered, /notebook — type "godev"\s+there/)
	assert.ok(rendered.includes('afterwards.'))
})

test('render_usage keeps the usage heading intact at width 5', () => {
	const lines = agf.render_usage(5).split('\n')

	assert.equal(lines.filter((line) => line === 'usage:').length, 1)
})

test('render_usage keeps an overlong description token byte-intact at a narrow width', () => {
	const lines = agf.render_usage(5).split('\n')
	const integrating_lines = lines.filter((line) => line.trim() === 'integrating')

	assert.deepEqual(integrating_lines, ['    integrating'])
})

test('render_usage handles invalid and very narrow widths without looping or duplicating syntax', () => {
	assert.equal(agf.render_usage(0), agf.render_usage(80))
	const narrow = agf.render_usage(1)

	assert.ok(narrow.includes('finish'))
	assert.equal((narrow.match(/agf finish --prep/g) || []).length, 1)
	assert.equal((narrow.match(/agf finish --deliver/g) || []).length, 1)
})

test('help keeps stdout empty and writes the complete usage text to stderr', () => {
	const result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), '--help'], { encoding: 'utf8' })

	assert.equal(result.status, 1)
	assert.equal(result.stdout, '')
	assert.match(result.stderr, /agf finish --prep/)
})

test('uninstall help is focused and keeps stdout empty', () => {
	const result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'uninstall', '--help'], { encoding: 'utf8' })

	assert.equal(result.status, 0)
	assert.equal(result.stdout, '')
	assert.match(result.stderr, /agf uninstall/)
	assert.match(result.stderr, /--skills/)
})

test('setup, hooks, and settings have focused help and looper stays standalone', () => {
	for (const command of ['setup', 'hooks', 'settings']) {
		const result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), command, '--help'], { encoding: 'utf8' })

		assert.equal(result.status, 0, `${command}: ${result.stderr}`)
		assert.equal(result.stdout, '')
		assert.match(result.stderr, new RegExp(`agf ${command}`))
	}
	assert.doesNotMatch(agf.render_usage(80), /agf looper/)
	assert.match(agf.render_usage(80), /standalone agf-looper/is)
})

test('settings forwards show and validation through agf with empty stdout', () => {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-settings-')))
	execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
	const logs = []
	agf.init_main([], dir, () => {})

	assert.equal(agf.main(['settings', 'show'], dir, message => logs.push(message)), 0)
	assert.match(logs.join('\n'), /target-doc:/)
	assert.equal(agf.main(['settings', 'validate'], dir, message => logs.push(message)), 0)
	assert.match(logs.join('\n'), /valid .*ag\.json/)
	drop(dir)
})

test('hooks forwards project host selection and removal through agf', () => {
	const { dir } = make_repo()
	const logs = []

	assert.equal(agf.main(['hooks', '--project', '--host', 'codex'], dir, message => logs.push(message)), 0)
	assert.ok(fs.existsSync(path.join(dir, '.codex', 'hooks.json')))
	assert.equal(agf.main(['hooks', '--project', '--host', 'codex', '--off'], dir, message => logs.push(message)), 0)
	assert.doesNotMatch(fs.readFileSync(path.join(dir, '.codex', 'hooks.json'), 'utf8'), /stop-hook\.js/)
	drop(dir)
})

test('uninstall previews once, preserves a decline, then removes project hooks and shell shortcuts with empty stdout', () => {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-uninstall-')))
	const home = path.join(dir, 'home')
	fs.mkdirSync(home)
	execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
	const cfg = path.join(home, '.zshrc')
	fs.writeFileSync(cfg, setup.lines_to_append('zsh', true, true, path.resolve(__dirname, '..')) + '\n')
	install_hook.install({ cwd: dir, quiet: true, say: () => {} })
	const env = { ...process.env, HOME: home, SHELL: '/bin/zsh' }

	const declined = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'uninstall'], { cwd: dir, env, input: 'n\n', encoding: 'utf8' })
	assert.equal(declined.status, 1)
	assert.equal(declined.stdout, '')
	assert.match(declined.stderr, /uninstall preview/i)
	assert.match(fs.readFileSync(cfg, 'utf8'), /agf\(\)/)

	const accepted = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'uninstall'], { cwd: dir, env, input: 'y\n', encoding: 'utf8' })
	assert.equal(accepted.status, 0, accepted.stderr)
	assert.equal(accepted.stdout, '')
	assert.doesNotMatch(fs.readFileSync(cfg, 'utf8'), /agf\(\)|agf-looper\(\)|AGF_OPEN/)
	assert.equal(fs.existsSync(path.join(dir, '.git', 'hooks', 'pre-commit')), false)
	drop(dir)
})

test('finish help receives the dispatcher terminal width', () => {
	const logs = []
	assert.equal(agf.main(['finish', '--help'], '/tmp', (message) => logs.push(message), undefined, 40), 1)
	assert.equal(logs.join(''), agf.render_usage(40))
})

test('init creates the configured notebook, ignore entries, and project hooks in one repeatable action', () => {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-init-')))
	execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
	const logs = []
	const first = agf.init_main([], dir, message => logs.push(message))
	const first_notebook = fs.readFileSync(path.join(dir, '.agentflow', 'devlog.md'), 'utf8')
	const first_ignore = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8')
	const second = agf.init_main([], dir, message => logs.push(message))

	assert.equal(first.notebook, '.agentflow/devlog.md')
	assert.equal(second.notebook, '.agentflow/devlog.md')
	assert.equal(fs.readFileSync(path.join(dir, '.agentflow', 'devlog.md'), 'utf8'), first_notebook)
	assert.equal(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), first_ignore)
	assert.deepEqual(first_ignore.trim().split('\n'), ['.claude/', '.codex/', '.worktrees/'])
	assert.ok(fs.existsSync(path.join(dir, '.claude', 'settings.json')))
	assert.ok(fs.existsSync(path.join(dir, '.codex', 'hooks.json')))
	assert.match(logs.join('\n'), /\.agentflow\/devlog\.md/)
	drop(dir)
})

// ---------- pure: new ----------

test('kebab_case lowercases and hyphenates, trimming edges', () => {
	assert.equal(agf.kebab_case('Login Page'), 'login-page')
	assert.equal(agf.kebab_case('  Search!! Page  '), 'search-page')
	assert.equal(agf.kebab_case('foo_bar 2'), 'foo-bar-2')
	assert.equal(agf.kebab_case('搜尋頁'), '')
})

test('is_key accepts only lowercase keys', () => {
	assert.ok(agf.is_key('search-page'))
	assert.ok(agf.is_key('a1'))
	assert.ok(!agf.is_key('Search-Page'))
	assert.ok(!agf.is_key('-lead'))
	assert.ok(!agf.is_key('has space'))
})

test('next_key adds the smallest free numeric suffix', () => {
	assert.equal(agf.next_key('login', []), 'login')
	assert.equal(agf.next_key('login', ['login']), 'login-2')
	assert.equal(agf.next_key('login', ['login', 'login-2', 'login-3']), 'login-4')
})

test('parse_new_args splits name, key and -m wish', () => {
	assert.deepEqual(agf.parse_new_args(['搜尋頁', 'search-page']), { name: '搜尋頁', key: 'search-page', wish: '' })
	assert.deepEqual(agf.parse_new_args(['login', '-m', 'build it']), { name: 'login', key: '', wish: 'build it' })
	assert.deepEqual(agf.parse_new_args(['--help']), { help: true })
	assert.match(agf.parse_new_args(['login', '-m']).error, /requires a message/)
	assert.match(agf.parse_new_args(['login', '--force']).error, /unknown new option/)
	assert.match(agf.parse_new_args(['login', 'key', 'extra']).error, /at most one taskkey/)
})

test('resolve_key prefers an explicit key and rejects a bad one', () => {
	assert.equal(agf.resolve_key({ name: '搜尋頁', key: 'search-page' }), 'search-page')
	assert.equal(agf.resolve_key({ name: 'Login Page', key: '' }), 'login-page')
	assert.throws(() => agf.resolve_key({ name: 'x', key: 'Bad Key' }), /must be lowercase/)
	assert.throws(() => agf.resolve_key({ name: '搜尋頁', key: '' }), /no usable key/)
})

test('stream configuration changes only the adjacent target document', () => {
	const root = ag_settings.make_template('codex')
	const out = ag_settings.copy_for_notebook(root, 'features/x/x.devlog.md', { repo_root: '/tmp', active_host: 'codex', executables: ['codex', 'claude'] })
	assert.equal(out.switches['target-doc'], 'features/x/x.devlog.md')
	assert.equal(out.switches['auto-reply'], root.switches['auto-reply'])
	assert.equal(out['external-workers'].find(profile => profile.id === 'codex-default').tiers.best, root['external-workers'].find(profile => profile.id === 'codex-default').tiers.best)
})

const tpl_args = {
	taskkey: 'search-page',
	name: '搜尋頁',
	project_line: 'Project: ag — the skill',
	config_path: 'features/search-page/ag.json',
	host: 'codex',
	date: '2026-08-19',
}

test('devlog_template writes STATUS, backlink and one empty Ask when there is no wish', () => {
	const out = agf.devlog_template({ ...tpl_args, wish: '' })
	assert.ok(out.startsWith('# STATUS\n'))
	assert.ok(out.includes('Project: ag — the skill'))
	assert.ok(out.includes('Feature: search-page — active — 搜尋頁'))
	assert.ok(out.includes('Backlink: main notebook `devlog.md`'))
	assert.ok(out.includes('Configuration: features/search-page/ag.json — schema v7; validated for codex this round.'))
	assert.ok(!out.includes('Settings:'))
	assert.ok(out.includes('# → Ask / A-001'))
	assert.ok(!out.includes('A-002'))
	assert.match(out, /Opened by[^]*\n\n---\n\n# → Ask \/ A-001/)
	assert.equal((out.match(/^---$/gm) || []).length, 1)
})

test('devlog_template puts the wish in A-001 verbatim and leaves A-002 empty', () => {
	const out = agf.devlog_template({ ...tpl_args, wish: 'build the search box' })
	assert.ok(out.includes('# → Ask / A-001\n\n+ build the search box'))
	assert.ok(out.includes('# → Ask / A-002'))
})

test('devlog_template never writes the feature: trigger word into the notebook', () => {
	const out = agf.devlog_template({ ...tpl_args, wish: '' })
	assert.ok(!/^\s*\+?\s*feature:/m.test(out))
})

// ---------- pure: clean ----------

test('parse_clean_args takes the first plain word as the key and spots --help', () => {
	assert.deepEqual(agf.parse_clean_args(['login-page']), { help: false, key: 'login-page' })
	assert.deepEqual(agf.parse_clean_args([]), { help: false, key: '' })
	assert.equal(agf.parse_clean_args(['-h']).help, true)
	assert.equal(agf.parse_clean_args(['--help']).help, true)
	assert.match(agf.parse_clean_args(['login-page', 'extra']).error, /at most one taskkey/)
	assert.match(agf.parse_clean_args(['--force']).error, /unknown option/)
})

test('parse_finish_args requires exactly one phase and at most one valid key', () => {
	assert.deepEqual(agf.parse_finish_args(['--prep']), { help: false, phase: 'prep', key: '' })
	assert.deepEqual(agf.parse_finish_args(['--deliver', 'login-page']), { help: false, phase: 'deliver', key: 'login-page' })
	assert.equal(agf.parse_finish_args(['--help']).help, true)
	assert.match(agf.parse_finish_args([]).error, /exactly one/)
	assert.match(agf.parse_finish_args(['--prep', '--deliver']).error, /exactly one/)
	assert.match(agf.parse_finish_args(['--prep', 'one', 'two']).error, /at most one/)
	assert.match(agf.parse_finish_args(['--prep', 'Bad-Key']).error, /lowercase/)
	assert.match(agf.parse_finish_args(['--prep', '--force']).error, /unknown finish option/)
})

test('key_from_path reads the key out of a .worktrees folder, and nothing else', () => {
	assert.equal(agf.key_from_path('/repo/.worktrees/login-page'), 'login-page')
	assert.equal(agf.key_from_path('/repo/.worktrees/login-page/features/x'), 'login-page')
	assert.equal(agf.key_from_path('/repo'), '')
	assert.equal(agf.key_from_path('/repo/.worktrees'), '')
})

test('default_from_origin_head strips the origin/ prefix', () => {
	assert.equal(agf.default_from_origin_head('origin/main'), 'main')
	assert.equal(agf.default_from_origin_head('origin/trunk\n'), 'trunk')
	assert.equal(agf.default_from_origin_head(''), '')
})

test('near_keys offers the likely typos, not the whole list', () => {
	const known = ['login-page', 'logout', 'search-page', 'main']
	assert.deepEqual(agf.near_keys('login-pag', known), ['login-page', 'logout'])
	assert.deepEqual(agf.near_keys('zzz', known), [])
})

// ---------- end to end, in a throwaway repo ----------

const make_repo = ({ remote = false, prefix = 'agf-' } = {}) => {
	// realpath: on macOS /var is a symlink to /private/var, and git reports the real path
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
	const run = (args, cwd = dir) => execFileSync('git', args, { cwd, encoding: 'utf8' })
	run(['init', '-b', 'main'])
	run(['config', 'user.email', 't@example.com'])
	run(['config', 'user.name', 'T'])
	fs.writeFileSync(path.join(dir, '.gitignore'), '.worktrees/\n')
	fs.writeFileSync(path.join(dir, 'devlog.md'), ag_settings.format_status({
		project: 'demo — a test',
		notebook: 'devlog.md',
		current_commit: 'initial commit',
		tests_scenarios: 'none',
		config_path: 'ag.json',
		host: 'codex',
		validation: 'validated',
		proven: 'none',
		open: 'none',
		next: 'await the owner',
		artifacts: 'none',
		archived_eras: 'none',
	}))
	fs.writeFileSync(path.join(dir, 'ag.json'), `${JSON.stringify(ag_settings.make_template('codex'), null, 2)}\n`)
	run(['add', '-A'])
	run(['commit', '-m', 'init'])

	if (remote) {
		const bare = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-remote-')))
		execFileSync('git', ['init', '--bare', '-b', 'main'], { cwd: bare })
		run(['remote', 'add', 'origin', bare])
		run(['push', '-u', 'origin', 'main'])
		run(['remote', 'set-head', 'origin', 'main'])
		return { dir, run, bare }
	}
	return { dir, run }
}

const open_stream = (dir, name) => agf.main(['new', name], dir, () => {}).dir

test('new places a stream below the configured workspace directory', () => {
	const { dir, run } = make_repo()
	try {
		const config_path = path.join(dir, 'ag.json')
		const config = ag_settings.make_template('codex')
		config.switches['workspace-dir'] = '.agentflow'
		config.switches['target-doc'] = '.agentflow/devlog.md'
		fs.mkdirSync(path.join(dir, '.agentflow'), { recursive: true })
		fs.renameSync(path.join(dir, 'devlog.md'), path.join(dir, '.agentflow/devlog.md'))
		fs.writeFileSync(config_path, `${JSON.stringify(config, null, 2)}\n`)
		run(['add', '-A'])
		run(['commit', '-m', 'configure workspace'])
		const worktree = open_stream(dir, 'Login page')
		assert.ok(fs.existsSync(path.join(worktree, '.agentflow/features/login-page/login-page.devlog.md')))
		assert.ok(fs.existsSync(path.join(worktree, '.agentflow/features/login-page/ag.json')))
		const notebook = fs.readFileSync(path.join(worktree, '.agentflow/features/login-page/login-page.devlog.md'), 'utf8')
		assert.match(notebook, /Backlink: main notebook `\.agentflow\/devlog\.md`/)
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

const commit_stream_file = (run, wt, file, content, message = 'feature work') => {
	const target = path.join(wt, file)
	fs.mkdirSync(path.dirname(target), { recursive: true })
	fs.writeFileSync(target, content)
	run(['add', file], wt)
	run(['commit', '-m', message], wt)
}

const close_stream = (run, wt, key) => {
	const doc = path.join(wt, 'features', key, `${key}.devlog.md`)
	const opened = fs.readFileSync(doc, 'utf8')
	const closed = opened.replace(new RegExp(`^Feature: ${key} — active —.*$`, 'm'), `Feature: ${key} — closed`)
	assert.notEqual(closed, opened)
	fs.writeFileSync(doc, closed)
	run(['add', doc], wt)
	run(['commit', '-m', 'devlog: close stream for test'], wt)
	const pushed = run(['push', 'origin', `HEAD:${key}`], wt)
	run(['fetch', 'origin'], wt)
	return pushed
}

const close_local_stream = (run, wt, key) => {
	const doc = path.join(wt, 'features', key, `${key}.devlog.md`)
	const opened = fs.readFileSync(doc, 'utf8')
	const closed = opened.replace(new RegExp(`^Feature: ${key} — active —.*$`, 'm'), `Feature: ${key} — closed`)
	assert.notEqual(closed, opened)
	fs.writeFileSync(doc, closed)
	run(['add', doc], wt)
	return run(['commit', '-m', 'devlog: close local stream for test'], wt)
}

const commit_notebook_bytes = (run, wt, key, bytes, message = 'test notebook bytes') => {
	const doc = path.join(wt, 'features', key, `${key}.devlog.md`)
	fs.writeFileSync(doc, bytes)
	run(['add', doc], wt)
	run(['commit', '-m', message], wt)
}

const make_unvalidated_tip = (run, wt, key, validated_tip) => {
	fs.writeFileSync(path.join(wt, 'unvalidated-stream-tip.txt'), 'unvalidated stream tip\n')
	run(['add', 'unvalidated-stream-tip.txt'], wt)
	run(['commit', '-m', 'unvalidated stream tip'], wt)
	const unvalidated_tip = run(['rev-parse', 'HEAD'], wt).trim()
	run(['reset', '--hard', validated_tip], wt)
	return unvalidated_tip
}

const drop = (...dirs) => dirs.filter(Boolean).forEach((d) => fs.rmSync(d, { recursive: true, force: true }))

const shell_quote = value => `'${String(value).replace(/'/g, "'\\''")}'`

const make_git_wrapper = (mode) => {
	const bin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-git-wrapper-')))
	const real_git = process.env.PATH.split(path.delimiter)
		.map(directory => path.join(directory, 'git'))
		.find(candidate => fs.existsSync(candidate))
	if (!real_git) throw new Error('could not find the real git executable for the local test wrapper')
	const wrapper = path.join(bin, 'git')
	fs.writeFileSync(wrapper, `#!/usr/bin/env node
const child_process = require('node:child_process')
const fs = require('node:fs')
const real_git = ${JSON.stringify(real_git)}
const args = process.argv.slice(2)
const result = child_process.spawnSync(real_git, args, { cwd: process.cwd(), encoding: 'utf8' })
process.stdout.write(result.stdout || '')
process.stderr.write(result.stderr || '')
const switch_after = process.env.AGF_TEST_SWITCH_AFTER || ''
const move_stream_after = process.env.AGF_TEST_MOVE_STREAM_AFTER || ''
const unvalidated_tip = process.env.AGF_TEST_UNVALIDATED_TIP || ''
const stream_key = process.env.AGF_TEST_STREAM_KEY || ''
const lock_replacement_after = process.env.AGF_TEST_REPLACE_LOCK_AFTER || ''
const lock_path = process.env.AGF_TEST_LOCK_PATH || ''
const is_diff = args[0] === 'diff' && args.includes('--diff-filter=A')
const is_merge = args[0] === 'merge' && args[1] === '--ff-only'
const is_stream_head = args[0] === 'rev-parse' && args[1] === 'HEAD' && process.cwd().includes('/.worktrees/')
if (result.status === 0 && ((switch_after === 'diff' && is_diff) || (switch_after === 'merge' && is_merge))) {
  const switched = child_process.spawnSync(real_git, ['switch', 'side'], { cwd: process.cwd(), encoding: 'utf8' })
  process.stderr.write(switched.stderr || '')
}
if (result.status === 0 && move_stream_after === 'stream-head' && is_stream_head && unvalidated_tip && stream_key) {
  const moved = child_process.spawnSync(real_git, ['update-ref', 'refs/heads/' + stream_key, unvalidated_tip], { cwd: process.cwd(), encoding: 'utf8' })
  process.stderr.write(moved.stderr || '')
}
if (result.status === 0 && lock_replacement_after === 'merge' && is_merge && lock_path) {
  try { fs.unlinkSync(lock_path) } catch {}
  fs.writeFileSync(lock_path, 'replacement owner\\n', { mode: 0o600 })
}
process.exit(result.status === null ? 1 : result.status)
`, { mode: 0o755 })
	return { bin, real_git }
}

// ----- agf new -----

test('new opens branch, worktree, notebook and commit in a real repo', () => {
	const { dir, run } = make_repo()
	const logs = []
	const r = agf.main(['new', '搜尋頁', 'search-page'], dir, (m) => logs.push(m))

	assert.equal(r.dir, path.join(dir, '.worktrees', 'search-page'))
	const doc = path.join(r.dir, 'features', 'search-page', 'search-page.devlog.md')
	const stream_config = JSON.parse(fs.readFileSync(path.join(r.dir, 'features', 'search-page', 'ag.json'), 'utf8'))
	assert.ok(fs.existsSync(doc))
	assert.ok(fs.readFileSync(doc, 'utf8').includes('Project: demo — a test'))
	assert.equal(stream_config.switches['target-doc'], 'features/search-page/search-page.devlog.md')
	assert.equal(stream_config.switches['auto-reply'], 'on')
	assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'ag.json'), 'utf8')).switches['target-doc'], 'devlog.md')
	assert.ok(run(['branch', '--list', 'search-page']).includes('search-page'))
	assert.equal(run(['status', '--porcelain'], r.dir).trim(), '')
	assert.ok(logs.some((l) => l.includes('no remote configured')))
	assert.deepEqual(logs.slice(-9), [
		'',
		'stream: search-page open',
		'branch: search-page',
		'notebook: .worktrees/search-page/features/search-page/search-page.devlog.md',
		'',
		'open new notebook in your editor:',
		path.join(r.dir, 'features', 'search-page', 'search-page.devlog.md'),
		'',
		'root stream pointer not written — the next `godev` in the main project folder adds it',
	])
	drop(dir)
})

test('public new command works from an ordinary shell without host session markers', () => {
	const { dir } = make_repo()
	const env = { ...process.env }
	for (const markers of Object.values(ag_settings.host_markers)) for (const marker of markers) delete env[marker]

	const result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'new', 'shell test'], {
		cwd: dir,
		env,
		encoding: 'utf8',
	})

	assert.equal(result.status, 0, result.stderr)
	assert.equal(result.stdout.trim(), path.join(dir, '.worktrees', 'shell-test'))
	assert.doesNotMatch(result.stderr, /\.worktrees\/.*not in \.gitignore/)
	drop(dir)
})

test('new leaves the root notebook untouched', () => {
	const { dir } = make_repo()
	const before = fs.readFileSync(path.join(dir, 'devlog.md'), 'utf8')
	agf.main(['new', 'login page'], dir, () => {})
	assert.equal(fs.readFileSync(path.join(dir, 'devlog.md'), 'utf8'), before)
	drop(dir)
})

test('new suffixes the key when the branch already exists', () => {
	const { dir } = make_repo()
	agf.main(['new', 'login page'], dir, () => {})
	const r = agf.main(['new', 'login page'], dir, () => {})
	assert.equal(path.basename(r.dir), 'login-page-2')
	drop(dir)
})

test('two parallel streams get independent adjacent configurations', () => {
	const { dir } = make_repo()
	try {
		const first = agf.main(['new', 'search-page'], dir, () => {}).dir
		const second = agf.main(['new', 'billing-page'], dir, () => {}).dir
		const first_config_path = path.join(first, 'features/search-page/ag.json')
		const second_config_path = path.join(second, 'features/billing-page/ag.json')
		const root_config_path = path.join(dir, 'ag.json')
		ag_settings.change_configuration(first_config_path, ['auto-reply: off'], { repo_root: first, active_host: 'codex', executables: ['codex', 'claude'] })
		assert.equal(JSON.parse(fs.readFileSync(first_config_path, 'utf8')).switches['auto-reply'], 'off')
		assert.equal(JSON.parse(fs.readFileSync(second_config_path, 'utf8')).switches['auto-reply'], 'on')
		assert.equal(JSON.parse(fs.readFileSync(root_config_path, 'utf8')).switches['auto-reply'], 'on')
	} finally {
		drop(dir)
	}
})

test('new refuses outside a git repository', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agf-bare-'))
	const logs = []
	assert.equal(agf.main(['new', 'x'], dir, (m) => logs.push(m)), 1)
	assert.ok(logs.some((l) => l.includes('not a git repository')))
	drop(dir)
})

test('new opens the notebook with AGF_OPEN when set', async () => {
	const { dir } = make_repo()
	const marker_dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-marker-')))
	const marker = path.join(marker_dir, 'opened')
	const script = path.join(marker_dir, 'opener.sh')
	fs.writeFileSync(script, `#!/bin/sh\necho "$1" > "${marker}"\n`, { mode: 0o755 })
	process.env.AGF_OPEN = script
	try {
		const r = agf.main(['new', 'test-open'], dir, () => {})
		assert.ok(r.dir)
		for (let attempt = 0; attempt < 40 && !fs.existsSync(marker); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50))
		assert.ok(fs.existsSync(marker), 'AGF_OPEN command was executed')
		const opened = fs.readFileSync(marker, 'utf8').trim()
		assert.ok(opened.includes('test-open.devlog.md'), `notebook path passed to AGF_OPEN: ${opened}`)
	} finally {
		delete process.env.AGF_OPEN
		drop(dir, marker_dir)
	}
})

test('new succeeds even when AGF_OPEN command does not exist', () => {
	const { dir } = make_repo()
	process.env.AGF_OPEN = '/nonexistent/agf-open-command'
	try {
		const r = agf.main(['new', 'test-fail'], dir, () => {})
		assert.ok(r.dir)
	} finally {
		delete process.env.AGF_OPEN
		drop(dir)
	}
})

test('new prints the notebook path on its own line for clickability', () => {
	const { dir } = make_repo()
	const logs = []
	agf.main(['new', 'click-test'], dir, (m) => logs.push(m))
	const doc_path = path.join(dir, '.worktrees', 'click-test', 'features', 'click-test', 'click-test.devlog.md')
	assert.ok(logs.includes(doc_path), `expected standalone path line, got: ${logs.join(' | ')}`)
	drop(dir)
})

test('new refuses when run from inside a worktree', () => {
	const { dir } = make_repo()
	const r = agf.main(['new', 'first'], dir, () => {})
	const logs = []
	assert.equal(agf.main(['new', 'second'], r.dir, (m) => logs.push(m)), 1)
	assert.ok(logs.some((l) => l.includes('worktree, not the main checkout')))
	drop(dir)
})

test('new prints usage and stops when no name is given', () => {
	const { dir } = make_repo()
	const logs = []
	assert.equal(agf.main(['new'], dir, (m) => logs.push(m)), 1)
	assert.ok(logs[0].startsWith('usage:'))
	drop(dir)
})

// ----- agf finish -----

test('finish remote preparation integrates the default branch without moving it, then delivers the closing commit', () => {
	const { dir, run } = make_repo({ remote: true })
	const wt = open_stream(dir, 'login page')
	commit_stream_file(run, wt, 'feature.txt', 'feature\n')
	commit_stream_file(run, dir, 'main.txt', 'main\n', 'main work')
	run(['push', 'origin', 'main'])
	const remote_default_before = run(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0]
	const prep_logs = []

	assert.equal(agf.main(['finish', '--prep', 'login-page'], wt, (m) => prep_logs.push(m)), 0)
	assert.equal(run(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0], remote_default_before)
	assert.ok(run(['branch', '--show-current'], wt).trim() === 'login-page')
	assert.ok(prep_logs.some((line) => line === 'phase 1 complete — write the closing round and commit it, then run agf finish --deliver'))
	assert.ok(prep_logs.some((line) => line === 'before running agf finish --deliver, push the committed closing record to origin/login-page'))
	assert.ok(prep_logs.some((line) => line.includes('pushed stream branch login-page to origin')))
	assert.equal(run(['status', '--porcelain'], wt).trim(), '')

	close_stream(run, wt, 'login-page')
	const deliver_logs = []
	const delivered = agf.main(['finish', '--deliver'], wt, (m) => deliver_logs.push(m))
	assert.equal(delivered.dir, dir)
	assert.equal(run(['rev-parse', 'HEAD']).trim(), run(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0])
	assert.ok(run(['log', '--format=%s', '-3']).includes('devlog: close stream for test'))
	assert.ok(deliver_logs.some((line) => line.includes('delivered origin/main to the main checkout')))
	drop(dir)
})

test('finish local-only preparation and delivery never need a remote', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	commit_stream_file(run, wt, 'feature.txt', 'feature\n')
	commit_stream_file(run, dir, 'main.txt', 'main\n', 'main work')
	const prep_logs = []

	assert.equal(agf.main(['finish', '--prep'], wt, (m) => prep_logs.push(m)), 0)
	assert.ok(prep_logs.some((line) => line.includes('no remote configured — the merge is local only')))
	assert.ok(prep_logs.some((line) => line === 'phase 1 complete — write the closing round and commit it, then run agf finish --deliver'))
	assert.equal(run(['rev-parse', '--abbrev-ref', 'HEAD']).trim(), 'main')
	assert.ok(run(['log', '--format=%s', '-3'], wt).includes('main work'))

	const local_doc = path.join(wt, 'features/login-page/login-page.devlog.md')
	fs.writeFileSync(local_doc, fs.readFileSync(local_doc, 'utf8').replace(/^Feature: login-page — active —.*$/m, 'Feature: login-page — closed'))
	run(['add', 'features/login-page/login-page.devlog.md'], wt)
	run(['commit', '-m', 'devlog: close local stream'], wt)
	const delivered = agf.main(['finish', '--deliver'], wt, () => {})
	assert.equal(delivered.dir, dir)
	assert.equal(run(['rev-parse', 'HEAD']), run(['rev-parse', 'login-page']))
	assert.ok(!fs.existsSync(agf.delivery_lock_path({ git_common_dir: path.join(dir, '.git') })))
	drop(dir)
})

test('finish preparation never invokes the editor when Git auto-edit is enabled', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	commit_stream_file(run, wt, 'feature.txt', 'feature\n')
	commit_stream_file(run, dir, 'main.txt', 'main\n', 'main work')
	const marker_dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-editor-marker-')))
	const marker = path.join(marker_dir, 'editor-ran')
	const editor = path.join(marker_dir, 'marker-editor.sh')
	fs.writeFileSync(editor, `#!/bin/sh\nprintf invoked > ${JSON.stringify(marker)}\nexit 1\n`, { mode: 0o755 })
	const previous_editor = process.env.GIT_EDITOR
	const previous_auto_edit = process.env.GIT_MERGE_AUTOEDIT
	process.env.GIT_EDITOR = editor
	process.env.GIT_MERGE_AUTOEDIT = 'yes'
	try {
		const logs = []
		assert.equal(agf.main(['finish', '--prep'], wt, (message) => logs.push(message)), 0)
		assert.ok(logs.some((line) => line === 'phase 1 complete — write the closing round and commit it, then run agf finish --deliver'))
	} finally {
		if (previous_editor === undefined) delete process.env.GIT_EDITOR
		else process.env.GIT_EDITOR = previous_editor
		if (previous_auto_edit === undefined) delete process.env.GIT_MERGE_AUTOEDIT
		else process.env.GIT_MERGE_AUTOEDIT = previous_auto_edit
	}
	assert.equal(fs.existsSync(marker), false, 'the merge editor was not invoked')
	drop(dir, marker_dir)
})

test('finish local delivery rechecks branch and tip after collision work and leaves an unrelated branch unmoved', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	commit_stream_file(run, wt, 'feature.txt', 'feature\n')
	close_local_stream(run, wt, 'login-page')
	run(['branch', 'side'])
	const side_before = run(['rev-parse', 'side']).trim()
	const main_before = run(['rev-parse', 'main']).trim()
	const wrapper = make_git_wrapper('diff')
	const previous_path = process.env.PATH
	const previous_switch = process.env.AGF_TEST_SWITCH_AFTER
	const logs = []

	process.env.PATH = `${wrapper.bin}${path.delimiter}${previous_path}`
	process.env.AGF_TEST_SWITCH_AFTER = 'diff'
	try {
		assert.equal(agf.main(['finish', '--deliver'], wt, (message) => logs.push(message)), 1)
	} finally {
		process.env.PATH = previous_path
		if (previous_switch === undefined) delete process.env.AGF_TEST_SWITCH_AFTER
		else process.env.AGF_TEST_SWITCH_AFTER = previous_switch
	}

	assert.ok(logs.some(line => line.includes('checkout changed during delivery')))
	assert.equal(execFileSync(wrapper.real_git, ['rev-parse', 'main'], { cwd: dir, encoding: 'utf8' }).trim(), main_before)
	assert.equal(execFileSync(wrapper.real_git, ['rev-parse', 'side'], { cwd: dir, encoding: 'utf8' }).trim(), side_before)
	assert.equal(execFileSync(wrapper.real_git, ['branch', '--show-current'], { cwd: dir, encoding: 'utf8' }).trim(), 'side')
	drop(dir, wrapper.bin)
})

test('finish local delivery verifies branch and tip after a successful merge before returning stdout', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	commit_stream_file(run, wt, 'feature.txt', 'feature\n')
	close_local_stream(run, wt, 'login-page')
	run(['branch', 'side'])
	const side_before = run(['rev-parse', 'side']).trim()
	const wrapper = make_git_wrapper('merge')
	const previous_path = process.env.PATH
	const previous_switch = process.env.AGF_TEST_SWITCH_AFTER
	const logs = []

	process.env.PATH = `${wrapper.bin}${path.delimiter}${previous_path}`
	process.env.AGF_TEST_SWITCH_AFTER = 'merge'
	let result
	try {
		result = agf.main(['finish', '--deliver'], wt, (message) => logs.push(message))
	} finally {
		process.env.PATH = previous_path
		if (previous_switch === undefined) delete process.env.AGF_TEST_SWITCH_AFTER
		else process.env.AGF_TEST_SWITCH_AFTER = previous_switch
	}

	assert.equal(result, 1)
	assert.ok(logs.some(line => line.includes('post-success checkout verification failed')))
	assert.equal(execFileSync(wrapper.real_git, ['branch', '--show-current'], { cwd: dir, encoding: 'utf8' }).trim(), 'side')
	assert.equal(execFileSync(wrapper.real_git, ['rev-parse', 'side'], { cwd: dir, encoding: 'utf8' }).trim(), side_before)
	assert.ok(!fs.existsSync(agf.delivery_lock_path({ git_common_dir: path.join(dir, '.git') })))
	drop(dir, wrapper.bin)
})

test('finish accepts a subdirectory of the matching registered worktree', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	const subdir = path.join(wt, 'src', 'nested')
	fs.mkdirSync(subdir, { recursive: true })
	const logs = []

	assert.equal(agf.main(['finish', '--prep'], subdir, (m) => logs.push(m)), 0)
	assert.ok(logs.some((line) => line.includes('phase 1 complete')))
	assert.equal(run(['branch', '--show-current'], wt).trim(), 'login-page')
	drop(dir)
})

test('finish rejects the main checkout, mismatched worktree key, and dirty worktree before mutation', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	const before = run(['rev-parse', 'HEAD'])
	const main_logs = []
	assert.equal(agf.main(['finish', '--prep', 'login-page'], dir, (m) => main_logs.push(m)), 1)
	assert.ok(main_logs.some((line) => line.includes('only inside a .worktrees')))
	assert.equal(run(['rev-parse', 'HEAD']), before)

	const mismatch_logs = []
	assert.equal(agf.main(['finish', '--prep', 'other-page'], wt, (m) => mismatch_logs.push(m)), 1)
	assert.ok(mismatch_logs.some((line) => line.includes('does not match the current worktree')))
	assert.equal(run(['rev-parse', 'HEAD']), before)

	fs.writeFileSync(path.join(wt, 'untracked.txt'), 'not committed\n')
	const dirty_logs = []
	assert.equal(agf.main(['finish', '--deliver'], wt, (m) => dirty_logs.push(m)), 1)
	assert.ok(dirty_logs.some((line) => line.includes('has unsaved changes')))
	assert.equal(run(['rev-parse', 'HEAD']), before)
	assert.ok(fs.existsSync(path.join(wt, 'untracked.txt')))
	drop(dir)
})

test('finish rejects extra and ambiguous forms before inspecting a repository', () => {
	for (const argv of [
		['finish', '--prep', 'one', 'two'],
		['finish', '--prep', '--deliver'],
		['finish', '--force'],
		['finish'],
	]) {
		const logs = []
		assert.equal(agf.main(argv, '/tmp', (m) => logs.push(m)), 1)
		assert.ok(logs.length > 0)
		assert.equal(logs.join('\n').includes('not a git repository'), false)
	}
})

test('finish delivery stops after a rejected default-branch push and leaves stdout to the executable boundary', () => {
	const { dir, run, bare } = make_repo({ remote: true })
	const wt = open_stream(dir, 'login page')
	commit_stream_file(run, wt, 'feature.txt', 'feature\n')
	close_stream(run, wt, 'login-page')
	const main_before = run(['rev-parse', 'main'])

	const hook = path.join(bare, 'hooks', 'pre-receive')
	fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 })
	const logs = []
	assert.equal(agf.main(['finish', '--deliver'], wt, (m) => logs.push(m)), 1)
	assert.ok(logs.some((line) => line.includes('delivery push failed; origin rejected the update')))
	assert.ok(logs.some((line) => line.includes('open a pull request from the stream branch')))
	assert.equal(run(['rev-parse', 'main']), main_before)
	drop(dir, bare)
})

test('finish process channels keep preparation stdout empty and successful delivery stdout to the main directory', () => {
	const { dir, run } = make_repo({ remote: true })
	const wt = open_stream(dir, 'login page')
	commit_stream_file(run, wt, 'feature.txt', 'feature\n')
	const script = path.join(__dirname, 'agf.js')

	const prep = spawnSync(process.execPath, [script, 'finish', '--prep'], { cwd: wt, encoding: 'utf8' })
	assert.equal(prep.status, 0)
	assert.equal(prep.stdout, '')
	assert.match(prep.stderr, /phase 1 complete/)

	close_stream(run, wt, 'login-page')
	const deliver = spawnSync(process.execPath, [script, 'finish', '--deliver'], { cwd: wt, encoding: 'utf8' })
	assert.equal(deliver.status, 0)
	assert.equal(deliver.stdout, `${dir}\n`)
	assert.doesNotMatch(deliver.stderr, new RegExp(`${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`))
	drop(dir)
})

test('finish remote delivery updates origin before refusing a mismatched main checkout branch', () => {
	const { dir, run } = make_repo({ remote: true })
	const wt = open_stream(dir, 'login page')
	commit_stream_file(run, wt, 'feature.txt', 'feature\n')
	close_stream(run, wt, 'login-page')
	run(['switch', '-c', 'side'])
	const side_before = run(['rev-parse', 'HEAD'])
	const stream_tip = run(['rev-parse', 'login-page'], wt).trim()
	const logs = []

	assert.equal(agf.main(['finish', '--deliver'], wt, (m) => logs.push(m)), 1)
	assert.equal(run(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0], stream_tip)
	assert.equal(run(['rev-parse', 'HEAD']), side_before)
	assert.equal(run(['branch', '--show-current']).trim(), 'side')
	assert.ok(logs.some((line) => line.includes('remote default branch was updated but the main checkout was not')))
	assert.ok(logs.some((line) => line.includes('recover with:')))
	drop(dir)
})

test('finish remote delivery refuses a stream tip movement before the default-ref push', () => {
	const { dir, run, bare } = make_repo({ remote: true })
	const wt = open_stream(dir, 'login page')
	commit_stream_file(run, wt, 'feature.txt', 'feature\n')
	assert.equal(agf.main(['finish', '--prep'], wt, () => {}), 0)
	close_stream(run, wt, 'login-page')
	const validated_tip = run(['rev-parse', 'HEAD'], wt).trim()
	const unvalidated_tip = make_unvalidated_tip(run, wt, 'login-page', validated_tip)
	const remote_main_before = run(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0]
	const wrapper = make_git_wrapper('stream-head')
	const result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'finish', '--deliver'], {
		cwd: wt,
		encoding: 'utf8',
		env: {
			...process.env,
			PATH: `${wrapper.bin}${path.delimiter}${process.env.PATH}`,
			AGF_TEST_MOVE_STREAM_AFTER: 'stream-head',
			AGF_TEST_UNVALIDATED_TIP: unvalidated_tip,
			AGF_TEST_STREAM_KEY: 'login-page',
		},
	})

	assert.equal(result.status, 1)
	assert.equal(result.stdout, '')
	assert.match(result.stderr, /stream worktree changed before default-ref/)
	assert.equal(run(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0], remote_main_before)
	assert.notEqual(remote_main_before, unvalidated_tip)
	drop(dir, bare, wrapper.bin)
})

test('finish local delivery refuses a stream tip movement before the default-ref merge', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	commit_stream_file(run, wt, 'feature.txt', 'feature\n')
	assert.equal(agf.main(['finish', '--prep'], wt, () => {}), 0)
	close_local_stream(run, wt, 'login-page')
	const validated_tip = run(['rev-parse', 'HEAD'], wt).trim()
	const unvalidated_tip = make_unvalidated_tip(run, wt, 'login-page', validated_tip)
	const main_before = run(['rev-parse', 'main'])
	const wrapper = make_git_wrapper('stream-head')
	const result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'finish', '--deliver'], {
		cwd: wt,
		encoding: 'utf8',
		env: {
			...process.env,
			PATH: `${wrapper.bin}${path.delimiter}${process.env.PATH}`,
			AGF_TEST_MOVE_STREAM_AFTER: 'stream-head',
			AGF_TEST_UNVALIDATED_TIP: unvalidated_tip,
			AGF_TEST_STREAM_KEY: 'login-page',
		},
	})

	assert.equal(result.status, 1)
	assert.equal(result.stdout, '')
	assert.match(result.stderr, /stream worktree changed before default-ref mutation/)
	assert.equal(run(['rev-parse', 'main']), main_before)
	assert.notEqual(main_before, unvalidated_tip)
	drop(dir, wrapper.bin)
})

test('finish preparation aborts remote and local conflicts without moving the default branch', () => {
	const remote_case = make_repo({ remote: true })
	const remote_wt = open_stream(remote_case.dir, 'login page')
	commit_stream_file(remote_case.run, remote_wt, 'shared.txt', 'stream\n')
	commit_stream_file(remote_case.run, remote_case.dir, 'shared.txt', 'main\n', 'main conflict')
	remote_case.run(['push', 'origin', 'main'])
	const remote_main_before = remote_case.run(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0]
	const remote_logs = []

	assert.equal(agf.main(['finish', '--prep'], remote_wt, (m) => remote_logs.push(m)), 1)
	assert.ok(remote_logs.some((line) => line.includes('merging origin/main into "login-page" failed')))
	assert.ok(remote_logs.some((line) => line.includes('the merge was aborted')))
	assert.equal(remote_case.run(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0], remote_main_before)
	assert.equal(remote_case.run(['status', '--porcelain'], remote_wt).trim(), '')
	assert.notEqual(spawnSync('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: remote_wt }).status, 0)
	assert.equal(fs.readFileSync(path.join(remote_wt, 'shared.txt'), 'utf8'), 'stream\n')
	drop(remote_case.dir)

	const local_case = make_repo()
	const local_wt = open_stream(local_case.dir, 'login page')
	commit_stream_file(local_case.run, local_wt, 'shared.txt', 'stream\n')
	commit_stream_file(local_case.run, local_case.dir, 'shared.txt', 'main\n', 'main conflict')
	const local_main_before = local_case.run(['rev-parse', 'main'])
	const local_logs = []

	assert.equal(agf.main(['finish', '--prep'], local_wt, (m) => local_logs.push(m)), 1)
	assert.ok(local_logs.some((line) => line.includes('merging main into "login-page" failed')))
	assert.ok(local_logs.some((line) => line.includes('the merge was aborted')))
	assert.equal(local_case.run(['rev-parse', 'main']), local_main_before)
	assert.equal(local_case.run(['status', '--porcelain'], local_wt).trim(), '')
	assert.notEqual(spawnSync('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: local_wt }).status, 0)
	assert.equal(fs.readFileSync(path.join(local_wt, 'shared.txt'), 'utf8'), 'stream\n')
	drop(local_case.dir)
})

test('finish refuses staged, unstaged, and untracked work for both phases without committing it', () => {
	for (const kind of ['staged', 'unstaged', 'untracked']) {
		const { dir, run } = make_repo()
		const wt = open_stream(dir, 'login page')
		const file = path.join(wt, `${kind}.txt`)
		fs.writeFileSync(file, `${kind}\n`)
		if (kind === 'staged') run(['add', path.basename(file)], wt)
		const stream_before = run(['rev-parse', 'HEAD'], wt)
		const main_before = run(['rev-parse', 'main'])

		for (const phase of ['--prep', '--deliver']) {
			const logs = []
			assert.equal(agf.main(['finish', phase], wt, (m) => logs.push(m)), 1)
			assert.ok(logs.some((line) => line.includes('has unsaved changes')))
			assert.equal(run(['rev-parse', 'HEAD'], wt), stream_before)
			assert.equal(run(['rev-parse', 'main']), main_before)
		}

		assert.ok(fs.existsSync(file))
		drop(dir)
	}
})

test('finish preparation and delivery are repeatable no-ops after their first success', () => {
	const { dir, run } = make_repo({ remote: true })
	const wt = open_stream(dir, 'login page')
	commit_stream_file(run, wt, 'feature.txt', 'feature\n')
	const remote_main_before = run(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0]

	assert.equal(agf.main(['finish', '--prep'], wt, () => {}), 0)
	const prepared_tip = run(['rev-parse', 'HEAD'], wt)
	assert.equal(agf.main(['finish', '--prep'], wt, () => {}), 0)
	assert.equal(run(['rev-parse', 'HEAD'], wt), prepared_tip)
	assert.equal(run(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0], remote_main_before)

	close_stream(run, wt, 'login-page')
	assert.equal(agf.main(['finish', '--deliver'], wt, () => {}).dir, dir)
	const delivered_tip = run(['rev-parse', 'HEAD'])
	const remote_main_after = run(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0]
	assert.equal(agf.main(['finish', '--deliver'], wt, () => {}).dir, dir)
	assert.equal(run(['rev-parse', 'HEAD']), delivered_tip)
	assert.equal(run(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0], remote_main_after)
	drop(dir)
})

test('finish delivery requires a fixed tracked closing marker before moving the default branch', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	commit_stream_file(run, wt, 'feature.txt', 'feature\n')
	const main_before = run(['rev-parse', 'main'])
	const logs = []

	assert.equal(agf.main(['finish', '--deliver'], wt, (message) => logs.push(message)), 1)
	assert.ok(logs.some((line) => line.includes('fixed stream-state marker')))
	assert.equal(run(['rev-parse', 'main']), main_before)
	drop(dir)
})

test('finish delivery validates original committed notebook bytes and rejects normalized marker forms', () => {
	const key = 'login-page'
	const marker = `Feature: ${key} — closed`
	const variants = [
		['embedded carriage return', (valid) => Buffer.from(valid.replace(marker, `Feature: ${key} — cl\rosed`))],
		['NUL', (valid) => Buffer.from(valid.replace(marker, `Feature: ${key} — cl\u0000osed`))],
		['escape', (valid) => Buffer.from(valid.replace(marker, `Feature: ${key} — cl${String.fromCharCode(27)}osed`))],
		['invalid UTF-8', (valid) => {
			const source = Buffer.from(valid)
			const needle = Buffer.from('closed')
			const position = source.indexOf(needle)
			assert.notEqual(position, -1)
			return Buffer.concat([source.subarray(0, position), Buffer.from([0xc3, 0x28]), source.subarray(position + needle.length)])
		}],
		['duplicate marker', (valid) => Buffer.from(`${valid}${marker}\n`)],
		['lone carriage return normalized marker', (valid) => Buffer.from(valid.replace(`${marker}\n`, `${marker}\r`))],
		['mixed line endings', (valid) => Buffer.from(valid.replace('\n', '\r\n'))],
	]

	for (const [label, make_bytes] of variants) {
		const { dir, run } = make_repo()
		const wt = open_stream(dir, 'login page')
		const doc = path.join(wt, 'features', key, `${key}.devlog.md`)
		const opened = fs.readFileSync(doc, 'utf8')
		const valid = opened.replace(new RegExp(`^Feature: ${key} — active —.*$`, 'm'), marker)
		assert.notEqual(valid, opened)
		commit_notebook_bytes(run, wt, key, make_bytes(valid), `reject ${label}`)
		const main_before = run(['rev-parse', 'main'])
		const logs = []

		assert.equal(agf.main(['finish', '--deliver'], wt, (message) => logs.push(message)), 1, label)
		assert.ok(logs.some((line) => line.includes('fixed stream-state marker')), label)
		assert.equal(run(['rev-parse', 'main']), main_before, label)
		assert.ok(!fs.existsSync(agf.delivery_lock_path({ git_common_dir: path.join(dir, '.git') })), label)
		drop(dir)
	}
})

test('finish delivery accepts consistently formed CRLF committed notebook bytes', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	const doc = path.join(wt, 'features/login-page/login-page.devlog.md')
	const opened = fs.readFileSync(doc, 'utf8')
	const closed = opened.replace(/^Feature: login-page — active —.*$/m, 'Feature: login-page — closed').replace(/\n/g, '\r\n')
	commit_notebook_bytes(run, wt, 'login-page', Buffer.from(closed), 'CRLF closing notebook')

	assert.equal(agf.main(['finish', '--deliver'], wt, () => {}).dir, dir)
	assert.equal(run(['rev-parse', 'main']), run(['rev-parse', 'HEAD'], wt))
	assert.ok(!fs.existsSync(agf.delivery_lock_path({ git_common_dir: path.join(dir, '.git') })))
	drop(dir)
})

test('finish delivery refuses a pre-existing Agentflow delivery lock without mutation', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	const lock = agf.delivery_lock_path({ git_common_dir: path.join(dir, '.git') })
	const owner_record = 'pid: 12345\nrepository: recovery-test\n'
	fs.writeFileSync(lock, owner_record, { mode: 0o600 })
	const main_before = run(['rev-parse', 'main'])
	const logs = []

	assert.equal(agf.main(['finish', '--deliver'], wt, (message) => logs.push(message)), 1)
	assert.ok(logs.some(line => line.includes(lock)))
	assert.equal(run(['rev-parse', 'main']), main_before)
	assert.equal(fs.readFileSync(lock, 'utf8'), owner_record)
	drop(dir)
})

test('finish delivery preserves a replacement lock and emits no directory stdout', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	commit_stream_file(run, wt, 'feature.txt', 'feature\n')
	assert.equal(agf.main(['finish', '--prep'], wt, () => {}), 0)
	close_local_stream(run, wt, 'login-page')
	const validated_tip = run(['rev-parse', 'HEAD'], wt).trim()
	const lock = agf.delivery_lock_path({ git_common_dir: path.join(dir, '.git') })
	const replacement = 'replacement owner\n'
	const wrapper = make_git_wrapper('merge')
	const result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'finish', '--deliver'], {
		cwd: wt,
		encoding: 'utf8',
		env: {
			...process.env,
			PATH: `${wrapper.bin}${path.delimiter}${process.env.PATH}`,
			AGF_TEST_REPLACE_LOCK_AFTER: 'merge',
			AGF_TEST_LOCK_PATH: lock,
		},
	})

	assert.equal(result.status, 1)
	assert.equal(result.stdout, '')
	assert.match(result.stderr, /lock pathname no longer refers to the acquired lock/)
	assert.match(result.stderr, /lifecycle cleanup did not complete/)
	assert.equal(fs.readFileSync(lock, 'utf8'), replacement)
	assert.equal(run(['rev-parse', 'main']).trim(), validated_tip)
	drop(dir, wrapper.bin)
})

test('finish delivery reports truthful partial state when lock unlink fails after Git delivery', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	commit_stream_file(run, wt, 'feature.txt', 'feature\n')
	assert.equal(agf.main(['finish', '--prep'], wt, () => {}), 0)
	close_local_stream(run, wt, 'login-page')
	const delivered_tip = run(['rev-parse', 'HEAD'], wt).trim()
	const lock = agf.delivery_lock_path({ git_common_dir: path.join(dir, '.git') })
	const child = [
		"const fs = require('node:fs')",
		`const lock = ${JSON.stringify(lock)}`,
		"const unlink = fs.unlinkSync",
		"fs.unlinkSync = (target) => target === lock ? (() => { throw new Error('forced lock release failure') })() : unlink(target)",
		`const agf = require(${JSON.stringify(path.join(__dirname, 'agf.js'))})`,
		"const result = agf.main(['finish', '--deliver'], process.cwd(), (message) => process.stderr.write(message + '\\n'))",
		"if (typeof result === 'number') process.exitCode = result; else process.stdout.write(result.dir + '\\n')",
	].join('\n')
	const result = spawnSync(process.execPath, ['-e', child], { cwd: wt, encoding: 'utf8' })

	assert.equal(result.status, 1)
	assert.equal(result.stdout, '')
	assert.match(result.stderr, /Git delivery status: remote default-ref delivery was not configured; local main-checkout delivery completed/)
	assert.match(result.stderr, /lifecycle cleanup did not complete/)
	assert.equal(run(['rev-parse', 'main']).trim(), delivered_tip)
	assert.ok(fs.existsSync(lock), 'failed release leaves the owned lock for recovery')
	drop(dir)
})

test('finish delivery rejects a closing commit that was not pushed to origin', () => {
	const { dir, run, bare } = make_repo({ remote: true })
	const wt = open_stream(dir, 'login page')
	commit_stream_file(run, wt, 'feature.txt', 'feature\n')
	assert.equal(agf.main(['finish', '--prep'], wt, () => {}), 0)
	close_local_stream(run, wt, 'login-page')
	const main_before = run(['rev-parse', 'main'])
	const logs = []

	assert.equal(agf.main(['finish', '--deliver'], wt, (message) => logs.push(message)), 1)
	assert.ok(logs.some((line) => line.includes('origin/login-page to equal the current stream HEAD')))
	assert.equal(run(['rev-parse', 'main']), main_before)
	drop(dir, bare)
})

test('finish delivery refuses ignored, untracked-ancestor, and no-op cache collisions', () => {
	const ignored_case = make_repo()
	const ignored_wt = open_stream(ignored_case.dir, 'login page')
	commit_stream_file(ignored_case.run, ignored_wt, 'private.txt', 'feature data\n')
	fs.appendFileSync(path.join(ignored_case.dir, '.gitignore'), 'private.txt\n')
	ignored_case.run(['add', '.gitignore'])
	ignored_case.run(['commit', '-m', 'ignore local file'])
	assert.equal(agf.main(['finish', '--prep'], ignored_wt, () => {}), 0)
	close_local_stream(ignored_case.run, ignored_wt, 'login-page')
	fs.writeFileSync(path.join(ignored_case.dir, 'private.txt'), 'local secret\n')
	const ignored_before = ignored_case.run(['rev-parse', 'main'])
	const ignored_logs = []
	assert.equal(agf.main(['finish', '--deliver'], ignored_wt, (message) => ignored_logs.push(message)), 1)
	assert.ok(ignored_logs.some((line) => line.includes('untracked or ignored entry at "private.txt"')))
	assert.equal(ignored_case.run(['rev-parse', 'main']), ignored_before)
	assert.equal(fs.readFileSync(path.join(ignored_case.dir, 'private.txt'), 'utf8'), 'local secret\n')
	assert.ok(fs.existsSync(ignored_wt))
	drop(ignored_case.dir)

	const ancestor_case = make_repo()
	const ancestor_wt = open_stream(ancestor_case.dir, 'login page')
	commit_stream_file(ancestor_case.run, ancestor_wt, 'nested/value.txt', 'feature data\n')
	assert.equal(agf.main(['finish', '--prep'], ancestor_wt, () => {}), 0)
	close_local_stream(ancestor_case.run, ancestor_wt, 'login-page')
	fs.writeFileSync(path.join(ancestor_case.dir, 'nested'), 'local file ancestor\n')
	const ancestor_logs = []
	assert.equal(agf.main(['finish', '--deliver'], ancestor_wt, (message) => ancestor_logs.push(message)), 1)
	assert.ok(ancestor_logs.some((line) => line.includes('untracked or ignored entry at "nested"')))
	assert.equal(fs.readFileSync(path.join(ancestor_case.dir, 'nested'), 'utf8'), 'local file ancestor\n')
	assert.ok(fs.existsSync(ancestor_wt))
	drop(ancestor_case.dir)

	const cache_case = make_repo()
	const cache_wt = open_stream(cache_case.dir, 'login page')
	commit_stream_file(cache_case.run, cache_wt, 'safe.txt', 'feature data\n')
	fs.appendFileSync(path.join(cache_case.dir, '.gitignore'), 'node_modules/\n')
	cache_case.run(['add', '.gitignore'])
	cache_case.run(['commit', '-m', 'ignore dependency cache'])
	assert.equal(agf.main(['finish', '--prep'], cache_wt, () => {}), 0)
	close_local_stream(cache_case.run, cache_wt, 'login-page')
	fs.mkdirSync(path.join(cache_case.dir, 'node_modules', 'cache'), { recursive: true })
	fs.writeFileSync(path.join(cache_case.dir, 'node_modules', 'cache', 'state'), 'cache\n')
	assert.equal(agf.main(['finish', '--deliver'], cache_wt, () => {}).dir, cache_case.dir)
	assert.ok(fs.existsSync(path.join(cache_case.dir, 'safe.txt')))
	drop(cache_case.dir)
})

test('finish remote delivery reports a partial result when the main checkout has an ignored collision', () => {
	const { dir, run, bare } = make_repo({ remote: true })
	const wt = open_stream(dir, 'login page')
	commit_stream_file(run, wt, 'private.txt', 'feature data\n')
	fs.appendFileSync(path.join(dir, '.gitignore'), 'private.txt\n')
	run(['add', '.gitignore'])
	run(['commit', '-m', 'ignore local file'])
	run(['push', 'origin', 'main'])
	assert.equal(agf.main(['finish', '--prep'], wt, () => {}), 0)
	close_stream(run, wt, 'login-page')
	fs.writeFileSync(path.join(dir, 'private.txt'), 'local secret\n')
	const main_before = run(['rev-parse', 'main'])
	const stream_tip = run(['rev-parse', 'HEAD'], wt).trim()
	const logs = []

	assert.equal(agf.main(['finish', '--deliver'], wt, (message) => logs.push(message)), 1)
	assert.equal(run(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0], stream_tip)
	assert.equal(run(['rev-parse', 'main']), main_before)
	assert.ok(fs.existsSync(wt))
	assert.ok(logs.some((line) => line.includes('remote default branch was updated but the main checkout was not')))
	assert.ok(logs.some((line) => line.includes('untracked or ignored entry at "private.txt"')))
	drop(dir, bare)
})

test('finish recovery commands quote metacharacter-bearing default refs', () => {
	const { dir, run, bare } = make_repo({ remote: true })
	const weird = 'main;echo$PWNED' + String.fromCharCode(96) + 'id' + String.fromCharCode(96) + "'q"
	run(['branch', '-m', weird])
	run(['push', 'origin', 'HEAD:' + weird])
	run(['remote', 'set-head', 'origin', weird])
	const wt = open_stream(dir, 'login page')
	commit_stream_file(run, wt, 'feature.txt', 'feature\n')
	close_stream(run, wt, 'login-page')
	run(['switch', '-c', 'side'])
	const logs = []

	assert.equal(agf.main(['finish', '--deliver'], wt, (message) => logs.push(message)), 1)
	assert.ok(logs.some((line) => line.includes("switch 'main;echo$PWNED")))
	assert.ok(logs.some((line) => line.includes("merge --ff-only 'origin/main;echo$PWNED")))
	assert.ok(logs.some((line) => line.includes("'\\''q'")))
	drop(dir, bare)
})

test('cleanup recovery commands quote a spaced repository and metacharacter-bearing default ref', () => {
	const { dir, run, bare } = make_repo({ remote: true, prefix: 'agf recovery ' })
	const weird = 'main;echo$PWNED' + String.fromCharCode(96) + 'id' + String.fromCharCode(96) + "'q"
	run(['branch', '-m', weird])
	run(['push', 'origin', 'HEAD:' + weird])
	run(['remote', 'set-head', 'origin', weird])
	open_stream(dir, 'login page')
	run(['switch', '-c', 'side'])
	const logs = []

	assert.equal(agf.main(['cleanup', 'login-page'], dir, (message) => logs.push(message)), 1)
	const recovery = logs.find(line => line.includes('get there with:'))
	assert.ok(recovery)
	assert.ok(recovery.includes(`cd ${shell_quote(dir)} && git switch ${shell_quote(weird)}`), recovery)
	assert.ok(run(['branch', '--list', 'login-page']).includes('login-page'), 'nothing was deleted')
	drop(dir, bare)
})

test('finish delivery rejects a tracked notebook symlink before moving the default branch', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	const target_dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-symlink-target-')))
	const target = path.join(target_dir, 'closed-marker.md')
	const doc = path.join(wt, 'features/login-page/login-page.devlog.md')
	fs.writeFileSync(target, 'Feature: login-page — closed\n')
	fs.unlinkSync(doc)
	fs.symlinkSync(target, doc)
	run(['add', doc], wt)
	run(['commit', '-m', 'test tracked notebook symlink'], wt)
	const main_before = run(['rev-parse', 'main'])
	const logs = []

	assert.equal(agf.main(['finish', '--deliver'], wt, (message) => logs.push(message)), 1)
	assert.ok(logs.some(line => line.includes('regular committed file')))
	assert.equal(run(['rev-parse', 'main']), main_before)
	assert.ok(fs.lstatSync(doc).isSymbolicLink())
	drop(dir, target_dir)
})

test('Git diagnostics remove terminal data and URL userinfo', () => {
	const esc = String.fromCharCode(27)
	const bell = String.fromCharCode(7)
	const raw = esc + '[31mremote ' + esc + ']0;title' + bell + 'https://user:secret@example.test/repo' + esc + '[0m'
	assert.equal(agf.sanitize_diagnostic(raw), 'remote https://[redacted]@example.test/repo')
})

test('CLI diagnostics remove carriage-return overwrite text while preserving line feeds', () => {
	const raw = 'trusted status\rOVERWRITE\nnext line'
	const sanitized = agf.sanitize_diagnostic(raw)

	assert.equal(sanitized, 'trusted statusOVERWRITE\nnext line')
	assert.doesNotMatch(sanitized, /\r/)
})

test('network Git failures use fixed diagnostics without child stderr', () => {
	const { dir, run, bare } = make_repo({ remote: true })
	const wt = open_stream(dir, 'login page')
	commit_stream_file(run, wt, 'feature.txt', 'feature\n')
	const hook = path.join(bare, 'hooks', 'pre-receive')
	fs.writeFileSync(hook, '#!/bin/sh\nprintf \"\\\\033[31mhttps://user:secret@example.test/repo\\\\033]0;title\\\\007\\\\n\" >&2\nexit 1\n', { mode: 0o755 })
	const logs = []

	assert.equal(agf.main(['finish', '--prep'], wt, (message) => logs.push(message)), 1)
	const text = logs.join('\n')
	assert.match(text, /stream push failed/)
	assert.doesNotMatch(text, /secret|example\.test|\u001b/)
	drop(dir, bare)
})

test('Git timeout override can lower the deadline but cannot raise the thirty-second cap', () => {
	const previous = process.env.AGF_TEST_GIT_TIMEOUT_MS
	try {
		process.env.AGF_TEST_GIT_TIMEOUT_MS = '999999'
		assert.equal(agf.git_timeout_ms(), 30000)
		process.env.AGF_TEST_GIT_TIMEOUT_MS = '7'
		assert.equal(agf.git_timeout_ms(), 7)
	} finally {
		if (previous === undefined) delete process.env.AGF_TEST_GIT_TIMEOUT_MS
		else process.env.AGF_TEST_GIT_TIMEOUT_MS = previous
	}
})

test('Git timeout reports an unknown push result without claiming no mutation', () => {
	const { dir, run, bare } = make_repo({ remote: true })
	const wt = open_stream(dir, 'login page')
	commit_stream_file(run, wt, 'feature.txt', 'feature\n')
	const hook = path.join(bare, 'hooks', 'pre-receive')
	fs.writeFileSync(hook, '#!/bin/sh\nsleep 1\nexit 0\n', { mode: 0o755 })
	const previous = process.env.AGF_TEST_GIT_TIMEOUT_MS
	const logs = []
	try {
		process.env.AGF_TEST_GIT_TIMEOUT_MS = '50'
		assert.equal(agf.main(['finish', '--prep'], wt, (message) => logs.push(message)), 1)
	} finally {
		if (previous === undefined) delete process.env.AGF_TEST_GIT_TIMEOUT_MS
		else process.env.AGF_TEST_GIT_TIMEOUT_MS = previous
	}
	const text = logs.join('\n')
	assert.match(text, /timed out/)
	assert.match(text, /result is unknown/)
	assert.doesNotMatch(text, /default branch was not changed|stream branch is unchanged/)
	drop(dir, bare)
})

// ----- agf clean -----

test('cleanup merges the stream, removes the folder and deletes the branch', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	fs.writeFileSync(path.join(wt, 'app.txt'), 'the feature\n')
	run(['add', '-A'], wt)
	run(['commit', '-m', 'feature work'], wt)

	const logs = []
	const r = agf.main(['cleanup', 'login-page'], dir, (m) => logs.push(m))

	assert.equal(r.dir, dir)
	assert.ok(fs.existsSync(path.join(dir, 'app.txt')), 'the feature landed on main')
	assert.ok(!fs.existsSync(wt), 'the worktree folder is gone')
	assert.equal(run(['branch', '--list', 'login-page']).trim(), '')
	assert.ok(logs.some((l) => l.includes('merged "login-page" into main')))
	assert.ok(logs.some((l) => l.includes('main notebook devlog.md was NOT written')))
	drop(dir)
})

test('cleanup keeps the feature notebook as the record', () => {
	const { dir } = make_repo()
	open_stream(dir, 'login page')
	const logs = []
	agf.main(['cleanup', 'login-page'], dir, (m) => logs.push(m))
	assert.ok(fs.existsSync(path.join(dir, 'features', 'login-page', 'login-page.devlog.md')))
	assert.ok(logs.some((l) => l.includes('features/login-page/login-page.devlog.md')))
	drop(dir)
})

test('cleanup preserves the worktree used by the running host and redirects cleanup to main', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	const main_before = run(['rev-parse', 'main'])
	const logs = []

	assert.equal(agf.main(['cleanup'], wt, (message) => logs.push(message)), 1)
	assert.ok(fs.existsSync(wt))
	assert.ok(run(['branch', '--list', 'login-page']).includes('login-page'))
	assert.equal(run(['rev-parse', 'main']), main_before)
	assert.ok(logs.some((line) => line.includes('still using')))
	assert.ok(logs.some((line) => line.includes(`cd ${shell_quote(dir)} && agf cleanup ${shell_quote('login-page')}`)))
	drop(dir)
})

test('cleanup refuses when the main folder is on another branch', () => {
	const { dir, run } = make_repo()
	open_stream(dir, 'login page')
	run(['switch', '-c', 'side'])
	const logs = []
	assert.equal(agf.main(['cleanup', 'login-page'], dir, (m) => logs.push(m)), 1)
	assert.ok(logs.some((l) => l.includes('on branch "side", not "main"')))
	assert.ok(logs.some((l) => l.includes("git switch 'main'")))
	assert.ok(run(['branch', '--list', 'login-page']).includes('login-page'), 'nothing was deleted')
	drop(dir)
})

test('cleanup refuses an unknown name and shows the closest ones', () => {
	const { dir } = make_repo()
	open_stream(dir, 'login page')
	const logs = []
	assert.equal(agf.main(['cleanup', 'login-pag'], dir, (m) => logs.push(m)), 1)
	assert.ok(logs.some((l) => l.includes('no feature called "login-pag"')))
	assert.ok(logs.some((l) => l.includes('did you mean: login-page')))
	drop(dir)
})

test('cleanup refuses to sweep a worktree with unsaved work in it', () => {
	const { dir } = make_repo()
	const wt = open_stream(dir, 'login page')
	fs.writeFileSync(path.join(wt, 'half-done.txt'), 'not saved yet\n')
	const logs = []
	assert.equal(agf.main(['cleanup', 'login-page'], dir, (m) => logs.push(m)), 1)
	assert.ok(logs.some((l) => l.includes('still has unsaved changes')))
	assert.ok(fs.existsSync(wt), 'the folder is untouched')
	drop(dir)
})

test('cleanup undoes the merge and deletes nothing when the branch conflicts', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	fs.writeFileSync(path.join(wt, 'shared.txt'), 'the feature version\n')
	run(['add', '-A'], wt)
	run(['commit', '-m', 'feature side'], wt)
	fs.writeFileSync(path.join(dir, 'shared.txt'), 'the main version\n')
	run(['add', '-A'])
	run(['commit', '-m', 'main side'])

	const logs = []
	assert.equal(agf.main(['cleanup', 'login-page'], dir, (m) => logs.push(m)), 1)
	assert.ok(logs.some((l) => l.includes('hit a conflict')))
	assert.equal(run(['status', '--porcelain']).trim(), '', 'the merge was undone')
	assert.ok(fs.existsSync(wt), 'nothing was deleted')
	assert.ok(run(['branch', '--list', 'login-page']).includes('login-page'))
	drop(dir)
})

test('cleanup runs only the sweeping-up on an already merged stream', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	run(['merge', '--no-ff', 'login-page', '-m', 'merged by hand'])
	const logs = []
	agf.main(['cleanup', 'login-page'], dir, (m) => logs.push(m))
	assert.ok(logs.some((l) => l.includes('was already merged')))
	assert.ok(!fs.existsSync(wt))
	assert.equal(run(['branch', '--list', 'login-page']).trim(), '')
	drop(dir)
})

test('cleanup pushes the merge and deletes the branch on the server', () => {
	const { dir, run, bare } = make_repo({ remote: true })
	open_stream(dir, 'login page')
	const logs = []
	agf.main(['cleanup', 'login-page'], dir, (m) => logs.push(m))
	assert.ok(logs.some((l) => l.includes('pushed main to origin')))
	assert.ok(logs.some((l) => l.includes('deleted branch login-page on origin')))
	assert.equal(execFileSync('git', ['branch', '--list', 'login-page'], { cwd: bare, encoding: 'utf8' }).trim(), '')
	assert.ok(run(['ls-remote', '--heads', 'origin', 'main']).includes('main'))
	drop(dir, bare)
})

test('cleanup stops before sweeping when fetch or default-branch push fails', () => {
	const rejected = make_repo({ remote: true })
	const rejected_wt = open_stream(rejected.dir, 'login page')
	commit_stream_file(rejected.run, rejected_wt, 'app.txt', 'feature\n')
	const hook = path.join(rejected.bare, 'hooks', 'pre-receive')
	fs.writeFileSync(hook, '#!/bin/sh\nwhile read old new ref\ndo\n  case "$ref" in\n    refs/heads/main) printf "reject https://user:secret@example.test\\\\033[31m\\\\n" >&2; exit 1 ;;\n  esac\ndone\nexit 0\n', { mode: 0o755 })
	const remote_main_before = rejected.run(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0]
	const logs = []

	assert.equal(agf.main(['cleanup', 'login-page'], rejected.dir, (message) => logs.push(message)), 1)
	assert.ok(logs.some((line) => line.includes('default-branch push failed')))
	assert.ok(!logs.some((line) => line.includes('removed folder')))
	assert.ok(!logs.some((line) => line.includes('deleted branch login-page')))
	assert.ok(fs.existsSync(rejected_wt))
	assert.ok(rejected.run(['branch', '--list', 'login-page']).includes('login-page'))
	assert.ok(execFileSync('git', ['show-ref', '--verify', 'refs/heads/login-page'], { cwd: rejected.bare, encoding: 'utf8' }))
	assert.equal(rejected.run(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0], remote_main_before)
	assert.doesNotMatch(logs.join('\n'), /secret|example\.test/)
	drop(rejected.dir, rejected.bare)

	const fetched = make_repo({ remote: true })
	const fetched_wt = open_stream(fetched.dir, 'login page')
	const missing_remote = path.join(fetched.dir, 'missing-origin')
	fetched.run(['remote', 'set-url', 'origin', missing_remote])
	const fetch_logs = []

	assert.equal(agf.main(['cleanup', 'login-page'], fetched.dir, (message) => fetch_logs.push(message)), 1)
	assert.ok(fetch_logs.some((line) => line.includes('fetch failed')))
	assert.ok(!fetch_logs.some((line) => line.includes('removed folder')))
	assert.ok(fs.existsSync(fetched_wt))
	assert.ok(fetched.run(['branch', '--list', 'login-page']).includes('login-page'))
	drop(fetched.dir, fetched.bare)
})

test('cleanup leaves the root notebook untouched', () => {
	const { dir } = make_repo()
	open_stream(dir, 'login page')
	const before = fs.readFileSync(path.join(dir, 'devlog.md'), 'utf8')
	agf.main(['cleanup', 'login-page'], dir, () => {})
	assert.equal(fs.readFileSync(path.join(dir, 'devlog.md'), 'utf8'), before)
	drop(dir)
})

test('cleanup refuses outside a git repository', () => {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-bare-')))
	const logs = []
	assert.equal(agf.main(['cleanup', 'x'], dir, (m) => logs.push(m)), 1)
	assert.ok(logs.some((l) => l.includes('not a git repository')))
	drop(dir)
})

test('cleanup prints usage when there is no name and no worktree to read one from', () => {
	const { dir } = make_repo()
	const logs = []
	assert.equal(agf.main(['cleanup'], dir, (m) => logs.push(m)), 1)
	assert.ok(logs.some((l) => l.includes('not standing in a .worktrees')))
	drop(dir)
})

test('stream_doc finds both the current and the legacy notebook name', () => {
	const { dir } = make_repo()
	fs.mkdirSync(path.join(dir, 'features', 'new'), { recursive: true })
	fs.writeFileSync(path.join(dir, 'features', 'new', 'new.devlog.md'), 'x')
	fs.mkdirSync(path.join(dir, 'features', 'old'), { recursive: true })
	fs.writeFileSync(path.join(dir, 'features', 'old', 'devlog.md'), 'x')
	assert.equal(agf.stream_doc(dir, 'new'), path.join('features', 'new', 'new.devlog.md'))
	assert.equal(agf.stream_doc(dir, 'old'), path.join('features', 'old', 'devlog.md'))
	assert.equal(agf.stream_doc(dir, 'missing'), '')
	drop(dir)
})

// ----- agf ditch -----

test('is_yes takes Enter, y and yes; EOF (null) and anything else are no', () => {
	assert.ok(agf.is_yes(''))
	assert.ok(agf.is_yes('\n'))
	assert.ok(agf.is_yes('y\n'))
	assert.ok(agf.is_yes('Y'))
	assert.ok(agf.is_yes('yes'))
	assert.ok(!agf.is_yes(null))
	assert.ok(!agf.is_yes('n\n'))
	assert.ok(!agf.is_yes('no'))
	assert.ok(!agf.is_yes('yeah nah'))
})

test('ditch needs the name written out — it never infers one from the folder', () => {
	const { dir } = make_repo()
	const wt = open_stream(dir, 'login page')
	const logs = []
	assert.equal(agf.main(['ditch'], wt, (m) => logs.push(m), () => 'Y\n'), 1)
	assert.ok(logs.some((l) => l.includes('you type what you delete')))
	assert.ok(fs.existsSync(wt))
	drop(dir)
})

test('ditch refuses an unknown name and shows the closest ones', () => {
	const { dir } = make_repo()
	open_stream(dir, 'login page')
	const logs = []
	assert.equal(agf.main(['ditch', 'login-pag'], dir, (m) => logs.push(m), () => 'Y\n'), 1)
	assert.ok(logs.some((l) => l.includes('no feature called "login-pag"')))
	assert.ok(logs.some((l) => l.includes('did you mean: login-page')))
	drop(dir)
})

test('ditch refuses the default branch', () => {
	const { dir, run } = make_repo()
	open_stream(dir, 'login page')
	const logs = []
	assert.equal(agf.main(['ditch', 'main'], dir, (m) => logs.push(m), () => 'Y\n'), 1)
	assert.ok(logs.some((l) => l.includes('main line of work')))
	assert.ok(run(['branch', '--list', 'main']).includes('main'))
	drop(dir)
})

test('ditch warns with what will be deleted, and n changes nothing', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	const logs = []
	const questions = []
	assert.equal(agf.main(['ditch', 'login-page'], dir, (m) => logs.push(m), (q) => { questions.push(q); return 'n\n' }), 1)
	assert.ok(logs.some((l) => l.includes('feature branch "login-page" will be deleted')))
	assert.ok(logs.some((l) => l.includes('unmerged work is lost')))
	assert.ok(questions.some((q) => q.includes('(Y/n)')))
	assert.ok(logs.some((l) => l === 'nothing was changed'))
	assert.ok(fs.existsSync(wt))
	assert.ok(run(['branch', '--list', 'login-page']).includes('login-page'))
	drop(dir)
})

test('ditch treats a closed stdin (EOF) as no', () => {
	const { dir } = make_repo()
	const wt = open_stream(dir, 'login page')
	assert.equal(agf.main(['ditch', 'login-page'], dir, () => {}, () => null), 1)
	assert.ok(fs.existsSync(wt))
	drop(dir)
})

test('ditch on yes deletes the worktree with unsaved work in it and the local branch', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	fs.writeFileSync(path.join(wt, 'half-done.txt'), 'never saved\n')
	const logs = []
	const r = agf.main(['ditch', 'login-page'], dir, (m) => logs.push(m), () => 'Y\n')
	assert.equal(r.dir, dir)
	assert.ok(!fs.existsSync(wt))
	assert.equal(run(['branch', '--list', 'login-page']).trim(), '')
	assert.ok(logs.some((l) => l.includes('main notebook devlog.md was NOT written')))
	drop(dir)
})

test('ditch deletes the branch on the server too', () => {
	const { dir, bare } = make_repo({ remote: true })
	open_stream(dir, 'login page')
	const logs = []
	agf.main(['ditch', 'login-page'], dir, (m) => logs.push(m), () => '\n')
	assert.ok(logs.some((l) => l.includes('deleted branch login-page on origin')))
	assert.equal(execFileSync('git', ['branch', '--list', 'login-page'], { cwd: bare, encoding: 'utf8' }).trim(), '')
	drop(dir, bare)
})

test('ditch leaves the root notebook untouched', () => {
	const { dir } = make_repo()
	open_stream(dir, 'login page')
	const before = fs.readFileSync(path.join(dir, 'devlog.md'), 'utf8')
	agf.main(['ditch', 'login-page'], dir, () => {}, () => 'Y\n')
	assert.equal(fs.readFileSync(path.join(dir, 'devlog.md'), 'utf8'), before)
	drop(dir)
})

test('cleanup deletes the branch merge_back left ahead of its own upstream (remote swept first)', () => {
	// The shape merge_back leaves behind: the branch's last commit went to main on the server,
	// never to origin/<key>. `git branch -d` compares against origin/<key> while it exists and
	// refuses — so the remote branch must go first.
	const { dir, run, bare } = make_repo({ remote: true })
	const wt = open_stream(dir, 'login page')
	fs.writeFileSync(path.join(wt, 'app.txt'), 'the feature\n')
	run(['add', '-A'], wt)
	run(['commit', '-m', 'feature work'], wt)
	run(['push', 'origin', 'HEAD:main'], wt)
	run(['fetch', 'origin'])
	run(['merge', '--ff-only', 'origin/main'])
	assert.ok(run(['branch', '--list', 'login-page']).includes('login-page'))

	const logs = []
	agf.main(['cleanup', 'login-page'], dir, (m) => logs.push(m))

	assert.ok(logs.some((l) => l.includes('deleted branch login-page on origin')))
	assert.ok(logs.some((l) => l === 'deleted branch login-page'), `local branch not deleted: ${logs.join(' | ')}`)
	assert.equal(run(['branch', '--list', 'login-page']).trim(), '')
	assert.equal(execFileSync('git', ['branch', '--list', 'login-page'], { cwd: bare, encoding: 'utf8' }).trim(), '')
	assert.ok(!fs.existsSync(wt))
	drop(dir, bare)
})

test('cleanup still refuses to delete a branch whose work never made it in', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	fs.writeFileSync(path.join(wt, 'app.txt'), 'the feature\n')
	run(['add', '-A'], wt)
	run(['commit', '-m', 'feature work'], wt)
	// A conflicting main-side change makes the merge fail, so nothing may be deleted.
	fs.writeFileSync(path.join(dir, 'app.txt'), 'the main version\n')
	run(['add', '-A'])
	run(['commit', '-m', 'main side'])
	const logs = []
	assert.equal(agf.main(['cleanup', 'login-page'], dir, (m) => logs.push(m)), 1)
	assert.ok(run(['branch', '--list', 'login-page']).includes('login-page'))
	assert.ok(fs.existsSync(wt))
	drop(dir)
})
