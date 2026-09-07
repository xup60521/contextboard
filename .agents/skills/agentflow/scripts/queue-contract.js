'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ENVELOPE_NAME = '.queue-generation.json'
const MAX_PLAN_BYTES = 1024 * 1024
const PLAN_PATTERN = /^plan-(\d{3})\.md$/
const HASH_PATTERN = /^[0-9a-f]{64}$/i
const PLAN_SECTIONS = Object.freeze([
	'Authority',
	'Outcome',
	'Dependencies',
	'Required work',
	'Constraints',
	'Tests and evidence',
	'Completion conditions',
	'Success signal',
	'Final integration',
])

class QueueContractError extends Error {
	constructor(message, code = 'AG_QUEUE_CONTRACT') {
		super(message)
		this.name = 'QueueContractError'
		this.code = code
	}
}

const has_own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const is_object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const nonempty_text = value => typeof value === 'string' && value.trim().length > 0
const is_sha256 = value => typeof value === 'string' && HASH_PATTERN.test(value)
const is_positive_integer = value => Number.isInteger(value) && value > 0
const unique = values => [...new Set(values)]
const clone = value => JSON.parse(JSON.stringify(value))
const codewalk_trigger_names = Object.freeze(['unfamiliar_code', 'multiple_subsystems', 'public_interface', 'stored_data', 'trust_boundary', 'stale_or_missing_map'])

const codewalk_required = facts => {
	const explicit = facts.codewalk_required
	if (explicit !== undefined && typeof explicit !== 'boolean') return null
	const triggers = facts.codewalk_triggers ?? facts.codewalk_trigger
	let trigger_result = false
	if (triggers === true) trigger_result = true
	else if (triggers === false || triggers === undefined || triggers === null) trigger_result = false
	else {
		if (!is_object(triggers)) return null
		const supplied = Object.keys(triggers)
		if (supplied.some(name => !codewalk_trigger_names.includes(name)) || supplied.some(name => typeof triggers[name] !== 'boolean')) return null
		trigger_result = supplied.some(name => triggers[name] === true)
	}
	return explicit === true || trigger_result
}

const discovery_fact_names = Object.freeze([
	'verified_paths',
	'fact_inference_labels',
	'public_boundaries',
	'conventions',
	'likely_edit_locations',
	'focused_commands',
	'unexamined_areas',
])

const stage_record_id = record => String(record?.stage_id ?? record?.stage ?? record?.id ?? '').toLowerCase()

const accepted_stage_record = record => is_object(record) && (record.accepted === true || record.current === true || record.status === 'accepted')

const validate_shared_codewalk_record = record => {
	const errors = []
	if (!is_object(record) || stage_record_id(record) !== 'codewalk') {
		return { valid: false, errors: ['shared discovery reuse requires a codewalk stage record'] }
	}
	if (!accepted_stage_record(record)) errors.push('shared codewalk record is not accepted and current')
	if (record.shared_coverage !== true) errors.push('shared coverage marker must be true')
	const evidence_identity = hash_field(record, ['accepted_evidence_identity', 'evidence_identity', 'evidence_id'])
	if (!nonempty_text(evidence_identity)) errors.push('shared codewalk record needs current codewalk evidence identity')
	const currentness = record.currentness_check ?? record.current
	if (currentness !== true) errors.push('shared codewalk record needs a currentness check')
	const answered_questions = record.answered_questions ?? record.questions_answered
	if (!Array.isArray(answered_questions) || !answered_questions.every(nonempty_text)) errors.push('shared codewalk record needs answered questions')
	const facts = record.discovery_facts ?? record.discovery
	if (!is_object(facts)) errors.push('shared codewalk record needs discovery facts')
	else {
		for (const name of discovery_fact_names) {
			if (!Array.isArray(facts[name]) || !facts[name].every(nonempty_text)) errors.push(`shared codewalk discovery facts are missing ${name}`)
		}
	}
	return { valid: errors.length === 0, errors }
}

const error_text = error => error instanceof Error ? error.message : String(error)

const fail = (message, code) => {
	throw new QueueContractError(message, code)
}

const stat_identity = stat => ({ dev: stat.dev, ino: stat.ino, size: stat.size })

const same_identity = (left, right) => left && right && left.dev === right.dev && left.ino === right.ino && left.size === right.size

const path_is_within = (candidate, parent) => {
	const relative = path.relative(path.resolve(parent), path.resolve(candidate))
	return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

const canonical_path = value => path.resolve(String(value))

const ensure_directory = (directory, label) => {
	let stat
	try {
		stat = fs.lstatSync(directory)
	} catch (error) {
		fail(`${label} could not be inspected: ${error_text(error)}`)
	}
	if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`${label} must be a real directory: ${directory}`)
	try {
		return fs.realpathSync(directory)
	} catch (error) {
		fail(`${label} could not be resolved safely: ${error_text(error)}`)
	}
}

const descriptor_flags = () => {
	let flags = fs.constants.O_RDONLY
	if (typeof fs.constants.O_NOFOLLOW === 'number') flags |= fs.constants.O_NOFOLLOW
	return flags
}

const read_regular_bytes = (file, label = 'file') => {
	let entry_stat
	try {
		entry_stat = fs.lstatSync(file)
	} catch (error) {
		fail(`${label} is unavailable at ${file}: ${error_text(error)}`, 'AG_QUEUE_MISSING')
	}
	if (entry_stat.isSymbolicLink() || !entry_stat.isFile()) fail(`${label} must be a regular nonsymlink file: ${file}`, 'AG_QUEUE_UNSAFE_PATH')
	if (!Number.isSafeInteger(entry_stat.size) || entry_stat.size < 0 || entry_stat.size > MAX_PLAN_BYTES) fail(`${label} exceeds the ${MAX_PLAN_BYTES}-byte limit: ${file}`, 'AG_QUEUE_SIZE')

	let descriptor = null
	let primary_error = null
	let bytes = null
	try {
		descriptor = fs.openSync(file, descriptor_flags())
		const descriptor_stat = fs.fstatSync(descriptor)
		if (!descriptor_stat.isFile() || !same_identity(stat_identity(entry_stat), stat_identity(descriptor_stat))) fail(`${label} changed while opening: ${file}`, 'AG_QUEUE_CHANGED')
		bytes = Buffer.alloc(descriptor_stat.size)
		let offset = 0
		while (offset < descriptor_stat.size) {
			const read = fs.readSync(descriptor, bytes, offset, descriptor_stat.size - offset, null)
			if (!Number.isSafeInteger(read) || read <= 0) fail(`${label} could not be read completely: ${file}`, 'AG_QUEUE_READ')
			offset += read
		}
		const final_stat = fs.fstatSync(descriptor)
		if (offset !== descriptor_stat.size || !same_identity(stat_identity(descriptor_stat), stat_identity(final_stat))) fail(`${label} changed while reading: ${file}`, 'AG_QUEUE_CHANGED')
	} catch (error) {
		primary_error = error
	} finally {
		if (descriptor !== null) {
			try {
				fs.closeSync(descriptor)
			} catch (error) {
				if (primary_error === null) primary_error = error
			}
		}
	}
	if (primary_error) {
		if (primary_error instanceof QueueContractError) throw primary_error
		fail(`${label} could not be read safely: ${error_text(primary_error)}`, 'AG_QUEUE_READ')
	}
	return bytes
}

const file_digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex')

const parse_json_bytes = (bytes, label) => {
	try {
		const value = JSON.parse(bytes.toString('utf8'))
		if (!is_object(value)) fail(`${label} must contain a JSON object`, 'AG_QUEUE_SCHEMA')
		return value
	} catch (error) {
		if (error instanceof QueueContractError) throw error
		fail(`${label} is not valid JSON: ${error_text(error)}`, 'AG_QUEUE_SCHEMA')
	}
}

const safe_relative_path = value => {
	if (!nonempty_text(value) || value.includes('\0') || path.isAbsolute(value)) return false
	const normalized = path.posix.normalize(value.replaceAll('\\', '/'))
	return normalized === value.replaceAll('\\', '/') && normalized !== '.' && !normalized.split('/').includes('..')
}

const complexity_reason_names = Object.freeze([
	'material_uncertainty',
	'cross_subsystem_coordination',
	'public_or_stored_data_contract',
	'trust_boundary',
	'unresolved_material_decision',
])

const validate_repository_evidence = (evidence, required) => {
	if (!Array.isArray(evidence) || (required && evidence.length === 0)) fail('repository_evidence must be a non-empty array for simple jobs', 'AG_QUEUE_SCHEMA')
	for (const item of evidence) {
		if (!is_object(item) || !safe_relative_path(item.path) || !is_sha256(item.sha256)) fail('repository_evidence entries need a safe path and SHA-256 digest', 'AG_QUEUE_SCHEMA')
	}
	return evidence.map(item => ({ path: item.path, sha256: item.sha256 }))
}

const route_job = job => {
	if (!is_object(job)) fail('each owner job must be an object', 'AG_QUEUE_SCHEMA')
	if (!nonempty_text(job.job_id)) fail('job_id must be non-empty', 'AG_QUEUE_SCHEMA')
	if (!nonempty_text(job.request_text)) fail(`request_text must be non-empty for ${job.job_id}`, 'AG_QUEUE_SCHEMA')
	if (!Array.isArray(job.dependencies) || !job.dependencies.every(nonempty_text) || unique(job.dependencies).length !== job.dependencies.length) fail(`dependencies must be a unique array for ${job.job_id}`, 'AG_QUEUE_SCHEMA')
	const complexity_reasons = job.complexity_reasons
	if (!Array.isArray(complexity_reasons)) fail(`complexity reasons must be an array for ${job.job_id}`, 'AG_QUEUE_SCHEMA')
	if (!complexity_reasons.every(name => complexity_reason_names.includes(name))) fail(`complexity reasons contain an unsupported name for ${job.job_id}`, 'AG_QUEUE_SCHEMA')
	if (unique(complexity_reasons).length !== complexity_reasons.length) fail(`complexity reasons must be unique for ${job.job_id}`, 'AG_QUEUE_SCHEMA')
	const classification = complexity_reasons.length > 0 ? 'complex' : 'simple'
	const repository_evidence = validate_repository_evidence(job.repository_evidence, classification === 'simple')
	return {
		job_id: job.job_id,
		request_text: job.request_text,
		repository_evidence,
		dependencies: [...job.dependencies],
		classification,
		complexity_reasons: [...complexity_reasons],
	}
}

const classification_record = classified => ({
	job_id: classified.job_id,
	classification: classified.classification,
	complexity_reasons: [...classified.complexity_reasons],
})

const hash_field = (object, names) => {
	for (const name of names) if (object && object[name] !== undefined) return object[name]
	return undefined
}

const accepted_field = (object, names) => names.some(name => object && object[name] === true)

