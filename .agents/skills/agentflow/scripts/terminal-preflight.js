#!/usr/bin/env node
'use strict';

// One coordinator-run completion gate. Policy remains in round-linter; this
// command only makes its complete result a reusable terminal preflight.
const fs = require('node:fs');
const { lint_round, read_context_json } = require('./round-linter');
const { validate_candidate } = require('./completion-context');

const preflight = ({ devlog_text, context = {} }) => {
  const can_collect = typeof context.project_root === 'string' || typeof context.notebook_path === 'string' || typeof context.config_path === 'string';
  return can_collect
    ? validate_candidate({ devlog_text, context })
    : lint_round({ ...context, devlog_text });
};

const read_standard_input = () => {
  const chunks = [];
  const buffer = Buffer.alloc(64 * 1024 + 1);
  let total = 0;
  while (true) {
    const count = fs.readSync(0, buffer, 0, buffer.length);
    if (count === 0) break;
    total += count;
    if (total > 64 * 1024) throw new Error('standard-input context exceeds 65536 bytes');
    chunks.push(Buffer.from(buffer.subarray(0, count)));
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('standard-input context must be a JSON object');
  return value;
};

const run = argv => {
  const [devlog_path, flag, context_path] = argv;
  const file_mode = flag === '--context' && context_path && argv.length === 3;
  const stdin_mode = flag === '--context-stdin' && argv.length === 2;
  if (!devlog_path || (!file_mode && !stdin_mode)) {
    console.error('Usage: node terminal-preflight.js <devlog-path> <--context <facts.json>|--context-stdin>');
    return 1;
  }
  let context;
  try {
    context = file_mode ? read_context_json(context_path) : read_standard_input();
  } catch (error) {
    console.error(error.message);
    return 1;
  }
  const result = preflight({ devlog_text: fs.readFileSync(devlog_path, 'utf8'), context });
  result.checks.forEach(check => console.log(`${check.status.toUpperCase()}  ${check.id}  ${check.detail}`));
  console.log(`${result.ok ? 'PASS' : 'FAIL'}  terminal preflight`);
  return result.ok ? 0 : 1;
};

module.exports = { preflight, run };
if (require.main === module) process.exitCode = run(process.argv.slice(2));
