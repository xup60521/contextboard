# Agentflow — the plain-language user guide

**English** · [繁體中文](AG_GUIDE.zh-tw.md)

This page explains how to use agentflow in everyday works, with examples. It assumes you have never used it before. The rulebook for the AI lives in `SKILL.md`; you never need to read that file to use the system.

One term to know before reading: AI = the coding agent you are running now, for example, `codex` or `claude code` cli.

## The protocol and three work routes

- **The protocol** — the everyday way of working: the AI (the controlling agent you are running in, for example, `codex` cli or `claude code` cli) keeps a notebook file. New projects use `.agentflow/devlog.md`; legacy projects without `workspace-dir` keep `devlog.md` at the project root until explicitly migrated. The AI writes every request and answer into that notebook and keeps it up to date. It applies to any job, however small.

- **Direct route** — the host AI itself handles clear local work that is reversible, easy to test, and does not cross a material risk boundary. It does not send that work to another worker merely because one is available.

- **Selected-advisor route** — the AI runs only the advisors needed to answer named material questions that direct work cannot safely settle.

- **Full-pipeline route** — the AI runs the complete requirements, brownfield discovery and codewalk when applicable, specification, implementation, security, and acceptance process for work that is expensive to reverse, crosses a trust boundary, can hide serious failure, or uses an enabled explicit trigger.

## The one idea behind everything

- **You and the AI talk through a notebook file, not through the terminal.** New projects use `.agentflow/devlog.md`; root `devlog.md` is only the legacy layout before an explicit migration.

- You write your request into the notebook. The AI does the work, then writes its answer into the same notebook, right under your request. Everything both of you ever said stays on the page.

- Why a file instead of the terminal: the terminal forgets, the file remembers. Every decision, question, and result is saved in Git, so you can read back the whole history any time, from any computer.

## Getting started — one word

1. Open your project folder in the terminal and start the AI (for example, run `codex`).

2. Type the single word `godev` and press enter.

3. **First time in a project:** the AI runs `agf init` once. This one command creates `.agentflow/devlog.md`, root `ag.json`, the three ignore entries, and the project safety hooks. It never creates a Git repository for you. The JSON file is the only startup configuration file and tells Agentflow where its private workspace is. The public controls use kebab-case: `target-doc: .agentflow/devlog.md`, `workspace-dir: .agentflow`, `cli-provider: off|on`, `auto-reply: on`, `lang: en`, `streams: ask|always|off`, `ask-names: off`, `allow-ag: on`, `metrics: off`, and `large-work-minutes: 120`.

		The AI reads and validates the version-7 `ag.json` (`"schema-version": 7`) before using its settings. The same kebab-case names are used in the public JSON and in setting requests; older spellings are rejected without translation.

	It also leaves an empty "Ask" section at the bottom of `.agentflow/devlog.md`. That empty section is where you type your next request. After that, go back to `codex` and type `/clear` then enter (this ensures a new round with empty context), then `godev` again.

	And it asks you one small question: "what short code name should this project carry?" — see the nickname section just below.

	**If your folder is not yet under Git** (Git is the save-history system that keeps every version of your files, so nothing is ever lost), the AI asks one more question: "set it up for you?" The suggested answer is yes — with Git in place, every round of work is safely saved, and the AI can recover the full story even after a crash. It never sets Git up without asking you first.

4. **Every time after that:** `godev` just means "look at the notebook and continue". The AI makes one small local check that reads the STATUS section, your newest unfinished request, the current branch, changed-file names, and the validated settings. It does not fetch from the network, read old archive pages, or reinstall hooks before its first useful response.

## Give the project a nickname — so you always know which notebook you are in

- **The problem this solves:** when you work in several projects at once, every notebook is a file named `devlog.md`, and they all look alike. It is easy to open the wrong one and type a request into the wrong project.

- **The first time the notebook is created, the AI asks you one question:** what short code name should this project carry? It suggests the project folder's name as the default, so answering "yes" is enough.

- **Your answer is saved at the top of the notebook, in the STATUS section, forever.** It looks like this — a short code name, plus a one-line description in any language you like:

	```
	Project: ag — the agentflow skill and its user guides
	```

- **Change it any time** by saying so in a request, in plain words. There is no special syntax to learn.

## Renaming the notebook — even in the middle of a project

- **The problem this solves:** the nickname above helps once the file is open, but your editor's tab list still shows five files all named `devlog.md`. If you want the filename itself to say which project it is, rename the notebook.

- **How to rename it:** write one line anywhere in a request — `target-doc: ag.devlog.md` — with the new name you want. The AI first commits only the notebook and archive moves. It then updates the adjacent `ag.json`, writes the forwarding card, and records the rename in the new STATUS. This two-commit order keeps the full history attached.

- **Recommended name shape: your project code in front, the word `devlog` kept in.** For example `ag.devlog.md` or `shop.devlog.md`. Your editor tabs become instantly tellable apart, and anyone glancing at the folder still recognizes the file as a notebook.

- **What about new sessions that go looking for `devlog.md`?** The AI leaves a one-line forwarding card at the old address, like the note a post office keeps for a moved house: `Moved to: ag.devlog.md — write your asks there.` A fresh session finds the card, follows it, and continues in the real notebook. It will never create a second empty notebook next to your renamed one.

- **If someone accidentally writes a request into the card,** it still gets answered — the AI carries the text into the real notebook and notes the mix-up. No request is ever lost.

- **Old pages that mention the old name stay as they are.** They are history, and history is never rewritten. The notebook's STATUS section gains one line recording the rename, like `Renamed: devlog.md → ag.devlog.md (2026-08-14)`.

## Do I have to type `godev` for every message?

- **No. You type it once per session.** A session is one run of the AI program in your terminal. After the first `godev`, the notebook protocol stays on for the whole session — everything you say next is handled under it and recorded in the configured notebook.

- **You do type it again when you start a new session** — a new terminal window, a restart, or after you clear the conversation. It is one word, and it also means "pick up exactly where we left off", so nothing is lost between sessions.

- **In a project that already has the configured notebook, you do not even type it the first time.** New projects use `.agentflow/devlog.md`; a legacy project can still use root `devlog.md` until migration. If that configured notebook already exists, the project has said yes once and for all, so the AI switches the protocol on from your first message. In a folder with no configured notebook, nothing is recorded until you type `godev`.

- **`nolog` — one message off the record.** Put the word `nolog` anywhere in a message (or say "off the record", or "don't log this") and that ONE message is answered in the terminal only: nothing is written into the notebook, no `ag.json` change is made, and nothing is saved to history. The next message is recorded as normal — there is deliberately no way to switch recording off for a whole session. One safety rule is never waived: if the turn really changed a file, saved to history, or uploaded something, it IS written down anyway, with a line saying `nolog` was asked for and could not be honoured. The written record must never disagree with what actually happened on disk.

