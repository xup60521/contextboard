'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const queue_contract = require('./queue-contract')

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex')

const make_directory = () => {
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentflow-mixed-routing-')))
	const tasks_dir = path.join(root, 'planned')
	fs.mkdirSync(path.join(tasks_dir, 'done'), { recursive: true })
	return { root, tasks_dir }
}

const dispose = root => fs.rmSync(root, { recursive: true, force: true })

const simple_job = (overrides = {}) => ({
	job_id: 'mechanical-docs',
	request_text: 'Apply the same documented spelling correction throughout the named guide.',
	repository_evidence: [{ path: 'guide.md', sha256: sha256('guide evidence') }],
	dependencies: [],
	complexity_reasons: [],
	...overrides,
})

const complex_job = (overrides = {}) => ({
	job_id: 'token-check',
	request_text: 'Change token validation at the network trust boundary.',
	repository_evidence: [{ path: 'auth.js', sha256: sha256('auth evidence') }],
	dependencies: [],
	complexity_reasons: ['trust_boundary'],
	...overrides,
})

const accepted_contract = () => ({
	original_request_sha256: sha256('owner request'),
	requirements_sha256: sha256('requirements'),
	specification_sha256: sha256('specification'),
	requirements: { accepted: true },
	specification: { accepted: true },
	brownfield: false,
	mandatory_stages: ['requirements', 'specification'],
	stage_records: [],
	unresolved_decisions: [],
})

const base_input = (tasks_dir, overrides = {}) => ({
	operation: 'make-plans',
	allow_ag: 'on',
	jobs: [simple_job()],
	tasks_dir,
	generation_id: 'routing-generation-001',
	created_at: '2026-09-01T08:00:00.000Z',
	completion_path: 'devlog.md',
	...overrides,
})

test('routing uses a short list of allowed complexity reasons and never job length', () => {
	const complex_queue = make_directory()
	const simple_queue = make_directory()
	const invalid_queue = make_directory()
	try {
		const complex_result = queue_contract.plan_jobs(base_input(complex_queue.tasks_dir, { allow_ag: 'off', jobs: [complex_job({ request_text: 'Rotate key.' })] }))
		assert.equal(complex_result.jobs[0].classification, 'complex')
		assert.deepEqual(complex_result.jobs[0].complexity_reasons, ['trust_boundary'])

		const simple_result = queue_contract.plan_jobs(base_input(simple_queue.tasks_dir, { allow_ag: 'off', jobs: [simple_job({ request_text: 'Repeat this mechanical replacement. '.repeat(200) })] }))
		assert.equal(simple_result.jobs[0].classification, 'simple')
		assert.deepEqual(simple_result.jobs[0].complexity_reasons, [])

		assert.throws(() => queue_contract.plan_jobs(base_input(invalid_queue.tasks_dir, { jobs: [simple_job({ complexity_reasons: ['unexpected'] })] })), /complexity reason/i)
		assert.throws(() => queue_contract.plan_jobs(base_input(invalid_queue.tasks_dir, { jobs: [simple_job({ complexity_reasons: ['trust_boundary', 'trust_boundary'] })] })), /unique/i)
		assert.throws(() => queue_contract.plan_jobs(base_input(invalid_queue.tasks_dir, { jobs: [simple_job({ complexity_reasons: 'trust_boundary' })] })), /array/i)
	} finally {
		dispose(complex_queue.root)
		dispose(simple_queue.root)
		dispose(invalid_queue.root)
	}
})

test('simple-only make-plans publishes with allow_ag off and no accepted contract', () => {
	const queue = make_directory()
	try {
		const result = queue_contract.plan_jobs(base_input(queue.tasks_dir, { allow_ag: 'off' }))
		assert.equal(result.publication.published, true)
		assert.equal(result.publication.generation_kind, 'simple')
		assert.equal(result.implementation_started, false)
		assert.deepEqual(result.blocked_jobs, [])
		const frozen = queue_contract.read_frozen_queue(queue.tasks_dir)
		assert.equal(frozen.envelope.schema_version, 2)
		assert.equal(frozen.envelope.authorities.some(authority => 'requirements_sha256' in authority), false)
	} finally {
		dispose(queue.root)
	}
})

test('complex-only route retains accepted-contract and permission gates', () => {
	for (const allow_ag of ['off', 'ask']) {
		const queue = make_directory()
		try {
			const result = queue_contract.plan_jobs(base_input(queue.tasks_dir, { allow_ag, jobs: [complex_job()] }))
			assert.equal(result.publication.published, false)
			assert.deepEqual(result.blocked_jobs.map(item => item.job_id), ['token-check'])
			assert.equal(result.blocked_jobs[0].status, allow_ag === 'off' ? 'denied' : 'awaiting_owner_approval')
			assert.deepEqual(fs.readdirSync(queue.tasks_dir), ['done'])
		} finally {
			dispose(queue.root)
		}
	}

	const queue = make_directory()
	try {
		const result = queue_contract.plan_jobs(base_input(queue.tasks_dir, {
			jobs: [complex_job()],
			complex_contract: accepted_contract(),
		}))
		assert.equal(result.publication.generation_kind, 'complex')
		assert.equal(result.implementation_started, false)
	} finally {
		dispose(queue.root)
	}
})

