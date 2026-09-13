'use strict'

// Windows regressions. Native PowerShell is not covered by the zsh/bash/fish
// shortcuts, and Git hands the working tree CRLF notebooks whenever
// core.autocrlf is enabled, which is the Windows default.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const setup = require('./setup.js')
const intake = require('./resume-intake.js')
const settings = require('./ag-settings.js')
const { send_tree_signal } = require('./process-tree.js')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agentflow-windows-'))
const drop = directory => fs.rmSync(directory, { recursive: true, force: true })
const crlf = text => text.split('\n').join('\r\n')

const config = () => JSON.stringify({
  'schema-version': 7,
  switches: {
    'target-doc': 'devlog.md',
    'workspace-dir': '.agentflow',
    'cli-provider': 'on',
    'auto-reply': 'off',
    lang: 'English',
    streams: 'always',
    'ask-names': 'off',
    'allow-ag': 'ask',
    metrics: 'off',
    'large-work-minutes': 120,
  },
  'pipeline-roles': {
    requirements: 'basic', codewalk: 'basic', explore: 'basic', spike: 'basic', spec: 'basic', implementation: 'basic', 'security-scan': 'off', acceptance: 'basic', 'cross-check': 'basic', learn: 'basic',
  },
  'external-workers': [{
    id: 'node-worker', command: ['node'], priority: 1, family: 'codex', tiers: { best: 'gpt-5.6-sol/low', better: 'gpt-5.6-luna/xhigh', basic: 'gpt-5.6-luna/xhigh', cheap: 'gpt-5.4/medium' },
  }],
}, null, 2) + '\n'

const notebook = ask => `# STATUS\n\nProject: test.\n\nNotebook: devlog.md — root.\n\nCurrent commit: initial.\n\nTests/scenarios: none.\n\nConfiguration: ag.json — schema v7; validated for codex this round.\n\nProven: none.\n\nOpen: none.\n\nNext: wait.\n\nArtifacts: none.\n\nArchived eras: none.\n\nStreams: none.\n\n---\n\n# → Ask / A-001\n\n+${ask ? ` ${ask}` : ''}\n`

const make_folder = text => {
  const directory = tmp()
  fs.writeFileSync(path.join(directory, 'ag.json'), config())
  fs.writeFileSync(path.join(directory, 'devlog.md'), text)
  return directory
}

test('PowerShell shortcuts preserve arguments and support managed replacement', () => {
  assert.equal(setup.detect_shell('C:\\Program Files\\PowerShell\\7\\pwsh.exe'), 'powershell')
  const shortcuts = { agf: "C:\\Users\\O'Brien\\.agents\\skills\\agentflow\\scripts\\agf.js", looper: 'C:\\Users\\test\\.agents\\skills\\agentflow\\scripts\\looper.js' }
  const content = setup.fixed_content({ shell: 'powershell', content: '', needs_fn: true, needs_looper: true, needs_open: true, shortcut_paths: shortcuts })
  assert.match(content, /O''Brien/)
  assert.match(content, /@args/)
  assert.match(content, /Set-Location -LiteralPath/)
  assert.equal(setup.uninstall_content('powershell', content), '')
})

test('PowerShell executes shortcuts with literal paths and forwards arguments', { skip: process.platform !== 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agf O'Brien "))
  try {
    const script = path.join(root, 'agf.js')
    fs.writeFileSync(script, 'process.stdout.write(process.argv[2])')
    const content = setup.lines_to_append('powershell', true, false, root, false)
    fs.mkdirSync(path.join(root, 'scripts'))
    fs.copyFileSync(script, path.join(root, 'scripts', 'agf.js'))
    const profile = path.join(root, 'journey.ps1')
    fs.writeFileSync(profile, `${content}\nagf '${root.replaceAll("'", "''")}'\n(Get-Location).Path\n`)
    const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', profile], { encoding: 'utf8' })
    assert.equal(output.trim(), root)
  } finally { drop(root) }
})

// status_block() searches for a literal '\n---\n', so before normalization a
// CRLF notebook threw "notebook has no STATUS separator" and no round could
// start on a Windows checkout at all.
test('a CRLF notebook in a plain folder still yields STATUS and the current Ask', () => {
  const directory = make_folder(crlf(notebook('explain the current setup result')))
  try {
    const result = intake.collect_intake({ repo_root: directory, notebook_path: 'devlog.md', active_host: 'codex' })
    assert.equal(result.stream_decision.reason, 'not_git_repository')
    assert.match(result.status, /^# STATUS/m)
    assert.deepEqual(result.current_ask, { id: 'A-001', text: '+ explain the current setup result' })
  } finally { drop(directory) }
})

test('a CRLF notebook in a repository reports the same intake as its LF form', () => {
  const git = (directory, args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' })
  const start = make_folder(notebook(''))
  try {
    git(start, ['init', '-q', '-b', 'main'])
    git(start, ['config', 'user.email', 'windows@example.invalid'])
    git(start, ['config', 'user.name', 'windows tests'])
    git(start, ['add', '.'])
    git(start, ['commit', '-q', '-m', 'fixture'])

    const written = notebook('explain the current setup result')
    fs.writeFileSync(path.join(start, 'devlog.md'), written)
    const lf = intake.collect_intake({ repo_root: start, notebook_path: 'devlog.md', active_host: 'codex' })
    fs.writeFileSync(path.join(start, 'devlog.md'), crlf(written))
    const converted = intake.collect_intake({ repo_root: start, notebook_path: 'devlog.md', active_host: 'codex' })

    assert.deepEqual(converted.current_ask, lf.current_ask)
    assert.equal(converted.status, lf.status)
    assert.equal(converted.expected_owner_input, lf.expected_owner_input)
  } finally { drop(start) }
})

// npm leaves an extensionless POSIX shim next to its .cmd wrapper. Windows
// spawns with shell:false, so counting that shim as available selects a worker
// that cannot start; only a real .exe or .com proves launchability.
test('Windows executable discovery requires a native executable extension', { skip: process.platform !== 'win32' }, () => {
  const root = tmp()
  try {
    fs.writeFileSync(path.join(root, 'claude'), '#!/bin/sh\nexec node "$@"\n')
    fs.writeFileSync(path.join(root, 'codex.cmd'), '@echo off\n')
    assert.equal(settings.executable_available('claude', { path_value: root }), false)
    assert.equal(settings.executable_available('codex', { path_value: root }), false)
    fs.writeFileSync(path.join(root, 'claude.exe'), '')
    assert.equal(settings.executable_available('claude', { path_value: root }), true)
  } finally { drop(root) }
})

test('Windows cancellation terminates descendants', { skip: process.platform !== 'win32', timeout: 15000 }, async () => {
  const { spawn } = require('node:child_process')
  const { once } = require('node:events')
  const code = `const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true}); console.log(child.pid); setInterval(()=>{},1000)`
  const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let descendant
  try {
    const [data] = await once(child.stdout, 'data')
    descendant = Number(String(data).trim())
    const closed = once(child, 'close')
    send_tree_signal(child, 'SIGTERM')
    await closed
    assert.throws(() => process.kill(descendant, 0), { code: 'ESRCH' })
  } finally {
    try { send_tree_signal(child, 'SIGKILL') } catch {}
    if (descendant) { try { process.kill(descendant) } catch {} }
  }
})
