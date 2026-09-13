'use strict'

const node_fs = require('node:fs')
const node_path = require('node:path')
const node_crypto = require('node:crypto')
const node_child_process = require('node:child_process')

const ag_settings = require('./ag-settings.js')
const round_linter = require('./round-linter.js')
const { parse_numeric_timestamp } = require('./local-time.js')

const DAY_MS = 24 * 60 * 60 * 1000
const RETENTION_MS = 30 * DAY_MS
const MAX_RECORD_BYTES = 1024 * 1024
const RECORD_KEYS = Object.freeze(['version', 'notebook', 'ask', 'created_at', 'metadata_text'])
const has_own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const is_object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const as_posix = value => String(value).replace(/\\/g, '/')
const same_record = (left, right) => JSON.stringify(RECORD_KEYS.reduce((out, key) => { out[key] = left[key]; return out }, {})) === JSON.stringify(RECORD_KEYS.reduce((out, key) => { out[key] = right[key]; return out }, {}))
const path_below = (target, root) => target !== root && target.startsWith(`${root}${node_path.sep}`)

const failure = (status, reason) => ({ status, moved: [], ...(reason ? { reason } : {}) })

const normalise_notebook = (project_root, notebook_path) => {
	if (typeof notebook_path !== 'string' || notebook_path.trim() === '') throw new Error('notebook_path is required')
	const absolute = node_path.resolve(project_root, notebook_path)
	const relative = as_posix(node_path.relative(project_root, absolute))
	if (!relative || relative === '..' || relative.startsWith('../') || node_path.isAbsolute(relative)) throw new Error('notebook_path must be repository-relative')
	return { absolute, relative }
}

const no_symlink_components = (target, stop_at) => {
	let current = node_path.resolve(target)
	const stop = stop_at === undefined ? undefined : node_path.resolve(stop_at)
	while (true) {
		let stat
		try { stat = node_fs.lstatSync(current) } catch (error) {
			if (error.code === 'ENOENT') {
				const parent = node_path.dirname(current)
				if (parent === current) return
				current = parent
				continue
			}
			throw error
		}
		if (stat.isSymbolicLink()) throw new Error(`symlink path component is not allowed: ${current}`)
		if (stop !== undefined && current === stop) return
		const parent = node_path.dirname(current)
		if (parent === current) return
		current = parent
	}
}

const ensure_directory = (directory, stop_at) => {
	no_symlink_components(directory, stop_at)
	node_fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
	no_symlink_components(directory, stop_at)
}

