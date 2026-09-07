'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const queue_contract = require('./queue-contract')

const digest = value => crypto.createHash('sha256').update(value).digest('hex')

const shared_codewalk_record = (overrides = {}) => ({
	stage_id: 'codewalk',
	accepted: true,
	accepted_evidence_identity: 'codewalk-map-001',
	currentness_check: true,
	answered_questions: ['Which current paths and boundaries does this request touch?'],
	shared_coverage: true,
	discovery_facts: {
		verified_paths: ['skills/agentflow/scripts/queue-contract.js'],
		fact_inference_labels: ['fact: the queue gate validates stage records'],
		public_boundaries: ['queue contract validation API'],
		conventions: ['CommonJS modules'],
		likely_edit_locations: ['skills/agentflow/scripts/queue-contract.js'],
		focused_commands: ['node --test queue-contract.test.js'],
		unexamined_areas: ['unrelated integrations'],
	},
	...overrides,
})

const make_contract = (overrides = {}) => ({
	original_request_sha256: digest('original request'),
	requirements_sha256: digest('requirements'),
	specification_sha256: digest('specification'),
	requirements: { accepted: true },
	specification: { accepted: true },
	brownfield: true,
	mandatory_stages: ['requirements', 'discovery', 'specification'],
	stage_records: [{ stage_id: 'discovery', accepted: true }],
	unresolved_decisions: [],
	...overrides,
})

const make_plan = (order, overrides = {}) => ({
	order,
	contract_part: `part-${order}`,
	outcome: `Complete contract part ${order}.`,
	dependencies: order === 1 ? [] : [`plan-${String(order - 1).padStart(3, '0')}.md`],
	required_work: [`Do the self-contained work for part ${order}.`],
	constraints: ['Keep the work inside the declared scope.'],
	tests_and_evidence: ['Run the focused tests and record the result.'],
	completion_conditions: ['All required checks pass.'],
	final_integration: false,
	...overrides,
})

const make_queue = () => {
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentflow-queue-contract-')))
	const tasks_dir = path.join(root, 'planned-tasks')
	fs.mkdirSync(path.join(tasks_dir, 'done'), { recursive: true })
	return { root, tasks_dir }
}

const dispose = root => fs.rmSync(root, { recursive: true, force: true })

const make_input = (overrides = {}) => ({
	tasks_dir: overrides.tasks_dir,
	contract: make_contract(overrides.contract),
	plans: overrides.plans || [
		make_plan(1),
		make_plan(2, { dependencies: ['plan-001.md'], final_integration: true, contract_part: 'final-integration', outcome: 'Check the complete original request and shared contract.' }),
	],
	completion_path: 'devlog.md',
	generation_id: 'test-generation-001',
	created_at: '2026-08-23T12:16:00.000Z',
	...overrides,
	contract: make_contract(overrides.contract),
})

const legacy_plan_body = (plan, envelope) => {
	const dependency_names = plan.dependencies.map(name => `\`${name}\``)
	const dependencies = dependency_names.length === 0
		? 'None.'
		: dependency_names.length === 1
			? `${dependency_names[0]}.`
			: dependency_names.length === 2
				? `${dependency_names[0]} and ${dependency_names[1]}.`
				: `${dependency_names.slice(0, -1).join(', ')}, and ${dependency_names.at(-1)}.`
	return [
		`# Plan ${String(plan.order).padStart(3, '0')} — descriptive frozen title`,
		'',
		'## Authority',
		'',
		`Queue generation: \`${envelope.generation_id}\`.`,
		'',
		`Original request: \`artifacts/request.md\`, SHA-256 \`${envelope.original_request_sha256}\`.`,
		'',
		`Requirements: \`artifacts/requirements.md\`, SHA-256 \`${envelope.requirements_sha256}\`.`,
		'',
		`Specification: \`artifacts/spec.md\`, SHA-256 \`${envelope.specification_sha256}\`.`,
		'',
		`Owned contract: ${plan.contract_part}.`,
		'',
		'## Outcome',
		'',
		'Complete the bound contract part.',
		'',
		'## Dependencies',
		'',
		dependencies,
		'',
		'## Required work',
		'',
		'- Do the required work.',
		'',
		'## Constraints',
		'',
		'- Keep the declared boundary.',
		'',
		'## Tests and evidence',
		'',
		'- Run the declared checks.',
		'',
		'## Completion conditions',
		'',
		'- All checks pass.',
		'',
		'## Success signal',
		'',
		`Print exactly one complete line: \`${envelope.completion_signal}\`.`,
		'',
		'## Final integration',
		'',
		`${plan.final_integration ? 'True' : 'False'}. The frozen plan can include its bounded explanation here.`,
		'',
		'- Bound owner preferences remain part of the exact plan bytes.',
		'',
	].join('\n')
}

