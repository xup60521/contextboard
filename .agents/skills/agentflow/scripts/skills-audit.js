'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// Inventory only: never import inspected skills or execute their hooks.
const inventory = (repo, env = process.env) => {
  const home = os.homedir()
  const codex = env.CODEX_HOME || path.join(home, '.codex')
  const claude = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude')
  const roots = [...new Set([
    ...['.agents/skills', '.codex/skills', '.claude/skills'].map(name => path.join(repo, name)),
    path.join(home, '.agents/skills'), path.join(codex, 'skills'), path.join(claude, 'skills'),
    path.join(codex, 'plugins'), path.join(claude, 'plugins/cache'),
  ])]
  const skills = new Map(); const sources = []
  const state = file => {
    try { return fs.statSync(file).isFile() ? 'available' : 'not_file' }
    catch (error) { return error.code === 'ENOENT' ? 'missing' : 'unavailable' }
  }
  for (const root of roots) {
    const source = { path: root, state: 'available', issues: [] }; sources.push(source)
    const visited = new Set()
    const walk = dir => {
      const real = fs.realpathSync(dir)
      if (visited.has(real)) return
      visited.add(real)
      for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (['.git', 'node_modules'].includes(entry.name)) continue
        const file = path.join(dir, entry.name)
        try {
          const stat = fs.statSync(file)
          if (stat.isDirectory()) walk(file)
          else if (entry.name === 'SKILL.md' && stat.isFile()) {
            const canonical = fs.realpathSync(file)
            if (!skills.has(canonical)) skills.set(canonical, { path: canonical, aliases: [] })
            const aliases = skills.get(canonical).aliases
            if (!aliases.includes(file)) aliases.push(file)
          }
        } catch (error) { source.issues.push({ path: file, code: error.code || 'unavailable' }) }
      }
    }
    try { walk(root) } catch (error) { source.state = error.code === 'ENOENT' ? 'missing' : 'unavailable' }
  }
  const configurations = [...new Set([
    path.join(codex, 'config.toml'), path.join(claude, 'settings.json'),
    path.join(claude, 'plugins/installed_plugins.json'),
    ...['.codex/config.toml', '.claude/settings.json', '.claude/settings.local.json'].map(name => path.join(repo, name)),
  ])].map(file => ({ path: file, state: state(file) }))
  return {
    assessment: 'not_performed',
    baseline: path.resolve(__dirname, '../SKILL.md'),
    sources, skills: [...skills.values()], configurations,
    limitations: [
      'Installed does not mean active. This command inventories paths; semantic conflict assessment is not performed.',
      'Only the current project, user skill directories and local Codex/Claude plugin caches are searched. Ancestor projects, remote catalogs, custom roots and unobservable runtime hooks may be missing.',
      'Configuration paths are listed without contents. Review relevant triggers and hooks locally; do not publish credentials.',
    ],
    prompt: fs.readFileSync(path.join(__dirname, '../references/skill-conflicts.md'), 'utf8'),
  }
}

const main = (argv, cwd, log, _ask, width = 80) => {
  const usage = 'usage: agf skills audit [--json]'
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) { log(usage); return 0 }
  if (argv[0] !== 'audit' || argv.slice(1).some(arg => arg !== '--json') || argv.length > 2) { log(usage); return 1 }
  const report = inventory(cwd)
  if (argv.includes('--json')) return { json: report, exitCode: 0 }
  // Wrap display only. JSON retains exact paths for machine consumers.
  const columns = Number.isFinite(width) ? Math.max(20, width) : 80
  const emit = text => {
    for (const line of text.split('\n')) {
      let rest = line
      while (rest.length > columns) {
        const split = rest.lastIndexOf(' ', columns)
        const end = split > 0 ? split : columns
        log(rest.slice(0, end)); rest = rest.slice(end).trimStart()
      }
      log(rest)
    }
  }
  emit('Skills audit: inventory ready; conflict assessment not performed.')
  emit(`Agentflow baseline: ${report.baseline}`)
  for (const source of report.sources) {
    emit(`Source (${source.state}): ${source.path}`)
    for (const issue of source.issues) emit(`Unavailable (${issue.code}): ${issue.path}`)
  }
  for (const skill of report.skills) emit(`Skill: ${skill.path}`)
  for (const config of report.configurations) emit(`Configuration (${config.state}): ${config.path}`)
  for (const limit of report.limitations) emit(limit)
  emit('\nUse this prompt with the inventory for a read-only assessment:\n' + report.prompt)
  return 0
}

module.exports = { inventory, main }
