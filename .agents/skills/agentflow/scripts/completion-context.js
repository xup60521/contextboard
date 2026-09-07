'use strict';

const node_fs = require('node:fs');
const node_path = require('node:path');
const { execFileSync } = require('node:child_process');
const { lint_round, parse_devlog } = require('./round-linter');
const tracker_contract = require('./tracker-contract.js');

const edit_tool_names = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const devlog_file_pattern = /(^|[\\/])[^\\/]*devlog[^\\/]*\.md$/i;

const git = (project_root, args) => {
  try {
    return execFileSync('git', args, {
      cwd: project_root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trimEnd();
  } catch (error) {
    return '';
  }
};

const git_succeeds = (project_root, args) => {
  try {
    execFileSync('git', args, { cwd: project_root, stdio: 'ignore' });
    return true;
  } catch (error) {
    return false;
  }
};

const regular_files_named = (root, name, depth = 0) => {
  if (depth > 5) return [];
  let entries;
  try {
    entries = node_fs.readdirSync(root, { withFileTypes: true });
  } catch (error) {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === '.worktrees' || entry.name === 'node_modules') continue;
    const file = node_path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...regular_files_named(file, name, depth + 1));
    else if (entry.isFile() && entry.name === name) files.push(file);
  }
  return files;
};

const parse_porcelain_paths = output => {
  const paths = [];
  const records = output.split('\0');
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 4) continue;
    const status = record.slice(0, 2);
    const file = record.slice(3);
    if (file.length > 0) paths.push(file);
    if (status.includes('R') || status.includes('C')) index += 1;
  }
  return paths;
};

const changed_line_count = (project_root, baseline, working_files) => {
  if (!/^[0-9a-f]{40}$/u.test(baseline)) return Number.POSITIVE_INFINITY;
  const rows = git(project_root, ['diff', '--numstat', baseline]).split(/\r?\n/u).filter(Boolean);
  let total = 0;
  for (const row of rows) {
    const [added, removed] = row.split('\t');
    if (!/^\d+$/u.test(added) || !/^\d+$/u.test(removed)) return Number.POSITIVE_INFINITY;
    total += Number(added) + Number(removed);
  }
  const untracked = new Set(git(project_root, ['ls-files', '--others', '--exclude-standard']).split(/\r?\n/u).filter(Boolean));
  for (const relative of working_files.filter(file => untracked.has(file))) {
    try {
      const stat = node_fs.statSync(node_path.join(project_root, relative));
      if (!stat.isFile() || stat.size > 1024 * 1024) return Number.POSITIVE_INFINITY;
      const text = node_fs.readFileSync(node_path.join(project_root, relative), 'utf8');
      total += text.length === 0 ? 0 : text.split(/\r?\n/u).length;
    } catch (error) {
      return Number.POSITIVE_INFINITY;
    }
  }
  return total;
};

const current_round_info = devlog_text => {
  const parsed = parse_devlog(devlog_text);
  const current_round = parsed.rounds.find(round => round.text === parsed.last_round);
  const ask_id = current_round?.id;
  return { parsed, current_round, ask_id };
};

const escape_regexp = value => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

const completed_cleanup_boundary = (project_root, current_round, workspace_dir, committed_files) => {
  const ask_text = current_round?.ask_text ?? '';
  if (!/\bclean(?:up|ed|ing)?\b/iu.test(ask_text) || typeof workspace_dir !== 'string' || workspace_dir.length === 0) return undefined;
  const root = workspace_dir.replace(/\/+$/u, '');
  const feature_pattern = new RegExp(`^${escape_regexp(root)}/features/([^/]+)/\\1\\.devlog\\.md$`, 'u');
  const candidates = committed_files.flatMap(file => {
    const match = feature_pattern.exec(file);
    return match === null ? [] : [{ file, key: match[1] }];
  }).filter(({ key }) => new RegExp(`(^|[^A-Za-z0-9_-])${escape_regexp(key)}($|[^A-Za-z0-9_-])`, 'u').test(ask_text));
  if (candidates.length !== 1) return undefined;

  const { file, key } = candidates[0];
  let text;
  try {
    text = node_fs.readFileSync(node_path.join(project_root, file), 'utf8');
  } catch (error) {
    return undefined;
  }
  const marker = `Feature: ${key} — closed`;
  if (text.split(/\r?\n/u).filter(line => line === marker).length !== 1) return undefined;
  if (git_succeeds(project_root, ['show-ref', '--verify', '--quiet', `refs/heads/${key}`])) return undefined;
  if (node_fs.existsSync(node_path.join(project_root, '.worktrees', key))) return undefined;

  const boundary = git(project_root, ['log', '-1', '--format=%H', '-S', marker, '--', file]);
  if (!/^[0-9a-f]{40}$/u.test(boundary)) return undefined;
  if (!git_succeeds(project_root, ['merge-base', '--is-ancestor', boundary, 'HEAD'])) return undefined;
  return boundary;
};