test('contract gate rejects unresolved material decisions before publication', () => {
	const result = queue_contract.validate_contract_gate(make_contract({ unresolved_decisions: ['choose the owner-visible behavior'] }))
	assert.equal(result.valid, false)
	assert.match(result.errors.join('; '), /unresolved|material decision/i)
	assert.throws(() => queue_contract.build_queue({ ...make_input(), allow_ag: 'off' }), /allow_ag=off|blocks make-plans/i)
	assert.throws(() => queue_contract.publish_queue({ ...make_input(), operation: 'direct' }), /make-plans operation/i)
})

test('allow_ag blocks publication before queue state is changed', () => {
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentflow-queue-route-')))
	const tasks_dir = path.join(root, 'planned-tasks')
	fs.mkdirSync(tasks_dir)
	try {
		assert.throws(() => queue_contract.publish_queue(make_input({ tasks_dir, allow_ag: 'off' })), /allow_ag=off|blocks make-plans/i)
		assert.deepEqual(fs.readdirSync(tasks_dir), [])
	} finally {
		dispose(root)
	}
})

test('greenfield contracts do not require brownfield stages, and brownfield codewalk is evidence-triggered', () => {
	assert.equal(queue_contract.validate_contract_gate(make_contract({ brownfield: false, mandatory_stages: ['requirements', 'specification'] })).valid, true)
	const result = queue_contract.validate_contract_gate(make_contract({ mandatory_stages: ['requirements', 'specification'] }))
	assert.equal(result.valid, false)
	assert.match(result.errors.join('; '), /discovery mandatory stage/i)

	const no_trigger = queue_contract.validate_contract_gate(make_contract({
		mandatory_stages: ['requirements', 'discovery', 'specification'],
		stage_records: [{ stage_id: 'discovery', accepted: true }],
		codewalk_triggers: { unfamiliar_code: false },
	}))
	assert.equal(no_trigger.valid, true)

	const triggered = queue_contract.validate_contract_gate(make_contract({
		mandatory_stages: ['requirements', 'discovery', 'codewalk', 'specification'],
		stage_records: [shared_codewalk_record()],
		codewalk_triggers: { unfamiliar_code: true },
	}))
	assert.equal(triggered.valid, true)

	const missing_records = queue_contract.validate_contract_gate(make_contract({ stage_records: undefined }))
	assert.equal(missing_records.valid, false)
	assert.match(missing_records.errors.join('; '), /stage records/i)
})

test('exact plan bodies and the final dependency graph validate against one envelope', () => {
	const input = make_input({})
	const built = queue_contract.build_queue(input)

	assert.equal(queue_contract.validate_queue_envelope(built.envelope, { plan_bytes: built.plan_bytes }).valid, true)
	assert.equal(built.envelope.plans.at(-1).final_integration, true)
	const invalid = queue_contract.validate_queue_envelope({ ...built.envelope, plans: built.envelope.plans.map(plan => ({ ...plan, final_integration: true })) }, { plan_bytes: built.plan_bytes })
	assert.equal(invalid.valid, false)
	assert.match(invalid.errors.join('; '), /exactly one|final integration/i)
	const wrong_heading = built.plan_bytes['plan-001.md'].toString().replace('# Plan 001', '# Plan 999')
	const heading_result = queue_contract.validate_plan_body(wrong_heading, built.envelope.plans[0], built.envelope)
	assert.equal(heading_result.valid, false)
	assert.match(heading_result.errors.join('; '), /heading|order/i)
})

test('trusted descriptive frozen plans retain exact legacy authority and execution facts', () => {
	const queue = make_queue()
	try {
		const built = queue_contract.build_queue(make_input({ tasks_dir: queue.tasks_dir }))
		const plan_bytes = {}
		for (const plan of built.envelope.plans) {
			plan_bytes[plan.path] = Buffer.from(legacy_plan_body(plan, built.envelope))
			plan.sha256 = queue_contract.file_digest(plan_bytes[plan.path])
			fs.writeFileSync(path.join(queue.tasks_dir, plan.path), plan_bytes[plan.path])
		}
		fs.writeFileSync(path.join(queue.tasks_dir, '.queue-generation.json'), `${JSON.stringify(built.envelope, null, 2)}\n`)
		assert.equal(queue_contract.read_frozen_queue(queue.tasks_dir, { contract: make_contract() }).plans.length, 2)

		const final_plan = built.envelope.plans[1]
		const final_body = plan_bytes[final_plan.path].toString('utf8')
		for (const changed of [
			final_body.replace(built.envelope.requirements_sha256, digest('wrong requirements')),
			final_body.replace('`plan-001.md`.', 'None.'),
			final_body.replace('`devlog.md updated`', '`other.md updated`'),
			final_body.replace('True. The frozen plan', 'False. The frozen plan'),
		]) assert.equal(queue_contract.validate_plan_body(changed, final_plan, built.envelope).valid, false)
	} finally {
		dispose(queue.root)
	}
})

