'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { schema_version } = require('./ag-settings.js')

const repo_root = path.resolve(__dirname, '..', '..', '..')
const read = relative_path => fs.readFileSync(path.join(repo_root, relative_path), 'utf8')
const render_public = source => source.replaceAll('{{org}}', 'agfnow').replaceAll('{{repo}}', 'agentflow')

test('public release templates use the validator schema and explain installation readiness', () => {
	const english = render_public(read('release/README.public.md'))
	const chinese = render_public(read('release/README.public.zh-tw.md'))

	assert.match(english, new RegExp(`version-${schema_version}\\b`))
	assert.match(chinese, new RegExp(`版本 ${schema_version}\\b`))
	for (const document of [english, chinese]) {
		assert.match(document, /setup\.js/)
		assert.match(document, /Node(?:\.js)? 18|Node 18/i)
		assert.match(document, /Git/i)
		assert.match(document, /godev/)
		assert.match(document, /optional worker|optional worker.*installation failed|選用 worker|安裝失敗/i)
	}
	assert.match(english, /AGENTFLOW_SKILL_DIR/)
	assert.match(chinese, /AGENTFLOW_SKILL_DIR/)
})

test('active owner-facing Markdown uses the accepted configuration contract', () => {
	const english = read('skills/agentflow/docs/AG_GUIDE.md')
	const chinese = read('skills/agentflow/docs/AG_GUIDE.zh-tw.md')
	const readme = read('skills/agentflow/scripts/README.md')
	const delegation = read('skills/agentflow/references/delegation.md')
	const setup = read('skills/agentflow/scripts/setup.js')
	const install_hook = read('skills/agentflow/scripts/install-hook.js')

	for (const guide of [english, chinese]) {
		assert.match(guide, /schema-version": 7/)
		assert.match(guide, /allow_ag|allow-ag/)
		assert.match(guide, /metrics/)
		assert.match(guide, /external-workers/)
		assert.match(guide, /pipeline-roles/)
		assert.match(guide, /\[FINAL REPORT\]/)
		assert.doesNotMatch(guide, /schema_version": 1/)
		assert.doesNotMatch(guide, /seven switches|七個設定/)
		assert.doesNotMatch(guide, /## Final report/)
		assert.doesNotMatch(guide, /DO NOT USE Agentflow pipeline/)
		assert.doesNotMatch(guide, /nine switches|九個設定|four-hour|四小時|20 個同時 active|這兩個子指令|beside this guide|就在本指南旁邊|~\/\.claude\/skills\/agentflow\/scripts\/setup\.js/)
		assert.match(guide, /large-work-minutes/)
		assert.doesNotMatch(guide, /docs\/marcom\/(?:USAGE|FAQ|COURSE)\.md/)
		assert.match(guide, /Still to do.*None\.|Still to do.*None/i)
		assert.match(guide, /archive|封存/i)
	}
	assert.match(english, /shared-coverage marker|shared coverage marker/i)
	assert.match(english, /\[RUN-NNN\]|numbered RUN/i)
	assert.match(english, /indent each numbered item by two spaces/i)
	assert.match(english, /Archived eras:.*adjacent archive path/i)
	assert.match(chinese, /shared-coverage marker/i)
	assert.match(chinese, /RUN 事件/)
	assert.match(chinese, /縮排兩個空白/)
	assert.match(chinese, /Archived eras:.*archive path/i)
	assert.doesNotMatch(chinese, /最後核實日期|十六題|十四題|gpt-5\.6-sol|gemma4:e4b-mlx/)
	assert.doesNotMatch(english, /disposable worktree|throwaway worktree/)
	assert.doesNotMatch(chinese, /拋棄式 worktree/)
	assert.doesNotMatch(`${setup}\n${install_hook}`, /~\/\.claude\/skills\/agentflow\/scripts\/setup\.js/)
	assert.match(install_hook, /node_path\.join\(__dirname, 'setup\.js'\)/)

	assert.match(english, /Direct route/)
	assert.match(english, /Direct route[^\n]*host AI itself/i)
	assert.match(english, /Selected-advisor route/)
	assert.match(english, /Full-pipeline route/)
	assert.match(chinese, /direct route/)
	assert.match(chinese, /direct route[^\n]*host AI 自己/i)
	assert.match(chinese, /selected-advisor route/)
	assert.match(chinese, /full-pipeline route/)
	assert.match(english, /same order.*owner.*request/i)
	assert.match(chinese, /owner.*原始順序/)
	assert.match(english, /succeeded.*failed.*limited/i)
	assert.match(chinese, /成功.*失敗.*限制/)
	assert.match(readme, /Version 7/i)
	assert.match(readme, /pipeline-roles/)
	assert.match(readme, /planning-only frozen/)
	assert.match(readme, /external-runner\.js/)
	assert.doesNotMatch(readme, /schema_version|pipeline_roles|external_workers/)
	assert.doesNotMatch(delegation, /20-minute deadline|45-minute deadline/i)
	assert.match(delegation, /Do not impose a fixed elapsed-time deadline/)
	assert.match(delegation, /ten-minute checkpoint interval is reporting cadence only/)
	assert.match(delegation, /Silent reasoning or unchanged files alone never prove a hang/)
	assert.match(delegation, /launcher wrapper.*(?:does not|without) copying|launcher wrapper.*repeat neither/i)
	assert.match(delegation, /owner explicitly selects an exact model or model-and-effort combination.*pauses for owner approval.*never substitute another model automatically/i)
	assert.doesNotMatch(delegation, /owner-selected model never substitutes without owner approval/i)
	assert.doesNotMatch(delegation, /coordinator runs the suite personally, every time/i)
})

test('looper operation guidance is loaded only by explicit run triggers', () => {
	const skill = read('skills/agentflow/SKILL.md')
	const looper = read('skills/agentflow/references/looper.md')
	assert.match(skill, /`run-looper` means: read `references\/looper\.md`/)
	assert.match(skill, /`run-plans` means: read the same reference/)
	assert.doesNotMatch(skill, /^### Running a planned queue for the owner$/mu)
	for (const fact of [/handwritten queue/i, /make-plans/i, /--dump/, /--reset/, /looper-live-gate\.js/]) assert.match(looper, fact)
	assert.match(skill, /`off` means AG is forbidden:.*do not ask/i)
	assert.match(skill, /route trigger, not a settings change, and never overrides `off`/i)
	assert.match(skill, /None of the four `ag`-family spellings grants permission: when `allow-ag` is `off`/i)
	assert.match(read('skills/agentflow/references/ag.md'), /route trigger is not a settings change and never overrides `off`/i)
})

test('workspace layout instructions are explicit across the complete impact inventory', () => {
	const skill = read('skills/agentflow/SKILL.md')
	const streams = read('skills/agentflow/references/streams.md')
	const pipeline = read('skills/agentflow/references/ag.md')
	const looper = read('skills/agentflow/references/looper.md')
	const english = read('skills/agentflow/docs/AG_GUIDE.md')
	const chinese = read('skills/agentflow/docs/AG_GUIDE.zh-tw.md')

	assert.match(skill, /workspace_instruction_inventory/)
	assert.match(skill, /workspace_layout_change/)
	assert.match(streams, /\$workspace_dir\/features\/<taskkey>/)
	assert.match(pipeline, /\$workspace_dir\/artifacts\/<work-key>/)
	assert.match(looper, /\$workspace_dir\/planned/)
	for (const guide of [english, chinese]) {
		assert.match(guide, /\.agentflow\/devlog\.md/)
		assert.match(guide, /\.agentflow\/features/)
		assert.match(guide, /workspace-dir/)
	}
})

test('continuation controls retain the canonical Reply boundary', () => {
	const skill = read('skills/agentflow/SKILL.md')
	assert.match(skill, /continue`\/`next` only re-read and resume/)
	assert.match(skill, /Every resumed round still uses the normal exact `# ← Reply \/ A-NNN` heading/)
})

test('the skill requires canonical tracker generation and validation', () => {
	const skill = read('skills/agentflow/SKILL.md')
	assert.match(skill, /tracker-contract\.js template/)
	assert.match(skill, /tracker-contract\.js validate --repo <repo> --tracker <work-root>\/tracker\.md/)
	assert.match(skill, /— I-063/)
})

test('the incident-derived closeout stop rule prevents recursive final review', () => {
	const skill = read('skills/agentflow/SKILL.md')
	const incidents = read('skills/agentflow/docs/incidents-log.md')
	assert.match(skill, /Closeout stop rule:/)
	assert.match(skill, /do not restart implementation review for later notebook, STATUS, tracker, run-log, metadata, or reviewer-format-only corrections/)
	assert.match(skill, /same unchanged implementation is sent through repeated "final" validation, stop and report the protocol defect/)
	assert.match(skill, /reviewer performs its assigned review directly/)
	assert.match(skill, /never invokes Agentflow for the reviewed repository/)
	assert.match(skill, /never delegates or launches another reviewer/)
	assert.match(skill, /— I-072/)
	assert.match(incidents, /I-072 — 2026-09-03 — exact-commit certainty caused a recursive final-review loop/)
})

test('user-facing terminal changes require reusable real-person PTY journeys', () => {
	const skill = read('skills/agentflow/SKILL.md')
	assert.match(skill, /Before completing any new or changed user-facing terminal feature or control, run a reusable real PTY journey/)
	assert.match(skill, /terminal identity, visible input and output, process exit status, and resulting repository or configuration state/)
	assert.match(skill, /model-backed journey uses the configured cheap model tier/)
	assert.match(skill, /Unit tests and headless process tests do not replace this journey/)
})

test('active owner documentation explains the cross-check command consistently', () => {
	const documents = [
		'README.md',
		'docs/ag-json-doc.md',
		'docs/external-runner.md',
		'docs/marcom/USAGE.md',
		'docs/marcom/FAQ.md',
		'docs/marcom/COURSE.md',
		'docs/feature-highlights.md',
		'skills/agentflow/docs/AG_GUIDE.md',
		'skills/agentflow/docs/AG_GUIDE.zh-tw.md',
		'skills/agentflow/scripts/README.md',
	].map(read)

	for (const document of documents) {
		assert.match(document, /cross-check/)
		assert.match(document, /PASS/)
		assert.match(document, /implementation|實作/i)
	}
	const usage = read('docs/marcom/USAGE.md')
	assert.match(usage, /Cross-check review:/)
	assert.match(usage, /Cross-check implementation:/)
	assert.match(usage, /configured external-worker selection rules choose the reviewer/i)
	assert.doesNotMatch(usage, /different family is preferred/i)
	assert.match(read('docs/marcom/FAQ.md'), /same final implementation commit/i)
	assert.match(read('docs/marcom/COURSE.md'), /read-only reviewer/i)
	assert.match(read('skills/agentflow/docs/AG_GUIDE.zh-tw.md'), /唯讀.*reviewer|reviewer.*唯讀/i)
})

test('consequential-work controls are visible in both owner guides', () => {
	for (const guide of [read('skills/agentflow/docs/AG_GUIDE.md'), read('skills/agentflow/docs/AG_GUIDE.zh-tw.md')]) {
		for (const control of ['Design Go:', 'Outcome', 'Minimality', 'Conformance', 'Result Go:', '3ways']) assert.ok(guide.includes(control), control)
		assert.match(guide, /journey|旅程/i)
		assert.match(guide, /host gate/i)
	}
})

test('live devlog, merge-conflict recovery, and proportional cross-check guidance stay aligned', () => {
	const skill = read('skills/agentflow/SKILL.md')
	const delegation = read('skills/agentflow/references/delegation.md')
	const streams = read('skills/agentflow/references/streams.md')
	const english = read('skills/agentflow/docs/AG_GUIDE.md')
	const chinese = read('skills/agentflow/docs/AG_GUIDE.zh-tw.md')

	for (const document of [skill, english, chinese]) {
		assert.match(document, /narrow/i)
		assert.match(document, /targeted/i)
		assert.match(document, /full/i)
		assert.match(document, /skip-review/i)
	}
	assert.match(delegation, /cross-check-plan\.js/)
	assert.match(delegation, /complete relevant suite once/i)
	for (const document of [skill, english, chinese]) assert.match(document, /owner conversation and live recovery|what you asked, short numbered RUN|即時 RUN 事件/i)
	for (const document of [streams, english, chinese]) {
		assert.match(document, /merge --continue/)
		assert.match(document, /finish --prep/)
		assert.match(document, /finish --deliver/)
	}
})

test('named-advisor guidance states the complete parser and route contract', () => {
	const english = read('skills/agentflow/docs/AG_GUIDE.md')
	const chinese = read('skills/agentflow/docs/AG_GUIDE.zh-tw.md')

	for (const guide of [english, chinese]) {
		assert.match(guide, /advisors:\s*requirements,\s*codewalk,\s*spec/)
		assert.match(guide, /requirements.*codewalk.*explore.*spike.*spec.*security-scan.*acceptance.*learn/s)
		assert.match(guide, /trailing comma|尾逗號/i)
		assert.match(guide, /non-string|非字串/i)
		assert.match(guide, /parser order|typed order|解析順序|輸入順序/i)
		assert.match(guide, /dependency-safe|dependency.*order|相依安全|相依性/i)
		assert.match(guide, /named material question|具名.*問題/i)
		assert.match(guide, /before any advisor starts|任何 advisor.*啟動前/i)
		assert.match(guide, /requirements-only|selecting only.*requirements|只選.*requirements/i)
	}

	assert.doesNotMatch(english, /advisors?:.*best effort|advisor selection is only a hint/i)
	assert.doesNotMatch(chinese, /advisor.*只是建議|選擇.*僅供參考/i)
})