const safe_regular_file = (file_path, root, label) => {
	const absolute = node_path.resolve(file_path)
	if (absolute !== file_path || !path_below(absolute, root)) throw new Error(`${label} must be a canonical path under the configured workspace .tmp`)
	no_symlink_components(node_path.dirname(absolute), root)
	let stat
	try { stat = node_fs.lstatSync(absolute) } catch (error) {
		throw new Error(`${label} could not be inspected: ${error.message}`)
	}
	if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file`)
	if (node_path.basename(absolute) !== 'completion.json') throw new Error(`${label} must name completion.json`)
	let real
	try { real = node_fs.realpathSync(absolute) } catch (error) { throw new Error(`${label} could not be canonicalized: ${error.message}`) }
	if (real !== absolute) throw new Error(`${label} must not resolve through a symlink`)
	return { stat, absolute }
}

const read_json_file = (file_path, label, max_bytes = Infinity, expected_identity) => {
	let descriptor
	let stat
	let text
	try {
		descriptor = node_fs.openSync(file_path, node_fs.constants.O_RDONLY | (node_fs.constants.O_NOFOLLOW || 0))
		stat = node_fs.fstatSync(descriptor)
		if (expected_identity && (stat.dev !== expected_identity.dev || stat.ino !== expected_identity.ino)) throw new Error(`${label} path was substituted`)
		if (stat.size > max_bytes) throw new Error(`${label} is too large`)
		text = node_fs.readFileSync(descriptor, 'utf8')
	} finally {
		if (descriptor !== undefined) { try { node_fs.closeSync(descriptor) } catch {} }
	}
	const duplicate = ag_settings.duplicate_json_key(text)
	if (duplicate !== null) throw new Error(`${label} contains duplicate JSON key '${duplicate}'`)
	try { return { value: JSON.parse(text), text } } catch { throw new Error(`${label} contains malformed JSON`) }
}

const validate_record = (record, notebook_relative, ask) => {
	if (!is_object(record)) throw new Error('completion record must be an object')
	const keys = Object.keys(record).sort()
	const expected = [...RECORD_KEYS].sort()
	if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) throw new Error('completion record contains unknown or missing fields')
	if (record.version !== 1) throw new Error('completion record version must be 1')
	if (record.notebook !== notebook_relative) throw new Error('completion record notebook does not match this notebook')
	if (record.ask !== ask) throw new Error('completion record Ask does not match its historical round')
	if (typeof record.created_at !== 'string' || !Number.isFinite(parse_numeric_timestamp(record.created_at))) throw new Error('completion record created_at must be a numeric-offset local timestamp')
	if (typeof record.metadata_text !== 'string') throw new Error('completion record metadata_text must be text')
}

const extract_completion_stamp = (round, record) => {
	const candidates = []
	const stamp_pattern = /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{4})/gu
	const reply = typeof round.reply_text === 'string' ? round.reply_text : ''
	let fenced = false
	for (const line of reply.split(/\r?\n/u)) {
		if (/^\s*(?:`{3,}|~{3,})/u.test(line)) { fenced = !fenced; continue }
		if (fenced || /^(?: {0,3}>| {4}|\t)/u.test(line)) continue
		if (/^\*\s*_/u.test(line) || /^(?:completion|completed|completion_at|completed_at)\s*[:=]/iu.test(line)) {
			for (const match of line.matchAll(stamp_pattern)) candidates.push(match[1])
		}
	}
	for (const key of ['completion_at', 'completed_at', 'completed']) {
		if (typeof record?.[key] === 'string') candidates.push(record[key])
	}
	for (const candidate of candidates) {
		const value = parse_numeric_timestamp(candidate)
		if (Number.isFinite(value)) return value
	}
	return NaN
}