const unresolved_values = contract => {
	const values = []
	for (const name of ['unresolved_decisions', 'unresolved_material_decisions', 'open_decisions', 'blocking_decisions']) {
		if (contract[name] === undefined) continue
		if (Array.isArray(contract[name])) values.push(...contract[name])
		else if (contract[name] === true) values.push(name)
		else if (is_object(contract[name]) && contract[name].resolved !== true) values.push(name)
	}
	if (contract.unresolved_material_decision === true || contract.material_decision_resolved === false) values.push('material decision')
	return values
}

const validate_contract_gate = input => {
	const contract = input && is_object(input.contract) ? input.contract : input
	const errors = []
	if (!is_object(contract)) return { valid: false, errors: ['accepted contract must be an object'], contract: null }

	const original_request_sha256 = hash_field(contract, ['original_request_sha256', 'original_request_hash'])
	const requirements_sha256 = hash_field(contract, ['requirements_sha256', 'requirements_hash'])
	const specification_sha256 = hash_field(contract, ['specification_sha256', 'specification_hash'])
	for (const [name, value] of [['original_request_sha256', original_request_sha256], ['requirements_sha256', requirements_sha256], ['specification_sha256', specification_sha256]]) {
		if (!is_sha256(value)) errors.push(`${name} must be a SHA-256 digest`)
	}

	const requirements = contract.requirements
	const specification = contract.specification
	if (!(accepted_field(contract, ['requirements_accepted']) || accepted_field(requirements, ['accepted', 'resolved', 'complete']))) errors.push('accepted requirements are required')
	if (!(accepted_field(contract, ['specification_accepted']) || accepted_field(specification, ['accepted', 'resolved', 'complete']))) errors.push('accepted specification is required')

	const unresolved = unresolved_values(contract)
	if (unresolved.length > 0) errors.push(`unresolved material decision remains: ${String(unresolved[0])}`)
	if (contract.brownfield !== undefined && typeof contract.brownfield !== 'boolean') errors.push('brownfield must be a boolean')
	const brownfield = contract.brownfield === true
	const mandatory_stages = contract.mandatory_stages ?? contract.stages
	if (!Array.isArray(mandatory_stages) || mandatory_stages.length === 0 || !mandatory_stages.every(nonempty_text)) errors.push('mandatory_stages must be a non-empty ordered list')
	if (Array.isArray(mandatory_stages)) {
		const stage_names = mandatory_stages.map(stage => String(stage).toLowerCase())
		if (!stage_names.includes('requirements') || !stage_names.includes('specification')) errors.push('contract requires requirements and specification mandatory stages')
		const codewalk_needed = codewalk_required({ ...contract, ...(is_object(input) ? input : {}) })
		if (codewalk_needed === null) errors.push('codewalk trigger facts must be booleans for the named evidence triggers')
		if (brownfield && !stage_names.includes('discovery')) errors.push('brownfield contract requires discovery mandatory stage')
		if (brownfield && codewalk_needed && !stage_names.includes('codewalk')) errors.push('brownfield contract requires codewalk when a named evidence trigger is true')
		if (brownfield && codewalk_needed === false && stage_names.includes('codewalk')) errors.push('brownfield contract must not include codewalk when no named evidence trigger is true')
	}
	const stage_records = contract.stage_records ?? contract.mandatory_stage_records
	if (brownfield) {
		if (!Array.isArray(stage_records)) errors.push('brownfield stage records must be an array')
		else {
			const codewalk_needed = codewalk_required({ ...contract, ...(is_object(input) ? input : {}) })
			if (brownfield && codewalk_needed === false && stage_records.some(item => stage_record_id(item) === 'codewalk')) errors.push('brownfield contract must not contain a codewalk record when no named evidence trigger is true')
			const discovery_record = stage_records.find(item => stage_record_id(item) === 'discovery')
			if (codewalk_needed === true) {
				const codewalk_record = stage_records.find(item => stage_record_id(item) === 'codewalk')
				const shared_result = validate_shared_codewalk_record(codewalk_record)
				if (!shared_result.valid) errors.push(`brownfield codewalk shared record is invalid: ${shared_result.errors.join('; ')}`)
				else if (accepted_stage_record(discovery_record)) errors.push('brownfield triggered codewalk must be the one shared discovery record; overlapping discovery pass is not allowed')
			} else if (!discovery_record || !accepted_stage_record(discovery_record)) {
				errors.push('brownfield discovery stage record is not accepted')
			}
		}
	}

	const operation = String(input?.operation ?? contract.operation ?? 'make-plans').toLowerCase()
	const allow_ag = input?.allow_ag ?? contract.allow_ag
	if (allow_ag !== undefined && !['on', 'off', 'ask'].includes(allow_ag)) errors.push('allow_ag must be on, off, or ask')
	if (operation === 'make-plans' && allow_ag === 'off') errors.push('allow_ag=off blocks make-plans before queue publication')
	if (operation === 'make-plans' && allow_ag === 'ask' && input?.owner_confirmation !== 'approved' && contract.owner_confirmation !== 'approved') errors.push('allow_ag=ask requires recorded approval before queue publication')

	const normalized = {
		...clone(contract),
		original_request_sha256,
		requirements_sha256,
		specification_sha256,
		brownfield,
		mandatory_stages: Array.isArray(mandatory_stages) ? [...mandatory_stages] : [],
	}
	return { valid: errors.length === 0, errors, contract: normalized }
}

const assert_contract_gate = input => {
	const result = validate_contract_gate(input)
	if (!result.valid) fail(result.errors.join('; '), 'AG_QUEUE_CONTRACT_GATE')
	return result.contract
}

const completion_path_for = input => {
	const completion_path = input.completion_path ?? input.completion_notebook ?? 'devlog.md'
	if (!safe_relative_path(completion_path)) fail('completion_path must be a safe repository-relative path', 'AG_QUEUE_SCHEMA')
	const completion_signal = input.completion_signal ?? `${completion_path} updated`
	if (completion_signal !== `${completion_path} updated`) fail('completion_signal must exactly match completion_path updated', 'AG_QUEUE_SCHEMA')
	return { completion_path, completion_signal }
}