test('mixed routing preserves both authorities and refuses misleading partial publication', () => {
	const allowed = make_directory()
	try {
		const result = queue_contract.plan_jobs(base_input(allowed.tasks_dir, {
			jobs: [simple_job(), complex_job()],
			complex_contract: accepted_contract(),
		}))
		assert.equal(result.publication.generation_kind, 'mixed')
		const frozen = queue_contract.read_frozen_queue(allowed.tasks_dir)
		assert.deepEqual(new Set(frozen.envelope.authorities.map(item => item.route)), new Set(['simple', 'complex', 'integration']))
	} finally {
		dispose(allowed.root)
	}

	const denied = make_directory()
	try {
		const result = queue_contract.plan_jobs(base_input(denied.tasks_dir, {
			allow_ag: 'off',
			jobs: [simple_job({ dependencies: ['token-check'] }), complex_job()],
		}))
		assert.equal(result.publication.published, false)
		assert.deepEqual(result.blocked_jobs.map(item => item.job_id), ['token-check'])
		assert.deepEqual(fs.readdirSync(denied.tasks_dir), ['done'])
	} finally {
		dispose(denied.root)
	}
})

test('schema-v2 authority rejects source changes, duplicate authority, cycles, and unbound completed plans', () => {
	const queue = make_directory()
	try {
		queue_contract.plan_jobs(base_input(queue.tasks_dir))
		const envelope_path = path.join(queue.tasks_dir, queue_contract.ENVELOPE_NAME)
		const original = JSON.parse(fs.readFileSync(envelope_path, 'utf8'))
		const mutations = [
			envelope => { envelope.authorities[0].repository_evidence[0].sha256 = sha256('changed evidence') },
			envelope => { envelope.authorities.push({ ...envelope.authorities[0] }) },
			envelope => { envelope.plans[0].dependencies = [envelope.plans.at(-1).path] },
		]
		for (const mutate of mutations) {
			const changed = structuredClone(original)
			mutate(changed)
			fs.writeFileSync(envelope_path, `${JSON.stringify(changed)}\n`)
			assert.equal(queue_contract.validate_frozen_queue(queue.tasks_dir).valid, false)
		}
		fs.writeFileSync(envelope_path, `${JSON.stringify(original)}\n`)
		fs.writeFileSync(path.join(queue.tasks_dir, 'done', 'plan-900.md'), 'unbound completed\n')
		assert.throws(() => queue_contract.select_frozen_ready_plans(queue.tasks_dir), /unbound|authority|bound/i)
	} finally {
		dispose(queue.root)
	}
})

test('shared readiness keeps final integration last and rejects stale authority', () => {
	const queue = make_directory()
	try {
		queue_contract.plan_jobs(base_input(queue.tasks_dir))
		const first = queue_contract.select_frozen_ready_plans(queue.tasks_dir)
		assert.deepEqual(first.ready_plan_names, ['plan-001.md'])
		fs.renameSync(path.join(queue.tasks_dir, 'plan-001.md'), path.join(queue.tasks_dir, 'done', 'plan-001.md'))
		const final = queue_contract.select_frozen_ready_plans(queue.tasks_dir)
		assert.deepEqual(final.ready_plan_names, ['plan-002.md'])
		assert.throws(() => queue_contract.select_frozen_ready_plans(queue.tasks_dir, { authority: first.authority }), /stale|changed/i)
	} finally {
		dispose(queue.root)
	}
})

test('ordinary host readiness is the same public decision boundary as executor readiness', () => {
	assert.equal(typeof queue_contract.select_host_ready_plans, 'function')
	const queue = make_directory()
	try {
		queue_contract.plan_jobs(base_input(queue.tasks_dir))
		const shared = queue_contract.select_frozen_ready_plans(queue.tasks_dir)
		const host = queue_contract.select_host_ready_plans(queue.tasks_dir)
		assert.deepEqual(host.ready_plan_names, shared.ready_plan_names)
		assert.deepEqual(host.completed_plan_names, shared.completed_plan_names)
		fs.appendFileSync(path.join(queue.tasks_dir, 'plan-001.md'), 'tamper\n')
		assert.throws(() => queue_contract.select_frozen_ready_plans(queue.tasks_dir), /digest|changed/i)
		assert.throws(() => queue_contract.select_host_ready_plans(queue.tasks_dir), /digest|changed/i)
	} finally {
		dispose(queue.root)
	}
})

test('schema-v2 duplicate plans and dependency cycles refuse readiness before launch', () => {
	for (const mutation of ['duplicate-plan', 'cycle']) {
		const queue = make_directory()
		try {
			queue_contract.plan_jobs(base_input(queue.tasks_dir))
			const envelope_path = path.join(queue.tasks_dir, queue_contract.ENVELOPE_NAME)
			const envelope = JSON.parse(fs.readFileSync(envelope_path, 'utf8'))
			if (mutation === 'duplicate-plan') envelope.plans.push({ ...envelope.plans[0] })
			else envelope.plans[0].dependencies = [envelope.plans.at(-1).path]
			fs.writeFileSync(envelope_path, `${JSON.stringify(envelope)}\n`)
			assert.throws(() => queue_contract.select_frozen_ready_plans(queue.tasks_dir), /duplicate|unique|dependency|later|cycle|graph/i)
		} finally {
			dispose(queue.root)
		}
	}
})

test('schema-v2 plans moved before an early envelope never become launchable', () => {
	const queue = make_directory()
	try {
		const result = queue_contract.plan_jobs(base_input(queue.tasks_dir, { crash_at: 'after-plans' }))
		assert.equal(result.publication.published, false)
		assert.equal(result.implementation_started, false)
		assert.equal(fs.existsSync(path.join(queue.tasks_dir, queue_contract.ENVELOPE_NAME)), false)
		assert.throws(() => queue_contract.select_frozen_ready_plans(queue.tasks_dir), /envelope|authority|missing/i)
	} finally {
		dispose(queue.root)
	}
})
