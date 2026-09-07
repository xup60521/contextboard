'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { select_cross_check_plan, workspace_instruction_files } = require('./cross-check-plan.js')

const facts = overrides => ({
	changed_files: ['docs/guide.md'],
	changed_lines: 20,
	behavior_change: false,
	trust_boundary: false,
	broad_change: false,
	consequential_change: false,
	...overrides,
})

const consequential_facts = overrides => facts({
	changed_files: ['src/tool.js'],
	changed_lines: 40,
	behavior_change: true,
	consequential_change: true,
	original_ask_path: '.agentflow/devlog.md',
	normal_journey_path: '.agentflow/journeys/tool.md',
	...overrides,
})

test('small documentation-only work selects narrow review', () => {
	const result = select_cross_check_plan(facts())
	assert.equal(result.valid, true)
	assert.equal(result.level, 'narrow')
	assert.match(result.reviewer_checks.join('\n'), /do not repeat.*complete test suite/i)
})

test('ordinary behavior work selects targeted review', () => {
	const result = select_cross_check_plan(facts({ changed_files: ['src/tool.js', 'src/tool.test.js'], behavior_change: true }))
	assert.equal(result.level, 'targeted')
	assert.match(result.reviewer_checks.join('\n'), /focused tests/i)
})

test('broad size and trust boundaries select full review', () => {
	assert.equal(select_cross_check_plan(facts({ trust_boundary: true })).level, 'full')
	assert.equal(select_cross_check_plan(facts({ changed_lines: 500 })).level, 'full')
	assert.equal(select_cross_check_plan(facts({ changed_files: Array.from({ length: 10 }, (_, index) => `docs/${index}.md`) })).level, 'full')
})

test('stronger owner control escalates one level', () => {
	assert.equal(select_cross_check_plan(facts({ owner_control: 'stronger' })).level, 'targeted')
	assert.equal(select_cross_check_plan(facts({ changed_files: ['src/a.js'], behavior_change: true, owner_control: 'stronger' })).level, 'full')
})

test('skip-review requires a recorded tradeoff and skips every proportional final-review level', () => {
	assert.equal(select_cross_check_plan(facts({ owner_control: 'skip-review' })).valid, false)
	assert.equal(select_cross_check_plan(facts({ owner_control: 'skip-review', skip_reason: 'owner accepts no independent review for this typo' })).level, 'skip')
	assert.equal(select_cross_check_plan(facts({ changed_files: ['src/a.js'], behavior_change: true, owner_control: 'skip-review', skip_reason: 'urgent local change' })).level, 'skip')
	assert.equal(select_cross_check_plan(facts({ trust_boundary: true, owner_control: 'skip-review', skip_reason: 'owner accepts the risk' })).level, 'skip')
	assert.equal(select_cross_check_plan(facts({ owner_control: 'skip-narrow', skip_reason: 'old spelling' })).valid, false)
})

test('malformed or incomplete facts fail closed', () => {
	for (const value of [null, {}, facts({ changed_lines: -1 }), facts({ trust_boundary: 'no' }), facts({ owner_control: 'off' })]) {
		assert.equal(select_cross_check_plan(value).valid, false)
	}
	const without_consequence = facts()
	delete without_consequence.consequential_change
	assert.equal(select_cross_check_plan(without_consequence).valid, false)
	assert.equal(select_cross_check_plan(facts({ consequential_change: 'false' })).valid, false)
})

test('workspace layout changes require the complete instruction impact inventory', () => {
	const incomplete = facts({ workspace_layout_change: true })
	assert.equal(select_cross_check_plan(incomplete).valid, false)
	const inventory = workspace_instruction_files.map(path => ({ path, status: 'changed', reason: 'workspace paths are part of this instruction' }))
	const result = select_cross_check_plan(facts({ workspace_layout_change: true, workspace_instruction_inventory: inventory }))
	assert.equal(result.valid, true)
	assert.match(result.reviewer_checks.join('\n'), /workspace_instruction_inventory/)
	assert.equal(select_cross_check_plan(facts({ workspace_layout_change: true, workspace_instruction_inventory: inventory.slice(1) })).valid, false)
	assert.equal(select_cross_check_plan(facts({ workspace_layout_change: true, workspace_instruction_inventory: [{ ...inventory[0], path: 'README.md' }, ...inventory.slice(1)] })).valid, false)
})

test('consequential changes require repository-relative original-Ask and normal-journey paths', () => {
	assert.equal(select_cross_check_plan(consequential_facts()).valid, true)
	for (const field of ['original_ask_path', 'normal_journey_path']) {
		assert.equal(select_cross_check_plan(consequential_facts({ [field]: '' })).valid, false)
		assert.equal(select_cross_check_plan(consequential_facts({ [field]: '   ' })).valid, false)
		assert.equal(select_cross_check_plan(consequential_facts({ [field]: 42 })).valid, false)
		assert.equal(select_cross_check_plan(consequential_facts({ [field]: '/tmp/record.md' })).valid, false)
		assert.equal(select_cross_check_plan(consequential_facts({ [field]: '../record.md' })).valid, false)
		assert.equal(select_cross_check_plan(consequential_facts({ [field]: 'nested/../../record.md' })).valid, false)
	}
	assert.equal(select_cross_check_plan(facts({ consequential_change: true })).valid, false)
})

test('contradictory consequential and path aliases fail closed', () => {
	assert.equal(select_cross_check_plan(consequential_facts({ consequential: false })).valid, false)
	assert.equal(select_cross_check_plan(consequential_facts({ original_ask: 'other.md' })).valid, false)
	assert.equal(select_cross_check_plan(consequential_facts({ journey_path: 'other.md' })).valid, false)
})

test('cross-check reviewers reconstruct outcome, inspect the journey, account for added concepts, and return three verdicts', () => {
	const result = select_cross_check_plan(consequential_facts())
	const checks = result.reviewer_checks.join('\n')
	assert.equal(result.level, 'targeted')
	assert.match(checks, /reconstruct the outcome.*original Ask/i)
	assert.match(checks, /inspect the (?:normal[- ]user )?journey/i)
	assert.match(checks, /account for (?:every )?added concept/i)
	assert.match(checks, /perform this review directly/i)
	assert.match(checks, /do not invoke Agentflow/i)
	assert.match(checks, /do not delegate or launch another reviewer/i)
	assert.match(checks, /Outcome: PASS\|BLOCKING/)
	assert.match(checks, /Minimality: PASS\|BLOCKING/)
	assert.match(checks, /Conformance: PASS\|BLOCKING/)
})

test('low-risk cross-checks keep their existing exemptions while requiring the verdict contract', () => {
	const result = select_cross_check_plan(facts())
	const checks = result.reviewer_checks.join('\n')
	assert.equal(result.level, 'narrow')
	assert.doesNotMatch(checks, /normal[- ]user journey/i)
	assert.match(checks, /Outcome: PASS\|BLOCKING/)
	assert.match(checks, /Minimality: PASS\|BLOCKING/)
	assert.match(checks, /Conformance: PASS\|BLOCKING/)
})