const section_map = body => {
	const lines = String(body).replaceAll('\r\n', '\n').split('\n')
	if (!/^# Plan \d{3}(?: — .+)?$/.test(lines[0] || '')) return { error: 'plan must start with # Plan NNN' }
	const headings = []
	for (let index = 1; index < lines.length; index += 1) {
		const match = /^## (.+)$/.exec(lines[index])
		if (match) headings.push({ name: match[1], index })
	}
	if (headings.length !== PLAN_SECTIONS.length || headings.some((heading, index) => heading.name !== PLAN_SECTIONS[index])) return { error: 'plan must contain the exact required sections in order' }
	const sections = {}
	for (let index = 0; index < headings.length; index += 1) {
		const start = headings[index].index + 1
		const end = index + 1 < headings.length ? headings[index + 1].index : lines.length
		sections[headings[index].name] = lines.slice(start, end).join('\n').trim()
	}
	return { sections, lines }
}

const plan_name_for = order => `plan-${String(order).padStart(3, '0')}.md`

const normalize_dependencies = value => {
	if (value === undefined || value === null || (typeof value === 'string' && value.trim() === 'None.')) return []
	if (!Array.isArray(value) || !value.every(nonempty_text)) fail('plan dependencies must be an array of plan basenames', 'AG_QUEUE_SCHEMA')
	return [...value]
}

const legacy_dependency_line = dependencies => {
	const names = dependencies.map(name => `\`${name}\``)
	if (names.length === 1) return `${names[0]}.`
	if (names.length === 2) return `${names[0]} and ${names[1]}.`
	return `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}.`
}

const list_text = (value, label) => {
	if (typeof value === 'string' && value.trim()) return value.trim()
	if (Array.isArray(value) && value.length > 0 && value.every(item => nonempty_text(item))) return value.map(item => `- ${item}`).join('\n')
	fail(`${label} must be non-empty`, 'AG_QUEUE_SCHEMA')
}

const authority_lines = authority => {
	if (!is_object(authority)) fail('v2 plan authority must be an object', 'AG_QUEUE_SCHEMA')
	if (authority.route === 'simple') return [
		`- id: ${authority.id}`,
		'- route: simple',
		`- job_id: ${authority.job_id}`,
		`- owner_request_sha256: ${authority.owner_request_sha256}`,
		'- repository_evidence:',
		...(Array.isArray(authority.repository_evidence) ? authority.repository_evidence.flatMap(item => [`  - path: ${item.path}`, `    - sha256: ${item.sha256}`]) : []),
	]
	if (authority.route === 'complex') return [
		`- id: ${authority.id}`,
		'- route: complex',
		`- original_request_sha256: ${authority.original_request_sha256}`,
		`- requirements_sha256: ${authority.requirements_sha256}`,
		`- specification_sha256: ${authority.specification_sha256}`,
	]
	if (authority.route === 'integration') return [
		`- id: ${authority.id}`,
		'- route: integration',
		`- included_authority_ids: ${Array.isArray(authority.included_authority_ids) ? authority.included_authority_ids.join(', ') : ''}`,
	]
	fail('v2 plan authority route is invalid', 'AG_QUEUE_SCHEMA')
}

const build_v2_plan_body = (input, context) => {
	const order = input.order
	const name = input.path ?? input.name ?? plan_name_for(order)
	const dependencies = normalize_dependencies(input.dependencies)
	const completion_signal = context.completion_signal ?? input.completion_signal
	const authority = context.authority
	if (!is_positive_integer(order) || name !== plan_name_for(order)) fail('plan order and path must match plan-NNN.md', 'AG_QUEUE_SCHEMA')
	if (!nonempty_text(input.contract_part)) fail(`contract_part is required for ${name}`, 'AG_QUEUE_SCHEMA')
	if (!nonempty_text(completion_signal)) fail(`completion signal is required for ${name}`, 'AG_QUEUE_SCHEMA')
	if (!is_object(authority)) fail(`authority is required for ${name}`, 'AG_QUEUE_SCHEMA')
	return [
		`# Plan ${String(order).padStart(3, '0')}`,
		'',
		'## Authority',
		...authority_lines(authority),
		`- generation_id: ${context.generation_id}`,
		`- plan_path: ${name}`,
		'',
		'## Outcome',
		list_text(input.outcome, 'plan outcome'),
		'',
		'## Dependencies',
		dependencies.length === 0 ? 'None.' : dependencies.map(item => `- ${item}`).join('\n'),
		'',
		'## Required work',
		list_text(input.required_work, 'required work'),
		'',
		'## Constraints',
		list_text(input.constraints, 'plan constraints'),
		'',
		'## Tests and evidence',
		list_text(input.tests_and_evidence, 'tests and evidence'),
		'',
		'## Completion conditions',
		list_text(input.completion_conditions, 'completion conditions'),
		'',
		'## Success signal',
		completion_signal,
		'',
		'## Final integration',
		String(input.final_integration === true),
		'',
	].join('\n')
}

const build_plan_body = (input, context = {}) => {
	if (context.schema_version === 2) return build_v2_plan_body(input, context)
	const order = input.order
	const name = input.path ?? input.name ?? plan_name_for(order)
	const dependencies = normalize_dependencies(input.dependencies)
	const completion_signal = context.completion_signal ?? input.completion_signal
	if (!is_positive_integer(order) || name !== plan_name_for(order)) fail('plan order and path must match plan-NNN.md', 'AG_QUEUE_SCHEMA')
	if (!nonempty_text(input.contract_part)) fail(`contract_part is required for ${name}`, 'AG_QUEUE_SCHEMA')
	if (!nonempty_text(completion_signal)) fail(`completion signal is required for ${name}`, 'AG_QUEUE_SCHEMA')
	return [
		`# Plan ${String(order).padStart(3, '0')}`,
		'',
		'## Authority',
		`- original_request_sha256: ${context.original_request_sha256}`,
		`- requirements_sha256: ${context.requirements_sha256}`,
		`- specification_sha256: ${context.specification_sha256}`,
		`- generation_id: ${context.generation_id}`,
		'',
		'## Outcome',
		list_text(input.outcome, 'plan outcome'),
		'',
		'## Dependencies',
		dependencies.length === 0 ? 'None.' : dependencies.map(item => `- ${item}`).join('\n'),
		'',
		'## Required work',
		list_text(input.required_work, 'required work'),
		'',
		'## Constraints',
		list_text(input.constraints, 'plan constraints'),
		'',
		'## Tests and evidence',
		list_text(input.tests_and_evidence, 'tests and evidence'),
		'',
		'## Completion conditions',
		list_text(input.completion_conditions, 'completion conditions'),
		'',
		'## Success signal',
		completion_signal,
		'',
		'## Final integration',
		String(input.final_integration === true),
		'',
	].join('\n')
}

const validate_v2_plan_body = (body, plan, envelope) => {
	const parsed = section_map(body)
	const errors = []
	if (parsed.error) errors.push(parsed.error)
	if (!parsed.sections) return { valid: false, errors, sections: null }
	if (plan?.order !== undefined && !new RegExp(`^# Plan ${String(plan.order).padStart(3, '0')}$`).test(parsed.lines[0])) errors.push(`${plan?.path ?? 'plan'} heading does not match its order`)
	for (const section of PLAN_SECTIONS) if (!nonempty_text(parsed.sections[section])) errors.push(`${plan?.path ?? 'plan'} section ${section} is empty`)
	const authority = envelope.authorities.find(item => item.id === plan?.authority_id)
	if (!authority) errors.push(`${plan?.path ?? 'plan'} references an unknown authority_id`)
	else {
		if (!['simple', 'complex', 'integration'].includes(authority.route)) errors.push(`${plan.path} authority route is invalid`)
		else {
			const expected_authority = [...authority_lines(authority), `- generation_id: ${envelope.generation_id}`, `- plan_path: ${plan.path}`]
			const actual_authority = parsed.sections.Authority.split('\n').map(line => line.trimEnd()).filter(line => line.trim())
			if (actual_authority.length !== expected_authority.length || actual_authority.some((line, index) => line !== expected_authority[index])) errors.push(`${plan.path} authority records do not exactly match the frozen envelope`)
		}
	}
	const expected_dependencies = normalize_dependencies(plan?.dependencies)
	const actual_dependencies = parsed.sections.Dependencies.split('\n').map(line => line.trim()).filter(Boolean)
	const expected_dependency_lines = expected_dependencies.length === 0 ? ['None.'] : expected_dependencies.map(dependency => `- ${dependency}`)
	if (actual_dependencies.length !== expected_dependency_lines.length || actual_dependencies.some((line, index) => line !== expected_dependency_lines[index])) errors.push(`${plan?.path ?? 'plan'} dependencies do not exactly match the frozen envelope`)
	if (parsed.sections['Success signal'] !== envelope.completion_signal) errors.push(`${plan?.path ?? 'plan'} has the wrong success signal`)
	const final_match = /^(true|false)(?:\.|$)(?:\s|$)/i.exec(parsed.sections['Final integration'])
	const final_value = final_match ? final_match[1].toLowerCase() : null
	if (!final_value) errors.push(`${plan?.path ?? 'plan'} final integration must start with true or false`)
	if (plan && final_value !== String(plan.final_integration === true)) errors.push(`${plan.path} final integration does not match the envelope`)
	return { valid: errors.length === 0, errors, sections: parsed.sections }
}

const validate_plan_body = (body, plan, context = {}) => {
	if (context.schema_version === 2) return validate_v2_plan_body(body, plan, context)
	const parsed = section_map(body)
	const errors = []
	if (parsed.error) errors.push(parsed.error)
	if (parsed.sections) {
		if (plan?.order !== undefined && !new RegExp(`^# Plan ${String(plan.order).padStart(3, '0')}(?: — .+)?$`).test(parsed.lines[0])) errors.push(`${plan?.path ?? 'plan'} heading does not match its order`)
		for (const section of PLAN_SECTIONS) if (!nonempty_text(parsed.sections[section])) errors.push(`${plan?.path ?? 'plan'} section ${section} is empty`)
		const expected_authority = [
			`- original_request_sha256: ${context.original_request_sha256}`,
			`- requirements_sha256: ${context.requirements_sha256}`,
			`- specification_sha256: ${context.specification_sha256}`,
			`- generation_id: ${context.generation_id}`,
		]
		const authority_lines = parsed.sections.Authority.split('\n').map(line => line.trim()).filter(Boolean)
		const canonical_authority = expected_authority.every((line, index) => authority_lines[index] === line) && authority_lines.length === expected_authority.length
		const legacy_authority = authority_lines.length === 5
			&& authority_lines[0] === `Queue generation: \`${context.generation_id}\`.`
			&& new RegExp('^Original request: .+, SHA-256 `' + context.original_request_sha256 + '`\\.$').test(authority_lines[1])
			&& new RegExp('^Requirements: .+, SHA-256 `' + context.requirements_sha256 + '`\\.$').test(authority_lines[2])
			&& new RegExp('^Specification: .+, SHA-256 `' + context.specification_sha256 + '`\\.$').test(authority_lines[3])
			&& /^Owned contract: .+\.$/.test(authority_lines[4])
		if (!canonical_authority && !legacy_authority) errors.push(`${plan?.path ?? 'plan'} authority records do not exactly match the frozen envelope`)
		const expected_dependencies = normalize_dependencies(plan?.dependencies)
		if (expected_dependencies.length === 0) {
			if (parsed.sections.Dependencies !== 'None.') errors.push(`${plan?.path ?? 'plan'} must state None. for dependencies`)
		} else {
			const dependency_lines = parsed.sections.Dependencies.split('\n').map(line => line.trim()).filter(Boolean)
			const expected_lines = expected_dependencies.map(dependency => `- ${dependency}`)
			const canonical_dependencies = expected_lines.every((line, index) => dependency_lines[index] === line) && dependency_lines.length === expected_lines.length
			const legacy_dependencies = dependency_lines.length === 1 && dependency_lines[0] === legacy_dependency_line(expected_dependencies)
			if (!canonical_dependencies && !legacy_dependencies) errors.push(`${plan?.path ?? 'plan'} dependencies do not exactly match the frozen envelope`)
		}
		const success_value = parsed.sections['Success signal']
		const legacy_success = `Print exactly one complete line: \`${context.completion_signal}\`.`
		if (nonempty_text(context.completion_signal) && success_value !== context.completion_signal && success_value !== legacy_success) errors.push(`${plan?.path ?? 'plan'} has the wrong success signal`)
		const final_match = /^(true|false)(?:\.|$)(?:\s|$)/i.exec(parsed.sections['Final integration'])
		const final_value = final_match ? final_match[1].toLowerCase() : null
		if (!final_value) errors.push(`${plan?.path ?? 'plan'} final integration must start with true or false`)
		if (plan && final_value !== String(plan.final_integration === true)) errors.push(`${plan.path} final integration does not match the envelope`)
	}
	return { valid: errors.length === 0, errors, sections: parsed.sections ?? null }
}

const normalize_plan_input = (input, context, fallback_order) => {
	if (!is_object(input)) fail('each queue plan must be an object', 'AG_QUEUE_SCHEMA')
	const order = input.order === undefined ? fallback_order : input.order
	if (!is_positive_integer(order)) fail('plan order must be a positive integer', 'AG_QUEUE_SCHEMA')
	const name = input.path ?? input.name ?? plan_name_for(order)
	if (name !== plan_name_for(order)) fail(`plan path must be ${plan_name_for(order)}`, 'AG_QUEUE_SCHEMA')
	const dependencies = normalize_dependencies(input.dependencies)
	const final_integration = input.final_integration === true
	const content_value = input.content ?? input.body
	const content = content_value === undefined
		? build_plan_body({ ...input, order, path: name, dependencies, final_integration }, context)
		: Buffer.isBuffer(content_value) ? content_value.toString('utf8') : String(content_value)
	const plan = {
		path: name,
		order,
		sha256: file_digest(Buffer.from(content)),
		dependencies,
		contract_part: input.contract_part,
		final_integration,
	}
	return { plan, content: Buffer.from(content) }
}

const dependency_graph_errors = plans => {
	const errors = []
	const names = new Set(plans.map(plan => plan.path))
	const orders = new Map(plans.map(plan => [plan.path, plan.order]))
	if (new Set(plans.map(plan => plan.path)).size !== plans.length) errors.push('plan paths must be unique')
	if (new Set(plans.map(plan => plan.order)).size !== plans.length) errors.push('plan orders must be unique')
	for (const plan of plans) {
		if (!is_sha256(plan.sha256)) errors.push(`${plan.path} has no valid SHA-256 digest`)
		if (!nonempty_text(plan.contract_part)) errors.push(`${plan.path} has no contract_part`)
		if (!Array.isArray(plan.dependencies) || unique(plan.dependencies).length !== plan.dependencies.length) errors.push(`${plan.path} dependencies must be a unique array`)
		for (const dependency of plan.dependencies || []) {
			if (!names.has(dependency)) errors.push(`${plan.path} depends on unknown plan ${dependency}`)
			else if (orders.get(dependency) >= plan.order) errors.push(`${plan.path} depends on a later or same-order plan ${dependency}`)
		}
	}
	const ordered = [...plans].sort((left, right) => left.order - right.order)
	const finals = ordered.filter(plan => plan.final_integration === true)
	if (finals.length !== 1) errors.push('queue must contain exactly one final integration plan')
	else {
		const final = finals[0]
		if (final.path !== ordered.at(-1).path) errors.push('final integration plan must be the last ordered plan')
		const dependencies = new Map(ordered.map(plan => [plan.path, plan.dependencies]))
		const reached = new Set()
		const visit = name => {
			if (reached.has(name)) return
			reached.add(name)
			for (const dependency of dependencies.get(name) || []) visit(dependency)
		}
		visit(final.path)
		for (const plan of ordered.slice(0, -1)) if (!reached.has(plan.path)) errors.push(`final integration graph does not reach ${plan.path}`)
	}
	return errors
}

const envelope_keys = Object.freeze(['schema_version', 'state', 'generation_id', 'created_at', 'original_request_sha256', 'requirements_sha256', 'specification_sha256', 'completion_path', 'completion_signal', 'plans'])
const plan_keys = Object.freeze(['path', 'order', 'sha256', 'dependencies', 'contract_part', 'final_integration'])

const validate_v1_queue_envelope = (envelope, options = {}) => {
	const errors = []
	if (!is_object(envelope)) return { valid: false, errors: ['queue envelope must be a JSON object'], envelope: null }
	for (const key of envelope_keys) if (!has_own(envelope, key)) errors.push(`queue envelope is missing ${key}`)
	for (const key of Object.keys(envelope)) if (!envelope_keys.includes(key)) errors.push(`queue envelope has unknown field ${key}`)
	if (envelope.schema_version !== 1) errors.push('queue envelope schema_version must be 1')
	if (envelope.state !== 'frozen') errors.push('queue envelope state must be frozen')
	if (!nonempty_text(envelope.generation_id)) errors.push('queue envelope generation_id must be non-empty')
	if (!nonempty_text(envelope.created_at) || !Number.isFinite(Date.parse(envelope.created_at))) errors.push('queue envelope created_at must be a valid timestamp')
	for (const name of ['original_request_sha256', 'requirements_sha256', 'specification_sha256']) if (!is_sha256(envelope[name])) errors.push(`queue envelope ${name} must be a SHA-256 digest`)
	if (!safe_relative_path(envelope.completion_path)) errors.push('queue envelope completion_path must be repository-relative and safe')
	if (envelope.completion_signal !== `${envelope.completion_path} updated`) errors.push('queue envelope completion_signal must exactly match completion_path updated')
	if (!Array.isArray(envelope.plans) || envelope.plans.length === 0) errors.push('queue envelope plans must be a non-empty ordered array')
	const plans = Array.isArray(envelope.plans) ? envelope.plans : []
	for (const plan of plans) {
		if (!is_object(plan)) {
			errors.push('each queue envelope plan entry must be an object')
			continue
		}
		for (const key of plan_keys) if (!has_own(plan, key)) errors.push('queue envelope plan entry is missing ' + key)
		for (const key of Object.keys(plan)) if (!plan_keys.includes(key)) errors.push(`queue envelope plan entry has unknown field ${key}`)
		if (!PLAN_PATTERN.test(plan.path || '') || !is_positive_integer(plan.order) || plan.path !== plan_name_for(plan.order)) errors.push('queue envelope plan path and order must match plan-NNN.md')
		if (!is_sha256(plan.sha256)) errors.push(`${plan.path || 'plan'} sha256 must be a SHA-256 digest`)
		if (!Array.isArray(plan.dependencies) || !plan.dependencies.every(item => PLAN_PATTERN.test(item))) errors.push(`${plan.path || 'plan'} dependencies must contain plan basenames`)
		if (!nonempty_text(plan.contract_part)) errors.push(`${plan.path || 'plan'} contract_part must be non-empty`)
		if (typeof plan.final_integration !== 'boolean') errors.push(`${plan.path || 'plan'} final_integration must be boolean`)
	}
	const graph_ready = plans.length > 0 && plans.every(plan => is_object(plan) && nonempty_text(plan.path) && is_positive_integer(plan.order) && Array.isArray(plan.dependencies))
	if (graph_ready) {
		const ordered = [...plans].sort((left, right) => left.order - right.order)
		if (plans.some((plan, index) => plan.order !== ordered[index]?.order)) errors.push('queue envelope plans must be ordered by plan number')
		errors.push(...dependency_graph_errors(plans))
	}
	const plan_bytes = options.plan_bytes
	if (plan_bytes !== undefined) {
		const get_bytes = name => plan_bytes instanceof Map ? plan_bytes.get(name) : is_object(plan_bytes) ? plan_bytes[name] : undefined
		for (const plan of plans) {
			if (!is_object(plan) || !PLAN_PATTERN.test(plan.path || '')) continue
			const bytes = get_bytes(plan.path)
			if (bytes === undefined) errors.push(`plan bytes are missing for ${plan.path}`)
			else {
				const normalized = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes))
				if (normalized.length > MAX_PLAN_BYTES) errors.push(`${plan.path} exceeds the ${MAX_PLAN_BYTES}-byte limit`)
				if (file_digest(normalized) !== plan.sha256) errors.push(`${plan.path} digest does not match the frozen envelope`)
				const body_result = validate_plan_body(normalized.toString('utf8'), plan, envelope)
				if (!body_result.valid) errors.push(...body_result.errors)
			}
		}
	}
	return { valid: errors.length === 0, errors, envelope: errors.length === 0 ? envelope : null }
}