const read_notebook = (file_path, label) => {
	let stat
	try { stat = node_fs.lstatSync(file_path) } catch (error) { throw new Error(`${label} could not be read: ${error.message}`) }
	if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file`)
	return node_fs.readFileSync(file_path, 'utf8')
}

const read_optional_notebook = (file_path, label) => {
	try { node_fs.lstatSync(file_path) } catch (error) {
		if (error.code === 'ENOENT') return ''
		throw new Error(`${label} could not be read: ${error.message}`)
	}
	return read_notebook(file_path, label)
}

const acquire_lock = lock_path => {
	let descriptor
	try {
		descriptor = node_fs.openSync(lock_path, node_fs.constants.O_CREAT | node_fs.constants.O_EXCL | node_fs.constants.O_WRONLY | (node_fs.constants.O_NOFOLLOW || 0), 0o600)
	} catch (error) {
		if (error && error.code === 'EEXIST') return { busy: true }
		throw new Error(`could not acquire cleanup lock: ${error.message}`)
	}
	const identity = node_fs.fstatSync(descriptor)
	try {
		node_fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, token: node_crypto.randomBytes(12).toString('hex') }))
		return { descriptor, identity, path: lock_path }
	} catch (error) {
		try { node_fs.closeSync(descriptor) } catch {}
		try { node_fs.unlinkSync(lock_path) } catch {}
		throw error
	}
}

const release_lock = lock => {
	if (!lock || lock.busy) return
	try { node_fs.closeSync(lock.descriptor) } finally {
		let current
		try { current = node_fs.lstatSync(lock.path) } catch (error) { if (error.code !== 'ENOENT') return }
		if (current && current.dev === lock.identity.dev && current.ino === lock.identity.ino) {
			try { node_fs.unlinkSync(lock.path) } catch {}
		}
	}
}

const atomic_write = (file_path, text, stop_at) => {
	ensure_directory(node_path.dirname(file_path), stop_at)
	const temp_path = `${file_path}.tmp-${process.pid}-${Date.now()}-${node_crypto.randomBytes(8).toString('hex')}`
	let descriptor
	try {
		descriptor = node_fs.openSync(temp_path, 'wx', 0o600)
		node_fs.writeFileSync(descriptor, text, 'utf8')
		if (typeof node_fs.fsyncSync === 'function') node_fs.fsyncSync(descriptor)
		node_fs.closeSync(descriptor)
		descriptor = undefined
		node_fs.renameSync(temp_path, file_path)
	} catch (error) {
		if (descriptor !== undefined) { try { node_fs.closeSync(descriptor) } catch {} }
		try { node_fs.unlinkSync(temp_path) } catch {}
		throw new Error(`cleanup state could not be written atomically: ${error.message}`)
	}
}

const read_watermark = (state_path, notebook_relative, tmp_path) => {
	let state_stat
	try { state_stat = node_fs.lstatSync(state_path) } catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
	no_symlink_components(node_path.dirname(state_path), tmp_path)
	if (!state_stat.isFile() || state_stat.isSymbolicLink()) throw new Error('cleanup state must be a regular non-symlink file')
	const { value } = read_json_file(state_path, 'cleanup state', MAX_RECORD_BYTES)
	if (!is_object(value)) throw new Error('cleanup state must be an object')
	const candidate = is_object(value.notebooks) ? value.notebooks[notebook_relative] : undefined
	if (candidate === undefined) return undefined
	if (!((typeof candidate === 'number' && Number.isFinite(candidate)) || (typeof candidate === 'string' && candidate.trim() !== '' && Number.isFinite(Number(candidate))))) throw new Error('cleanup state watermark is invalid')
	return Number(candidate)
}

const read_metadata_result = (reader, round, context) => {
	let result
	try { result = reader(round.reply_text || '', context) } catch (error) { throw new Error(`completion metadata inspection failed for ${round.id}: ${error.message}`) }
	if (result === null || result === undefined || !is_object(result)) throw new Error(`completion metadata inspection failed for ${round.id}: invalid reader result`)
	if (result.error !== undefined && result.error !== null && typeof result.error !== 'string') throw new Error(`completion metadata inspection failed for ${round.id}: reader error must be text`)
	if (typeof result.error === 'string' && result.error.trim() !== '') throw new Error(`completion metadata for ${round.id} is unavailable: ${result.error}`)
	return result
}

const validate_reader_record = (result, notebook_relative, ask) => {
	validate_record(result.record, notebook_relative, ask)
	if (typeof result.text === 'string' && result.text !== result.record.metadata_text) throw new Error('completion record metadata_text differs from parsed metadata')
}

const sweep_completion_records = (options = {}) => {
	if (!is_object(options)) return failure('error', 'cleanup options must be an object')
	let project_root
	try { project_root = node_fs.realpathSync(node_path.resolve(options.project_root || process.cwd())) } catch (error) { return failure('error', `project_root could not be resolved: ${error.message}`) }
	const now_ms = options.now_ms === undefined ? Date.now() : Number(options.now_ms)
	if (!Number.isFinite(now_ms)) return failure('error', 'now_ms must be finite')
	let config
	let notebook
	let config_path
	try {
		config_path = node_path.resolve(options.config_path || node_path.join(project_root, 'ag.json'))
		const config_text = node_fs.readFileSync(config_path, 'utf8')
		const duplicate = ag_settings.duplicate_json_key(config_text)
		if (duplicate !== null) throw new Error(`configuration contains duplicate JSON key '${duplicate}'`)
		config = JSON.parse(config_text)
	} catch (error) {
		return failure('error', `cleanup configuration could not be read: ${error.message}`)
	}
	if (!is_object(config.switches)) return failure('error', 'configuration.switches must be an object')
	const switches = config.switches
	const cleanup_mode = switches['completion-cleanup'] ?? ag_settings.completion_cleanup_defaults['completion-cleanup']
	const interval_days = switches['completion-cleanup-interval-days'] ?? ag_settings.completion_cleanup_defaults['completion-cleanup-interval-days']
	if (cleanup_mode !== 'off' && cleanup_mode !== 'on') return failure('error', 'completion-cleanup must be off or on')
	if (cleanup_mode === 'off') return failure('disabled', 'completion-cleanup is off')
	if (!Number.isInteger(interval_days) || interval_days < 1 || interval_days > 365) return failure('error', 'completion-cleanup-interval-days must be an integer from 1 through 365')
	try { notebook = normalise_notebook(project_root, options.notebook_path || config?.switches?.['target-doc'] || 'devlog.md') } catch (error) { return failure('error', error.message) }

	let workspace_relative = switches['workspace-dir']
	if (typeof workspace_relative !== 'string' || workspace_relative.trim() === '') return failure('error', 'configured workspace-dir is missing')
	const workspace_errors = ag_settings.workspace_dir_errors(workspace_relative, project_root)
	if (workspace_errors.length > 0) return failure('error', workspace_errors.join('; '))
	const workspace_path = node_path.resolve(project_root, workspace_relative)
	const tmp_path = node_path.join(workspace_path, '.tmp')
	const state_path = node_path.join(tmp_path, 'completion-cleanup-state.json')
	const sweep_lock_path = node_path.join(tmp_path, 'completion-cleanup.lock')
	const close_lock_path = `${notebook.absolute}.close-round.lock`
	let watermark
	try { watermark = read_watermark(state_path, notebook.relative, tmp_path) } catch (error) { return failure('error', error.message) }
	if (watermark !== undefined && now_ms - watermark < interval_days * DAY_MS) return failure('not-due', `completion-cleanup is not due until ${new Date(watermark + interval_days * DAY_MS).toISOString()}`)

	let archive_absolute
	try {
		const archive_relative = ag_settings.archive_path_for_notebook(notebook.relative)
		archive_absolute = node_path.resolve(project_root, archive_relative)
	} catch (error) { return failure('error', error.message) }
	const reader = has_own(options, 'read_metadata') ? options.read_metadata : round_linter.completion_metadata
	if (typeof reader !== 'function') return failure('error', 'completion metadata reader capability is unavailable')
	const context_base = { project_root, notebook_path: notebook.relative, workspace_dir: workspace_relative }
	try {
		ensure_directory(tmp_path, workspace_path)
		const ignore_path = node_path.join(tmp_path, '.gitignore')
		no_symlink_components(ignore_path, tmp_path)
		if (!node_fs.existsSync(ignore_path)) node_fs.writeFileSync(ignore_path, '*\n', { flag: 'wx', mode: 0o600 })
		no_symlink_components(node_path.dirname(close_lock_path), project_root)
	} catch (error) { return failure('error', `cleanup storage is unsafe: ${error.message}`) }
	let sweep_lock
	let close_lock
	try {
		sweep_lock = acquire_lock(sweep_lock_path)
		if (sweep_lock.busy) return failure('busy', 'completion cleanup sweep is already locked')
		close_lock = acquire_lock(close_lock_path)
		if (close_lock.busy) return failure('busy', 'notebook close-round is locked')
		const locked_watermark = read_watermark(state_path, notebook.relative, tmp_path)
		if (locked_watermark !== undefined && now_ms - locked_watermark < interval_days * DAY_MS) return failure('not-due', 'another successful sweep already advanced this notebook watermark')
		const live_text = read_notebook(notebook.absolute, 'notebook')
		const archive_text = read_optional_notebook(archive_absolute, 'adjacent archive')
		let parsed_live
		try { parsed_live = round_linter.parse_devlog(live_text) } catch (error) { return failure('error', `notebook inspection failed while locked: ${error.message}`) }
		const current_last = parsed_live.rounds?.slice().reverse().find(round => !round.body.split(/\r?\n/u).every(line => line.trim() === '' || line.trim() === '+'))
		if (current_last && !/^\s*(?:# ← Reply \/|## Reply \/)\s+A-\d+/mu.test(current_last.body)) return failure('skipped', 'latest nonempty Ask is active or unfinished')
		let parsed_archive
		try { parsed_archive = archive_text ? round_linter.parse_devlog(archive_text) : { rounds: [] } } catch (error) { return failure('error', `adjacent archive inspection failed: ${error.message}`) }
		const all_rounds = [...(parsed_archive.rounds || []).map(round => ({ ...round, source: 'archive' })), ...(parsed_live.rounds || []).map(round => ({ ...round, source: 'live' }))]
		const latest_completed = [...all_rounds].reverse().find(round => /^\s*(?:# ← Reply \/|## Reply \/)\s+A-\d+/mu.test(round.body))
		const references = new Map()
		const candidates = []
		const inspection_errors = []
		for (const round of all_rounds) {
			if (!/^\s*(?:# ← Reply \/|## Reply \/)\s+A-\d+/mu.test(round.body)) continue
			// Absent historical files are not cleanup candidates; completion checks still report their evidence as unavailable.
			if (!has_own(options, 'read_metadata') && round.id !== latest_completed?.id) {
				const expected = require('./completion-record').location({ ...context_base, ask: round.id })
				if (!node_fs.lstatSync(expected.file, { throwIfNoEntry: false })) continue
			}
			let result
			try { result = read_metadata_result(reader, round, { ...context_base, ask: round.id }) } catch (error) { inspection_errors.push(error.message); continue }
			if (result.record === undefined && result.record_file === undefined) continue
			if (result.record === undefined || result.record_file === undefined) { inspection_errors.push(`completion metadata for ${round.id} is missing record or record_file`); continue }
			try {
				validate_reader_record(result, notebook.relative, round.id)
				if (typeof result.record_file !== 'string' || !node_path.isAbsolute(result.record_file) || node_path.basename(result.record_file) !== 'completion.json') throw new Error('record_file must be an absolute canonical completion.json path')
				const checked = safe_regular_file(result.record_file, tmp_path, 'record_file')
				const file_record = read_json_file(checked.absolute, 'completion record', MAX_RECORD_BYTES, checked.stat).value
				validate_record(file_record, notebook.relative, round.id)
				if (!same_record(result.record, file_record)) throw new Error('record identity differs from completion.json')
				const reference = { notebook: notebook.relative, ask: round.id, record_file: checked.absolute, identity: { dev: checked.stat.dev, ino: checked.stat.ino }, round, record: result.record }
				const refs = references.get(checked.absolute) || []
				refs.push(reference)
				references.set(checked.absolute, refs)
				candidates.push(reference)
			} catch (error) { inspection_errors.push(`${round.id}: ${error.message}`) }
		}
		if (inspection_errors.length > 0) return failure('error', inspection_errors.join('; '))
		const unique_candidates = [...new Map(candidates.map(candidate => [candidate.record_file, candidate])).values()]
		const eligible = []
		const eligibility_errors = []
		for (const candidate of unique_candidates) {
			const refs = references.get(candidate.record_file) || []
			if (refs.some(reference => reference.ask !== candidate.ask || reference.notebook !== candidate.notebook || reference.round.source !== candidate.round.source || reference.round.index !== candidate.round.index)) continue
			if (latest_completed && latest_completed.id === candidate.ask) continue
			const relative = as_posix(node_path.relative(project_root, candidate.record_file))
			const href = node_path.posix.relative(node_path.posix.dirname(notebook.relative), relative)
			const other_text = all_rounds.filter(round => round.source !== candidate.round.source || round.index !== candidate.round.index).map(round => round.text).join('\n')
			if ([candidate.record_file, relative, href, encodeURI(href)].some(reference => other_text.includes(reference))) continue
			const created_ms = parse_numeric_timestamp(candidate.record.created_at)
			const completion_ms = extract_completion_stamp(candidate.round, candidate.record)
			if (!Number.isFinite(created_ms)) { eligibility_errors.push(`${candidate.ask}: invalid creation timestamp`); continue }
			if (!Number.isFinite(completion_ms)) { eligibility_errors.push(`${candidate.ask}: completion timestamp is unavailable`); continue }
			if (now_ms - created_ms <= RETENTION_MS || now_ms - completion_ms <= RETENTION_MS) continue
			eligible.push(candidate)
		}
		if (eligibility_errors.length > 0) return failure('error', eligibility_errors.join('; '))
		if (read_notebook(notebook.absolute, 'notebook') !== live_text) return failure('error', 'notebook changed during cleanup inspection')
		const archive_after_inspection = read_optional_notebook(archive_absolute, 'adjacent archive')
		if (archive_after_inspection !== archive_text) return failure('error', 'adjacent archive changed during cleanup inspection')
		const moved = []
		const current_rounds = [...(parsed_archive.rounds || []), ...(parsed_live.rounds || [])]
		const current_round_by_id = new Map(current_rounds.map(round => [round.id, round]))
		for (const candidate of eligible) {
			const current_round = current_round_by_id.get(candidate.ask)
			if (!current_round || !/^\s*(?:# ← Reply \/|## Reply \/)\s+A-\d+/mu.test(current_round.body)) return failure('error', `round ${candidate.ask} changed before moving its completion record`)
			let reread
			try { reread = read_metadata_result(reader, current_round, { ...context_base, ask: candidate.ask }) } catch (error) { return failure('error', error.message) }
			if (reread.record_file !== candidate.record_file || reread.record === undefined) return failure('error', `record identity changed before moving ${candidate.record_file}`)
			try { validate_reader_record(reread, notebook.relative, candidate.ask) } catch (error) { return failure('error', `record identity changed before moving ${candidate.record_file}: ${error.message}`) }
			if (!same_record(reread.record, candidate.record)) return failure('error', `record identity changed before moving ${candidate.record_file}`)
			try {
				const checked = safe_regular_file(candidate.record_file, tmp_path, 'record_file')
				const current_record = read_json_file(checked.absolute, 'completion record', MAX_RECORD_BYTES, checked.stat).value
				validate_record(current_record, notebook.relative, candidate.ask)
				if (checked.stat.dev !== candidate.identity.dev || checked.stat.ino !== candidate.identity.ino) return failure('error', `record path was substituted before moving ${candidate.record_file}`)
				if (!same_record(current_record, candidate.record)) return failure('error', `record identity changed before moving ${candidate.record_file}`)
			} catch (error) { return failure('error', `${candidate.record_file}: ${error.message}`) }
			try {
				if (typeof options.trash === 'function') options.trash(candidate.record_file)
				else node_child_process.execFileSync('trash', [candidate.record_file])
				moved.push(candidate.record_file)
			} catch (error) { return { status: 'error', moved, reason: `could not move ${candidate.record_file}: ${error.message}` } }
		}
		let current_state = {}
		let state_present = false
		try { node_fs.lstatSync(state_path); state_present = true } catch (error) { if (error.code !== 'ENOENT') return failure('error', `cleanup state could not be inspected: ${error.message}`) }
		if (state_present) {
			try {
				no_symlink_components(node_path.dirname(state_path), tmp_path)
				const state_stat = node_fs.lstatSync(state_path)
				if (!state_stat.isFile() || state_stat.isSymbolicLink()) throw new Error('cleanup state must be a regular non-symlink file')
				current_state = read_json_file(state_path, 'cleanup state', MAX_RECORD_BYTES, state_stat).value
			} catch (error) { return failure('error', error.message) }
		}
		const next_state = is_object(current_state) ? current_state : {}
		next_state.version = 1
		next_state.last_success_ms = now_ms
		next_state.notebooks = is_object(next_state.notebooks) ? next_state.notebooks : {}
		next_state.notebooks[notebook.relative] = now_ms
		atomic_write(state_path, JSON.stringify(next_state, null, 2) + '\n', workspace_path)
		return { status: 'success', moved }
	} catch (error) {
		return failure('error', error.message)
	} finally {
		release_lock(close_lock)
		release_lock(sweep_lock)
	}
}

module.exports = { sweep_completion_records }
