#!/usr/bin/env node
'use strict';

const node_crypto = require('node:crypto');
const node_fs = require('node:fs');
const node_path = require('node:path');
const { lint_round_boundaries, parse_devlog } = require('./round-linter');
const ag_settings = require('./ag-settings');

const MAX_FILE_BYTES = 1024 * 1024;
const LOCK_WAIT_MS = 5000;
const LOCK_POLL_MS = 10;
const ask_heading_pattern = /^# → Ask \/ (A-\d+)(?: \([^\)\r\n]*\))?[ \t]*\r?$/gmu;
const ask_like_pattern = /^[ \t]*# → Ask \/[^\r\n]*$/gmu;
const reply_like_pattern = /^[ \t]*(?:# ← Reply \/|## Reply \/)[^\r\n]*$/gmu;
const status_heading_pattern = /^[ \t]*# STATUS[ \t]*$/gmu;
const wip_like_pattern = /^[ \t]*## \[WIP-[^\r\n]*$/gmu;
const existing_wip_heading_pattern = /^## \[WIP-(\d{3})\] Checkpoint\b[^\r\n]*$/gmu;
const run_like_pattern = /^[ \t]*## \[RUN-[^\r\n]*$/gmu;
const existing_run_heading_pattern = /^## \[RUN-(\d{3})\] Event\b[^\r\n]*$/gmu;
const draft_run_heading_pattern = /^## \[RUN-(\d{3})\] Event\b[^\r\n]*\(during round (A-\d+)\)[ \t]*$/gmu;
const draft_wip_heading_pattern = /^## \[WIP-(\d{3})\] Checkpoint\b[^\r\n]*\(during round (A-\d+)\)[ \t]*$/gmu;
const draft_reply_heading_pattern = /^# ← Reply \/ (A-\d{3})[ \t]*\r?$/gmu;
const checkpoint_footers = new Set([
  '- **Checks:** [x] tracker.md | [x] devlog RUN | [x] scope matches tracker',
  'Checks: [x] tracker.md | [x] devlog RUN | [x] scope matches tracker',
  '[x] tracker.md | [x] devlog RUN | [x] scope matches tracker'
]);

const fail = message => {
  throw new Error(message);
};

const stat_identity = stat => ({
  dev: String(stat.dev),
  ino: String(stat.ino),
  size: String(stat.size),
  mode: String(stat.mode),
  mtime: String(stat.mtimeNs ?? stat.mtimeMs),
  ctime: String(stat.ctimeNs ?? stat.ctimeMs)
});

const same_identity = (left, right) => Object.keys(left).every(key => left[key] === right[key]);
const same_object = (left, right) => String(left.dev) === String(right.dev) && String(left.ino) === String(right.ino);

const descriptor_flags = () => {
  let flags = node_fs.constants.O_RDONLY;
  if (typeof node_fs.constants.O_NOFOLLOW === 'number') flags |= node_fs.constants.O_NOFOLLOW;
  return flags;
};

const valid_relative_path = (value, label) => {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} path is empty`);
  if (value.includes('\0') || /[\u0001-\u001f\u007f]/u.test(value)) fail(`${label} path contains a control character`);
  if (value.includes('\\') || node_path.posix.isAbsolute(value) || node_path.win32.isAbsolute(value) || /^[A-Za-z]:/u.test(value)) {
    fail(`${label} path must be repository-relative and not absolute`);
  }

  const parts = value.split('/');
  if (parts.some(part => part === '' || part === '.' || part === '..')) fail(`${label} path rejects traversal or empty path segments`);
  return parts;
};

const ensure_path_components = (root, absolute, label) => {
  const relative = node_path.relative(root, absolute);
  if (relative === '' || relative.startsWith(`..${node_path.sep}`) || relative === '..' || node_path.isAbsolute(relative)) {
    fail(`${label} path must stay inside the repository`);
  }

  let current = root;
  for (const part of relative.split(node_path.sep)) {
    current = node_path.join(current, part);
    let stat;
    try {
      stat = node_fs.lstatSync(current, { bigint: true });
    } catch (error) {
      fail(`${label} path is missing or unreadable`);
    }
    if (stat.isSymbolicLink()) fail(`${label} path contains a symbolic link`);
    if (current !== absolute && !stat.isDirectory()) fail(`${label} path has a non-directory parent`);
  }
};

const resolve_path = (root, value, label) => {
  valid_relative_path(value, label);
  const absolute = node_path.resolve(root, value);
  ensure_path_components(root, absolute, label);
  return absolute;
};

const read_regular_file = (file, label) => {
  let checked;
  try {
    checked = node_fs.lstatSync(file, { bigint: true });
  } catch (error) {
    fail(`${label} is missing or unreadable`);
  }
  if (checked.isSymbolicLink()) fail(`${label} must be a regular non-symbolic-link file`);
  if (!checked.isFile()) fail(`${label} must be a regular non-symbolic-link file`);
  if (checked.size > BigInt(MAX_FILE_BYTES)) fail(`${label} is oversized; maximum is ${MAX_FILE_BYTES} bytes`);

  let descriptor = null;
  let content;
  let close_error = null;
  try {
    descriptor = node_fs.openSync(file, descriptor_flags());
    const opened = node_fs.fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || !same_identity(stat_identity(checked), stat_identity(opened))) {
      fail(`${label} identity changed before reading`);
    }

    const chunks = [];
    let total = 0;
    while (true) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, MAX_FILE_BYTES + 1 - total));
      const bytes_read = node_fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytes_read === 0) break;
      total += bytes_read;
      if (total > MAX_FILE_BYTES) fail(`${label} is oversized; maximum is ${MAX_FILE_BYTES} bytes`);
      chunks.push(buffer.subarray(0, bytes_read));
    }

    const final_stat = node_fs.fstatSync(descriptor, { bigint: true });
    if (!final_stat.isFile() || !same_identity(stat_identity(opened), stat_identity(final_stat)) || total !== Number(opened.size)) {
      fail(`${label} changed while reading`);
    }
    content = Buffer.concat(chunks, total);
    if (!Buffer.from(content.toString('utf8'), 'utf8').equals(content)) fail(`${label} is not valid UTF-8`);
  } catch (error) {
    if (error instanceof Error && error.message) throw error;
    fail(`${label} is unreadable`);
  } finally {
    if (descriptor !== null) {
      try {
        node_fs.closeSync(descriptor);
      } catch (error) {
        close_error = error;
      }
    }
  }
  if (close_error !== null) fail(`${label} descriptor close failed`);

  return {
    content,
    text: content.toString('utf8'),
    identity: stat_identity(checked),
    mode: Number(checked.mode & 0o7777n),
    hash: node_crypto.createHash('sha256').update(content).digest('hex')
  };
};

const read_standard_input = () => {
  const chunks = [];
  let total = 0;
  while (true) {
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, MAX_FILE_BYTES + 1 - total));
    const bytes_read = node_fs.readSync(0, buffer, 0, buffer.length, null);
    if (bytes_read === 0) break;
    total += bytes_read;
    if (total > MAX_FILE_BYTES) fail(`standard input is oversized; maximum is ${MAX_FILE_BYTES} bytes`);
    chunks.push(buffer.subarray(0, bytes_read));
  }
  const content = Buffer.concat(chunks, total);
  if (!Buffer.from(content.toString('utf8'), 'utf8').equals(content)) fail('standard input is not valid UTF-8');
  return { content, text: content.toString('utf8') };
};

const line_ending_for = content => content.includes(Buffer.from('\r\n')) ? '\r\n' : '\n';

const normalized_lines = text => {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
};

const reject_draft_boundaries = draft_text => {
  if (ask_like_pattern.test(draft_text)) fail('draft contains an Ask heading');
  if (reply_like_pattern.test(draft_text)) fail('draft contains a Reply heading');
  if (status_heading_pattern.test(draft_text)) fail('draft contains a STATUS heading');
};

const parse_draft = (draft_text, ask_id, expected_number) => {
  if (draft_text.trim().length === 0) fail('draft is empty');
  reject_draft_boundaries(draft_text);

  const candidates = [...draft_text.matchAll(wip_like_pattern)];
  const headings = [...draft_text.matchAll(draft_wip_heading_pattern)];
  if (candidates.length !== 1 || headings.length !== 1) fail('draft must contain exactly one complete WIP heading');
  if (headings[0].index !== 0) fail('draft must start with its WIP heading');

  const [heading] = headings;
  const number = Number(heading[1]);
  const declared_round = heading[2];
  if (declared_round !== ask_id) fail(`draft declared round ${declared_round} does not match ${ask_id}`);
  if (number !== expected_number) fail(`draft WIP number must be WIP-${String(expected_number).padStart(3, '0')}`);

  const lines = normalized_lines(draft_text);
  const final_line = lines.at(-1);
  if (!checkpoint_footers.has(final_line)) fail('draft must end with the exact checkpoint verification line');
  if (lines.length === 0 || final_line === undefined) fail('draft is empty');
  return { number };
};

const parse_reply_draft = (draft_text, ask_id) => {
  if (draft_text.trim().length === 0) fail('draft is empty');
  const replies = [...draft_text.matchAll(reply_like_pattern)];
  const headings = [...draft_text.matchAll(draft_reply_heading_pattern)];
  if (replies.length !== 1 || headings.length !== 1) fail('draft must contain exactly one complete Reply heading');
  if (headings[0].index !== 0) fail('draft must start with its Reply heading');
  if (headings[0][1] !== ask_id) fail(`draft Reply ${headings[0][1]} does not match ${ask_id}`);
  const body = draft_text.slice(headings[0][0].length);
  if (ask_like_pattern.test(body)) fail('draft contains an Ask heading');
  if (status_heading_pattern.test(body)) fail('draft contains a STATUS heading');
  if (wip_like_pattern.test(body)) fail('draft contains a WIP heading');
};

const parse_run_draft = (draft_text, ask_id, expected_number) => {
  if (draft_text.trim().length === 0) fail('draft is empty');
  reject_draft_boundaries(draft_text);
  if (wip_like_pattern.test(draft_text)) fail('RUN draft contains a WIP heading');
  const candidates = [...draft_text.matchAll(run_like_pattern)];
  const headings = [...draft_text.matchAll(draft_run_heading_pattern)];
  if (candidates.length !== 1 || headings.length !== 1) fail('draft must contain exactly one complete RUN heading');
  if (headings[0].index !== 0) fail('draft must start with its RUN heading');
  if (headings[0][2] !== ask_id) fail(`draft declared round ${headings[0][2]} does not match ${ask_id}`);
  if (Number(headings[0][1]) !== expected_number) fail(`draft RUN number must be RUN-${String(expected_number).padStart(3, '0')}`);
  if (draft_text.slice(headings[0][0].length).trim().length === 0) fail('RUN event body is empty');
};

const inspect_notebook = (notebook_text, ask_id) => {
  const boundary_check = lint_round_boundaries(notebook_text);
  if (boundary_check.status === 'fail') fail(`notebook round-boundary check failed: ${boundary_check.detail}`);
  const parsed = parse_devlog(notebook_text);
  const asks = [...notebook_text.matchAll(ask_heading_pattern)];
  const ask_like = [...notebook_text.matchAll(ask_like_pattern)];
  if (ask_like.length !== asks.length) fail('notebook contains an ambiguous Ask heading');

  const matching = asks.filter(match => match[1] === ask_id);
  if (matching.length === 0) fail(`notebook has no Ask ${ask_id}`);
  if (matching.length > 1) fail(`notebook has duplicate Ask ${ask_id}`);
  const target = matching[0];
  const target_index = asks.indexOf(target);
  if (target_index !== asks.length - 1) fail(`Ask ${ask_id} is non-final; an existing later Ask prevents the write`);

  const span_end = target_index + 1 < asks.length ? asks[target_index + 1].index : notebook_text.length;
  const target_span = notebook_text.slice(target.index, span_end);
  const target_body = target_span.slice(target[0].length);
  if (parsed.last_round !== target_span) fail(`Ask ${ask_id} is not the final unresolved round`);
  if (target_body.trim() === '' || target_body.trim() === '+') fail(`Ask ${ask_id} is empty`);
  if (reply_like_pattern.test(target_body)) fail(`Ask ${ask_id} is closed because it already has a Reply`);

  const existing_candidates = [...target_body.matchAll(wip_like_pattern)];
  const existing_headings = [...target_body.matchAll(existing_wip_heading_pattern)];
  if (existing_candidates.length !== existing_headings.length) fail(`Ask ${ask_id} has an ambiguous WIP heading`);
  const numbers = existing_headings.map(match => Number(match[1]));
  if (numbers.some(number => number === 0)) fail(`Ask ${ask_id} contains invalid WIP-000`);
  if (new Set(numbers).size !== numbers.length) fail(`Ask ${ask_id} contains duplicate WIP numbers`);
  if (numbers.some((number, index) => index > 0 && number < numbers[index - 1])) fail(`Ask ${ask_id} WIPs are out of physical order`);
  const run_candidates = [...target_body.matchAll(run_like_pattern)];
  const run_headings = [...target_body.matchAll(existing_run_heading_pattern)];
  if (run_candidates.length !== run_headings.length) fail(`Ask ${ask_id} has an ambiguous RUN heading`);
  const run_numbers = run_headings.map(match => Number(match[1]));
  if (run_numbers.some(number => number === 0)) fail(`Ask ${ask_id} contains invalid RUN-000`);
  if (new Set(run_numbers).size !== run_numbers.length) fail(`Ask ${ask_id} contains duplicate RUN numbers`);
  if (run_numbers.some((number, index) => index > 0 && number < run_numbers[index - 1])) fail(`Ask ${ask_id} RUN events are out of physical order`);

  return {
    ask: target,
    span_end,
    target_span,
    next_number: numbers.length === 0 ? 1 : Math.max(...numbers) + 1,
    next_run_number: run_numbers.length === 0 ? 1 : Math.max(...run_numbers) + 1
  };
};

const build_candidate = (notebook, draft) => {
  const separator = notebook.content.length === 0
    ? ''
    : notebook.content.subarray(-2).equals(Buffer.from('\n\n'))
      ? ''
      : notebook.content.subarray(-1).equals(Buffer.from('\n'))
        ? line_ending_for(notebook.content)
        : line_ending_for(notebook.content).repeat(2);
  const ending = draft.content.subarray(-1).equals(Buffer.from('\n')) ? '' : line_ending_for(notebook.content);
  return Buffer.concat([notebook.content, Buffer.from(separator), draft.content, Buffer.from(ending)]);
};

const acquire_lock = lock_path => {
  const started = Date.now();
  while (true) {
    try {
      return node_fs.openSync(lock_path, node_fs.constants.O_CREAT | node_fs.constants.O_EXCL | node_fs.constants.O_WRONLY, 0o600);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() - started >= LOCK_WAIT_MS) fail('another notebook writer is still active');
      if (typeof Atomics.wait === 'function') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_POLL_MS);
    }
  }
};

const remove_if_present = file => {
  try {
    node_fs.unlinkSync(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
};

const verify_notebook_unchanged = (file, original) => {
  let current;
  try {
    current = read_regular_file(file, 'notebook');
  } catch (error) {
    fail(`notebook identity changed before replace: ${error.message}`);
  }
  if (!same_identity(current.identity, original.identity) || current.hash !== original.hash) {
    fail('notebook identity changed between read and replace');
  }
};

const consume_unchanged_draft = (file, original) => {
  let current;
  try {
    current = read_regular_file(file, 'draft');
  } catch (error) {
    fail(`draft identity changed before consume: ${error.message}`);
  }
  if (!same_identity(current.identity, original.identity) || current.hash !== original.hash) {
    fail('draft identity changed before consume');
  }
  node_fs.unlinkSync(file);
};

const atomic_replace = (file, content, mode) => {
  const temporary = `${file}.${process.pid}.${Date.now()}.${node_crypto.randomBytes(8).toString('hex')}.tmp`;
  let descriptor = null;
  let renamed = false;
  try {
    descriptor = node_fs.openSync(temporary, node_fs.constants.O_CREAT | node_fs.constants.O_EXCL | node_fs.constants.O_WRONLY, 0o600);
    node_fs.writeFileSync(descriptor, content);
    node_fs.fsyncSync(descriptor);
    node_fs.closeSync(descriptor);
    descriptor = null;
    node_fs.chmodSync(temporary, mode);
    const temporary_stat = node_fs.lstatSync(temporary, { bigint: true });
    if (Number(temporary_stat.mode & 0o7777n) !== mode) fail('temporary notebook mode could not be preserved');
    node_fs.renameSync(temporary, file);
    renamed = true;
  } finally {
    if (descriptor !== null) {
      try { node_fs.closeSync(descriptor); } catch (error) { /* keep the write error */ }
    }
    if (!renamed) remove_if_present(temporary);
  }
};

const append_wip = ({ root = process.cwd(), notebook: notebook_path, ask, input: draft_path, input_stdin = false } = {}) => {
  const repository_root = node_fs.realpathSync(root);
  const notebook_file = resolve_path(repository_root, notebook_path, 'notebook');
  const notebook = read_regular_file(notebook_file, 'notebook');
  const draft_file = input_stdin ? null : resolve_path(repository_root, draft_path, 'draft');
  const draft = input_stdin ? read_standard_input() : read_regular_file(draft_file, 'draft');

  if (!input_stdin && same_object(notebook.identity, draft.identity)) fail('notebook and draft refer to the same file identity');
  if (!input_stdin && notebook_file === draft_file) fail('notebook and draft paths must be different');
  if (typeof ask !== 'string' || !/^A-\d{3}$/u.test(ask)) fail('Ask must use the exact A-NNN form');

  const inspected = inspect_notebook(notebook.text, ask);
  parse_draft(draft.text, ask, inspected.next_number);
  const candidate = build_candidate(notebook, draft);
  const candidate_text = candidate.toString('utf8');
  const candidate_parse = parse_devlog(candidate_text);
  if (!candidate_parse.last_round.includes(draft.text.trimEnd())) fail('candidate notebook did not preserve the complete WIP draft');
  const candidate_boundary_check = lint_round_boundaries(candidate_text);
  if (candidate_boundary_check.status === 'fail') fail(`candidate round-boundary check failed: ${candidate_boundary_check.detail}`);

  const lock_path = `${notebook_file}.append-wip.lock`;
  let lock_descriptor = null;
  try {
    lock_descriptor = acquire_lock(lock_path);
    verify_notebook_unchanged(notebook_file, notebook);
    atomic_replace(notebook_file, candidate, notebook.mode);
    if (!input_stdin) consume_unchanged_draft(draft_file, draft);
  } finally {
    if (lock_descriptor !== null) {
      try { node_fs.closeSync(lock_descriptor); } finally { remove_if_present(lock_path); }
    }
  }

  return { notebook: notebook_path, ask, input: input_stdin ? 'stdin' : draft_path };
};

const append_run = ({ root = process.cwd(), notebook: notebook_path, ask, input: draft_path, input_stdin = false } = {}) => {
  const repository_root = node_fs.realpathSync(root);
  const notebook_file = resolve_path(repository_root, notebook_path, 'notebook');
  const notebook = read_regular_file(notebook_file, 'notebook');
  const draft_file = input_stdin ? null : resolve_path(repository_root, draft_path, 'draft');
  const draft = input_stdin ? read_standard_input() : read_regular_file(draft_file, 'draft');
  if (!input_stdin && same_object(notebook.identity, draft.identity)) fail('notebook and draft refer to the same file identity');
  if (typeof ask !== 'string' || !/^A-\d{3}$/u.test(ask)) fail('Ask must use the exact A-NNN form');
  const inspected = inspect_notebook(notebook.text, ask);
  parse_run_draft(draft.text, ask, inspected.next_run_number);
  const candidate = build_candidate(notebook, draft);
  const boundary_check = lint_round_boundaries(candidate.toString('utf8'));
  if (boundary_check.status === 'fail') fail(`candidate round-boundary check failed: ${boundary_check.detail}`);
  const lock_path = `${notebook_file}.append-run.lock`;
  let lock_descriptor = null;
  try {
    lock_descriptor = acquire_lock(lock_path);
    verify_notebook_unchanged(notebook_file, notebook);
    atomic_replace(notebook_file, candidate, notebook.mode);
    if (!input_stdin) consume_unchanged_draft(draft_file, draft);
  } finally {
    if (lock_descriptor !== null) {
      try { node_fs.closeSync(lock_descriptor); } finally { remove_if_present(lock_path); }
    }
  }
  return { notebook: notebook_path, ask, input: input_stdin ? 'stdin' : draft_path };
};

const append_reply = ({ root = process.cwd(), notebook: notebook_path, ask, input: draft_path, input_stdin = false } = {}) => {
  const repository_root = node_fs.realpathSync(root);
  const notebook_file = resolve_path(repository_root, notebook_path, 'notebook');
  const notebook = read_regular_file(notebook_file, 'notebook');
  const draft_file = input_stdin ? null : resolve_path(repository_root, draft_path, 'draft');
  const draft = input_stdin ? read_standard_input() : read_regular_file(draft_file, 'draft');

  if (!input_stdin && same_object(notebook.identity, draft.identity)) fail('notebook and draft refer to the same file identity');
  if (!input_stdin && notebook_file === draft_file) fail('notebook and draft paths must be different');
  if (typeof ask !== 'string' || !/^A-\d{3}$/u.test(ask)) fail('Ask must use the exact A-NNN form');
  if (ask === 'A-999') fail('A-999 cannot be closed because the next Ask identifier is unavailable');

  inspect_notebook(notebook.text, ask);
  parse_reply_draft(draft.text, ask);
  const newline = line_ending_for(notebook.content);
  const base = build_candidate(notebook, draft);
  const next_id = `A-${String(Number(ask.slice(2)) + 1).padStart(3, '0')}`;
  const scaffold = `${newline}---${newline}${newline}# → Ask / ${next_id}${newline}${newline}+${newline}`;
  const candidate = Buffer.concat([base, Buffer.from(scaffold)]);
  const candidate_text = candidate.toString('utf8');
  const boundary_check = lint_round_boundaries(candidate_text);
  if (boundary_check.status === 'fail') fail(`candidate round-boundary check failed: ${boundary_check.detail}`);
  if (!candidate_text.endsWith(`# → Ask / ${next_id}${newline}${newline}+${newline}`)) {
    fail('candidate notebook did not end with the exact next empty Ask scaffold');
  }

  const lock_path = `${notebook_file}.append-reply.lock`;
  let lock_descriptor = null;
  try {
    lock_descriptor = acquire_lock(lock_path);
    verify_notebook_unchanged(notebook_file, notebook);
    const { validate_candidate } = require('./completion-context');
    const repository_notebook = node_path.relative(repository_root, notebook_file).split(node_path.sep).join('/');
    const config_file = ag_settings.active_config_path(repository_root, repository_notebook);
    const candidate_result = validate_candidate({
      devlog_text: candidate_text,
      context: node_fs.existsSync(config_file)
        ? {
          project_root: repository_root,
          notebook_path: repository_notebook,
          config_path: config_file,
          ignore_paths: [node_path.relative(repository_root, lock_path)]
        }
        : {}
    });
    const blocking = candidate_result.checks.filter(check => check.status === 'fail');
    if (blocking.length > 0) fail(`candidate completion check failed: ${blocking.map(check => `${check.id}: ${check.detail}`).join('; ')}`);
    atomic_replace(notebook_file, candidate, notebook.mode);
    if (!input_stdin) consume_unchanged_draft(draft_file, draft);
  } finally {
    if (lock_descriptor !== null) {
      try { node_fs.closeSync(lock_descriptor); } finally { remove_if_present(lock_path); }
    }
  }

  return { notebook: notebook_path, ask, input: input_stdin ? 'stdin' : draft_path };
};