const authority_keys = Object.freeze({
	simple: ['id', 'route', 'job_id', 'owner_request_sha256', 'repository_evidence'],
	complex: ['id', 'route', 'original_request_sha256', 'requirements_sha256', 'specification_sha256'],
	integration: ['id', 'route', 'included_authority_ids'],
})

const same_values = (left, right) => Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => value === right[index])

const validate_v2_authority = authority => {
	const errors = []
	if (!is_object(authority)) return ['each v2 authority entry must be an object']
	if (!nonempty_text(authority.id)) errors.push('v2 authority id must be non-empty')
	if (!['simple', 'complex', 'integration'].includes(authority.route)) {
		errors.push('v2 authority route must be simple, complex, or integration')
		return errors
	}
	for (const key of authority_keys[authority.route]) if (!has_own(authority, key)) errors.push(`v2 ${authority.route} authority is missing ${key}`)
	for (const key of Object.keys(authority)) if (!authority_keys[authority.route].includes(key)) errors.push(`v2 ${authority.route} authority has unknown field ${key}`)
	if (authority.route === 'simple') {
		if (!nonempty_text(authority.job_id)) errors.push('simple authority job_id must be non-empty')
		if (!is_sha256(authority.owner_request_sha256)) errors.push('simple authority owner_request_sha256 must be a SHA-256 digest')
		if (!Array.isArray(authority.repository_evidence) || authority.repository_evidence.length === 0) errors.push('simple authority repository_evidence must be non-empty')
		else for (const item of authority.repository_evidence) {
			if (!is_object(item) || Object.keys(item).some(key => !['path', 'sha256'].includes(key)) || !safe_relative_path(item.path) || !is_sha256(item.sha256)) errors.push('simple authority repository_evidence entries need only a safe path and SHA-256 digest')
		}
	}
	if (authority.route === 'complex') {
		for (const name of ['original_request_sha256', 'requirements_sha256', 'specification_sha256']) if (!is_sha256(authority[name])) errors.push(`complex authority ${name} must be a SHA-256 digest`)
	}
	if (authority.route === 'integration') {
		if (!Array.isArray(authority.included_authority_ids) || authority.included_authority_ids.length === 0 || !authority.included_authority_ids.every(nonempty_text) || unique(authority.included_authority_ids).length !== authority.included_authority_ids.length) errors.push('integration authority included_authority_ids must be a non-empty unique array')
	}
	return errors
}

