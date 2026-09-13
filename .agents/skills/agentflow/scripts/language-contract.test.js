'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '../../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')

test('the resolved language setting overrides host defaults for Agentflow writing', () => {
	const skill = read('skills/agentflow/SKILL.md')
	const english = read('skills/agentflow/docs/AG_GUIDE.md')
	const chinese = read('skills/agentflow/docs/AG_GUIDE.zh-tw.md')

	assert.match(skill, /configuration\.language.*Agentflow writing/i)
	assert.match(skill, /overrides host\/personal defaults/i)
	assert.match(skill, /answers, devlog records, user documents, code comments, and commits/i)
	assert.match(english, /required language for AI-written answers, devlog records, documents, comments, and commit messages/i)
	assert.match(english, /overrides the AI host's normal language default/i)
	assert.match(chinese, /必須使用的語言/)
	assert.match(chinese, /覆蓋 AI host 平常的預設語言/)
})

test('delegated workers receive the resolved language as a mandatory brief fact', () => {
	const delegation = read('skills/agentflow/references/delegation.md')

	assert.match(delegation, /output language to the successful startup result's `configuration\.language`/i)
	assert.match(delegation, /overrides a worker or host default/i)
})