const parse_args = argv => {
  const command = argv[0];
  const usage = 'usage: node skills/agentflow/scripts/notebook-write.js <append-run|append-wip|append-reply> --notebook <path> --ask <A-NNN> --input-stdin; fallback only after --input-stdin fails: --input <draft>';
  if (!['append-run', 'append-wip', 'append-reply'].includes(command)) fail(usage);
  const values = {};
  for (let index = 1; index < argv.length;) {
    const flag = argv[index];
    if (!['--notebook', '--ask', '--input', '--input-stdin'].includes(flag)) fail(usage);
    if (Object.hasOwn(values, flag)) fail(`duplicate option ${flag}`);
    if (flag === '--input-stdin') {
      values[flag] = true;
      index += 1;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) fail(usage);
    values[flag] = value;
    index += 2;
  }
  if (!Object.hasOwn(values, '--notebook') || !Object.hasOwn(values, '--ask')) fail(usage);
  if (Boolean(values['--input']) === Boolean(values['--input-stdin'])) fail(`${usage}; --input and --input-stdin are mutually exclusive`);
  return { command, notebook: values['--notebook'], ask: values['--ask'], input: values['--input'], input_stdin: values['--input-stdin'] === true };
};

const run = argv => {
  try {
    const args = parse_args(argv);
    const result = args.command === 'append-reply' ? append_reply(args) : args.command === 'append-run' ? append_run(args) : append_wip(args);
    console.log(`${result.notebook} updated`);
    return 0;
  } catch (error) {
    const message = String(error?.message ?? error).replace(/[\r\n]+/gu, ' ');
    console.error(`Error: ${message}`);
    return 1;
  }
};

module.exports = { append_run, append_wip, append_reply, parse_args, run };

if (require.main === module) process.exitCode = run(process.argv.slice(2));