const validate_v2_queue_envelope = (envelope, options = {}) => {
	const errors = []
	if (!is_object(envelope)) return { valid: false, errors: ['queue envelope must be a JSON object'], envelope: null }
	const v2_envelope_keys = ['schema_version', 'state', 'generation_id', 'created_at', 'completion_path', 'completion_signal', 'authorities', 'plans']
	for (const key of v2_envelope_keys) if (!has_own(envelope, key)) errors.push(`v2 queue envelope is missing ${key}`)
	for (const key of Object.keys(envelope)) if (!v2_envelope_keys.includes(key)) errors.push(`v2 queue envelope has unknown field ${key}`)
	if (envelope.schema_version !== 2) errors.push('queue envelope schema_version must be 2')
	if (envelope.state !== 'frozen') errors.push('queue envelope state must be frozen')
	if (!nonempty_text(envelope.generation_id)) errors.push('queue envelope generation_id must be non-empty')
	if (!nonempty_text(envelope.created_at) || !Number.isFinite(Date.parse(envelope.created_at))) errors.push('queue envelope created_at must be a valid timestamp')
	if (!safe_relative_path(envelope.completion_path)) errors.push('queue envelope completion_path must be repository-relative and safe')
	if (envelope.completion_signal !== `${envelope.completion_path} updated`) errors.push('queue envelope completion_signal must exactly match completion_path updated')
	if (!Array.isArray(envelope.authorities) || envelope.authorities.length === 0) errors.push('v2 queue envelope authorities must be a non-empty array')
	if (!Array.isArray(envelope.plans) || envelope.plans.length === 0) errors.push('v2 queue envelope plans must be a non-empty ordered array')
	const authorities = Array.isArray(envelope.authorities) ? envelope.authorities : []
	const plans = Array.isArray(envelope.plans) ? envelope.plans : []
	const authority_ids = new Set()
	for (const authority of authorities) {
		for (const error of validate_v2_authority(authority)) errors.push(error)
		if (is_object(authority) && nonempty_text(authority.id)) {
			if (authority_ids.has(authority.id)) errors.push(`duplicate v2 authority id: ${authority.id}`)
			authority_ids.add(authority.id)
		}
	}
	const plan_key_set = ['path', 'order', 'sha256', 'dependencies', 'contract_part', 'final_integration', 'route', 'authority_id']
	for (const plan of plans) {
		if (!is_object(plan)) {
			errors.push('each v2 queue envelope plan entry must be an object')
			continue
		}
		for (const key of plan_key_set) if (!has_own(plan, key)) errors.push(`v2 queue envelope plan entry is missing ${key}`)
		for (const key of Object.keys(plan)) if (!plan_key_set.includes(key)) errors.push(`v2 queue envelope plan entry has unknown field ${key}`)
		if (!PLAN_PATTERN.test(plan.path || '') || !is_positive_integer(plan.order) || plan.path !== plan_name_for(plan.order)) errors.push('v2 queue envelope plan path and order must match plan-NNN.md')
		if (!is_sha256(plan.sha256)) errors.push(`${plan.path || 'plan'} sha256 must be a SHA-256 digest`)
		if (!Array.isArray(plan.dependencies) || !plan.dependencies.every(item => PLAN_PATTERN.test(item))) errors.push(`${plan.path || 'plan'} dependencies must contain plan basenames`)
		if (!nonempty_text(plan.contract_part)) errors.push(`${plan.path || 'plan'} contract_part must be non-empty`)
		if (typeof plan.final_integration !== 'boolean') errors.push(`${plan.path || 'plan'} final_integration must be boolean`)
		if (!['simple', 'complex', 'integration'].includes(plan.route)) errors.push(`${plan.path || 'plan'} route must be simple, complex, or integration`)
		if (!nonempty_text(plan.authority_id) || !authority_ids.has(plan.authority_id)) errors.push(`${plan.path || 'plan'} authority_id must reference one envelope authority`)
	}
	const graph_ready = plans.length > 0 && plans.every(plan => is_object(plan) && nonempty_text(plan.path) && is_positive_integer(plan.order) && Array.isArray(plan.dependencies))
	if (graph_ready) {
		const ordered = [...plans].sort((left, right) => left.order - right.order)
		if (plans.some((plan, index) => plan.order !== ordered[index]?.order)) errors.push('v2 queue envelope plans must be ordered by plan number')
		errors.push(...dependency_graph_errors(plans))
		const finals = ordered.filter(plan => plan.final_integration === true)
		if (finals.length === 1) {
			const final = finals[0]
			if (final.route !== 'integration') errors.push('v2 final integration plan must use the integration route')
			const nonfinal = ordered.filter(plan => plan !== final)
			for (const plan of nonfinal) {
				if (plan.final_integration) errors.push(`${plan.path} cannot be a non-final integration plan`)
				const authority = authorities.find(item => item.id === plan.authority_id)
				if (authority && authority.route !== plan.route) errors.push(`${plan.path} route does not match its authority`)
			}
			const terminal = nonfinal.filter(plan => !nonfinal.some(other => other.dependencies.includes(plan.path))).map(plan => plan.path)
			if (!same_values(final.dependencies, terminal)) errors.push('v2 final integration dependencies must be the ordered terminal plans')
			const integration_authority = authorities.find(item => item.id === final.authority_id)
			if (!integration_authority || integration_authority.route !== 'integration') errors.push('v2 final integration authority must use the integration route')
			else {
				const used_nonfinal_authorities = unique(nonfinal.map(plan => plan.authority_id))
				if (!same_values(integration_authority.included_authority_ids, used_nonfinal_authorities)) errors.push('v2 integration authority must include every non-final authority in order')
			}
		}
		const used_authority_ids = unique(plans.map(plan => plan.authority_id))
		if (used_authority_ids.length !== authority_ids.size || [...authority_ids].some(id => !used_authority_ids.includes(id))) errors.push('v2 queue envelope contains an unused authority')
	}
	const plan_bytes = options.plan_bytes
	if (plan_bytes !== undefined) {
		const get_bytes = name => plan_bytes instanceof Map ? plan_bytes.get(name) : is_object(plan_bytes) ? plan_bytes[name] : undefined
		for (const plan of plans) {
			if (!is_object(plan) || !PLAN_PATTERN.test(plan.path || '')) continue
			const bytes = get_bytes(plan.path)
			if (bytes === undefined) errors.push(`plan bytes are missing for ${plan.path}`)
			else {
				const normalized = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes))
				if (normalized.length > MAX_PLAN_BYTES) errors.push(`${plan.path} exceeds the ${MAX_PLAN_BYTES}-byte limit`)
				if (file_digest(normalized) !== plan.sha256) errors.push(`${plan.path} digest does not match the frozen envelope`)
				const body_result = validate_plan_body(normalized.toString('utf8'), plan, envelope)
				if (!body_result.valid) errors.push(...body_result.errors)
			}
		}
	}
	return { valid: errors.length === 0, errors, envelope: errors.length === 0 ? envelope : null }
}

const validate_queue_envelope = (envelope, options = {}) => envelope?.schema_version === 2
	? validate_v2_queue_envelope(envelope, options)
	: validate_v1_queue_envelope(envelope, options)

const assert_queue_envelope = (envelope, options = {}) => {
	const result = validate_queue_envelope(envelope, options)
	if (!result.valid) fail(result.errors.join('; '), 'AG_QUEUE_ENVELOPE')
	return envelope
}

const build_queue = input => {
	if (!is_object(input)) fail('queue build input must be an object', 'AG_QUEUE_SCHEMA')
	if (input.schema_version === 2 || Array.isArray(input.authorities)) return build_v2_queue(input)
	const contract = assert_contract_gate(input.contract === undefined ? input : { ...input, contract: input.contract })
	const { completion_path, completion_signal } = completion_path_for(input)
	if (!nonempty_text(input.generation_id)) fail('generation_id must be non-empty', 'AG_QUEUE_SCHEMA')
	if (!nonempty_text(input.created_at) || !Number.isFinite(Date.parse(input.created_at))) fail('created_at must be a valid timestamp', 'AG_QUEUE_SCHEMA')
	if (!Array.isArray(input.plans) || input.plans.length === 0) fail('plans must be a non-empty array', 'AG_QUEUE_SCHEMA')
	const start_order = input.start_order ?? 1
	if (!is_positive_integer(start_order)) fail('start_order must be a positive integer', 'AG_QUEUE_SCHEMA')
	const context = {
		original_request_sha256: contract.original_request_sha256,
		requirements_sha256: contract.requirements_sha256,
		specification_sha256: contract.specification_sha256,
		generation_id: input.generation_id,
		completion_signal,
	}
	const normalized = input.plans.map((plan, index) => normalize_plan_input(plan, context, start_order + index))
	const plans = normalized.map(item => item.plan).sort((left, right) => left.order - right.order)
	const plan_bytes = Object.fromEntries(normalized.map(item => [item.plan.path, item.content]))
	const envelope = {
		schema_version: 1,
		state: 'frozen',
		generation_id: input.generation_id,
		created_at: input.created_at,
		original_request_sha256: contract.original_request_sha256,
		requirements_sha256: contract.requirements_sha256,
		specification_sha256: contract.specification_sha256,
		completion_path,
		completion_signal,
		plans,
	}
	assert_queue_envelope(envelope, { plan_bytes })
	return { envelope, plan_bytes, plans, contract }
}

const build_v2_queue = input => {
	if (!is_object(input)) fail('queue build input must be an object', 'AG_QUEUE_SCHEMA')
	const { completion_path, completion_signal } = completion_path_for(input)
	if (!nonempty_text(input.generation_id)) fail('generation_id must be non-empty', 'AG_QUEUE_SCHEMA')
	if (!nonempty_text(input.created_at) || !Number.isFinite(Date.parse(input.created_at))) fail('created_at must be a valid timestamp', 'AG_QUEUE_SCHEMA')
	if (!Array.isArray(input.authorities) || input.authorities.length === 0) fail('authorities must be a non-empty array for schema-v2', 'AG_QUEUE_SCHEMA')
	if (!Array.isArray(input.plans) || input.plans.length === 0) fail('plans must be a non-empty array', 'AG_QUEUE_SCHEMA')
	const start_order = input.start_order ?? 1
	if (!is_positive_integer(start_order)) fail('start_order must be a positive integer', 'AG_QUEUE_SCHEMA')
	const authorities = clone(input.authorities)
	const authority_by_id = new Map(authorities.filter(is_object).map(authority => [authority.id, authority]))
	const context = {
		schema_version: 2,
		authorities,
		generation_id: input.generation_id,
		completion_signal,
	}
	const normalized = input.plans.map((plan_input, index) => {
		if (!is_object(plan_input)) fail('each queue plan must be an object', 'AG_QUEUE_SCHEMA')
		const order = plan_input.order === undefined ? start_order + index : plan_input.order
		const name = plan_input.path ?? plan_input.name ?? plan_name_for(order)
		const dependencies = normalize_dependencies(plan_input.dependencies)
		const final_integration = plan_input.final_integration === true
		const route = plan_input.route
		const authority = authority_by_id.get(plan_input.authority_id)
		if (!is_positive_integer(order) || name !== plan_name_for(order)) fail('plan order and path must match plan-NNN.md', 'AG_QUEUE_SCHEMA')
		if (!['simple', 'complex', 'integration'].includes(route)) fail(`plan route is invalid for ${name}`, 'AG_QUEUE_SCHEMA')
		if (!nonempty_text(plan_input.authority_id) || !authority) fail(`plan authority_id is invalid for ${name}`, 'AG_QUEUE_SCHEMA')
		const content_value = plan_input.content ?? plan_input.body
		const content = content_value === undefined
			? build_plan_body({ ...plan_input, order, path: name, dependencies, final_integration }, { ...context, authority })
			: Buffer.isBuffer(content_value) ? content_value.toString('utf8') : String(content_value)
		const plan = {
			path: name,
			order,
			sha256: file_digest(Buffer.from(content)),
			dependencies,
			contract_part: plan_input.contract_part,
			final_integration,
			route,
			authority_id: plan_input.authority_id,
		}
		return { plan, content: Buffer.from(content) }
	})
	const plans = normalized.map(item => item.plan).sort((left, right) => left.order - right.order)
	const plan_bytes = Object.fromEntries(normalized.map(item => [item.plan.path, item.content]))
	const envelope = {
		schema_version: 2,
		state: 'frozen',
		generation_id: input.generation_id,
		created_at: input.created_at,
		completion_path,
		completion_signal,
		authorities,
		plans,
	}
	assert_queue_envelope(envelope, { plan_bytes })
	return { envelope, plan_bytes, plans, authorities }
}

const path_exists = file => {
	try {
		fs.lstatSync(file)
		return true
	} catch (error) {
		if (error && error.code === 'ENOENT') return false
		throw error
	}
}

const inspect_queue_state = tasks_dir => {
	const queue = ensure_directory(tasks_dir, 'tasks directory')
	const done_dir = path.join(queue, 'done')
	if (path_exists(done_dir)) ensure_directory(done_dir, 'completed plan directory')
	return { tasks_dir: queue, done_dir }
}

const plan_numbers = (directory, include_directory = true) => {
	const numbers = []
	const scan = target => {
		if (!path_exists(target)) return
		for (const name of fs.readdirSync(target)) {
			const match = PLAN_PATTERN.exec(name)
			if (match) numbers.push(Number(match[1]))
		}
	}
	scan(directory)
	if (include_directory) scan(path.join(directory, 'done'))
	return numbers
}

const ensure_destination_free = (tasks_dir, done_dir, plans) => {
	for (const plan of plans) {
		for (const target of [path.join(tasks_dir, plan.path), path.join(done_dir, plan.path)]) {
			if (path_exists(target)) fail(`queue destination collision: ${target}`, 'AG_QUEUE_COLLISION')
		}
	}
}

const write_exclusive = (file, bytes) => {
	let descriptor
	let created = false
	try {
		descriptor = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600)
		created = true
		let offset = 0
		while (offset < bytes.length) offset += fs.writeSync(descriptor, bytes, offset, bytes.length - offset)
	} catch (error) {
		if (descriptor !== undefined) {
			try { fs.closeSync(descriptor) } catch {}
		}
		if (created) {
			try { fs.unlinkSync(file) } catch {}
		}
		fail(`exclusive write failed for ${file}: ${error_text(error)}`, 'AG_QUEUE_PUBLICATION')
	} finally {
		if (descriptor !== undefined) {
			try { fs.closeSync(descriptor) } catch {}
		}
	}
}