const read_transcript_entries = transcript_path => {
  try {
    return node_fs
      .readFileSync(transcript_path, 'utf8')
      .split(/\r?\n/u)
      .reduce((entries, line) => {
        if (line.trim().length === 0) return entries;
        try {
          entries.push(JSON.parse(line));
        } catch (error) {
          // A malformed transcript line is skipped, never fatal.
        }
        return entries;
      }, []);
  } catch (error) {
    return [];
  }
};

const content_blocks = entry => {
  const content = entry && entry.message && entry.message.content;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return Array.isArray(content) ? content : [];
};

const is_owner_prompt = entry =>
  entry && entry.type === 'user' && !content_blocks(entry).some(block => block && block.type === 'tool_result');

const gather_terminal_output = transcript_path => {
  if (!transcript_path) return undefined;
  const entries = read_transcript_entries(transcript_path);
  if (entries.length === 0) return undefined;

  let turn_start = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (is_owner_prompt(entries[index])) {
      turn_start = index + 1;
      break;
    }
  }

  const turn = entries.slice(turn_start);
  const devlog_edited = turn.some(entry =>
    entry.type === 'assistant' &&
    content_blocks(entry).some(block =>
      block &&
      block.type === 'tool_use' &&
      edit_tool_names.has(block.name) &&
      block.input &&
      typeof block.input.file_path === 'string' &&
      devlog_file_pattern.test(block.input.file_path)));
  if (!devlog_edited) return undefined;

  const last_assistant = [...turn].reverse().find(entry => entry.type === 'assistant');
  if (!last_assistant) return undefined;
  const text = content_blocks(last_assistant)
    .filter(block => block && block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('')
    .trim();
  return text.length === 0 ? undefined : text;
};

const gather_push = project_root => {
  const remote_exists = git(project_root, ['remote']).length > 0;
  const head = git(project_root, ['rev-parse', 'HEAD']);
  const branch = git(project_root, ['branch', '--show-current']);

  if (!remote_exists) return { remote_exists: false, exit_code: 0, head, branch, upstream: '', unpushed_count: 0 };

  const upstream = git(project_root, ['rev-parse', '--abbrev-ref', '@{u}']);
  if (upstream.length === 0) return { remote_exists: true, exit_code: 1, head, branch, upstream, unpushed_count: null };

  const unpushed = git(project_root, ['rev-list', '@{u}..HEAD', '--count']);
  return {
    remote_exists: true,
    exit_code: unpushed === '0' ? 0 : 1,
    head,
    branch,
    upstream,
    unpushed_count: /^\d+$/u.test(unpushed) ? Number(unpushed) : null
  };
};

