'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const intake = require('./resume-intake.js')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agentflow-resume-intake-'))
const drop = directory => fs.rmSync(directory, { recursive: true, force: true })
const git = (directory, args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim()

const config = () => JSON.stringify({
  'schema-version': 7,
  switches: {
    'target-doc': 'devlog.md',
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

const make_repo = () => {
  const directory = tmp()
  git(directory, ['init', '-q', '-b', 'main'])
  git(directory, ['config', 'user.email', 'resume-intake@example.invalid'])
  git(directory, ['config', 'user.name', 'resume intake tests'])
  fs.writeFileSync(path.join(directory, 'ag.json'), config())
  fs.writeFileSync(path.join(directory, 'devlog.md'), notebook(''))
  git(directory, ['add', '.'])
  git(directory, ['commit', '-q', '-m', 'fixture'])
  return directory
}

test('one intake result validates configuration and treats a newly written final Ask as expected owner input', () => {
  const directory = make_repo()
  try {
    fs.writeFileSync(path.join(directory, 'devlog.md'), notebook('explain the current setup result'))
    const result = intake.collect_intake({ repo_root: directory, notebook_path: 'devlog.md', active_host: 'codex' })
    assert.equal(result.configuration.valid, true)
    assert.equal(result.branch, 'main')
    assert.deepEqual(result.changed_paths, ['devlog.md'])
    assert.equal(result.expected_owner_input, true)
    assert.equal(result.stream_rulebook_required, false)
    assert.deepEqual(result.current_ask, { id: 'A-001', text: '+ explain the current setup result' })
    assert.match(result.status, /^# STATUS/m)
  } finally {
    drop(directory)
  }
})

test('a change outside the notebook stays a foreign-work stream trigger', () => {
  const directory = make_repo()
  try {
    fs.writeFileSync(path.join(directory, 'devlog.md'), notebook('inspect this request'))
    fs.writeFileSync(path.join(directory, 'other.js'), 'module.exports = true\n')
    const result = intake.collect_intake({ repo_root: directory, notebook_path: 'devlog.md', active_host: 'codex' })
    assert.equal(result.expected_owner_input, false)
    assert.equal(result.stream_rulebook_required, true)
    assert.deepEqual(result.changed_paths, ['devlog.md', 'other.js'])
  } finally {
    drop(directory)
  }
})

test('an earlier notebook edit is not disguised as expected owner input', () => {
  const directory = make_repo()
  try {
    fs.writeFileSync(path.join(directory, 'devlog.md'), notebook('inspect this request').replace('Project: test.', 'Project: foreign edit.'))
    const result = intake.collect_intake({ repo_root: directory, notebook_path: 'devlog.md', active_host: 'codex' })
    assert.equal(result.expected_owner_input, false)
    assert.equal(result.stream_rulebook_required, true)
  } finally {
    drop(directory)
  }
})

test('a notebook edit that is not a final unresolved Ask remains a stream trigger', () => {
  const directory = make_repo()
  try {
    fs.writeFileSync(path.join(directory, 'devlog.md'), `${notebook('inspect this request')}\n# ← Reply / A-001\n\nanswer\n`)
    const result = intake.collect_intake({ repo_root: directory, notebook_path: 'devlog.md', active_host: 'codex' })
    assert.equal(result.expected_owner_input, false)
    assert.equal(result.stream_rulebook_required, true)
  } finally {
    drop(directory)
  }
})

test('the returned Ask excludes the current round checkpoint', () => {
  const directory = make_repo()
  try {
    fs.writeFileSync(path.join(directory, 'devlog.md'), `${notebook('inspect this request')}\n---\n\n## [WIP-001] Checkpoint — 2026-08-31 16:35 (during round A-001)\n`)
    const result = intake.collect_intake({ repo_root: directory, notebook_path: 'devlog.md', active_host: 'codex' })
    assert.deepEqual(result.current_ask, { id: 'A-001', text: '+ inspect this request' })
  } finally {
    drop(directory)
  }
})

test('the returned Ask excludes current RUN events before a checkpoint', () => {
  const directory = make_repo()
  try {
    const run = '## [RUN-001] Event — 2026-09-04 10:00 (during round A-001)\n\n- **Material result:** focused tests passed.\n'
    const wip = '## [WIP-001] Checkpoint — 2026-09-04 10:10 (during round A-001)\n\n- **Finished:** one task.\n'
    fs.writeFileSync(path.join(directory, 'devlog.md'), `${notebook('inspect this request')}\n${run}\n${wip}`)
    const result = intake.collect_intake({ repo_root: directory, notebook_path: 'devlog.md', active_host: 'codex' })
    assert.deepEqual(result.current_ask, { id: 'A-001', text: '+ inspect this request' })
  } finally {
    drop(directory)
  }
})

test('a malformed RUN-like heading cannot hide later owner input', () => {
  const text = `${notebook('retain this owner instruction')}\n## [RUN-bad] Event — malformed\n\n+ keep this later owner instruction\n`
  assert.deepEqual(intake.final_ask(text), {
    id: 'A-001',
    text: '+ retain this owner instruction\n\n## [RUN-bad] Event — malformed\n\n+ keep this later owner instruction'
  })
})

test('intake returns the current Ask when completed history exceeds the old whole-file limit', () => {
  const directory = make_repo()
  try {
    const history = `${'# ← Reply / A-000\n\nold result text\n\n'.repeat(2500)}---\n\n`
    const large_notebook = notebook('').replace('---\n\n# → Ask', `---\n\n${history}# → Ask`)
    fs.writeFileSync(path.join(directory, 'devlog.md'), large_notebook)
    git(directory, ['add', 'devlog.md'])
    git(directory, ['commit', '-q', '-m', 'large history'])
    fs.writeFileSync(path.join(directory, 'devlog.md'), large_notebook.replace(/\+\n$/u, '+ large notebook request\n'))

    const result = intake.collect_intake({ repo_root: directory, notebook_path: 'devlog.md', active_host: 'codex' })

    assert.deepEqual(result.current_ask, { id: 'A-001', text: '+ large notebook request' })
    assert.match(result.status, /^# STATUS/m)
    assert.equal(result.expected_owner_input, true)
    assert.equal(result.stream_rulebook_required, false)
  } finally {
    drop(directory)
  }
})
