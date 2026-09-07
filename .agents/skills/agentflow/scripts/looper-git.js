#!/usr/bin/env node
'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const settings = require('./ag-settings')

const PLAN = /^plan-([0-9]{3})\.md$/u

const workspace_defaults = root => {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(root, 'ag.json'), 'utf8'))
    const paths = settings.workspace_paths(config)
    return { tasks_dir: path.join(root, paths.workspace || '.', 'planned'), completion_path: paths.notebook }
  } catch {
    return { tasks_dir: path.join(root, 'planned'), completion_path: 'devlog.md' }
  }
}

const fail = message => Object.assign(new Error(message), { name: 'GitLooperError' })
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const git = (root, args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) throw fail(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`)
  return result.stdout.trim()
}
const round_state = text => ({
  reply_ids: [...text.matchAll(/^# ← Reply \/ A-([0-9]+)$/gmu)].map(match => Number(match[1])),
  next_ask_id: Number((text.match(/(?:^|\n)# → Ask \/ A-([0-9]+)\n\n\+\n?$/u) || [])[1] || 0),
})
const plans = dir => fs.readdirSync(dir)
  .filter(name => PLAN.test(name))
  .sort((left, right) => Number(left.slice(5, 8)) - Number(right.slice(5, 8)))
const prompt_for = (root, plan, notebook, marker) => {
  const relative = path.relative(root, plan)
  return `godev: execute ${relative}\n\nYou are the plan worker already launched by the Git-backed looper. Execute only this plan directly. Do not invoke any looper or start another worker. Do not change files under ${path.dirname(relative)}. Complete ${notebook} with one exact \`# ← Reply / A-NNN\` heading and the next sequential scaffold \`# → Ask / A-NNN\n\n+\`. Commit the product and notebook changes. Your entire final response must be exactly: ${marker}`
}

const worker_for = (root, notebook) => {
  const config_path = settings.active_config_path(root, notebook)
  const text = fs.readFileSync(config_path, 'utf8')
  const duplicate = settings.duplicate_json_key(text)
  if (duplicate !== null) throw fail(`${config_path} contains duplicate key ${duplicate}`)
  const config = JSON.parse(text)
  settings.assert_valid_config(config, { repo_root: root, check_executables: false })
  const selection = settings.resolve_worker_tier(config, { role: 'implementation' })
  if (!selection) throw fail('no implementation worker is configured')
  return {
    command: selection.profile.command[0],
    args: selection.profile.command.slice(1),
    family: selection.profile.family,
    model: selection.model,
    effort: selection.effort,
  }
}

const worker_args = ({ worker, prompt, final_file }) => {
  let args = [...worker.args]
  if (worker.family === 'codex') {
    args.push('-m', worker.model, '-c', `model_reasoning_effort=${worker.effort}`)
    args.push('--output-last-message', final_file, prompt)
  } else if (worker.family === 'claude') {
    args.push('--model', worker.model, '--effort', worker.effort, prompt)
  } else args.push(prompt)
  return args
}

const run_child = ({ worker, args, root, heartbeat_ms = 60000, output = process.stderr }) => new Promise((resolve, reject) => {
  const child = spawn(worker.command, args, { cwd: root, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
  let transcript = ''
  const collect = chunk => { transcript = `${transcript}${chunk}`.slice(-4096) }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  child.once('error', reject)
  const started = Date.now()
  const timer = setInterval(() => output.write(`Still running — ${Math.floor((Date.now() - started) / 1000)}s elapsed\n`), heartbeat_ms)
  child.once('close', (code, signal) => {
    clearInterval(timer)
    resolve({ code, signal, transcript })
  })
})

const acquire = root => {
  const common = git(root, ['rev-parse', '--git-common-dir'])
  const lock = path.resolve(root, common, 'agentflow-looper-git.lock')
  try { fs.mkdirSync(lock) } catch (error) {
    if (error.code === 'EEXIST') throw fail(`another Git-backed looper owns this checkout: ${lock}`)
    throw error
  }
  try { fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\n`) } catch (error) {
    fs.rmdirSync(lock)
    throw error
  }
  return lock
}

const run_git_looper = async (options = {}) => {
  const root = fs.realpathSync(options.root || process.cwd())
  const defaults = workspace_defaults(root)
  const tasks = fs.realpathSync(options.tasks_dir || defaults.tasks_dir)
  const notebook = options.completion_path || defaults.completion_path
  const notebook_file = path.resolve(root, notebook)
  const marker = `${notebook} updated`
  let lock = null
  const done = path.join(tasks, 'done')
  const launched = []
  try {
    lock = acquire(root)
    fs.mkdirSync(done, { recursive: true })
    while (true) {
      const next = plans(tasks)[0]
      if (!next) return { code: 0, launched }
      const source = path.join(tasks, next)
      const before_hash = hash(source)
      const before_round = round_state(fs.readFileSync(notebook_file, 'utf8'))
      const before_head = git(root, ['rev-parse', 'HEAD'])
      const worker = options.worker || worker_for(root, notebook)
      const final_file = path.join(lock, `final-${next}`)
      const prompt = prompt_for(root, source, notebook, marker)
      const args = options.args_for ? options.args_for({ worker, prompt, final_file, plan: source }) : worker_args({ worker, prompt, final_file })
      launched.push(next)
      const child = await (options.run_child || run_child)({ worker, args, root, heartbeat_ms: options.heartbeat_ms })
      if (child.code !== 0) throw fail(`${next} worker exited ${child.code}${child.signal ? ` by ${child.signal}` : ''}`)
      const final = worker.family === 'codex'
        ? fs.readFileSync(final_file, 'utf8').trimEnd()
        : child.transcript.trimEnd()
      if (final !== marker) throw fail(`${next} did not return the exact completion response`)
      const after_round = round_state(fs.readFileSync(notebook_file, 'utf8'))
      if (before_round.next_ask_id < 1 ||
        after_round.reply_ids.length !== before_round.reply_ids.length + 1 ||
        after_round.reply_ids.at(-1) !== before_round.next_ask_id ||
        after_round.next_ask_id !== before_round.next_ask_id + 1)
        throw fail(`${next} did not add exactly one complete notebook round`)
      if (hash(source) !== before_hash) throw fail(`${next} changed while its worker ran`)
      if (git(root, ['rev-parse', 'HEAD']) === before_head) throw fail(`${next} produced no worker commit`)
      const destination = path.join(done, next)
      if (fs.existsSync(destination)) throw fail(`${next} archive already exists`)
      git(root, ['mv', source, destination])
      try { git(root, ['commit', '-m', `Archive ${next}`]) } catch (error) {
        git(root, ['reset', '--quiet', 'HEAD', '--', source, destination])
        fs.renameSync(destination, source)
        throw error
      }
    }
  } finally {
    if (lock !== null) fs.rmSync(lock, { recursive: true, force: true })
  }
}

const parse = argv => {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--tasks-dir' && argv[index + 1]) options.tasks_dir = argv[++index]
    else if (argv[index] === '--completion-path' && argv[index + 1]) options.completion_path = argv[++index]
    else throw fail(`unknown or incomplete option: ${argv[index]}`)
  }
  return options
}

if (require.main === module) run_git_looper(parse(process.argv.slice(2)))
  .then(result => process.stdout.write(`All plans are complete. ${result.launched.length} plan(s) archived.\n`))
  .catch(error => { process.stderr.write(`HALT: ${error.message}\n`); process.exitCode = 1 })

module.exports = { plans, prompt_for, round_state, run_git_looper, workspace_defaults }