const move_without_overwrite = (source, destination) => {
	try {
		fs.linkSync(source, destination)
		fs.unlinkSync(source)
		return
	} catch (error) {
		if (error && error.code === 'EEXIST') fail(`refusing to overwrite existing path: ${destination}`, 'AG_QUEUE_COLLISION')
		if (!error || !['EXDEV', 'EPERM', 'EOPNOTSUPP'].includes(error.code)) throw error
	}
	fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL)
	fs.unlinkSync(source)
}

const read_frozen_plan_bytes = (tasks_dir, plan_name, label = 'frozen plan') => {
	const open_path = path.join(tasks_dir, plan_name)
	const done_path = path.join(tasks_dir, 'done', plan_name)
	const open_exists = path_exists(open_path)
	const done_exists = path_exists(done_path)
	if (open_exists && done_exists) fail(`${label} exists in both open and completed locations: ${plan_name}`, 'AG_QUEUE_COLLISION')
	if (!open_exists && !done_exists) fail(`${label} is missing from open and completed locations: ${plan_name}`, 'AG_QUEUE_MISSING')
	return read_regular_bytes(open_exists ? open_path : done_path, `${label} ${plan_name}`)
}

const frozen_plan_names = (directory, label) => {
	if (!path_exists(directory)) return []
	const stat = fs.lstatSync(directory)
	if (stat.isSymbolicLink() || !stat.isDirectory()) fail(`${label} must be a real directory: ${directory}`, 'AG_QUEUE_UNSAFE_PATH')
	return fs.readdirSync(directory).filter(name => PLAN_PATTERN.test(name))
}

const compare_authority_result = (expected, actual) => {
	if (!is_object(expected)) fail('expected frozen queue authority must be an object', 'AG_QUEUE_AUTHORITY')
	if (expected.envelope_sha256 !== actual.envelope_sha256) fail('frozen queue envelope authority is stale or changed', 'AG_QUEUE_CHANGED')
	if (!Buffer.isBuffer(expected.envelope_bytes) || !expected.envelope_bytes.equals(actual.envelope_bytes)) fail('frozen queue envelope bytes are stale or changed', 'AG_QUEUE_CHANGED')
	const expected_bytes = expected.plan_bytes
	const actual_bytes = actual.plan_bytes
	if (!is_object(expected_bytes)) fail('expected frozen queue authority has no exact plan bytes', 'AG_QUEUE_AUTHORITY')
	const expected_names = Object.keys(expected_bytes).sort()
	const actual_names = Object.keys(actual_bytes).sort()
	if (expected_names.length !== actual_names.length || expected_names.some((name, index) => name !== actual_names[index])) fail('frozen queue plan authority is stale or changed', 'AG_QUEUE_CHANGED')
	for (const name of expected_names) {
		if (!Buffer.isBuffer(expected_bytes[name]) || !Buffer.isBuffer(actual_bytes[name]) || !expected_bytes[name].equals(actual_bytes[name])) fail(`frozen plan bytes are stale or changed: ${name}`, 'AG_QUEUE_CHANGED')
	}
	if (expected.plan_locations !== undefined) {
		if (!is_object(expected.plan_locations) || JSON.stringify(expected.plan_locations) !== JSON.stringify(actual.plan_locations)) fail('frozen queue plan locations are stale or changed', 'AG_QUEUE_CHANGED')
	}
	return true
}

const existing_envelope = (tasks_dir, options) => {
	const envelope_path = path.join(tasks_dir, ENVELOPE_NAME)
	if (!path_exists(envelope_path)) return null
	const envelope_bytes = read_regular_bytes(envelope_path, 'queue envelope')
	const envelope = parse_json_bytes(envelope_bytes, 'queue envelope')
	if (!Array.isArray(envelope.plans)) fail(`queue envelope plans are not an array: ${envelope_path}`, 'AG_QUEUE_SCHEMA')
	assert_queue_envelope(envelope)
	const plan_bytes = {}
	for (const plan of envelope.plans || []) plan_bytes[plan.path] = read_frozen_plan_bytes(tasks_dir, plan.path)
	assert_queue_envelope(envelope, { plan_bytes })
	return { envelope, plan_bytes, bytes: envelope_bytes, sha256: file_digest(envelope_bytes), path: envelope_path, identity: stat_identity(fs.lstatSync(envelope_path)) }
}

const publication_failure_result = (error, staging_path, moved_paths = []) => ({
	published: false,
	authority_published: false,
	implementation_started: false,
	staging_path: staging_path || null,
	moved_paths,
	message: error_text(error),
})

const publish_queue = input => {
	if (!is_object(input)) fail('queue publication input must be an object', 'AG_QUEUE_SCHEMA')
	if (String(input.operation ?? 'make-plans').toLowerCase() !== 'make-plans') fail('queue publication requires the make-plans operation', 'AG_QUEUE_ROUTE')
	if (input.schema_version === 2 || Array.isArray(input.authorities)) return publish_v2_queue(input)
	const contract = assert_contract_gate(input.contract === undefined ? input : { ...input, contract: input.contract })
	const tasks_dir = ensure_directory(input.tasks_dir ?? input.tasks_dir_path, 'tasks directory')
	const state = inspect_queue_state(tasks_dir, input)
	const done_dir = state.done_dir
	if (!path_exists(done_dir)) fs.mkdirSync(done_dir, { mode: 0o700 })
	const existing = existing_envelope(tasks_dir, input)
	const starting_order = Math.max(0, ...plan_numbers(tasks_dir), ...(existing?.envelope.plans || []).map(plan => plan.order)) + 1
	const plan_input = input.plans
	if (!Array.isArray(plan_input) || plan_input.length === 0) fail('plans must be a non-empty array', 'AG_QUEUE_SCHEMA')
	const generation_id = input.generation_id
	if (!nonempty_text(generation_id)) fail('generation_id must be non-empty', 'AG_QUEUE_SCHEMA')
	if (existing && (existing.envelope.original_request_sha256 !== contract.original_request_sha256 || existing.envelope.requirements_sha256 !== contract.requirements_sha256 || existing.envelope.specification_sha256 !== contract.specification_sha256)) fail('existing frozen queue contract identities do not match the accepted contract', 'AG_QUEUE_CONFLICT')
	if (existing && existing.envelope.generation_id === generation_id) fail('new queue generation_id must be unique from the existing frozen queue', 'AG_QUEUE_CONFLICT')
	if (existing?.envelope.plans.some(plan => plan.final_integration === true)) fail('an existing frozen queue already has its final integration plan; it cannot be extended', 'AG_QUEUE_CONFLICT')
	const built = build_queue({ ...input, tasks_dir, contract, plans: plan_input.map((plan, index) => ({ ...plan, order: plan.order ?? starting_order + index })), start_order: starting_order, generation_id })
	if (existing) {
		for (const plan of built.plans) if (plan.order <= Math.max(...existing.envelope.plans.map(item => item.order))) fail('new plan numbers must be higher than every existing plan', 'AG_QUEUE_CONFLICT')
	}
	ensure_destination_free(tasks_dir, done_dir, built.plans)
	const combined_plans = existing ? [...existing.envelope.plans, ...built.plans] : built.plans
	const combined_bytes = existing ? { ...existing.plan_bytes, ...built.plan_bytes } : built.plan_bytes
	const envelope = existing ? {
		...built.envelope,
		plans: combined_plans,
	} : built.envelope
	assert_queue_envelope(envelope, { plan_bytes: combined_bytes })

	const stage_parent = input.staging_parent ? ensure_directory(input.staging_parent, 'staging parent') : path.dirname(tasks_dir)
	if (path_is_within(stage_parent, tasks_dir) || path_is_within(tasks_dir, stage_parent) && stage_parent === tasks_dir) fail('staging area must be outside the executable tasks directory', 'AG_QUEUE_UNSAFE_PATH')
	const staging_path = fs.mkdtempSync(path.join(stage_parent, `.queue-stage-${process.pid}-`))
	fs.chmodSync(staging_path, 0o700)
	const moved_paths = []
	try {
		for (const plan of built.plans) {
			const staged_plan = path.join(staging_path, plan.path)
			write_exclusive(staged_plan, combined_bytes[plan.path])
			const staged_bytes = read_regular_bytes(staged_plan, `staged plan ${plan.path}`)
			if (file_digest(staged_bytes) !== plan.sha256) fail(`staged plan digest changed: ${plan.path}`, 'AG_QUEUE_CHANGED')
		}
		const envelope_bytes = Buffer.from(`${JSON.stringify(envelope)}\n`)
		const staged_envelope = path.join(staging_path, ENVELOPE_NAME)
		write_exclusive(staged_envelope, envelope_bytes)
		const staged_envelope_value = parse_json_bytes(read_regular_bytes(staged_envelope, 'staged queue envelope'), 'staged queue envelope')
		assert_queue_envelope(staged_envelope_value, { plan_bytes: combined_bytes })
		if (input.crash_at === 'before-envelope' || input.crash_at === 'before_envelope' || input.before_envelope === true) {
			return publication_failure_result(new QueueContractError('injected crash before envelope publication', 'AG_QUEUE_PUBLICATION_CRASH'), staging_path, moved_paths)
		}
		for (const plan of built.plans) {
			const destination = path.join(tasks_dir, plan.path)
			if (path_exists(destination)) fail(`queue destination collision: ${destination}`, 'AG_QUEUE_COLLISION')
			move_without_overwrite(path.join(staging_path, plan.path), destination)
			const final_bytes = read_regular_bytes(destination, `published plan ${plan.path}`)
			if (file_digest(final_bytes) !== plan.sha256) fail(`published plan digest mismatch: ${plan.path}`, 'AG_QUEUE_CHANGED')
			moved_paths.push(destination)
		}
		if (input.crash_at === 'after-plans' || input.crash_at === 'after-plan-moves' || input.after_plan_moves === true) {
			return publication_failure_result(new QueueContractError('injected crash before envelope publication', 'AG_QUEUE_PUBLICATION_CRASH'), staging_path, moved_paths)
		}
		if (typeof input.before_envelope_publish === 'function') input.before_envelope_publish({ envelope, tasks_dir, moved_paths: [...moved_paths] })
		const envelope_path = path.join(tasks_dir, ENVELOPE_NAME)
		if (existing) {
			const temporary = `${envelope_path}.${process.pid}.${Date.now()}.tmp`
			write_exclusive(temporary, envelope_bytes)
			const current_bytes = read_regular_bytes(envelope_path, 'existing queue envelope')
			const current_identity = stat_identity(fs.lstatSync(envelope_path))
			if (!same_identity(current_identity, existing.identity) || file_digest(current_bytes) !== existing.sha256) {
				try { fs.unlinkSync(temporary) } catch {}
				fail(`existing queue envelope changed before extension: ${envelope_path}`, 'AG_QUEUE_CHANGED')
			}
			fs.renameSync(temporary, envelope_path)
		} else {
			if (path_exists(envelope_path)) fail(`queue envelope collision: ${envelope_path}`, 'AG_QUEUE_COLLISION')
			move_without_overwrite(staged_envelope, envelope_path)
		}
		const final_envelope = parse_json_bytes(read_regular_bytes(envelope_path, 'published queue envelope'), 'published queue envelope')
		assert_queue_envelope(final_envelope, { plan_bytes: combined_bytes })
		try { fs.rmdirSync(staging_path) } catch {}
			return {
				published: true,
				authority_published: true,
				implementation_started: false,
				staging_path: null,
			moved_paths,
			envelope_path,
			envelope: final_envelope,
		}
	} catch (error) {
		if (error instanceof QueueContractError && error.code === 'AG_QUEUE_PUBLICATION_CRASH') return publication_failure_result(error, staging_path, moved_paths)
		error.staging_path = staging_path
		error.moved_paths = moved_paths
		throw error
	}
}

