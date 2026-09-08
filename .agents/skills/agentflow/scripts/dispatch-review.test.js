'use strict'

const node_assert = require('node:assert/strict')
const node_test = require('node:test')

const { build_dispatch_facts } = require('./dispatch-review.js')

node_test.test('review dispatch records the external runner result shape', () => {
  const facts = build_dispatch_facts({
    args: { output: 'review.md' },
    dispatch: { stage: 'cross-check' },
    report: 'PASS',
    result: {
      status: 'failed',
      exit_code: 1,
      timed_out: false,
      clone: { independent: true, remotes: [], changed: false },
      stdout_bytes: 12,
      stdout_truncated: false,
      stderr: 'provider unavailable',
    },
  })

  node_assert.equal(facts.stdout_bytes, 12)
  node_assert.equal(facts.stderr_excerpt, 'provider unavailable')
  node_assert.equal(facts.report_bytes, 4)
})
