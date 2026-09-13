'use strict'

const assert = require('node:assert/strict')
const child_process = require('node:child_process')
const path = require('node:path')
const test = require('node:test')

const { format_local_timestamp, parse_numeric_timestamp } = require('./local-time')

test('local timestamps carry the host offset, including a non-whole-hour zone', () => {
  const script = `const { format_local_timestamp, parse_numeric_timestamp } = require(${JSON.stringify(path.join(__dirname, 'local-time.js'))}); const stamp = format_local_timestamp(new Date(Date.UTC(2026, 8, 6, 12, 34, 56))); process.stdout.write(JSON.stringify({ stamp, parsed: parse_numeric_timestamp(stamp) }));`
  const result = child_process.execFileSync(process.execPath, ['-e', script], {
    env: { ...process.env, TZ: 'America/St_Johns' },
    encoding: 'utf8',
  })
  const value = JSON.parse(result)
  assert.match(value.stamp, /^2026-09-06 10:04:56 -0230$/u)
  assert.equal(value.parsed, Date.UTC(2026, 8, 6, 12, 34, 56))
})

test('numeric timestamp parsing rejects impossible dates and offsets', () => {
  for (const stamp of [
    '2026-02-30 12:00:00 +0800',
    '2026-09-06 12:00:00 +2400',
    '2026-09-06 12:00:00 +2360',
    '2026-09-06 12:00:00 UTC',
    '2026-09-06 12:00 +0800',
  ]) assert.ok(Number.isNaN(parse_numeric_timestamp(stamp)), stamp)
})
