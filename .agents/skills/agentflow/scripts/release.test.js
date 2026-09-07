'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const repo_root = path.resolve(__dirname, '..', '..', '..')
const release_config = JSON.parse(fs.readFileSync(path.join(repo_root, 'release', 'config.json'), 'utf8'))
const expected_remote = `git@github.com:${release_config.org}/${release_config.repo}.git`

const make_temp = prefix => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`)))
const dispose = target => fs.rmSync(target, { recursive: true, force: true })
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

const run_release = (source_root, args) => {
  try {
    return {
      status: 0,
      stdout: execFileSync(process.execPath, [path.join(source_root, 'release', 'publish.js'), ...args], {
        cwd: source_root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
      stderr: '',
    }
  } catch (error) {
    return {
      status: error.status || 1,
      stdout: String(error.stdout || ''),
      stderr: String(error.stderr || ''),
    }
  }
}

const copy_source = source_root => {
  fs.mkdirSync(source_root, { recursive: true })
  fs.cpSync(path.join(repo_root, 'release'), path.join(source_root, 'release'), { recursive: true })
  fs.mkdirSync(path.join(source_root, 'skills'), { recursive: true })
  fs.cpSync(path.join(repo_root, 'skills', 'agentflow'), path.join(source_root, 'skills', 'agentflow'), { recursive: true })
  fs.mkdirSync(path.join(source_root, 'eval'), { recursive: true })
  fs.copyFileSync(path.join(repo_root, 'eval', 'evaluation-harness.md'), path.join(source_root, 'eval', 'evaluation-harness.md'))
  git(source_root, ['init', '-q', '-b', 'main'])
  git(source_root, ['config', 'user.email', 'release-tests@example.invalid'])
  git(source_root, ['config', 'user.name', 'release tests'])
  git(source_root, ['config', 'maintenance.auto', 'false'])
  git(source_root, ['config', 'gc.auto', '0'])
  git(source_root, ['add', '.'])
  git(source_root, ['commit', '-q', '-m', 'fixture'])
}

const make_source = () => {
  const source_root = make_temp('agentflow-release-source')
  copy_source(source_root)
  return source_root
}

const make_destination = ({ remote = expected_remote, dirty = false, license = 'approved release license\n' } = {}) => {
  const destination = make_temp('agentflow-release-destination')
  git(destination, ['init', '-q', '-b', 'main'])
  git(destination, ['config', 'user.email', 'release-tests@example.invalid'])
  git(destination, ['config', 'user.name', 'release tests'])
  git(destination, ['config', 'maintenance.auto', 'false'])
  git(destination, ['config', 'gc.auto', '0'])
  fs.writeFileSync(path.join(destination, 'LICENSE'), license)
  fs.writeFileSync(path.join(destination, 'keep-me.txt'), 'keep this until validation\n')
  git(destination, ['add', '.'])
  git(destination, ['commit', '-q', '-m', 'empty public checkout'])
  git(destination, ['remote', 'add', 'origin', remote])
  if (dirty) fs.writeFileSync(path.join(destination, 'dirty.txt'), 'uncommitted\n')
  return destination
}

const snapshot = target => {
  if (!fs.existsSync(target)) return '<missing>'

  const visit = (current, prefix = '') => fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name)).flatMap(entry => {
    const relative = path.join(prefix, entry.name)
    const absolute = path.join(current, entry.name)
    if (entry.isSymbolicLink()) return [[relative, 'symlink', fs.readlinkSync(absolute)]]
    if (entry.isDirectory()) return visit(absolute, relative)
    return [[relative, 'file', fs.readFileSync(absolute).toString('base64')]]
  })

  return JSON.stringify(visit(target))
}

const write_license = (destination, value = 'approved release license\n') => fs.writeFileSync(path.join(destination, 'LICENSE'), value)

test('protected release refuses missing, wrong, dirty, source, and parent destinations before mutation', () => {
  const cases = []
  const source_root = make_source()
  try {
    const missing = path.join(path.dirname(source_root), `${path.basename(source_root)}-missing-destination`)
    cases.push({ name: 'missing', condition: /destination|exist|missing/i, destination: missing, before: '<missing>' })

    const wrong_remote = make_destination({ remote: 'https://github.com/example/not-agentflow.git' })
    cases.push({ name: 'wrong remote', condition: /remote/i, destination: wrong_remote, before: snapshot(wrong_remote) })

    const dirty = make_destination({ remote: 'https://github.com/agfnow/agentflow.git', dirty: true })
    cases.push({ name: 'dirty', condition: /dirty/i, destination: dirty, before: snapshot(dirty) })

    for (const item of cases) {
      const result = run_release(source_root, ['--dest', item.destination])
      assert.notEqual(result.status, 0, `${item.name} destination must be refused`)
      assert.match(result.stderr, item.condition)
      assert.equal(snapshot(item.destination), item.before, `${item.name} destination changed after refusal`)
    }

    const container = make_temp('agentflow-release-boundary')
    const nested_source = path.join(container, 'source')
    try {
      copy_source(nested_source)
      for (const [name, destination] of [['source', nested_source], ['parent', container]]) {
        const before = snapshot(destination)
        const result = run_release(nested_source, ['--dest', destination])
        assert.notEqual(result.status, 0, `${name} destination must be refused`)
        assert.match(result.stderr, new RegExp(name, 'i'))
        assert.equal(snapshot(destination), before, `${name} destination changed after refusal`)
      }
    } finally {
      dispose(container)
    }
  } finally {
    dispose(source_root)
    for (const item of cases) if (item.name !== 'missing') dispose(item.destination)
  }
})

test('explicit assembly refuses a missing, symlinked, or non-regular license without changing the destination', () => {
  const source_root = make_source()
  const destinations = []
  try {
    const missing = make_temp('agentflow-release-missing-license')
    fs.writeFileSync(path.join(missing, 'sentinel.txt'), 'unchanged\n')
    destinations.push(missing)

    const symlinked = make_temp('agentflow-release-symlink-license')
    fs.writeFileSync(path.join(symlinked, 'real-license'), 'approved release license\n')
    fs.symlinkSync('real-license', path.join(symlinked, 'LICENSE'))
    fs.writeFileSync(path.join(symlinked, 'sentinel.txt'), 'unchanged\n')
    destinations.push(symlinked)

    const directory = make_temp('agentflow-release-directory-license')
    fs.mkdirSync(path.join(directory, 'LICENSE'))
    fs.writeFileSync(path.join(directory, 'sentinel.txt'), 'unchanged\n')
    destinations.push(directory)

    for (const destination of destinations) {
      const before = snapshot(destination)
      const result = run_release(source_root, ['--assemble', '--dest', destination])
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /license/i)
      assert.equal(snapshot(destination), before)
    }
  } finally {
    dispose(source_root)
    destinations.forEach(dispose)
  }
})

test('explicit assembly keeps the approved license and creates the exact public payload', () => {
  const source_root = make_source()
  const destination = make_temp('agentflow-release-payload')
  const approved_license = 'approved release license identity\n'
  try {
    write_license(destination, approved_license)
    fs.writeFileSync(path.join(destination, 'stale.txt'), 'remove me\n')

    const result = run_release(source_root, ['--assemble', '--dest', destination])

    assert.equal(result.status, 0, result.stderr)
    assert.equal(fs.readFileSync(path.join(destination, 'LICENSE'), 'utf8'), approved_license)
    assert.equal(fs.lstatSync(path.join(destination, 'LICENSE')).isFile(), true)
    assert.deepEqual(fs.readdirSync(destination).sort(), ['.claude-plugin', 'LICENSE', 'README.md', 'README.zh-tw.md', 'skills'])
    assert.equal(fs.existsSync(path.join(destination, 'eval')), false)
    assert.equal(fs.existsSync(path.join(destination, 'skills', 'agentflow', 'references', 'evaluation-harness.md')), false)

    const english = fs.readFileSync(path.join(destination, 'README.md'), 'utf8')
    const chinese = fs.readFileSync(path.join(destination, 'README.zh-tw.md'), 'utf8')
    for (const readme of [english, chinese]) {
      assert.doesNotMatch(readme, /\{\{(?:org|repo)\}\}/)
      assert.match(readme, /Node(?:\.js)? 18|Node 18/i)
      assert.match(readme, /Git/i)
      assert.match(readme, /setup\.js/)
      assert.match(readme, /godev/)
    }
    assert.match(english, /README\.zh-tw\.md/)
    assert.match(chinese, /README\.md/)
    assert.match(english, /version-7\b/)
    assert.match(chinese, /版本 7\b/)

    const marketplace = JSON.parse(fs.readFileSync(path.join(destination, '.claude-plugin', 'marketplace.json'), 'utf8'))
    const plugin = JSON.parse(fs.readFileSync(path.join(destination, '.claude-plugin', 'plugin.json'), 'utf8'))
    assert.deepEqual(Object.keys(marketplace).sort(), ['name', 'owner', 'plugins'])
    assert.equal(marketplace.name, 'agentflow')
    assert.deepEqual(marketplace.owner, { name: release_config.org })
    assert.equal(marketplace.plugins.length, 1)
    assert.deepEqual(Object.keys(plugin).sort(), ['author', 'description', 'name'])
    assert.equal(plugin.name, 'agentflow')
    assert.deepEqual(plugin.author, { name: release_config.org })
    assert.ok(fs.existsSync(path.join(destination, 'skills', 'agentflow', 'SKILL.md')))
  } finally {
    dispose(source_root)
    dispose(destination)
  }
})

test('protected release accepts a clean checkout with a normalized public remote', () => {
  const source_root = make_source()
  const destination = make_destination({ remote: 'HTTPS://github.com/agfnow/agentflow.git' })
  try {
    const result = run_release(source_root, ['--dest', destination])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(fs.readFileSync(path.join(destination, 'LICENSE'), 'utf8'), 'approved release license\n')
    assert.equal(fs.existsSync(path.join(destination, 'keep-me.txt')), false)
    assert.ok(fs.existsSync(path.join(destination, 'README.md')))
  } finally {
    dispose(source_root)
    dispose(destination)
  }
})

test('protected --push refuses a mismatched effective push URL before mutation', () => {
  const source_root = make_source()
  const destination = make_destination()
  const push_target = make_temp('agentflow-release-push-target')
  try {
    git(push_target, ['init', '--bare', '-q'])
    git(destination, ['config', 'remote.origin.pushurl', push_target])
    const before = snapshot(destination)
    const push_target_before = snapshot(push_target)

    const result = run_release(source_root, ['--dest', destination, '--push'])

    assert.notEqual(result.status, 0, 'a mismatched effective push URL must be refused')
    assert.match(result.stderr, /push|remote/i)
    assert.equal(snapshot(destination), before, 'destination changed before push-url refusal')
    assert.equal(snapshot(push_target), push_target_before, 'mismatched push target was contacted')
  } finally {
    dispose(source_root)
    dispose(destination)
    dispose(push_target)
  }
})

test('the retained regression command names terminal and release boundary tests', () => {
  const readme = fs.readFileSync(path.join(repo_root, 'skills', 'agentflow', 'scripts', 'README.md'), 'utf8')
  assert.match(readme, /release\.test\.js/)
  assert.match(readme, /terminal\.test\.js/)
})