- After the first `godev`, you can talk in two ways, and both work:

	- **Type directly in the terminal.** You can put the request in the same first message as `godev`; the configured notebook may still be unchanged when the AI starts. After its small read-only intake, the AI copies your complete message into the empty final Ask, then does the work and records the answer there.

	- **Write into the notebook itself.** Open `.agentflow/devlog.md` in a new project, type your request into the empty Ask section at the bottom, save, then type `godev` or `continue` in the terminal to tell the AI "I wrote something — go read it".

		- **That unsaved Ask is normal.** If the configured notebook is the only changed file and it changed only from the empty final Ask to your new request, Agentflow treats it as your expected input. It does not mistake that ordinary workflow for another person or another AI working at the same time.

		- **You see useful information first.** After the small local check and the evidence for your request, the AI gives you its direct answer or tells you the exact next implementation step. It then does slower record work such as testing, archive maintenance, saving, and uploading. The final configured-notebook update line is only a completion signal.

## How a conversation round looks

- Your request gets a number, like `A-007`. The AI's answer appears right under it, marked with the same number. One request plus one answer is called a round.

- When the AI needs your decision, it never interrupts you mid-work. It collects ordinary questions at the end of its answer, and under each question it writes a suggested answer and an empty line like this:

	```
	- ans:
	```

- You type your answer after `ans:`, save the file, and type `godev`. The AI reads your answers and continues. If you agree with the suggestion, answering just "yes" is enough. One narrow exception applies during requirements work: open requirements questions keep their single `- ans:` fields at the exact requirements report path named by the notebook — `requirements-report.md` for newly allocated work, or the path already recorded for existing work — and the notebook lists that path and the outstanding question IDs instead of copying those questions.

## The settings — what they are, how to see them, how to change them

### The live task tracker

For jobs with a task list, create one `tracker.md` immediately after decomposition: `.agentflow/features/<taskkey>/artifacts/<work-key>/tracker.md` for stream work, or `.agentflow/artifacts/<work-key>/tracker.md` otherwise. A legacy project without `workspace-dir` uses the former root paths until migration. A short task that never forms a task list needs no tracker.

The tracker uses these sections in order: `Identity`, `Overall state`, `Accepted task checklist`, `Accepted scope changes`, `Current recovery`, `Completion proof`, and `Update meaning`. Keep one stable `T-N` item per current task, with `[x]`/`[ ]`, matching total/completed/remaining counts, an Ask/WIP `Source:`, and `Proof:` for checked items. Every task describes the required result, what is outside that task, and the evidence that will prove it done. The `Source:` value tells you where the request came from, but the task must still make sense after that devlog round moves to the archive. Record the current item, last proven result, blocker or running process, next safe action, and expected changed files.

`complete` is honest only when every item is checked, no accepted decision blocks, no operation runs, no next action remains, evidence is complete, and the recorded commit is verified. At each WIP checkpoint, end with `[x] tracker.md | [x] devlog RUN | [x] scope matches tracker`. These are current-file evidence claims, not commit or upload claims. The tracker update time must be at least as new as the checkpoint, and a preceding RUN event must record the changed-path-versus-tracker comparison. The normal round still commits and uploads its records before final completion.

The two current records have separate jobs:

- **`.agentflow/devlog.md`:** what you asked, short numbered RUN events after meaningful changes, ten-minute WIP status reports, and the final Reply. Historical runlog files remain untouched but are not current evidence.

- **`tracker.md`:** what is done, what remains, and how to resume.

Updating it never means “stop”; work continues unless stopped, truly blocked, or proven complete. `/goal` may use this view; Agentflow does not alter that Codex command.

The switches, `pipeline-roles`, and ordered `external-workers` profiles live in the validated version-7 root `ag.json`. STATUS shows only a short health line.

- **See them:** type the single word `settings`. The AI reads `ag.json` again, then lists its schema version, runtime host, external CLI availability, legal values, and exact change syntax.

- **Change one:** write a line like `auto-reply: on` anywhere in your request. The AI validates every requested change first, writes one canonical JSON document atomically, and confirms each change as `old → new`.

- **`workspace-dir`** — the repository-relative folder that holds Agentflow's private records. New projects use `.agentflow`. It holds the notebook, archive, artifacts, streams, and plan queues. New rounds do not create a separate audit side file; the completion checker derives its review decision from Git and current review evidence. Existing repositories without this setting keep their current root paths, and old audit files remain untouched history.

- **Move an existing workspace:** first set `workspace-dir: .agentflow` or another safe relative path, commit that setting, then run `agf settings migrate-workspace`. The command requires a clean Git repository, refuses occupied destinations, moves only tracked Agentflow-owned root records, updates root `ag.json`, and commits the move. It never runs during ordinary resume.

- **`target-doc`** — which repository-relative Markdown file is the notebook. New projects use `.agentflow/devlog.md`. A rename uses the dedicated two-commit operation, which moves the notebook and archive first, then updates configuration, the forwarding card, STATUS, and backlinks.

- **`lang`** — the language used for answers, documents, comments, and commit messages. Default: `en`. Use a non-empty language tag or existing language name, such as `lang: zh-TW`.

- **`auto-reply`** — whether the AI may answer routine questions and continue. Legal values are `on` and `off`. Hard stops still apply to owner-only decisions, irreversible actions, and new outward channels.

- **`streams`** — how the AI handles a plain-language signal that a feature or concurrent work may need its own branch and second folder. `always` opens that stream; `ask` asks first; `off` reports the signal but neither asks to open a stream nor opens one. `off` does not hide ownership or concurrent-work safety problems. `new-feature: <name>` always opens the stream you directly requested.

- **`ask-names`** — whether new request headings include the writer's name. Legal values are `on` and `off`.

- **`cli-provider`** — whether delegated work stays on the host's CLI family (`off`) or may use a different available family (`on`). The unified external worker always runs the command; the JSON file cannot supply a command path.

- **External command route:** every delegated task uses the unified external worker with a validated literal command in an independent clone.

- **Substantive work route:** research, planning, implementation, document drafting, scans, and first-pass review use that unified external worker. The coordinator keeps the owner conversation, safety boundaries, independent verification, final judgment, Git integration, and delivery.

- **Live RUN events** — Agentflow appends a numbered event to the devlog after a meaningful state change, such as route selection, a task result, a test, a gate, a failure, or recovery. It does not record every command. WIP remains a separate complete status report after ten active minutes.

