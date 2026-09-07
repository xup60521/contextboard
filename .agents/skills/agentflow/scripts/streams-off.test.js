'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const repo_root = path.resolve(__dirname, '..', '..', '..')
const read = relative_path => fs.readFileSync(path.join(repo_root, relative_path), 'utf8')

test('streams off remains a visible no-automatic-stream mode', () => {
	const skill = read('skills/agentflow/SKILL.md')
	const streams = read('skills/agentflow/references/streams.md')
	const english_guide = read('skills/agentflow/docs/AG_GUIDE.md')
	const chinese_guide = read('skills/agentflow/docs/AG_GUIDE.zh-tw.md')

	assert.match(skill, /streams: ask\|always\|off/)
	for (const document of [skill, streams]) {
		assert.match(document, /`off`.*(?:reports? the signal|report).*neither asks to open a stream nor opens one/i)
		assert.match(document, /Explicit `new-feature:`.*(?:still|always).*requested stream|Explicit `new-feature:` is always immediate authorization/i)
	}
	assert.match(english_guide, /Legal values are `ask`, `always`, and `off`/)
	assert.match(english_guide, /`off` reports the signal without asking or opening a stream/)
	assert.match(chinese_guide, /`off` 只會告訴你這個訊號，不會問你要不要開 stream/)
})
