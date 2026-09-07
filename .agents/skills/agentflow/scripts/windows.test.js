const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const setup = require('./setup.js')
const settings = require('./ag-settings.js')

test('PowerShell shortcuts preserve arguments and support managed replacement', () => {
  assert.equal(setup.detect_shell('C:\\Program Files\\PowerShell\\7\\pwsh.exe'), 'powershell')
  const shortcuts = { agf: "C:\\Users\\O'Brien\\.agents\\skills\\agentflow\\scripts\\agf.js", looper: 'C:\\Users\\test\\.agents\\skills\\agentflow\\scripts\\looper.js' }
  const content = setup.fixed_content({ shell: 'powershell', content: '', needs_fn: true, needs_looper: true, needs_open: true, shortcut_paths: shortcuts })
  assert.match(content, /O''Brien/)
  assert.match(content, /@args/)
  assert.match(content, /Set-Location -LiteralPath/)
  assert.equal(setup.uninstall_content('powershell', content), '')
})

test('Windows executable discovery checks executable extensions', { skip: process.platform !== 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agf-windows-'))
  try {
    fs.writeFileSync(path.join(root, 'claude.exe'), '')
    assert.equal(settings.executable_available('claude', { path_value: root }), true)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('PowerShell executes shortcuts with literal paths and forwards arguments', { skip: process.platform !== 'win32' }, () => {
  const { execFileSync } = require('node:child_process')
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
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('Windows cancellation terminates descendants', { skip: process.platform !== 'win32', timeout: 15000 }, async () => {
  const { spawn } = require('node:child_process')
  const { once } = require('node:events')
  const { send_tree_signal } = require('./process-tree.js')
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