- **`streams`** — how feature or parallel-work signals are handled. Legal values are `ask`, `always`, and `off`. `always` opens the stream, `ask` asks first, and `off` reports the signal without asking or opening a stream. This never hides ownership or concurrent-work safety problems, and direct `new-feature:` still opens the stream requested by the owner.

- **`allow-ag`** — whether complex pipeline work may start. Legal values are `on`, `off`, and `ask`. `off` blocks the complex route, and `ask` requires owner confirmation. Simple jobs use the direct planning route under every value.

- **`large-work-minutes`** — the estimated active-work threshold above which the large-work route starts. Default: `120`. Use an integer from 1 through 10080.

- **`metrics`** — whether completed pipeline stages write the optional local metrics history. Legal values are `off` and `on`. The evidence window is a command option, not a setting.

- **External-worker profiles:** each profile has a unique ID, a literal executable-and-argument array, a priority from 1 through 5, an optional family label, and `best`, `better`, `basic`, and `cheap` tiers. The highest-priority available profile wins; an equal priority keeps the first profile in the array. `cli-provider: off` keeps only the host family, while `cli-provider: on` permits every available family.

- **Worker tiers:** `best` is for high-risk review, `better` for planning and acceptance, `basic` for bounded implementation and routine work, and `cheap` for the least important low-capability work or an optional manual quota probe. The exact model and effort come only from validated `ag.json`, inside the selected profile.

- **Pipeline roles:** each canonical stage maps to a built-in or custom tier, or `off`. Turning off requirements, specification, implementation, or acceptance warns that the full pipeline is unavailable.

- **Session-limit recovery:** when a provider reports subscription session exhaustion, the coordinator disables that profile for the current session and continues with the next eligible profile. An optional manual probe can use `claude -p --model <cheap-model> hihi`; Agentflow does not spend that call automatically.

- **Missing configuration:** an established notebook without `ag.json` stops with a clear repair message. The system does not create configuration from STATUS text; a new configuration needs an explicit initialization or repair action.

## Public names, advisor choices, and safe implementation rules

### Request one independent implementation review with `cross-check`

Add `cross-check` to an Ask when you want one external reviewer to inspect the finished implementation before Agentflow reports completion. Implementation includes requested source code, tests, configuration, and user-facing documents.

The reviewer works read-only. The report must name the exact implementation commit and separately give `Outcome`, `Minimality`, and `Conformance` as `PASS` or `BLOCKING`, followed by its overall verdict. This keeps “does it solve the Ask?”, “is every added concept necessary?”, and “does it meet the agreed contract?” from collapsing into one approval. The round checker refuses completion when any required verdict is missing, malformed, or blocking. If implementation changes after review, the old report no longer applies and review must run again.

Agentflow automatically chooses a proportional review level from a frozen changed-file list, changed-line count, behavior-change flag, trust-boundary flag, and broad-change flag. A `narrow` review checks a small documentation-only diff and its named contracts without repeating an unrelated complete suite. A `targeted` review checks an ordinary behavior change and reruns focused tests; it uses the coordinator's already-passed complete-suite evidence. A `full` review covers broad, high-risk, or trust-boundary work and reruns the complete relevant suite. Explicit owner control can request `stronger`, which raises one level. Exact current-Ask `skip-review: <accepted tradeoff>` skips this final independent review at any level and records why the owner accepted that choice. It does not skip tests, delivery checks, or consequential-work approval gates.

A completed Reply records `Cross-check review: <repository-relative report path>` and `Cross-check implementation: <40-character commit hash>`. The report must belong to the current Ask's work key, contain the same hash as `Reviewed implementation commit: <40-character commit hash>`, contain exactly one verdict and that verdict must be `PASS`, use the standard worker opening stamp, and end at its one `Self-check:` line. The checker rejects unsafe paths, symbolic links, unreadable or malformed reports, multiple or blocking verdicts, and mismatched commits. A valid model or effort label that differs from trusted dispatch metadata produces a warning instead of a retry. The coordinator separately verifies that the external worker really ran because report text alone cannot prove who wrote it.

`cross-check` also applies when the full `ag` pipeline performs the implementation. The pipeline's mandatory external acceptance report can satisfy the same gate when it covers the same final implementation commit. Agentflow does not run a second duplicate reviewer, and it does not add separate cross-checks to requirements, codewalk, exploration, spikes, specification, security, acceptance, or learning stages.

### Debate a consequential plan with `3ways`

Put `3ways` or `threeways` in a request only when the plan needs an independent pre-implementation debate. Agentflow freezes the original Ask, ordinary user journey, smallest design, added concepts, uncertainties, forbidden scope, and open questions; it then runs one read-only external review. The host is `brain_1`; it chooses a highest-priority eligible different-family `better` worker for `brain_2`, recording a same-family fallback when that is all that is available.

Save a consequential-work design as `<work-root>/design.md`. The name `plan-NNN.md` is reserved for executable looper queue items.

Each round keeps immutable brief, report, and host-resolution records. Agreement requires verified evidence, no material disagreement, and `Consensus: AGREE`. After three starts, or when only the owner can choose, the record says `Consensus: UNRESOLVED`. Debate never authorizes implementation: you still give `Design Go: <plan commit>` or `Design Stop: <reason>`. A consequential implementation later needs a passing journey, all three cross-check verdicts, a host gate, and `Result Go: <implementation commit>` before delivery.

If you must leave before those two gates, put the exact line `away: gates` in the current Ask. It authorizes Agentflow to apply only that round's Design Go and Result Go after every normal check passes for the exact commit. It does not approve unknown work, vague away wording, failed checks, changed scope, a later Stop, irreversible work, or a new outward channel.

The names below are the public words a person can type or see. Use the hyphenated form exactly.

- `new-feature: <name>` opens a feature stream.

- `merge-back` closes the stream from its worktree.

- `target-doc: <path>` names a notebook target.

- `cli-provider: <value>`, `auto-reply: <on|off>`, and `ask-names: <on|off>` change the matching settings.

- `allow-ag: <on|off|ask>` and `metrics: <off|on>` change the matching settings.

- `keep-going` authorizes the current approved open list to continue until it is finished.

- `all-in` requests the full pipeline for the current request.

- `cross-check` requires one external read-only PASS review of the final implementation for the current request without forcing the full pipeline.

- `3ways` and `threeways` request a pre-implementation plan debate; neither word authorizes implementation.

The public `pipeline-roles` names are `requirements`, `codewalk`, `explore`, `spike`, `spec`, `implementation`, `security-scan`, `acceptance`, `cross-check`, and `learn`. Each selects a configured tier or `off`. `cross-check` uses the same worker-selection rules, while remaining a separate post-implementation gate rather than a full-pipeline stage.