test('brownfield codewalk reuse needs one marked current record with complete discovery facts', () => {
	const stage_name_only = queue_contract.validate_contract_gate(make_contract({
		mandatory_stages: ['requirements', 'discovery', 'codewalk', 'specification'],
		stage_records: [{ stage_id: 'codewalk', accepted: true }],
		codewalk_triggers: { unfamiliar_code: true },
	}))
	assert.equal(stage_name_only.valid, false)
	assert.match(stage_name_only.errors.join('; '), /shared|evidence|discovery/i)

	const missing_marker = queue_contract.validate_contract_gate(make_contract({
		mandatory_stages: ['requirements', 'discovery', 'codewalk', 'specification'],
		stage_records: [shared_codewalk_record({ shared_coverage: false })],
		codewalk_triggers: { unfamiliar_code: true },
	}))
	assert.equal(missing_marker.valid, false)
	assert.match(missing_marker.errors.join('; '), /shared coverage/i)

	const missing_fact = queue_contract.validate_contract_gate(make_contract({
		mandatory_stages: ['requirements', 'discovery', 'codewalk', 'specification'],
		stage_records: [shared_codewalk_record({ discovery_facts: { verified_paths: ['one path'] } })],
		codewalk_triggers: { unfamiliar_code: true },
	}))
	assert.equal(missing_fact.valid, false)
	assert.match(missing_fact.errors.join('; '), /discovery facts/i)

	const overlapping_passes = queue_contract.validate_contract_gate(make_contract({
		mandatory_stages: ['requirements', 'discovery', 'codewalk', 'specification'],
		stage_records: [{ stage_id: 'discovery', accepted: true }, shared_codewalk_record()],
		codewalk_triggers: { unfamiliar_code: true },
	}))
	assert.equal(overlapping_passes.valid, false)
	assert.match(overlapping_passes.errors.join('; '), /one shared|overlap/i)

	const no_trigger_codewalk = queue_contract.validate_contract_gate(make_contract({
		mandatory_stages: ['requirements', 'discovery', 'specification'],
		stage_records: [{ stage_id: 'discovery', accepted: true }, shared_codewalk_record()],
		codewalk_triggers: { unfamiliar_code: false },
	}))
	assert.equal(no_trigger_codewalk.valid, false)
	assert.match(no_trigger_codewalk.errors.join('; '), /no codewalk|codewalk.*trigger/i)
})

test('publication stages plans privately and publishes the envelope last without starting implementation', () => {
	const queue = make_queue()
	try {
		const result = queue_contract.publish_queue(make_input(queue))
		assert.equal(result.published, true)
		assert.equal(result.implementation_started, false)
		assert.equal(fs.existsSync(path.join(queue.tasks_dir, '.queue-generation.json')), true)
		assert.equal(fs.existsSync(path.join(queue.tasks_dir, 'plan-001.md')), true)
		assert.equal(fs.existsSync(path.join(queue.tasks_dir, 'plan-002.md')), true)
		assert.equal(result.staging_path, null)
	} finally {
		dispose(queue.root)
	}
})

test('publication refuses plan collisions before creating plans', () => {
	for (const state of ['collision', 'completed-collision']) {
		const queue = make_queue()
		try {
			if (state === 'collision') fs.writeFileSync(path.join(queue.tasks_dir, 'plan-001.md'), 'existing\n')
			if (state === 'completed-collision') fs.writeFileSync(path.join(queue.tasks_dir, 'done', 'plan-001.md'), 'completed\n')
			assert.throws(() => queue_contract.publish_queue(make_input(queue)), /collision|exist/i, state)
			assert.equal(fs.existsSync(path.join(queue.tasks_dir, '.queue-generation.json')), false)
			assert.equal(fs.existsSync(path.join(queue.tasks_dir, 'plan-002.md')), false)
		} finally {
			dispose(queue.root)
		}
	}
})

