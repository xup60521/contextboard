#!/usr/bin/env node
'use strict';

const node_crypto = require('node:crypto');
const node_fs = require('node:fs');
const node_path = require('node:path');

const template = `# Tracker

## Identity

- **Work key:** <work-key>.

- **Active Ask:** <A-NNN>.

- **Goal:** <goal>.

- **Last update:** <YYYY-MM-DD HH:MM:SS Asia/Taipei>.

- **Evidence commit:** uncommitted.

## Overall state

- **State:** active.

- **Reason:** Work remains.

- **Total:** <count>.

- **Completed:** 0.

- **Remaining:** <count>.

## Accepted task checklist

- [ ] **T-1:** <self-contained task: required outcome, scope boundary, and proof needed>. Source: <A-NNN>.

## Accepted scope changes

- None.

## Current recovery

- **Current item:** T-1.

- **Last proven result:** None.

- **Active blocker or running process:** None.

- **Next safe action:** <next action>.

- **Expected changed files:** <paths>.

## Completion proof

- **All accepted tasks checked:** no.

- **Blocking accepted decision:** none.

- **Operation running:** no.

- **Next action remaining:** T-1.

- **Evidence status:** current.

- **Judgment:** active.

## Update meaning

- Saving this tracker is a recovery checkpoint, not a stop signal.

- Work continues with the next unfinished item unless an independent stop condition applies.
`;

const file_identity = file => node_crypto.createHash('sha256').update(node_fs.readFileSync(file)).digest('hex');

const validation_facts = ({ repo, tracker }) => {
  const absolute_repo = node_path.resolve(repo);
  const absolute_tracker = node_path.resolve(tracker);
  const relative = node_path.relative(absolute_repo, absolute_tracker).split(node_path.sep).join('/');
  const text = node_fs.readFileSync(absolute_tracker, 'utf8');
  const identity = file_identity(absolute_tracker);
  const entry = node_fs.lstatSync(absolute_tracker);
  return {
    required: true,
    path: relative,
    work_root: node_path.posix.dirname(relative),
    repository_root: '.',
    text,
    file: { regular: entry.isFile(), symlink: entry.isSymbolicLink(), checked_identity: identity, opened_identity: identity, read_identity: identity },
    format_only: true
  };
};

const validate = options => require('./round-linter.js').lint_tracker(validation_facts(options));

const run = () => {
  const args = process.argv.slice(2);
  if (args[0] === 'template' && args.length === 1) {
    process.stdout.write(template);
    return;
  }
  if (args[0] === 'validate') {
    const repo_index = args.indexOf('--repo');
    const tracker_index = args.indexOf('--tracker');
    if (repo_index < 0 || tracker_index < 0 || !args[repo_index + 1] || !args[tracker_index + 1]) {
      throw new Error('Usage: tracker-contract.js validate --repo <repo> --tracker <tracker>');
    }
    const result = validate({ repo: args[repo_index + 1], tracker: args[tracker_index + 1] });
    process.stdout.write(`${result.status.toUpperCase()}: ${result.detail}\n`);
    process.exitCode = result.status === 'pass' ? 0 : 1;
    return;
  }
  throw new Error('Usage: tracker-contract.js template | validate --repo <repo> --tracker <tracker>');
};

module.exports = { template, validate, validation_facts };

if (require.main === module) {
  try { run(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