There is no second underscore-named settings schema. Unknown public keys are warned about and ignored; missing recognized keys and invalid recognized values remain errors.

### Select only the advisors you need

For a work item, an optional line can choose advisors:

```text
advisors: requirements, codewalk, spec
```

The exact eight-name roster is `requirements`, `codewalk`, `explore`, `spike`, `spec`, `security-scan`, `acceptance`, and `learn`.

- Spaces around commas are ignored.

- Every non-empty token must exactly match one roster name.

- Repeated valid names are deduplicated, so an advisor is selected once.

- An empty selection, empty token, or unknown name stops routing before any advisor starts and reports the accepted roster and the bad value.

The line is parsed before route dispatch and before any advisor starts. Its value must be a comma-separated string. Surrounding token whitespace is ignored. An empty value, whitespace-only value, empty token, trailing comma, non-string value, unknown name, or case mismatch is rejected with the bad value and the accepted roster. The parser keeps first-occurrence order after de-duplication.

That typed order is selection evidence, not an execution-order override. Dependency-safe routing may run a required predecessor first, and a selected-advisor route must name at least one material question. `advisors:` chooses who may be dispatched; it cannot bypass dependencies or coordinator duties.

For example, `advisors: requirements, spec, requirements` freezes the selection `requirements, spec`. The duplicate is removed and the first occurrence stays first. Without an `advisors:` line, normal route selection applies.

The validated selection is frozen in the controlling brief and execution record before the first selected advisor runs. A new explicit owner choice creates an immutable amendment that records the new selection and the earlier brief or amendment it supersedes. Earlier briefs, amendments, selections, and records remain unchanged.

When the work resumes after a crash, recovery, or lost conversation context, Agentflow reads the newest immutable brief or amendment before routing. It does not restore an omitted advisor because a normal default was forgotten. Selecting only `requirements` runs that advisor and then lets the coordinator perform the remaining authorized implementation and verification after the accepted report and required owner sign-off.

Advisor selection changes who is dispatched. It never removes tests, evidence, sign-off, Git work, isolation, artifact checks, or the coordinator's verification and reporting duties.

### Formal repairs and test-first work

For an executable behavior change or bug fix, the default is red-first test-driven development.

1. Add or change the automated test that expresses the required behavior.

2. Run it before changing production code and record the intended failure.

3. Confirm that the failure is the missing or broken behavior, not a fixture, syntax, environment, or setup problem.

4. Make the smallest production change that makes the test pass.

5. Run the focused test again and record the passing result.

6. Run the full relevant suite and record its result.

Documentation-only work may omit the initial failing run because it changes no executable behavior. A mechanically formal artifact repair may also omit it when the repair record states the reason, identifies the authoritative replacement, proves the limited byte change, and reruns the complete artifact gate.

The coordinator may repair only a fixed formal span whose replacement is already determined by immutable authority or verified execution evidence. Examples include a standard opening stamp, exact required heading, exact path label, or exact final boundary. The record names the defect, source, and span; compares before and after bytes; proves every byte outside the authorized span is unchanged; and reruns the full gate. A defect that changes findings, decisions, conclusions, evidence meaning, or self-check judgment returns to the responsible advisor.

### Bounded large work and review decisions

Agentflow uses the large-work route only when a request is incoherent or its estimated active work is more than two hours. The controller-only master plan records the complete outcome, ordered items, dependencies, ownership, progress, and final integration check. The queue receives one self-contained, independently checkable plan at a time; it never receives the controller's private state. A coherent ordinary request stays on the ordinary route.

The large-work order is fixed:

1. The controller may draft a private master outline so it can see the likely whole. This draft does not authorize implementation.

2. One requirements advisor settles one shared requirements report for the complete owner request.

3. Existing-product work always records discovery. Codewalk runs only for unfamiliar code, multiple subsystems, a public interface, stored data, a trust boundary, or a stale or missing map. With a trigger, one accepted current codewalk record can satisfy both logical obligations only when it carries an explicit shared-coverage marker, current codewalk evidence, answered questions, and verified paths, fact/inference labels, public boundaries, conventions, likely edit locations, focused commands, and unexamined areas. Without a trigger, keep the small discovery record and do not dispatch codewalk.

4. One specification advisor turns the accepted requirements and repository evidence into one shared implementation contract.

5. Only then does the controller freeze the executable `plan-NNN.md` files. Each plan owns one bounded part of the shared contract and contains the exact Authority, Outcome, Dependencies, Required work, Constraints, Tests and evidence, Completion conditions, Success signal, and Final integration sections.

6. The plans run one at a time in dependency order. They do not each restart the complete requirements process.

7. If a plan exposes a missing or contradictory decision, that plan stops. The controller repairs the affected shared requirements or specification before the plan resumes.

8. After all plans finish, the controller checks their combined result against the complete original request.

The `make-plans` operation classifies each owner job as simple or complex. It publishes self-contained simple plans directly, uses accepted requirements and specification authority for complex plans, and can publish only an independent simple-only partial queue when complex work is blocked. It stops after it publishes this digest-bound frozen queue. It does not start implementation. Later execution uses the same frozen plan bytes and completion contract through the ordinary external-worker route.

Estimated and actual active time are recorded separately. More than ten checkpoints is a visible warning and a prompt to split the work, not an automatic failure. Ten checkpoints is still inside the soft boundary. The large-work route starts above `large-work-minutes`, which defaults to 120 and can be changed with `large-work-minutes: <minutes>`.

For a new or edited checkpoint, keep every progress item short. `Finished` and `Running now` each use an ordered list below their outer field bullet. Write `- **Still to do:** None.` exactly when nothing remains; otherwise `Still to do` uses the same ordered-list shape. Put a blank line after the outer bullet, indent each numbered item by two spaces, start at `1.`, and put a blank line after every item. End with the combined verification line described above. Its `scope matches tracker` checkmark says the controlling AI compared the actual changed paths with the accepted tracker scope. The Stop hook requires the durable comparison record; it cannot prove that a design is necessary. Presentation mistakes warn; they do not replace substantive evidence.

Every review stage keeps the same identity even if its name changes. Before starting a worker, Agentflow checks the working directory, test access, executable, and authentication. If a live fact is unavailable, it asks for manual input and records SKIP. One failure before any process or model starts is free; every later failure counts, and a stage can start at most three workers total. When that fixed ceiling is reached, the unresolved result remains and the automatic cycle stops; the AI cannot silently grant itself a fourth start.

Security gets one advisory pass. Data loss, destructive behavior, credential exposure, and central-requested behavior failure go to the owner/controller for a decision; other findings become follow-up work. Acceptance reports owner-visible behavior separately from record quality, and neither security nor acceptance starts an automatic repair loop.

