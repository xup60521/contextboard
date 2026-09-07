'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { preflight, run } = require('./terminal-preflight');
const { spawnSync } = require('node:child_process');

test('terminal preflight reports an incomplete completed round', () => {
	const result = preflight({ devlog_text: '# → Ask / A-001\n\n+ cross-check: implement it\n\n---\n\n# ← Reply / A-001\n' });
	assert.equal(result.ok, false);
	assert.equal(result.checks.find(check => check.id === 'next_ask_scaffold').status, 'fail');
});

test('terminal preflight rejects incomplete command arguments', () => {
  assert.equal(run([]), 1);
});

test('terminal preflight accepts bounded context through standard input', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentflow-terminal-stdin-'));
  try {
    const devlog_path = path.join(root, 'devlog.md');
    fs.writeFileSync(devlog_path, '# → Ask / A-001\n\n+ request\n');
    const result = spawnSync(process.execPath, [path.join(__dirname, 'terminal-preflight.js'), devlog_path, '--context-stdin'], {
      input: JSON.stringify({ devlog_text: '# → Ask / A-001\n\n+ request\n' }),
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PASS  terminal preflight/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('terminal preflight derives missing checkpoint evidence from the repository context', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentflow-terminal-preflight-'));
  try {
    const stamp = new Date(Date.now() - 120000 + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
    const devlog_text = `# → Ask / A-001\n\n+ request\n\n## [RUN-001] Event — ${stamp} (during round A-001)\n\n- **Scope check:** Changed paths match the tracker.\n\n## [WIP-001] Checkpoint — ${stamp} (during round A-001)\n\n- **Finished:**\n\n  1. Evidence.\n\n- **Running now:** None.\n\n- **Still to do:** None.\n\n- **Next work action:** continue.\n\n- **Checks:** [x] tracker.md | [x] devlog RUN | [x] scope matches tracker\n`;
    const result = preflight({
      devlog_text,
      context: { project_root: root, notebook_path: 'devlog.md' }
    });
    const check = result.checks.find(candidate => candidate.id === 'checkpoint_verification');
    assert.equal(check.status, 'fail');
    assert.match(check.detail, /current evidence|RUN|tracker/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
