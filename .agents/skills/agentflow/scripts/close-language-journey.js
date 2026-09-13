#!/usr/bin/env node
'use strict';

// 在真實終端執行；沿用呼叫端 PTY，不新增終端套件或自行建立 fork。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const settings = require('./ag-settings.js');

assert.ok(process.stdin.isTTY && process.stdout.isTTY, 'Run this journey in a real terminal/PTY');
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-close-language-pty-')));
const notebook = '.agentflow/devlog.md';
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
git(['init', '-q', '-b', 'main']);
git(['config', 'user.email', 'pty@example.invalid']);
git(['config', 'user.name', 'Agentflow PTY']);
settings.initialize_project({ repo_root: root, active_host: 'codex' });
require('./agf.js').update_ignore_file(root);
console.log('PTY_OK: stdin/stdout are terminals');

const run = (file, args, input) => {
  console.log(`$ node ${file} ${args.join(' ')}`);
  if (input !== undefined) console.log(`stdin: ${input}`);
  const child = spawnSync(process.execPath, [path.join(__dirname, file), ...args], {
    cwd: root, input, encoding: 'utf8', stdio: [input === undefined ? 'inherit' : 'pipe', 'inherit', 'inherit'], timeout: 30000,
  });
  assert.equal(child.status, 0, `${file}: ${child.error?.message || `exit ${child.status}`}`);
};
const hook = (event, extra = {}) => run('stop-hook.js', ['--host', 'codex'], JSON.stringify({ cwd: root, hook_event_name: event, ...extra }));
const change_language = language => run('agf.js', ['settings', 'change', '--host', 'codex', '--notebook', notebook, '--set', `lang: ${language}`]);
const close = ask => run('agf.js', ['close', '--manifest-stdin'], JSON.stringify({
  version: 1, notebook, ask, run_events: [],
  reply: '## [SUMMARY]\n\n- 語言設定已保存。\n\n## [FINAL REPORT]\n\n1. 已驗證本輪語言與結案。\n',
  status: {
    project: 'language PTY', notebook, notebook_kind: 'root', current_commit: 'local delivery recorded in Git history',
    tests_scenarios: 'language PTY', config_path: 'ag.json', host: 'codex', validation: 'validated',
    proven: 'language saved', open: 'none', next: 'await owner', artifacts: 'none', archived_eras: 'none', streams: [],
  },
  allowed_paths: [notebook, '.gitignore', 'ag.json'], commit_message: `record language ${ask}`, delivery: { mode: 'local' },
}));

change_language('zh-tw');
hook('UserPromptSubmit', { prompt: 'hihi' });
close('A-001');
hook('Stop', { stop_hook_active: false });
const first_notebook = git(['show', `HEAD:${notebook}`]);
assert.equal(JSON.parse(git(['show', 'HEAD:ag.json'])).switches.lang, 'zh-tw');

hook('UserPromptSubmit', { prompt: 'lang: zh-cn' });
change_language('zh-cn');
close('A-002');
hook('Stop', { stop_hook_active: false });
assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'ag.json'), 'utf8')).switches.lang, 'zh-cn');
assert.equal(JSON.parse(git(['show', 'HEAD:ag.json'])).switches.lang, 'zh-cn');
assert.equal(git(['rev-list', '--count', 'HEAD']), '2');
assert.equal(git(['status', '--porcelain']), '');
const saved = fs.readFileSync(path.join(root, notebook), 'utf8');
assert.equal((saved.match(/^# ← Reply \//gm) || []).length, 2);
assert.ok(saved.includes('# → Ask / A-003'));
const first_round = first_notebook.slice(first_notebook.indexOf('# → Ask / A-001'), first_notebook.indexOf('# → Ask / A-002'));
assert.ok(saved.includes(first_round), 'the first completed round is unchanged');
console.log('PASS: visible PTY input/output, both stop hooks, two commits, persisted zh-cn and unchanged first round');
console.log(`Fixture retained: ${root}`);