In owner-facing prose, explain technical boundaries in plain language and state the substantive outcome, limitations, decisions, and next action clearly.

Every completed substantial round must put `## [FINAL REPORT]` immediately after `## [SUMMARY]`. The report must stand alone. It restates every final outcome, failure, decision, limitation, and action the owner needs. A pure short-answer round is exempt.

When one Ask contains several requests, the Reply answers them in the same order as the owner's request. Each request gets its own clearly separated group. The group starts with a short reminder of the original task or question, then gives the answer and relevant proof. For a task, it says whether the work succeeded, failed, or remains limited, and explains any problem encountered.

### Keeping older rounds

The AI checks the live notebook at every activation. It automatically moves completed old rounds to the archive when the live notebook exceeds 500 lines or when the new request is clearly unrelated to the older live rounds. If old completed rounds remain but neither condition applies, it asks one reminder question instead. Completed rounds are exact physical spans from `# → Ask / A-NNN` through the matching next Ask boundary. Copy those bytes unchanged into one adjacent `<basename>.archive.md` in chronological order, verify the identifier once, byte length, and SHA-256, and remove the same live bytes only after that verification. Preserve every verified copy and stop on a collision, source replacement, or uncertain boundary. `Archived eras:` is only `none` or that adjacent archive path; it never contains an era label, range, batch, or human index. Keep one `---` separator between STATUS and the current round, keep the current round immediately below it, and keep the next empty Ask scaffold at the end. Write the Reply before the final STATUS projection.

### Frozen planning queues

The `make-plans` operation publishes numbered `plan-NNN.md` files and a `.queue-generation.json` file, then stops before implementation. Each v2 envelope records whether each plan is simple, complex, or final integration, and binds simple plans to the owner request and repository evidence or complex plans to the accepted contract.

The `.queue-generation.json` file is a sealed instruction sheet for that plan queue. It records which plan files belong to the queue, their fingerprints, their route-specific authority, their order and dependencies, and the notebook completion line that proves the work finished. Looper and an ordinary host agent call the shared `select_frozen_ready_plans` boundary. Both refuse the queue if this instruction sheet or one of its plans is missing, changed, incomplete, or contradictory.

Publishing the queue does not start workers or track their attempts. A later command reads the unchanged plan files and runs them.

### Running your own handwritten plans

The separate `looper.js` command accepts either a queue that you write yourself or the exact `planned/` directory published by `make-plans`.

On a new machine, one setup command installs both terminal shortcuts:

```sh
agf setup --fix
```

Open a new terminal tab after setup. You can then type `agf` for feature work and `agf-looper` for plan queues from any checkout. Run `agf-looper --help` for the command summary.

Setup checks three installation locations in order: `$HOME/.agents/skills/agentflow`, `$HOME/.codex/skills/agentflow`, and `$HOME/.claude/skills/agentflow`. It uses the first complete location when it writes a new shortcut. An existing managed shortcut remains valid when it points to any complete location in that list, even if its indentation differs from the generated example. This supports the shared directory created by `npx skills add`, direct Codex or Claude installations, and their aliases without needless rewrites.

Put plans that you write yourself in a work item's `planned/` folder. Keep plans published by `make-plans` beside their `.queue-generation.json` instruction sheet.

Run looper from the checkout where the plans must do their work. Use the absolute path to `looper.js` when that checkout is not the Agentflow repository:

```sh
cd <checkout-where-the-plans-must-work>
node <absolute-path-to-agentflow>/skills/agentflow/scripts/looper.js --tasks-dir <path-to-planned>
```

After setup, the shorter global form is:

```sh
cd <checkout-where-the-plans-must-work>
agf-looper --tasks-dir <path-to-planned>
```

The shorter path `skills/agentflow/scripts/looper.js` works only when your current directory contains that path. Looper does not search other directories for the script.

Looper selects a worker command from the `ag.json` file beside the notebook that owns the plans. It runs one ready plan at a time in the current checkout. After it verifies that a plan finished, it moves that plan to `done/` and starts the next plan whose dependencies are complete. The shared readiness boundary keeps final integration until every published terminal job is complete.

Looper prints the working directory, plan directory, expected completion reply, and a `current/total` progress count before work starts. Its plan list uses `[x]` for complete, `[*]` for running, `[-]` for the plan that stopped, and `[ ]` for pending. During normal work it keeps the screen quiet with one start and one completion line per plan. Add `--show-output` when you want to page the worker's bounded final output in `less` after each plan.

When work stops, looper keeps the plan in place and prints a five-step review checklist with the exact stop-marker and protected-attempt paths. It does not guess that a normal host session finished a plan. If another host truly completed it, inspect the plan, notebook, and Git changes first, then move the reviewed plan into `planned/done/`. Preserve any failure evidence you need and clear only the reviewed stop and attempt records before running `agf-looper` again.

For a queue published by `make-plans`, the sealed instruction sheet identifies the correct notebook and configuration, including those inside a feature stream. It also prevents changed plans from running, enforces plan dependencies, and keeps the final integration plan until all earlier work is complete. A conflicting notebook completion path is refused.

When looper runs a published queue with Codex, it checks the worker's final response through a protected channel. It ignores ordinary terminal output because that output can contain extra messages. If the final response is missing, changed while being checked, too large, or not valid text, the plan stays in place for review. The internal file-handle mechanism is documented in `docs/LOOPER.md`.

A handwritten queue does not need a `.queue-generation.json` instruction sheet. It uses the notebook completion line instead.

## Going `all-in` — asking for the full ceremony on one job

- **The problem this solves:** for small jobs the AI is allowed to take shortcuts — skip optional review steps, shrink the paperwork — so you are not paying for ceremony a one-line fix does not need. But sometimes a job LOOKS small and is actually important, and you want every check to run and every document to be written, no shortcuts at all.

- **How to ask for it:** put the word `all-in` anywhere in your request. For example: "go `all-in` on this job: add a delete button to the invoice page." The hyphen makes it a command, so the ordinary English words "all in" do nothing and cannot trigger it by accident.

- **What the word instructs the AI to do, exactly:** run the full development process; propose or take no shortcut route; run every optional checking step (the risk explorer, the technical experiment, the security scan, the lessons write-up); and let no required step shrink — each one runs at full depth and leaves its full document behind.

- **Why "instructs" and not "guarantees".** These are rules the AI reads and follows, not a machine that stops it. The outside checker that runs after each round looks at the record — timestamps, the terminal line, push claims, the reply's shape — and does not currently verify that every pipeline stage really happened. In testing, a weak model under `all-in` did keep the important rules about who writes which document, and still broke several bookkeeping ones. So the word buys you a much stronger process, and your own reading of the resulting documents is still the final check.