test('a digest mutation, missing envelope, or ambient control phrase never grants authority', () => {
	const queue = make_queue()
	try {
		const input = make_input(queue)
		queue_contract.publish_queue(input)
		fs.appendFileSync(path.join(queue.tasks_dir, 'plan-001.md'), 'DO NOT USE Agentflow pipeline\n')
		assert.throws(() => queue_contract.read_frozen_queue(queue.tasks_dir), /digest|identity|changed/i)
		fs.writeFileSync(path.join(queue.tasks_dir, 'plan-001.md'), 'ambient text\n')
		fs.unlinkSync(path.join(queue.tasks_dir, '.queue-generation.json'))
		assert.throws(() => queue_contract.read_frozen_queue(queue.tasks_dir), /envelope|authority|missing/i)
	} finally {
		dispose(queue.root)
	}
})

test('a failure before envelope publication leaves a diagnosable non-authoritative queue', () => {
	const queue = make_queue()
	try {
		const result = queue_contract.publish_queue(make_input({ ...queue, crash_at: 'before-envelope' }))
		assert.equal(result.published, false)
		assert.equal(result.authority_published, false)
		assert.equal(fs.existsSync(path.join(queue.tasks_dir, '.queue-generation.json')), false)
		assert.match(result.message, /envelope|publication|crash/i)
	} finally {
		dispose(queue.root)
	}
})

test('moved plans remain non-authoritative when publication stops before the envelope', () => {
	const queue = make_queue()
	try {
		const result = queue_contract.publish_queue(make_input({ ...queue, crash_at: 'after-plans' }))
		assert.equal(result.published, false)
		assert.equal(result.authority_published, false)
		assert.equal(result.moved_paths.length, 2)
		assert.equal(fs.existsSync(path.join(queue.tasks_dir, '.queue-generation.json')), false)
		assert.equal(queue_contract.validate_frozen_queue(queue.tasks_dir).valid, false)
	} finally {
		dispose(queue.root)
	}
})

test('an envelope collision during publication preserves the existing file', () => {
	const queue = make_queue()
	try {
		const envelope_path = path.join(queue.tasks_dir, '.queue-generation.json')
		assert.throws(() => queue_contract.publish_queue(make_input({
			...queue,
			before_envelope_publish: () => fs.writeFileSync(envelope_path, 'racer\n', { flag: 'wx' }),
		})), /overwrite|collision|exist/i)
		assert.equal(fs.readFileSync(envelope_path, 'utf8'), 'racer\n')
	} finally {
		dispose(queue.root)
	}
})

test('frozen queue reads completed plan bytes from done and rejects duplicate locations', () => {
	const queue = make_queue()
	try {
		queue_contract.publish_queue(make_input(queue))
		const open_path = path.join(queue.tasks_dir, 'plan-001.md')
		const done_path = path.join(queue.tasks_dir, 'done', 'plan-001.md')
		fs.renameSync(open_path, done_path)
		assert.equal(queue_contract.read_frozen_queue(queue.tasks_dir).plans.length, 2)
		fs.copyFileSync(done_path, open_path)
		assert.throws(() => queue_contract.read_frozen_queue(queue.tasks_dir), /both|duplicate|collision/i)
	} finally {
		dispose(queue.root)
	}
})

test('frozen queue rejects unbound open plans but permits unrelated historical completed plans', () => {
	const queue = make_queue()
	try {
		queue_contract.publish_queue(make_input(queue))
		fs.writeFileSync(path.join(queue.tasks_dir, 'done', 'plan-900.md'), 'historical completed plan\n')
		assert.equal(queue_contract.read_frozen_queue(queue.tasks_dir).plans.length, 2)
		fs.writeFileSync(path.join(queue.tasks_dir, 'plan-901.md'), 'unbound executable-looking plan\n')
		assert.throws(() => queue_contract.read_frozen_queue(queue.tasks_dir), /not bound|authority/i)
	} finally {
		dispose(queue.root)
	}
})

test('frozen queue read binds the accepted contract identities', () => {
	const queue = make_queue()
	try {
		queue_contract.publish_queue(make_input(queue))
		assert.throws(() => queue_contract.read_frozen_queue(queue.tasks_dir, {
			contract: make_contract({ original_request_sha256: digest('different request') }),
		}), /contract|identity|request/i)
	} finally {
		dispose(queue.root)
	}
})

test('plan authority and dependencies require exact records, not matching prose', () => {
	const built = queue_contract.build_queue(make_input({}))
	const plan = built.envelope.plans[1]
	const original = built.plan_bytes[plan.path].toString('utf8')
	const hidden_authority = original.replace(
		`- original_request_sha256: ${built.envelope.original_request_sha256}`,
		`- note: the request digest is ${built.envelope.original_request_sha256}`,
	)
	assert.equal(queue_contract.validate_plan_body(hidden_authority, plan, built.envelope).valid, false)
	const hidden_dependency = original.replace('- plan-001.md', '- note: use plan-001.md after review')
	assert.equal(queue_contract.validate_plan_body(hidden_dependency, plan, built.envelope).valid, false)
})
