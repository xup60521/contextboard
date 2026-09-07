'use strict'

const { execFileSync } = require('node:child_process')

// Windows signals do not reach descendants. Kill the tree before its root exits.
const send_tree_signal = (child, signal) => {
  if (!child || !child.pid) return
  if (process.platform === 'win32') {
    execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
      timeout: 10000,
    })
    return
  }
  process.kill(-child.pid, signal)
}

module.exports = { send_tree_signal }