- **It covers that one request only.** The next request goes back to normal, where the AI sizes the effort to the job. There is no setting to turn off afterwards.

## Working alone on one thing at a time — nothing special to do

- Just write what you want in the notebook. For example:

	```
	+ Please build a small tool that reverses a string, with tests.
	```

- The AI plans, builds, tests, and reports — all in the notebook. When the piece of work is finished, older rounds are compacted into the notebook's one adjacent archive while the current round remains visible, and the main notebook stays short and readable.

## The life of a feature — from start to permanent record

Before diving into the details, here is one feature's full journey from start to finish, so you can see why each stage exists.

1. **You open it** — one line, `new-feature: login-page` (or `agf new "login page"` in your terminal). The system creates a branch (a parallel line of history that does not disturb anyone else's work), a second folder on your disk (so two AI sessions never overwrite each other's files), and the feature's own notebook inside that folder. From this moment, everything you say and everything the AI answers about this feature lives in that notebook, not in the main one.

2. **You work in it** — exactly the way you work in the main notebook. Type `godev`, write requests, read answers. The AI knows which notebook to use because it checks which branch you are on.

3. **You close it** — `merge-back` from the feature session starts the two-phase finish, or `cleanup: login-page` from the main folder performs cleanup. The agent calls `node <skill-dir>/scripts/agf.js finish --prep`, writes, commits, and pushes the closing notebook record when `origin` exists, then calls `node <skill-dir>/scripts/agf.js finish --deliver`. Delivery accepts the original committed notebook bytes only when they are valid UTF-8, use LF or consistently formed CRLF line endings, contain no disallowed controls or lone carriage returns, and have exactly one byte-exact `Feature: <name> — closed` line. It rechecks the stream tip and branch before each default-ref mutation and targets the validated commit itself. The owner can run `agf finish --prep`, `agf finish --deliver`, and later `agf cleanup login-page` directly. One thing cleanup does NOT delete: the feature's notebook.

   Delivery uses a short-lived, exclusive `agf-delivery.lock` file in Git's common directory for the main checkout. It records the delivery owner, a random owner token, and recovery details; release verifies the pathname identity and token before unlinking, so a replacement is preserved. If release cannot prove ownership or unlink fails, the command returns non-success, emits no directory stdout, and says truthfully whether remote/local Git delivery completed or is partial/unknown. This lock covers Agentflow deliveries only. Manual Git operations do not honor it, so do not switch branches, merge, fetch, or push by hand while delivery is running. If a process has stopped, inspect the lock record before removing a stale lock.

4. **The notebook stays forever** — at `.agentflow/features/login-page/login-page.devlog.md` in a new project, merged into your main line alongside the code. A year from now, anyone can open it and read why a decision was made, what was tested, and what went wrong along the way. The code tells you WHAT was built; the notebook tells you WHY.

- **The cost of all this:** one branch name, one folder (both temporary), and one small text file per feature (permanent). The cost of NOT doing it: two terminals quietly overwriting each other's files, and no record of why anything was built the way it was.

## Working on features in parallel, or in a team — the notebook splits by itself

Here is the whole feature in one sentence: **when several pieces of work happen at once, each piece gets its own private notebook and adjacent `ag.json` in its own folder, and the main `.agentflow/devlog.md` becomes a table of contents pointing at all of them.**

You never create folders and never learn any path rules. Here is what it looks like in practice.

- **Example story:** you and a teammate share one project. You are building a login page on your own Git branch; the teammate is building a search box on theirs.

- **Step 1 — you say which feature you are starting.** In the main notebook (or the terminal) you write one line:

	```
	new-feature: login page
	```

	Plain words work too — "I'm starting the login page, my teammate is on search at the same time" means the same thing, and the AI proposes the same one line back to you. Even if you say nothing about parallel work, it notices the signs on its own (you are on a feature branch, or another piece of work is already active) and offers it as a one-word yes/no question.

- **Step 2 — the AI builds everything.** It calls `node <skill-dir>/scripts/agf.js new "login page"`, which creates the branch, `.worktrees/login-page`, validated adjacent configuration, initial stream notebook, and first commit. The agent then owns the root pointer and stream-open Reply, leaves an empty next-Ask scaffold, and gives you exactly one copy-ready continuation line in the form `cd '<absolute-worktree-path>' && <current-host-cli>` with the `/exit` reminder; the resolved absolute path stays shell-quoted. No host relocates the current session. If the exact script is unavailable, the agent reports that path and stops rather than composing a direct Git fallback.

- **Step 3 — you keep talking exactly as before.** On your branch, you just type `godev`. The AI checks which branch you are on and opens the right notebook by itself. You never remember the path. If it genuinely cannot tell which piece of work you mean — say, two pieces of work live on the same branch — it asks you one question instead of guessing.

- **Wrote in the wrong file by mistake? It does not matter.** The AI answers wherever you wrote, and points out the mix-up. No request is ever lost because it was typed in the wrong place.

- **Merge day — there is nothing to do.** Your notebook and your teammate's notebook live in different folders, so Git merges them side by side with no conflict. After the merge, the AI refreshes the table of contents in the main notebook so it lists both finished pieces of work.

- **For teams that always work this way:** write one line — `streams: always` — in any request. It is a normal setting, described in full in the settings list above, and it makes plain feature or parallel-work signals open a stream immediately instead of asking first or only reporting the signal.

- **You always know which notebook is live**, whatever that setting says, from three places: the one line the AI prints in the terminal after every round names the exact file it just wrote; the main notebook's STATUS lists every active notebook and where it lives; and typing `godev` on a branch opens that branch's notebook by itself.

## Do I need a new branch or a worktree to start a feature?

Short answer: **usually no.** A branch, a worktree, and a separate notebook are three separate tools, and each one is optional. Here is what each one is, and when it starts to be worth having.

- **Working alone, one feature at a time — just write the wish.** Stay where you are, write the request in the notebook, done. No branch, no worktree, no separate notebook. When the feature finishes, its older rounds remain in the notebook's one adjacent archive and its current round stays visible.

- **A branch** is a parallel line of history inside the same project. Work on it stays out of everyone's way until you merge it back, and you can abandon it cheaply if the feature dies. You want one when the work is experimental, long-running, or happening at the same time as someone else's work.

- **A separate notebook (a "stream devlog")** keeps one feature's conversation in its own file. You want it exactly when two conversations would otherwise mix in one file — the parallel-work case. For feature work you never ask for the notebook on its own and you never type a path: the one line `new-feature: <name>` below builds it along with everything else. (For a conversation that will never produce code, you *can* ask for just the notebook — see the escape hatch further down.)