const publish_v2_queue = input => {
	if (!is_object(input)) fail('queue publication input must be an object', 'AG_QUEUE_SCHEMA')
	if (String(input.operation ?? 'make-plans').toLowerCase() !== 'make-plans') fail('queue publication requires the make-plans operation', 'AG_QUEUE_ROUTE')
	const tasks_dir = ensure_directory(input.tasks_dir ?? input.tasks_dir_path, 'tasks directory')
	const state = inspect_queue_state(tasks_dir, input)
	const done_dir = state.done_dir
	const existing_envelope_path = path.join(tasks_dir, ENVELOPE_NAME)
	if (path_exists(existing_envelope_path)) fail(`queue envelope collision: ${existing_envelope_path}`, 'AG_QUEUE_COLLISION')
	const start_order = Math.max(0, ...plan_numbers(tasks_dir)) + 1
	const plans = Array.isArray(input.plans) ? input.plans.map((plan, index) => ({ ...plan, order: plan.order ?? start_order + index })) : input.plans
	const built = build_v2_queue({ ...input, tasks_dir, plans })
	ensure_destination_free(tasks_dir, done_dir, built.plans)
	if (!path_exists(done_dir)) fs.mkdirSync(done_dir, { mode: 0o700 })
	const stage_parent = input.staging_parent ? ensure_directory(input.staging_parent, 'staging parent') : path.dirname(tasks_dir)
	if (path_is_within(stage_parent, tasks_dir) || path_is_within(tasks_dir, stage_parent) && stage_parent === tasks_dir) fail('staging area must be outside the executable tasks directory', 'AG_QUEUE_UNSAFE_PATH')
	const staging_path = fs.mkdtempSync(path.join(stage_parent, `.queue-stage-${process.pid}-`))
	fs.chmodSync(staging_path, 0o700)
	const moved_paths = []
	try {
		for (const plan of built.plans) {
			const staged_plan = path.join(staging_path, plan.path)
			write_exclusive(staged_plan, built.plan_bytes[plan.path])
			const staged_bytes = read_regular_bytes(staged_plan, `staged plan ${plan.path}`)
			if (file_digest(staged_bytes) !== plan.sha256) fail(`staged plan digest changed: ${plan.path}`, 'AG_QUEUE_CHANGED')
		}
		const envelope_bytes = Buffer.from(`${JSON.stringify(built.envelope)}\n`)
		const staged_envelope = path.join(staging_path, ENVELOPE_NAME)
		write_exclusive(staged_envelope, envelope_bytes)
		const staged_envelope_value = parse_json_bytes(read_regular_bytes(staged_envelope, 'staged queue envelope'), 'staged queue envelope')
		assert_queue_envelope(staged_envelope_value, { plan_bytes: built.plan_bytes })
		if (input.crash_at === 'before-envelope' || input.crash_at === 'before_envelope' || input.before_envelope === true) return publication_failure_result(new QueueContractError('injected crash before envelope publication', 'AG_QUEUE_PUBLICATION_CRASH'), staging_path, moved_paths)
		for (const plan of built.plans) {
			const destination = path.join(tasks_dir, plan.path)
			if (path_exists(destination)) fail(`queue destination collision: ${destination}`, 'AG_QUEUE_COLLISION')
			move_without_overwrite(path.join(staging_path, plan.path), destination)
			const final_bytes = read_regular_bytes(destination, `published plan ${plan.path}`)
			if (file_digest(final_bytes) !== plan.sha256) fail(`published plan digest mismatch: ${plan.path}`, 'AG_QUEUE_CHANGED')
			moved_paths.push(destination)
		}
		if (input.crash_at === 'after-plans' || input.crash_at === 'after-plan-moves' || input.after_plan_moves === true) return publication_failure_result(new QueueContractError('injected crash before envelope publication', 'AG_QUEUE_PUBLICATION_CRASH'), staging_path, moved_paths)
		if (typeof input.before_envelope_publish === 'function') input.before_envelope_publish({ envelope: built.envelope, tasks_dir, moved_paths: [...moved_paths] })
		if (path_exists(existing_envelope_path)) fail(`queue envelope collision: ${existing_envelope_path}`, 'AG_QUEUE_COLLISION')
		move_without_overwrite(staged_envelope, existing_envelope_path)
		const final_envelope = parse_json_bytes(read_regular_bytes(existing_envelope_path, 'published queue envelope'), 'published queue envelope')
		assert_queue_envelope(final_envelope, { plan_bytes: built.plan_bytes })
		try { fs.rmdirSync(staging_path) } catch {}
		return {
			published: true,
			authority_published: true,
			implementation_started: false,
			staging_path: null,
			moved_paths,
			envelope_path: existing_envelope_path,
			envelope: final_envelope,
		}
	} catch (error) {
		if (error instanceof QueueContractError && error.code === 'AG_QUEUE_PUBLICATION_CRASH') return publication_failure_result(error, staging_path, moved_paths)
		error.staging_path = staging_path
		error.moved_paths = moved_paths
		throw error
	}
}

const topological_jobs = classified_jobs => {
	const by_id = new Map(classified_jobs.map(job => [job.job_id, job]))
	for (const job of classified_jobs) for (const dependency of job.dependencies) if (!by_id.has(dependency)) fail(`${job.job_id} depends on unknown job ${dependency}`, 'AG_QUEUE_SCHEMA')
	const order = new Map(classified_jobs.map((job, index) => [job.job_id, index]))
	const remaining = new Set(classified_jobs.map(job => job.job_id))
	const result = []
	while (remaining.size > 0) {
		const ready = [...remaining].filter(id => classified_jobs.find(job => job.job_id === id).dependencies.every(dependency => !remaining.has(dependency)))
		if (ready.length === 0) fail('job dependencies contain a cycle', 'AG_QUEUE_SCHEMA')
		ready.sort((left, right) => order.get(left) - order.get(right))
		for (const id of ready) {
			remaining.delete(id)
			result.push(by_id.get(id))
		}
	}
	return result
}

const connected_to_blocked_job = (jobs, selected_job, blocked_ids) => {
	const neighbors = new Map(jobs.map(job => [job.job_id, new Set(job.dependencies)]))
	for (const job of jobs) for (const dependency of job.dependencies) neighbors.get(dependency).add(job.job_id)
	const seen = new Set([selected_job.job_id])
	const pending = [selected_job.job_id]
	while (pending.length > 0) {
		const current = pending.shift()
		if (blocked_ids.has(current)) return true
		for (const neighbor of neighbors.get(current) || []) if (!seen.has(neighbor)) {
			seen.add(neighbor)
			pending.push(neighbor)
		}
	}
	return false
}

const route_result = (jobs, blocked_jobs, publication) => ({
	jobs: jobs.map(classification_record),
	blocked_jobs,
	publication,
	implementation_started: false,
})

const make_job_plan = (job, plan, authority, completion_signal) => ({
	order: plan.order,
	path: plan.path,
	dependencies: plan.dependencies,
	contract_part: job.job_id,
	route: job.classification,
	authority_id: authority.id,
	final_integration: false,
	outcome: job.request_text,
	required_work: [`Complete the owner job: ${job.request_text}`],
	constraints: [`Keep this ${job.classification} job within its frozen authority.`],
	tests_and_evidence: job.repository_evidence.length > 0
		? job.repository_evidence.map(item => `Use the inspected repository evidence at ${item.path} (${item.sha256}).`)
		: ['Use the accepted requirements and specification recorded by the complex authority.'],
	completion_conditions: [`The owner job ${job.job_id} is complete and its declared checks pass.`],
	completion_signal,
})

const make_integration_plan = (plan, authority, job_ids, completion_signal) => ({
	order: plan.order,
	path: plan.path,
	dependencies: plan.dependencies,
	contract_part: 'final-integration',
	route: 'integration',
	authority_id: authority.id,
	final_integration: true,
	outcome: `Verify the complete published set of jobs: ${job_ids.join(', ')}.`,
	required_work: ['Check every published job together against the frozen request authorities.'],
	constraints: ['Do not claim completion for any blocked or unpublished job.'],
	tests_and_evidence: ['Run the complete relevant checks after all published job plans finish.'],
	completion_conditions: ['All published job plans are complete and the final integration check passes.'],
	completion_signal,
})