const tracker_candidates = (project_root, ask_id) => regular_files_named(project_root, 'tracker.md').filter(file => {
  try {
    return new RegExp(`^- \\*\\*Active Ask:\\*\\*.*\\b${ask_id}\\b`, 'mu').test(node_fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return false;
  }
});

const tracker_facts = (project_root, current_round, ask_id) => {
  if (ask_id === undefined || current_round === undefined) return { tracker: undefined, work: undefined };
  const has_checkpoint = /^## \[WIP-\d+\] Checkpoint\b/mu.test(current_round.wip_text);
  const matches = tracker_candidates(project_root, ask_id);
  if (matches.length === 0) {
    return {
      tracker: has_checkpoint ? { required: true, path: 'missing', work_root: 'missing' } : undefined,
      work: has_checkpoint ? { ask_id, work_key: undefined, root: undefined, tracker_path: undefined } : undefined
    };
  }
  if (matches.length > 1) {
    return {
      tracker: { required: true, path: 'ambiguous', work_root: 'ambiguous' },
      work: { ask_id, work_key: undefined, root: undefined, tracker_path: undefined }
    };
  }

  const tracker_path = matches[0];
  const relative = node_path.relative(project_root, tracker_path).split(node_path.sep).join('/');
  const root = node_path.posix.dirname(relative);
  return {
    tracker: tracker_contract.validation_facts({ repo: project_root, tracker: tracker_path }),
    work: {
      ask_id,
      work_key: node_path.posix.basename(root),
      root,
      tracker_path: relative
    }
  };
};

const gather_checkpoint_verification = (project_root, devlog_text, work, config_path) => {
  const { current_round, ask_id } = current_round_info(devlog_text);
  if (current_round === undefined || ask_id === undefined) return undefined;
  const checkpoints = [...current_round.wip_text.matchAll(/^## \[WIP-\d+\] Checkpoint — (\d{4}-\d{2}-\d{2} \d{2}:\d{2})/gmu)];
  if (checkpoints.length === 0) return undefined;

  const latest_checkpoint_minute = checkpoints.at(-1)[1];
  const before_checkpoint = current_round.wip_text.slice(0, checkpoints.at(-1).index);
  const run_events = [...before_checkpoint.matchAll(/^## \[RUN-\d+\] Event — \d{4}-\d{2}-\d{2} \d{2}:\d{2}[^\r\n]*$/gmu)];
  const tracker_path = work?.tracker_path === undefined ? undefined : node_path.resolve(project_root, work.tracker_path);
  let tracker_text = '';
  try {
    tracker_text = tracker_path === undefined ? '' : node_fs.readFileSync(tracker_path, 'utf8');
  } catch (error) {
    tracker_text = '';
  }
  const tracker_stamp = /^- \*\*Last update:\*\* (\d{4}-\d{2}-\d{2} \d{2}:\d{2}):\d{2} Asia\/Taipei\.$/mu.exec(tracker_text)?.[1];

  return {
    required: true,
    tracker_current: tracker_stamp !== undefined && tracker_stamp >= latest_checkpoint_minute,
    run_current: run_events.length > 0,
    progress_current: true,
    scope_checked: /^- \*\*Scope check:\*\*\s+\S/mu.test(before_checkpoint)
  };
};

const review_decision = (project_root, notebook_path, devlog_text, workspace_dir, config_path, git_facts) => {
  const notebook_name = node_path.basename(notebook_path, node_path.extname(notebook_path));
  const notebook_directory = node_path.posix.dirname(notebook_path);
  const { current_round, ask_id } = current_round_info(devlog_text);
  if (current_round === undefined || ask_id === undefined) {
    return { error: 'completed round has no Ask identifier for its review decision' };
  }
  const ask_text = current_round.ask_text ?? '';
  const prior_replies = git_facts.parsed.rounds.slice(0, current_round.index).filter(round => round.reply_text.length > 0).map(round => round.id);
  let changed_files = git_facts.changed_files;
  if (prior_replies.length === 0) {
    const committed = git(project_root, ['ls-files']).split('\n').filter(Boolean);
    changed_files = [...new Set([...committed, ...git_facts.working_files])];
  }
  const record_files = [
    notebook_path,
    node_path.posix.join(notebook_directory, `.${notebook_name}.audit.md`),
    node_path.posix.join(notebook_directory, `${notebook_name}.archive.md`)
  ];
  const record_roots = typeof workspace_dir === 'string' && workspace_dir.length > 0
    ? [`${workspace_dir.replace(/\/+$/u, '')}/`]
    : ['artifacts/', 'features/'];
  const configuration_files = [config_path === undefined
    ? 'ag.json'
    : node_path.relative(project_root, config_path).split(node_path.sep).join('/')];
  const implementation_files = changed_files.filter(file =>
    !record_files.includes(file) && !record_roots.some(root => file.startsWith(root))
  );
  const skip_tradeoff = /^\s*(?:\+\s*)?skip-review:\s*(\S[^\r\n]*)$/imu.exec(ask_text)?.[1]?.trim();
  if (skip_tradeoff) {
    return {
      status: 'skip-review',
      reason: `owner authorized final review skip: ${skip_tradeoff}`,
      owner_authorized: true
    };
  }
  const bootstrap_bookkeeping_only = prior_replies.length === 0 && changed_files.length > 0 && changed_files.every(file =>
    file === '.gitignore' || configuration_files.includes(file) || record_files.includes(file) || record_roots.some(root => file.startsWith(root))
  );
  const implementation_changed = !bootstrap_bookkeeping_only && changed_files.some(file =>
    configuration_files.includes(file) || (!record_files.includes(file) && !record_roots.some(root => file.startsWith(root)))
  );
  if (implementation_changed) return { status: 'required', reason: 'source, test, configuration, or user-document change detected from Git' };
  return {
    status: 'not-requested',
    reason: 'no source, test, configuration, or user-document change',
    changed_files,
    record_files,
    record_roots,
    configuration_files,
    bootstrap_bookkeeping_only
  };
};

const collect = ({
  project_root = process.cwd(),
  notebook_path = 'devlog.md',
  config_path,
  active_host,
  devlog_text,
  transcript_path,
  terminal_output,
  require_status_projection,
  now_ms = Date.now(),
  ignore_paths = []
} = {}) => {
  const root = node_path.resolve(project_root);
  const { parsed, current_round, ask_id } = current_round_info(devlog_text ?? '');
  const config_file = config_path === undefined ? node_path.join(root, 'ag.json') : config_path;
  let workspace_dir;
  try {
    workspace_dir = JSON.parse(node_fs.readFileSync(config_file, 'utf8'))?.switches?.['workspace-dir'];
  } catch (error) {
    workspace_dir = undefined;
  }

  const record = tracker_facts(root, current_round, ask_id);
  const push = gather_push(root);
  const status_output = terminal_output !== undefined ? terminal_output : gather_terminal_output(transcript_path);
  const git_status = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const ignored = new Set(ignore_paths.map(file => String(file).split(node_path.sep).join('/')));
  const working_files = parse_porcelain_paths(git_status).filter(file => !ignored.has(file));
  const baseline_round = current_round?.index === undefined ? undefined : parsed.rounds.slice(0, current_round.index).filter(round => round.reply_text.length > 0).at(-1);
  const baseline = baseline_round === undefined
    ? ''
    : git(root, ['log', '-1', '--format=%H', '-S', `# ← Reply / ${baseline_round.id}`, '--', notebook_path]);
  const baseline_committed_files = /^[0-9a-f]{40}$/u.test(baseline)
    ? git(root, ['diff', '--name-only', `${baseline}..HEAD`]).split('\n').filter(Boolean)
    : [];
  const cleanup_boundary = completed_cleanup_boundary(root, current_round, workspace_dir, baseline_committed_files);
  const effective_baseline = cleanup_boundary ?? baseline;
  const committed_files = /^[0-9a-f]{40}$/u.test(effective_baseline)
    ? git(root, ['diff', '--name-only', `${effective_baseline}..HEAD`]).split('\n').filter(Boolean)
    : baseline_committed_files;
  const changed_files = [...new Set([...committed_files, ...working_files])];
  const changed_lines = changed_line_count(root, effective_baseline, working_files);
  const repository_state = {
    head: push.head,
    branch: push.branch,
    status: git_status,
    baseline: effective_baseline,
    committed_files,
    working_files,
    changed_files,
    push
  };
  const decision = review_decision(root, notebook_path, devlog_text ?? '', workspace_dir, node_fs.existsSync(config_file) ? config_file : undefined, {
    parsed,
    changed_files,
    working_files,
    changed_lines
  });

  return {
    devlog_text,
    project_root: root,
    notebook_path,
    config_path: node_fs.existsSync(config_file) ? config_file : undefined,
    active_host,
    require_status_projection,
    now_ms,
    push,
    repository_state,
    terminal_output: status_output,
    tracker: record.tracker,
    checkpoint_verification: gather_checkpoint_verification(root, devlog_text ?? '', record.work, node_fs.existsSync(config_file) ? config_file : undefined),
    review_decision: decision,
    current_ask: ask_id,
    work_key: record.work?.work_key,
    work_root: record.work?.root,
    review_artifact_location: record.work?.root === undefined ? undefined : `${record.work.root}/`,
    git_paths: { baseline: effective_baseline, committed: committed_files, working: working_files, changed: changed_files, changed_lines }
  };
};

const validate_candidate = ({ devlog_text, context = {} } = {}) => {
  const can_collect = typeof context.project_root === 'string' || typeof context.notebook_path === 'string' || typeof context.config_path === 'string';
  const derived = can_collect
    ? collect({
      ...context,
      devlog_text,
      terminal_output: context.terminal_output,
      require_status_projection: context.require_status_projection
    })
    : {};
  return lint_round({ ...context, ...derived, devlog_text });
};

module.exports = { collect, validate_candidate };