- **A worktree** is a second physical folder on your disk showing a different branch of the same project. Without one, switching branches swaps the files in your one folder back and forth; with one, both branches sit on disk at once, in two folders. It is genuinely useful in exactly two cases: you want to keep working in your main folder while an AI worker builds the feature in the other folder at the same time, or you switch between the two pieces of work so often that the constant file-swapping hurts. Otherwise it is extra weight — one more folder to remember, and it is easy to type a command in the wrong one. Delegated workers instead run in independent disposable Git clones with no remotes; feature worktrees are owner/session workspaces, not worker safety cages.

- **The short way to say all of it: `new-feature: <name>`.** When you want a feature to have its own space, you do not type a sentence describing it — you type one line, in the notebook or the terminal: `new-feature: login page`. The agent calls `node <skill-dir>/scripts/agf.js new "login page"`, then writes the pointer, stream round, empty Ask scaffold, and exactly one copy-ready continuation line: `cd '<absolute-worktree-path>' && <current-host-cli>`. The path is the resolved absolute worktree path and remains shell-quoted. No host relocates the current session. Nothing else to remember or type. The CLI does not write protocol prose. Plain words work too — "let's start the login page" gets you the same thing, offered as a one-word yes/no question first (or done immediately if you set `streams: always`).

- **Why there is only this one line, and no lighter version of it.** You might expect a smaller command that makes only the separate notebook and skips the branch and the second folder. There deliberately is not one, for three reasons. First, this line already makes the notebook, so a smaller command would add nothing to it. Second, two similar-looking commands would force you to choose correctly at the worst possible moment: you are thinking about the feature, not about tooling, and a wrong pick gives you no warning — the small one looks fine right up until a second terminal opens an hour later and the two sessions quietly write over each other's files. Third, the two mistakes do not cost the same. Using this line when you did not need it costs you a branch name, a reference on the server, a hidden folder on disk, and a cleanup command later — small, visible, and reversible. Using a lighter one when you needed this costs you real work that got overwritten. Since the thing that actually collides is the files on disk, and only a second folder separates files, there is one line and it is the safer one.

- **If you really do want the notebook on its own, plain words get it.** Say **"open a separate devlog for X"** in the notebook or the terminal, and you get `.agentflow/features/<name>/<name>.devlog.md` plus its adjacent `ag.json` in a new project: same folder, same branch, nothing moved, nothing branched, nothing uploaded. Any wording meaning the same thing works, and you never type a path. Use it for a conversation that will never produce code — reviewing a document, a research question, a planning discussion you want kept out of the main notebook. For anything that will produce code, use `new-feature: <name>` instead.

- **Where the second folders live, on every AI tool: `.worktrees/<name>` inside your project.** The same CLI call creates that folder for every host. No host relocates the current session; every owner receives exactly one continuation line, `cd '<absolute-worktree-path>' && <current-host-cli>`, with the resolved absolute path shell-quoted and an `/exit`-first reminder. The AI also adds `.worktrees/` to the project's ignore list the first time, which keeps those copies out of your commits and out of searches that respect that list. One project stays one folder, and sweeping up afterwards is one command.

- **The rule of thumb:** solo and sequential → just write the wish, nothing else. Anything parallel — a person, a second terminal, or a background AI worker — → one line, `new-feature: <name>`. When you are not sure which case you are in, use `new-feature: <name>`, because that is the mistake whose cost you can see and undo.

- **Opening a second AI terminal yourself (the N-terminal case):** two live AI sessions must never share one project folder — that is exactly how they overwrite each other's files. Every host uses the same CLI-owned path and the same record rules. The agent calls `node <skill-dir>/scripts/agf.js new "<name>"`, writes only the model-owned pointer and stream round, and gives you exactly one ready-made continuation line: `cd '<absolute-worktree-path>' && <current-host-cli>`. The path is absolute and shell-quoted. No host relocates the current session. Quit the current AI session first with `/exit`, then paste that line into the plain terminal. Pasting it inside a still-running session sends the text to the AI instead of your shell. The second session leaves the first terminal's unsaved files and unfinished root requests alone; even the root pointer is deferred when another session owns that write. This holds however you phrase the request: a feature trigger opens its own stream first and never resumes the main notebook's unfinished work.

- **Closing that terminal down — the feature is finished, put it back:** type `merge-back` in the same terminal that built the feature. The agent runs `node <skill-dir>/scripts/agf.js finish --prep`, writes the closing Reply and closed STATUS, commits and pushes that record, then runs `node <skill-dir>/scripts/agf.js finish --deliver`. The current or legacy stream notebook must be tracked at clean stream HEAD, contain the exact byte-level `Feature: <name> — closed` line in a valid UTF-8 blob with consistent LF or CRLF endings and no disallowed controls, and match `origin/<name>` before delivery. The two phases keep the closing record reachable before the default branch moves; delivery rechecks the stream branch and tip before pushing or merging the validated commit. Before a local fast-forward, the CLI refuses untracked or ignored collisions on newly added paths; a remote push followed by that refusal is reported as partial. If delivery is refused, the CLI reports whether the remote was updated and gives a quoted recovery line; a lock-release refusal also returns non-success, emits no directory path, and reports the Git partial result. It never calls the other checkout unreachable or a protocol rule a sandbox. If you also say "and clean up", the agent runs `node <skill-dir>/scripts/agf.js cleanup <name>` and reports every safe refusal. The owner-facing commands are `agf finish --prep`, `agf finish --deliver`, and `agf cleanup <name>`.

- **Cleaning up from your main folder — one line, `cleanup: <name>`.** The feature is finished and you are back in your main project folder. Run cleanup there, because deleting a worktree while an AI session still uses that folder prevents the session's end-of-turn check from starting. If cleanup is called inside the target worktree, it changes nothing and prints the exact command to run after you exit and return to the main checkout. The main checkout itself must be on the default branch. The agent calls `node <skill-dir>/scripts/agf.js cleanup login-page`; the owner calls `agf cleanup login-page`, `agf clean login-page`, or `agf merge login-page`. The three names use the same existing merge-preserving cleanup. It refuses the wrong checkout or branch, unknown names, dirty worktrees, and conflicts instead of guessing or forcing deletion. A failed fetch or default-branch push stops with status 1 before sweeping, preserving the worktree and local and remote stream references; an individual sweep refusal is reported while remaining safe sweep steps continue. The agent writes the root round afterward. The feature's own notebook is never deleted.

