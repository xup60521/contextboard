'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const test = require('node:test')

const { prompt_for, run_git_looper, workspace_defaults } = require('./looper-git')

const git = (root, args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentflow-git-looper-'))
  fs.mkdirSync(path.join(root, 'planned'))
  fs.writeFileSync(path.join(root, 'devlog.md'), '# → Ask / A-001\n\n+\n')
  fs.writeFileSync(path.join(root, 'planned', 'plan-001.md'), 'one\n')
  fs.writeFileSync(path.join(root, 'planned', 'plan-002.md'), 'two\n')
  git(root, ['init', '-q'])
  git(root, ['config', 'user.name', 'Test'])
  git(root, ['config', 'user.email', 'test@example.invalid'])
  git(root, ['add', '.'])
  git(root, ['commit', '-qm', 'fixture'])
  return root
}

test('prompt states the direct Git-backed worker and exact notebook contract', () => {
  const text = prompt_for('/repo', '/repo/planned/plan-001.md', 'devlog.md', 'devlog.md updated')
  assert.match(text, /Git-backed looper/)
  assert.match(text, /Do not invoke any looper/)
  assert.match(text, /# ← Reply \/ A-NNN/)
  assert.match(text, /\n\n\+/)
})

test('Git-backed runner defaults resolve the configured workspace', () => {
  const root = fixture()
  try {
    fs.mkdirSync(path.join(root, '.agentflow', 'planned'), { recursive: true })
    fs.writeFileSync(path.join(root, '.agentflow', 'devlog.md'), '# → Ask / A-001\n\n+\n')
    fs.writeFileSync(path.join(root, 'ag.json'), JSON.stringify({ switches: { 'workspace-dir': '.agentflow' } }))
    assert.deepEqual(workspace_defaults(root), {
      tasks_dir: path.join(root, '.agentflow', 'planned'),
      completion_path: '.agentflow/devlog.md',
    })
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Git-backed runner executes, verifies, archives, and commits two plans', async () => {
  const root = fixture()
  let round = 0
  try {
    const worker = { command: 'fake', args: [], family: 'custom', model: null, effort: null }
    const result = await run_git_looper({
      root,
      tasks_dir: path.join(root, 'planned'),
      worker,
      args_for: () => [],
      run_child: async () => {
        round += 1
        fs.writeFileSync(path.join(root, `product-${round}.txt`), `${round}\n`)
        const notebook = fs.readFileSync(path.join(root, 'devlog.md'), 'utf8').replace(/# → Ask \/ A-[0-9]+\n\n\+\n?$/u,
          `# → Ask / A-${String(round).padStart(3, '0')}\n\n# ← Reply / A-${String(round).padStart(3, '0')}\n\nDone.\n\n# → Ask / A-${String(round + 1).padStart(3, '0')}\n\n+\n`)
        fs.writeFileSync(path.join(root, 'devlog.md'), notebook)
        git(root, ['add', 'devlog.md', `product-${round}.txt`])
        git(root, ['commit', '-qm', `worker ${round}`])
        return { code: 0, signal: null, transcript: 'devlog.md updated\n' }
      },
    })
    assert.deepEqual(result.launched, ['plan-001.md', 'plan-002.md'])
    assert.equal(fs.existsSync(path.join(root, 'planned', 'done', 'plan-001.md')), true)
    assert.equal(fs.existsSync(path.join(root, 'planned', 'done', 'plan-002.md')), true)
    assert.equal(git(root, ['log', '--format=%s']).split('\n').filter(line => line.startsWith('Archive ')).length, 2)
    assert.equal(git(root, ['status', '--porcelain']), '')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Git-backed runner releases its lock when done-directory setup fails', async () => {
  const root = fixture()
  try {
    fs.writeFileSync(path.join(root, 'planned', 'done'), 'collision\n')
    await assert.rejects(run_git_looper({ root, tasks_dir: path.join(root, 'planned') }), /EEXIST|directory/i)
    assert.equal(fs.existsSync(path.join(root, '.git', 'agentflow-looper-git.lock')), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Git-backed runner restores a pending plan when its archive commit fails', async () => {
  const root = fixture()
  fs.unlinkSync(path.join(root, 'planned', 'plan-002.md'))
  git(root, ['add', '-u'])
  git(root, ['commit', '-qm', 'one plan only'])
  try {
    const worker = { command: 'fake', args: [], family: 'custom', model: null, effort: null }
    await assert.rejects(run_git_looper({
      root,
      tasks_dir: path.join(root, 'planned'),
      worker,
      args_for: () => [],
      run_child: async () => {
        fs.writeFileSync(path.join(root, 'product.txt'), 'done\n')
        fs.writeFileSync(path.join(root, 'devlog.md'), '# → Ask / A-001\n\n# ← Reply / A-001\n\nDone.\n\n# → Ask / A-002\n\n+\n')
        git(root, ['add', 'devlog.md', 'product.txt'])
        git(root, ['commit', '-qm', 'worker'])
        fs.writeFileSync(path.join(root, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
        return { code: 0, signal: null, transcript: 'devlog.md updated\n' }
      },
    }), /git commit .* failed/i)
    assert.equal(fs.existsSync(path.join(root, 'planned', 'plan-001.md')), true)
    assert.equal(fs.existsSync(path.join(root, 'planned', 'done', 'plan-001.md')), false)
    assert.equal(git(root, ['status', '--porcelain']), '')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
