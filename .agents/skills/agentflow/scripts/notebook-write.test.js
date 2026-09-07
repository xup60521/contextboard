'use strict';

const node_assert = require('node:assert/strict');
const node_child_process = require('node:child_process');
const node_fs = require('node:fs');
const node_os = require('node:os');
const node_path = require('node:path');
const node_test = require('node:test');
const ag_settings = require('./ag-settings.js');

const SCRIPT = node_path.join(__dirname, 'notebook-write.js');
const CHECKS = '- **Checks:** [x] tracker.md | [x] devlog RUN | [x] scope matches tracker';
const recent_taipei_minute = () => new Date(Date.now() - 120000 + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ');

const make_root = () => node_fs.realpathSync(node_fs.mkdtempSync(node_path.join(node_os.tmpdir(), 'agentflow-notebook-write-')));

const run_writer = (root, args) => node_child_process.spawnSync(process.execPath, [SCRIPT, ...args], {
  cwd: root,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe']
});

const run_writer_stdin = (root, args, input) => node_child_process.spawnSync(process.execPath, [SCRIPT, ...args], {
  cwd: root,
  encoding: 'utf8',
  input,
  stdio: ['pipe', 'pipe', 'pipe']
});

const write = (root, relative, content, mode = 0o644) => {
  const file = node_path.join(root, relative);
  node_fs.mkdirSync(node_path.dirname(file), { recursive: true });
  node_fs.writeFileSync(file, content, { mode });
  node_fs.chmodSync(file, mode);
  return file;
};

const read_bytes = file => node_fs.readFileSync(file);

const checkpoint = (number, ask_id, marker = 'checkpoint') => [
  `## [WIP-${String(number).padStart(3, '0')}] Checkpoint — ${recent_taipei_minute()} (during round ${ask_id})`,
  '',
  '- **Finished:**',
  '',
  `  1. ${marker}.`,
  '',
  '- **Running now:** None.',
  '',
  '- **Still to do:** None.',
  '',
  '- **Next work action:** continue.',
  '',
  CHECKS,
  ''
].join('\n');

const run_event = (number, ask_id, marker = 'material change') => [
  `## [RUN-${String(number).padStart(3, '0')}] Event — ${recent_taipei_minute()} (during round ${ask_id})`,
  '',
  `- ${marker}.`,
  ''
].join('\n');

const notebook = ({ ask_id = 'A-001', body = '+ owner request\n', later = '', reply = '' } = {}) => [
  '# STATUS',
  '',
  'Project: test',
  '',
  '---',
  '',
  `# → Ask / ${ask_id}`,
  '',
  body,
  reply,
  later
].join('\n');

const setup = ({ relative = '.agentflow/devlog.md', text, mode = 0o644 } = {}) => {
  const root = make_root();
  const notebook_path = relative;
  const notebook_file = write(root, notebook_path, text ?? notebook(), mode);
  const draft_path = 'draft.md';
  const draft_file = write(root, draft_path, checkpoint(1, 'A-001', 'new WIP'));
  return { root, notebook_path, notebook_file, draft_path, draft_file };
};

const command = (root, notebook_path, draft_path, ask_id = 'A-001') => [
  'append-wip',
  '--notebook',
  notebook_path,
  '--ask',
  ask_id,
  '--input',
  draft_path
];

const reply_command = (root, notebook_path, draft_path, ask_id = 'A-001') => [
  'append-reply',
  '--notebook',
  notebook_path,
  '--ask',
  ask_id,
  '--input',
  draft_path
];

const stdin_command = (operation, notebook_path, ask_id = 'A-001') => [
  operation,
  '--notebook',
  notebook_path,
  '--ask',
  ask_id,
  '--input-stdin'
];

const reply = (ask_id = 'A-001', body = '## [SUMMARY]\n\n- Done.\n\n## Questions (batched — each with a suggested default)\n\n- None.') => `# ← Reply / ${ask_id}\n\n${body}\n`;

const failure_text = result => `${result.stdout}\n${result.stderr}`;

const assert_refused_without_write = ({ root, notebook_path, draft_path, ask_id = 'A-001', pattern, snapshot_path = notebook_path }) => {
  const notebook_file = node_path.isAbsolute(snapshot_path) ? snapshot_path : node_path.join(root, snapshot_path);
  const before = read_bytes(notebook_file);
  const result = run_writer(root, command(root, notebook_path, draft_path, ask_id));
  node_assert.notEqual(result.status, 0);
  node_assert.match(failure_text(result), pattern);
  node_assert.deepEqual(read_bytes(notebook_file), before);
};

node_test.test('append-wip appends after the target Ask WIPs despite repeated identical footers', () => {
  const root = make_root();
  const notebook_path = 'history.md';
  const old_round = notebook({
    ask_id: 'A-001',
    body: `+ old request\n\n${checkpoint(1, 'A-001', 'old')}`,
    reply: '# ← Reply / A-001\n\nold reply\n\n',
    later: '# → Ask / A-002\n\n+ current request\n\n'
  });
  const target = old_round + checkpoint(1, 'A-002', 'first target WIP') + checkpoint(2, 'A-002', 'second target WIP');
  const notebook_file = write(root, notebook_path, target);
  const draft_path = 'draft.md';
  const draft = write(root, draft_path, checkpoint(3, 'A-002', 'new target WIP'));

  const result = run_writer(root, command(root, notebook_path, draft_path, 'A-002'));

  node_assert.equal(result.status, 0, failure_text(result));
  const updated = read_bytes(notebook_file).toString('utf8');
  const second = checkpoint(2, 'A-002', 'second target WIP').trimEnd();
  const third = checkpoint(3, 'A-002', 'new target WIP').trimEnd();
  node_assert.ok(updated.indexOf(second) < updated.indexOf(third));
  node_assert.ok(updated.indexOf(third) > updated.indexOf('# → Ask / A-002'));
  node_assert.equal((updated.match(/## \[WIP-003\]/g) || []).length, 1);
  node_assert.equal((updated.match(/## \[WIP-002\]/g) || []).length, 1);
  node_assert.equal(node_fs.existsSync(draft), false);
});

node_test.test('append-wip preserves notebook bytes outside the insertion and preserves mode', () => {
  const fixture = setup({ mode: 0o640 });
  const before = read_bytes(fixture.notebook_file);
  const draft_bytes = read_bytes(fixture.draft_file);
  const result = run_writer(fixture.root, command(fixture.root, fixture.notebook_path, fixture.draft_path));

  node_assert.equal(result.status, 0, failure_text(result));
  const after = read_bytes(fixture.notebook_file);
  const draft_start = after.indexOf(draft_bytes);
  node_assert.ok(draft_start > 0);
  node_assert.deepEqual(after.subarray(0, draft_start), before);
  node_assert.deepEqual(after.subarray(draft_start), draft_bytes);
  node_assert.equal(node_fs.statSync(fixture.notebook_file).mode & 0o7777, 0o640);
  node_assert.equal(node_fs.existsSync(fixture.draft_file), false);
});

node_test.test('append-wip accepts bounded standard input without a draft file', () => {
  const fixture = setup();
  node_fs.unlinkSync(fixture.draft_file);
  const result = run_writer_stdin(fixture.root, stdin_command('append-wip', fixture.notebook_path), checkpoint(1, 'A-001', 'stdin WIP'));

  node_assert.equal(result.status, 0, failure_text(result));
  node_assert.match(read_bytes(fixture.notebook_file).toString('utf8'), /stdin WIP/);
  node_assert.equal(node_fs.readdirSync(fixture.root).some(name => /draft/i.test(name)), false);
});

node_test.test('append-run accepts sequential standard-input events interleaved with WIP checkpoints', () => {
  const fixture = setup({ text: notebook({ body: `+ request\n\n${run_event(1, 'A-001')}\n${checkpoint(1, 'A-001')}` }) });
  node_fs.unlinkSync(fixture.draft_file);
  const result = run_writer_stdin(fixture.root, stdin_command('append-run', fixture.notebook_path), run_event(2, 'A-001', 'focused tests passed'));

  node_assert.equal(result.status, 0, failure_text(result));
  const updated = read_bytes(fixture.notebook_file).toString('utf8');
  node_assert.match(updated, /\[RUN-001\][\s\S]*\[WIP-001\][\s\S]*\[RUN-002\]/u);
});

node_test.test('append-run refuses duplicate numbering, a wrong round, and a closed Ask', () => {
  for (const [label, text, event, pattern] of [
    ['duplicate', notebook({ body: `+ request\n\n${run_event(1, 'A-001')}` }), run_event(1, 'A-001'), /RUN.*number/i],
    ['wrong-round', notebook(), run_event(1, 'A-002'), /round/i],
    ['closed', notebook({ reply: reply('A-001') }), run_event(1, 'A-001'), /closed|Reply/i],
  ]) {
    const fixture = setup({ text });
    node_fs.unlinkSync(fixture.draft_file);
    const before = read_bytes(fixture.notebook_file);
    const result = run_writer_stdin(fixture.root, stdin_command('append-run', fixture.notebook_path), event);
    node_assert.notEqual(result.status, 0, label);
    node_assert.match(failure_text(result), pattern, label);
    node_assert.deepEqual(read_bytes(fixture.notebook_file), before, label);
  }
});

node_test.test('standard input is mutually exclusive with file input and remains size bounded', () => {
  const fixture = setup();
  const both = run_writer_stdin(fixture.root, [...command(fixture.root, fixture.notebook_path, fixture.draft_path), '--input-stdin'], checkpoint(1, 'A-001'));
  node_assert.notEqual(both.status, 0);
  node_assert.match(failure_text(both), /mutually exclusive|usage/i);

  const before = read_bytes(fixture.notebook_file);
  const oversized = run_writer_stdin(fixture.root, stdin_command('append-wip', fixture.notebook_path), 'x'.repeat(1024 * 1024 + 1));
  node_assert.notEqual(oversized.status, 0);
  node_assert.match(failure_text(oversized), /oversized|maximum/i);
  node_assert.deepEqual(read_bytes(fixture.notebook_file), before);
});

node_test.test('usage requires standard input first and labels named drafts as fallback-only', () => {
  const result = run_writer(process.cwd(), []);
  const output = failure_text(result);

  node_assert.notEqual(result.status, 0);
  node_assert.match(output, /--input-stdin.*fallback only after --input-stdin fails: --input <draft>/iu);
  node_assert.ok(output.indexOf('--input-stdin') < output.indexOf('--input <draft>'));
});

node_test.test('append-reply accepts standard input and creates the next Ask scaffold', () => {
  const fixture = setup();
  node_fs.unlinkSync(fixture.draft_file);
  const result = run_writer_stdin(fixture.root, stdin_command('append-reply', fixture.notebook_path), reply('A-001'));

  node_assert.equal(result.status, 0, failure_text(result));
  node_assert.match(read_bytes(fixture.notebook_file).toString('utf8'), /# ← Reply \/ A-001[\s\S]*# → Ask \/ A-002\n\n\+\n$/u);
  node_assert.equal(node_fs.readdirSync(fixture.root).some(name => /draft/i.test(name)), false);
});

node_test.test('append-wip refuses an older non-final Ask', () => {
  const fixture = setup({
    text: notebook({
      ask_id: 'A-001',
      body: '+ older request\n',
      later: '# → Ask / A-002\n\n+ final request\n'
    })
  });

  assert_refused_without_write({ ...fixture, pattern: /non-final|later Ask|final unresolved/i });
});

node_test.test('append-wip refuses an Ask that already has a Reply', () => {
  const fixture = setup({
    text: notebook({
      body: '+ completed request\n',
      reply: '# ← Reply / A-001\n\ncompleted\n'
    })
  });

  assert_refused_without_write({ ...fixture, pattern: /closed|Reply/i });
});

node_test.test('append-wip refuses wrong WIP numbers and declared rounds', () => {
  const wrong_number = setup({ text: notebook({ body: `+ request\n\n${checkpoint(1, 'A-001', 'existing')}\n` }) });
  wrong_number.draft_file = write(wrong_number.root, 'wrong-number.md', checkpoint(1, 'A-001', 'duplicate'));
  assert_refused_without_write({ ...wrong_number, draft_path: 'wrong-number.md', pattern: /WIP.*(next|number|duplicate)/i });

  const wrong_round = setup({ text: notebook({ body: '+ request\n' }) });
  wrong_round.draft_file = write(wrong_round.root, 'wrong-round.md', checkpoint(2, 'A-002', 'wrong round'));
  assert_refused_without_write({ ...wrong_round, draft_path: 'wrong-round.md', pattern: /round/i });
});

node_test.test('append-wip refuses empty, multi-block, boundary-bearing, and bad-footer drafts without writing', () => {
  const valid = checkpoint(1, 'A-001');
  const cases = [
    ['empty', '', /empty/i],
    ['two WIPs', valid + checkpoint(2, 'A-001'), /exactly one|more than one|WIP/i],
    ['Ask heading', valid + '# → Ask / A-002\n', /Ask heading|boundary|draft/i],
    ['Reply heading', valid + '# ← Reply / A-001\n', /Reply heading|boundary|draft/i],
    ['STATUS heading', valid + '# STATUS\n', /STATUS|boundary|draft/i],
    ['bad footer', valid.replace(CHECKS, '- [x] over-engineering checked'), /verification|footer/i]
  ];

  for (const [label, content, pattern] of cases) {
    const fixture = setup();
    const draft_path = `${label.replace(/\s+/g, '-')}.md`;
    write(fixture.root, draft_path, content);
    assert_refused_without_write({ ...fixture, draft_path, pattern });
  }
});

node_test.test('append-wip supports the configured root notebook and a stream notebook with spaces', () => {
  for (const relative of ['.agentflow/devlog.md', 'features/stream with spaces/stream note.md']) {
    const fixture = setup({ relative });
    const result = run_writer(fixture.root, command(fixture.root, relative, fixture.draft_path));
    node_assert.equal(result.status, 0, `${relative}: ${failure_text(result)}`);
    node_assert.match(read_bytes(fixture.notebook_file).toString('utf8'), /\[WIP-001\]/);
  }
});

node_test.test('append-wip refuses absolute, traversal, duplicate, and symbolic-link paths without writing', () => {
  const traversal = setup();
  assert_refused_without_write({
    ...traversal,
    notebook_path: '../outside.md',
    snapshot_path: traversal.notebook_path,
    pattern: /traversal|repository-relative|inside/i
  });

  const absolute = setup();
  assert_refused_without_write({
    ...absolute,
    notebook_path: absolute.notebook_file,
    pattern: /absolute|repository-relative|inside/i
  });

  const duplicate = setup();
  assert_refused_without_write({
    ...duplicate,
    draft_path: duplicate.notebook_path,
    pattern: /same|duplicate|identity/i
  });

  const linked_notebook = setup();
  node_fs.symlinkSync(linked_notebook.notebook_file, node_path.join(linked_notebook.root, 'linked.md'));
  assert_refused_without_write({
    ...linked_notebook,
    notebook_path: 'linked.md',
    pattern: /symbolic|symlink|regular/i
  });

  const linked_draft = setup();
  node_fs.symlinkSync(linked_draft.draft_file, node_path.join(linked_draft.root, 'linked-draft.md'));
  assert_refused_without_write({
    ...linked_draft,
    draft_path: 'linked-draft.md',
    pattern: /symbolic|symlink|regular/i
  });
});

node_test.test('append-wip refuses oversized drafts without writing', () => {
  const fixture = setup();
  const oversized_path = 'oversized.md';
  write(fixture.root, oversized_path, Buffer.alloc(1024 * 1024 + 1, 0x78));
  assert_refused_without_write({ ...fixture, draft_path: oversized_path, pattern: /oversized|maximum|size/i });
});

node_test.test('two concurrent append-wip attempts cannot overwrite one another', () => {
  const fixture = setup({
    text: notebook({ body: `+ request\n\n${'x'.repeat(512 * 1024)}\n` })
  });
  const first = node_child_process.spawn(process.execPath, [SCRIPT, ...command(fixture.root, fixture.notebook_path, fixture.draft_path)], {
    cwd: fixture.root,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const second = node_child_process.spawn(process.execPath, [SCRIPT, ...command(fixture.root, fixture.notebook_path, fixture.draft_path)], {
    cwd: fixture.root,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  return Promise.all([
    new Promise(resolve => first.on('close', (code, signal) => resolve({ code, signal }))),
    new Promise(resolve => second.on('close', (code, signal) => resolve({ code, signal })))
  ]).then(results => {
    node_assert.equal(results.filter(result => result.code === 0).length, 1);
    node_assert.equal(results.filter(result => result.code !== 0).length, 1);
    const updated = read_bytes(fixture.notebook_file).toString('utf8');
    node_assert.equal((updated.match(/## \[WIP-001\]/g) || []).length, 1);
  });
});

node_test.test('append-reply closes only the exact final Ask and creates the next scaffold', () => {
  const root = make_root();
  const notebook_path = 'history.md';
  const old = notebook({
    ask_id: 'A-001',
    body: `+ old request\n\n${checkpoint(1, 'A-001', 'same footer')}`,
    reply: '# ← Reply / A-001\n\nold reply\n\n',
    later: `# → Ask / A-002\n\n+ current request\n\n${checkpoint(1, 'A-002', 'same footer')}`
  });
  const notebook_file = write(root, notebook_path, old, 0o640);
  const draft_path = 'reply.md';
  write(root, draft_path, reply('A-002', '## [SUMMARY]\n\n- Done.\n\n## [FINAL REPORT]\n\n- The checkpointed round is complete.\n\n## Questions (batched — each with a suggested default)\n\n- None.'));
  const before = read_bytes(notebook_file);

  const result = run_writer(root, reply_command(root, notebook_path, draft_path, 'A-002'));

  node_assert.equal(result.status, 0, failure_text(result));
  const after = read_bytes(notebook_file);
  node_assert.deepEqual(after.subarray(0, before.length), before);
  const text = after.toString('utf8');
  node_assert.equal((text.match(/# ← Reply \/ A-002/g) || []).length, 1);
  node_assert.match(text, /# ← Reply \/ A-002[\s\S]*---\n\n# → Ask \/ A-003\n\n\+\n$/u);
  node_assert.equal(node_fs.statSync(notebook_file).mode & 0o7777, 0o640);
  node_assert.equal(node_fs.existsSync(node_path.join(root, draft_path)), false);
});

node_test.test('append-reply refuses a candidate with missing checkpoint evidence before replacement', () => {
  const fixture = setup({
    text: notebook({ body: `+ request\n\n${checkpoint(1, 'A-001')}` })
  });
  write(fixture.root, 'ag.json', `${JSON.stringify(ag_settings.make_template('codex'), null, 2)}\n`);
  fixture.draft_file = write(fixture.root, 'reply.md', reply('A-001'));
  const before = read_bytes(fixture.notebook_file);
  const result = run_writer(fixture.root, reply_command(fixture.root, fixture.notebook_path, 'reply.md'));

  node_assert.equal(result.status, 1, failure_text(result));
  node_assert.match(failure_text(result), /candidate completion check failed|checkpoint|tracker/i);
  node_assert.deepEqual(read_bytes(fixture.notebook_file), before);
  node_assert.equal(node_fs.existsSync(fixture.draft_file), true);
});

node_test.test('successful write keeps a draft that was replaced before consume', () => {
  const fixture = setup();
  const original_rename = node_fs.renameSync;
  node_fs.renameSync = (from, to) => {
    original_rename(from, to);
    node_fs.writeFileSync(fixture.draft_file, 'replacement');
  };
  try {
    node_assert.throws(() => require('./notebook-write').append_wip({
      root: fixture.root,
      notebook: fixture.notebook_path,
      ask: 'A-001',
      input: fixture.draft_path
    }), /draft identity changed/i);
  } finally {
    node_fs.renameSync = original_rename;
  }
  node_assert.equal(node_fs.readFileSync(fixture.draft_file, 'utf8'), 'replacement');
});

node_test.test('append-reply rejects invalid targets and boundary-bearing drafts without changing bytes', () => {
  const cases = [
    ['wrong id', reply('A-002'), /does not match|Reply.*A-002/i],
    ['no heading', '## [SUMMARY]\n\n- Done.\n', /start|Reply heading/i],
    ['Ask heading', `${reply('A-001')}# → Ask / A-002\n`, /Ask heading|draft/i],
    ['STATUS heading', `${reply('A-001')}# STATUS\n`, /STATUS|draft/i],
    ['WIP heading', `${reply('A-001')}## [WIP-001] Checkpoint\n`, /WIP|draft/i],
    ['second Reply', `${reply('A-001')}# ← Reply / A-001\n`, /exactly one|second|Reply/i],
  ];
  for (const [label, content, pattern] of cases) {
    const fixture = setup();
    const draft_path = `${label.replaceAll(' ', '-')}.md`;
    write(fixture.root, draft_path, content);
    const before = read_bytes(fixture.notebook_file);
    const result = run_writer(fixture.root, reply_command(fixture.root, fixture.notebook_path, draft_path));
    node_assert.notEqual(result.status, 0, label);
    node_assert.match(failure_text(result), pattern, label);
    node_assert.deepEqual(read_bytes(fixture.notebook_file), before, label);
  }
});

node_test.test('append-reply rejects A-999 and a closed or older Ask without changing bytes', () => {
  const closed = setup({ text: notebook({ body: '+ done\n', reply: '# ← Reply / A-001\n\ndone\n' }) });
  write(closed.root, 'reply.md', reply('A-001'));
  let before = read_bytes(closed.notebook_file);
  let result = run_writer(closed.root, reply_command(closed.root, closed.notebook_path, 'reply.md'));
  node_assert.notEqual(result.status, 0);
  node_assert.deepEqual(read_bytes(closed.notebook_file), before);

  const last = setup({ text: notebook({ ask_id: 'A-999', body: '+ request\n' }) });
  write(last.root, 'reply.md', reply('A-999'));
  before = read_bytes(last.notebook_file);
  result = run_writer(last.root, reply_command(last.root, last.notebook_path, 'reply.md', 'A-999'));
  node_assert.notEqual(result.status, 0);
  node_assert.match(failure_text(result), /A-999|next Ask/i);
  node_assert.deepEqual(read_bytes(last.notebook_file), before);
});