- **Doing it by hand from the terminal, without waiting for an AI — `agf new`, `agf finish`, `agf cleanup`, and `agf ditch`.** Everything above can happen through the AI, or you can run the same deterministic commands directly in your terminal. The shell function changes directory only when the CLI prints a successful directory result. Its exact setup text is in `skills/agentflow/scripts/README.md`.

	- **`agf new "login page"` opens the feature.** It makes the branch, makes the second folder, copies the validated `ag.json` to the feature folder while preserving its direct `target-doc` setting, writes the feature's fixed-STATUS notebook, saves that first commit and uploads it, then leaves your terminal standing inside the new folder. Start your AI there and type `godev`. A name in another language needs an English key after it — `agf new 搜尋頁 search-page` — and `-m "..."` writes your first request straight into the new notebook, so the AI has something to work on the moment it opens. The notebook's full path is printed on its own line, so most terminals let you cmd-click (or ctrl-click) it to open the file directly.

	- **Opening the notebook in your editor automatically — `AGF_OPEN`.** If you add one line to your `~/.zshrc` — for example `export AGF_OPEN="code"` for VS Code, or `subl` for Sublime Text, or `open` for whatever your Mac opens `.md` files with — then every time `agf new` finishes, it also opens the notebook in that program for you. If the program cannot start for any reason, you get a one-line warning and everything else still works. If the line is not there, nothing changes — today's behavior, plus the clickable path.

	- **`agf cleanup` closes the feature.** Type it in your main folder and give the name — `agf cleanup login-page`. Calling it inside the feature folder now refuses without changing anything and prints the main-folder command, because the running AI host still needs its current folder for the end-of-turn check. It retains guarded, merge-preserving cleanup and stops before sweeping when fetch or the default-branch push fails. Individual sweep refusals are reported while safe remaining steps continue. The CLI writes no protocol record; the next main-checkout `godev` round records the result.
	- **`agf finish` closes the feature's delivery boundary.** Run `agf finish --prep` inside the worktree, write, commit, and push the closing notebook record when `origin` exists, then run `agf finish --deliver`. The record must be a regular committed file whose original UTF-8 bytes use consistent LF or CRLF endings, contain no disallowed controls or lone carriage returns, and include exactly one byte-exact `Feature: <name> — closed` line; it must be present on both the clean stream HEAD and `origin/<name>`. Delivery rechecks the stream branch and tip and pushes or merges the validated commit SHA. Before a local fast-forward, ignored or untracked collisions on newly added paths are refused. Preparation leaves you in the worktree; successful delivery prints the main project folder, but a release failure returns non-success and prints no directory. The `merge` alias is reserved for cleanup, so it means the same thing as `agf cleanup`, not finish.

		- **If preparation reports a merge conflict, it has already canceled that merge.** Stay in the feature worktree. Inspect the default-branch changes that conflict with your feature. Edit or otherwise integrate the intended combined result on the feature branch, then commit that resolved state. Run `agf finish --prep <name>` again. Do not use `git merge --continue`, because there is no unfinished merge to continue. After preparation succeeds, write and commit the closed feature notebook, push it when `origin` exists, and run `agf finish --deliver <name>`. Do not skip directly to delivery.

	- **`agf ditch login-page` throws the feature away.** For when you change your mind and do not want the feature at all: nothing is merged. It first shows what will go — the extra folder with any unsaved work inside it, the branch on the server, the branch on your disk — and asks `are you sure? (Y/n)`; press Enter or `y` to go ahead, anything else and nothing at all is changed. The name must always be typed out, so what you delete is exactly what you typed. Unlike `agf cleanup`, unsaved and unmerged work is gone for good — that is the point.

	- **Every subcommand refuses rather than guesses.** `agf cleanup` stops and changes nothing at all when your main folder is on the wrong line of work (it hands you the line that gets you there), when the name is one it does not recognise (it shows you the closest names it does know, in case you mistyped), or when the feature's folder still holds unsaved work (it lists the files). If the merge itself clashes with something, it undoes the merge and deletes nothing.

	- **On a new machine,** use the installer once to create the `agf` shortcut. After that, run `agf setup` to check it or `agf setup --fix` to update it.

	- **The CLI does not write in the main notebook**, because a small program cannot judge what a diary entry should say. After `agf new`, `agf finish`, or `agf cleanup`, the agent or the next main-checkout `godev` round works out what happened by reading the folders, branches, and stream STATUS. Nothing is lost by waiting.

	- **When to use the AI words instead.** `new-feature: <name>`, `merge-back`, and `cleanup: <name>` add the protocol record and model judgment around the same CLI mechanics. The owner-facing commands exist for speed and direct terminal use; they never write protocol notebooks. If the exact script is unavailable, the agent reports it and stops instead of replacing it with direct Git commands.

## Which AI models can run agentflow — configured, not hard-coded

- **Current routing comes from `ag.json`.** Each pipeline stage selects a built-in or custom tier through `pipeline-roles`; every delegated task still uses the unified external worker.

- **The pattern that held for every model tested:** the safety behaviors never broke. Every model refused hostile instructions planted inside project files, and every model stopped at the decisions only a human may make. What separates a strong model from a weak one is record hygiene — above all the rule that the terminal gets exactly one line.

- **Live access is a dispatch-time question.** Local validation checks the model identifier, effort, host family, and executable policy. Authentication, entitlement, quota, and live access are checked only when a real dispatch needs them.

- **Historical evidence only — Claude subscription runs:** the saved evaluation folders contain the exact models and scores used in those past measurements. They remain useful evidence, but they are not current routing instructions; current choices come from the validated `ag.json` tiers.

- **Historical evidence only — Codex subscription runs:** the saved evaluation folders contain the exact models and scores used in those past measurements. They remain useful evidence, but they are not current routing instructions; current choices come from the validated `ag.json` tiers.

- **Historical evidence only — local models through Ollama:** old evaluation notes describe one local model run. Treat it as a past measurement, not as a supported current tier, and validate any new identifier through the configuration rules before dispatch.

## If you remember only four things

- Type `godev` once per session; write requests in `.agentflow/devlog.md` in a new project or in the terminal, whichever you like.

- Answer ordinary questions on their `- ans:` lines in the notebook; answer open requirements questions on their `- ans:` lines at the exact requirements report path named there (`requirements-report.md` for newly allocated work; the recorded path for existing work). A plain "yes" takes the suggestion.

- Type `settings` to see the ten switches and external worker profiles from `ag.json`; change a profile tier with a line like `codex-default.best: <model>/<effort>`.

- For a feature worked on in parallel with anyone — a person, a second terminal, or a background AI worker — type one line: `new-feature: <name>`; when it is finished, `cleanup: <name>` from your main folder closes it out. Solo sequential work needs nothing special.