const plan_jobs = input => {
	if (!is_object(input)) fail('planning input must be an object', 'AG_QUEUE_SCHEMA')
	if (String(input.operation ?? '').toLowerCase() !== 'make-plans') fail('planning requires the make-plans operation', 'AG_QUEUE_ROUTE')
	if (!['on', 'off', 'ask'].includes(input.allow_ag)) fail('allow_ag must be on, off, or ask', 'AG_QUEUE_SCHEMA')
	if (!Array.isArray(input.jobs) || input.jobs.length === 0) fail('jobs must be a non-empty array', 'AG_QUEUE_SCHEMA')
	const classified = input.jobs.map(route_job)
	if (unique(classified.map(job => job.job_id)).length !== classified.length) fail('job_id values must be unique', 'AG_QUEUE_SCHEMA')
	topological_jobs(classified)
	const complex_jobs = classified.filter(job => job.classification === 'complex')
	const simple_jobs = classified.filter(job => job.classification === 'simple')
	const blocked_jobs = []
	const complex_allowed = input.allow_ag === 'on' || (input.allow_ag === 'ask' && input.owner_confirmation === 'approved')
	if (!complex_allowed) for (const job of complex_jobs) blocked_jobs.push({
		job_id: job.job_id,
		route: 'complex',
		status: input.allow_ag === 'off' ? 'denied' : 'awaiting_owner_approval',
		reason: input.allow_ag === 'off' ? 'allow-ag: off denies the complex pipeline route.' : 'Recorded owner approval is required before complex pipeline work.',
	})
	if (blocked_jobs.length > 0) {
		const blocked_ids = new Set(blocked_jobs.map(job => job.job_id))
		if (simple_jobs.some(job => connected_to_blocked_job(classified, job, blocked_ids))) return route_result(classified, blocked_jobs, {
			published: false,
			generation_kind: null,
			envelope_path: null,
			published_job_ids: [],
		})
	}
	let contract = null
	if (complex_jobs.length > 0 && complex_allowed) {
		if (!is_object(input.complex_contract)) fail(`complex job ${complex_jobs[0].job_id} cannot be planned without an accepted complex contract`, 'AG_QUEUE_CONTRACT_GATE')
		contract = assert_contract_gate({
			...input,
			allow_ag: 'on',
			owner_confirmation: 'approved',
			contract: input.complex_contract,
		})
	}
	const selected = classified.filter(job => !blocked_jobs.some(item => item.job_id === job.job_id))
	if (selected.length === 0) return route_result(classified, blocked_jobs, {
		published: false,
		generation_kind: null,
		envelope_path: null,
		published_job_ids: [],
	})
	const ordered_selected = topological_jobs(selected)
	const completion = completion_path_for(input)
	if (!nonempty_text(input.generation_id)) fail('generation_id must be non-empty', 'AG_QUEUE_SCHEMA')
	if (!nonempty_text(input.created_at) || !Number.isFinite(Date.parse(input.created_at))) fail('created_at must be a valid timestamp', 'AG_QUEUE_SCHEMA')
	const selected_ids = new Set(selected.map(job => job.job_id))
	for (const job of selected) for (const dependency of job.dependencies) if (!selected_ids.has(dependency)) fail(`${job.job_id} depends on unpublished job ${dependency}`, 'AG_QUEUE_ROUTE')
	const authorities = []
	const authority_for_job = new Map()
	let complex_authority = null
	for (const job of ordered_selected) {
		if (job.classification === 'simple') {
			const authority = {
				id: `simple-${job.job_id}`,
				route: 'simple',
				job_id: job.job_id,
				owner_request_sha256: file_digest(Buffer.from(job.request_text)),
				repository_evidence: job.repository_evidence,
			}
			authorities.push(authority)
			authority_for_job.set(job.job_id, authority)
		} else {
			if (!complex_authority) {
				complex_authority = {
					id: 'complex-contract',
					route: 'complex',
					original_request_sha256: contract.original_request_sha256,
					requirements_sha256: contract.requirements_sha256,
					specification_sha256: contract.specification_sha256,
				}
				authorities.push(complex_authority)
			}
			authority_for_job.set(job.job_id, complex_authority)
		}
	}
	const job_plan_paths = new Map(ordered_selected.map((job, index) => [job.job_id, plan_name_for(index + 1)]))
	const nonfinal_plans = ordered_selected.map((job, index) => ({
		order: index + 1,
		path: job_plan_paths.get(job.job_id),
		dependencies: job.dependencies.map(dependency => job_plan_paths.get(dependency)),
	}))
	const terminal_plans = nonfinal_plans.filter(plan => !nonfinal_plans.some(other => other.dependencies.includes(plan.path)))
	const integration_authority = {
		id: 'integration-1',
		route: 'integration',
		included_authority_ids: unique(ordered_selected.map(job => authority_for_job.get(job.job_id).id)),
	}
	authorities.push(integration_authority)
	const plan_inputs = ordered_selected.map((job, index) => make_job_plan(job, nonfinal_plans[index], authority_for_job.get(job.job_id), completion.completion_signal))
	plan_inputs.push(make_integration_plan({
		order: nonfinal_plans.length + 1,
		path: plan_name_for(nonfinal_plans.length + 1),
		dependencies: terminal_plans.map(plan => plan.path),
	}, integration_authority, ordered_selected.map(job => job.job_id), completion.completion_signal))
	const generation_kind = selected.every(job => job.classification === 'simple') ? 'simple' : selected.every(job => job.classification === 'complex') ? 'complex' : 'mixed'
	const publication = publish_v2_queue({
		...input,
		schema_version: 2,
		completion_path: completion.completion_path,
		completion_signal: completion.completion_signal,
		authorities,
		plans: plan_inputs,
	})
	return route_result(classified, blocked_jobs, {
		published: publication.published,
		generation_kind: publication.published ? generation_kind : null,
		envelope_path: publication.envelope_path ?? null,
		published_job_ids: publication.published ? ordered_selected.map(job => job.job_id) : [],
	})
}

const read_frozen_queue = (tasks_dir, options = {}) => {
	const queue = ensure_directory(tasks_dir, 'tasks directory')
	const envelope_path = path.join(queue, ENVELOPE_NAME)
	if (!path_exists(envelope_path)) fail(`frozen queue envelope is missing: ${envelope_path}`, 'AG_QUEUE_AUTHORITY')
	const envelope_bytes = read_regular_bytes(envelope_path, 'queue envelope')
	const envelope = parse_json_bytes(envelope_bytes, 'queue envelope')
	if (!Array.isArray(envelope.plans)) fail(`queue envelope plans are not an array: ${envelope_path}`, 'AG_QUEUE_SCHEMA')
	assert_queue_envelope(envelope)
	const expected_contract = options.contract ?? options.expected_contract
	if (expected_contract !== undefined) {
		if (!is_object(expected_contract)) fail('expected queue contract identities must be an object', 'AG_QUEUE_CONTRACT')
		if (envelope.schema_version === 1) for (const [field, aliases] of [
			['original_request_sha256', ['original_request_sha256', 'original_request_hash']],
			['requirements_sha256', ['requirements_sha256', 'requirements_hash']],
			['specification_sha256', ['specification_sha256', 'specification_hash']],
		]) {
			const expected = hash_field(expected_contract, aliases)
			if (!is_sha256(expected)) fail(`expected ${field} must be a SHA-256 digest`, 'AG_QUEUE_CONTRACT')
			if (envelope[field] !== expected) fail(`frozen queue ${field} does not match the accepted contract identity`, 'AG_QUEUE_CONFLICT')
		}
		if (envelope.schema_version === 2) {
			const complex_authority = envelope.authorities.find(authority => authority.route === 'complex')
			if (complex_authority) for (const [field, aliases] of [
				['original_request_sha256', ['original_request_sha256', 'original_request_hash']],
				['requirements_sha256', ['requirements_sha256', 'requirements_hash']],
				['specification_sha256', ['specification_sha256', 'specification_hash']],
			]) {
				const expected = hash_field(expected_contract, aliases)
				if (!is_sha256(expected)) fail(`expected ${field} must be a SHA-256 digest`, 'AG_QUEUE_CONTRACT')
				if (complex_authority[field] !== expected) fail(`frozen queue ${field} does not match the accepted contract identity`, 'AG_QUEUE_CONFLICT')
			}
		}
	}
	const plan_bytes = {}
	for (const plan of envelope.plans || []) plan_bytes[plan.path] = read_frozen_plan_bytes(queue, plan.path)
	const expected_plan_names = new Set(envelope.plans.map(plan => plan.path))
	const plan_directories = envelope.schema_version === 2
		? [[queue, 'open plan directory'], [path.join(queue, 'done'), 'completed plan directory']]
		: [[queue, 'open plan directory']]
	for (const [directory, label] of plan_directories) for (const name of frozen_plan_names(directory, label)) {
		if (!expected_plan_names.has(name)) fail(`plan is not bound by the frozen queue envelope: ${name}`, 'AG_QUEUE_AUTHORITY')
	}
	assert_queue_envelope(envelope, { plan_bytes })
	const authority = {
		tasks_dir: queue,
		envelope_path,
		envelope_bytes,
		envelope_sha256: file_digest(envelope_bytes),
		envelope,
		plan_bytes,
		plan_locations: Object.fromEntries(envelope.plans.map(plan => [plan.path, path_exists(path.join(queue, 'done', plan.path)) ? 'done' : 'open'])),
		plans: envelope.plans.map(plan => ({ ...plan, content: plan_bytes[plan.path].toString('utf8') })),
	}
	if (options.authority !== undefined) compare_authority_result(options.authority, authority)
	return authority
}

const select_frozen_ready_plans = (tasks_dir, options = {}) => {
	const authority = read_frozen_queue(tasks_dir, options)
	const completed_plan_names = []
	const open_plans = []
	for (const plan of authority.envelope.plans) {
		const open_exists = path_exists(path.join(authority.tasks_dir, plan.path))
		const done_exists = path_exists(path.join(authority.tasks_dir, 'done', plan.path))
		if (done_exists) completed_plan_names.push(plan.path)
		if (open_exists) open_plans.push(plan)
	}
	const completed = new Set(completed_plan_names)
	const ready_plan_names = open_plans
		.filter(plan => plan.dependencies.every(dependency => completed.has(dependency)))
		.sort((left, right) => left.order - right.order)
		.map(plan => plan.path)
	if (open_plans.length > 0 && ready_plan_names.length === 0) fail('frozen queue has open plans but no dependency-ready plan', 'AG_QUEUE_DEPENDENCY')
	return { authority, completed_plan_names, ready_plan_names }
}

const select_host_ready_plans = select_frozen_ready_plans

const read_frozen_queue_authority = read_frozen_queue

const validate_frozen_queue = (tasks_dir, options = {}) => {
	try {
		return { valid: true, ...read_frozen_queue(tasks_dir, options) }
	} catch (error) {
		return { valid: false, errors: [error_text(error)], tasks_dir: canonical_path(tasks_dir) }
	}
}

const make_plans = input => Array.isArray(input?.jobs) ? plan_jobs(input) : publish_queue(input)

module.exports = {
	ENVELOPE_NAME,
	MAX_PLAN_BYTES,
	PLAN_SECTIONS,
	PLAN_PATTERN,
	QueueContractError,
	assert_contract_gate,
	assert_queue_envelope,
	build_plan_body,
	build_queue,
	create_plan_body: build_plan_body,
	create_queue: build_queue,
	create_queue_envelope: input => build_queue(input).envelope,
	file_digest,
	inspect_queue_state,
	make_plans,
	plan_name_for,
	plan_jobs,
	publish_queue,
	publish_frozen_queue: publish_queue,
	read_frozen_queue,
	read_frozen_queue_authority,
	read_queue: read_frozen_queue,
	select_frozen_ready_plans,
	select_host_ready_plans,
	codewalk_required,
	validate_shared_codewalk_record,
	validate_contract: validate_contract_gate,
	validate_contract_gate,
	validate_frozen_queue,
	validate_plan: validate_plan_body,
	validate_plan_body,
	validate_envelope: validate_queue_envelope,
	validate_queue_envelope,
}
