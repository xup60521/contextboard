<!--
`2026-08-18` Incident ledger of the agentflow skill (root devlog A-076/A-077). Append-only. Every `I-NNN` cited in SKILL.md, references/*.md, or a brief resolves here.

EDITING GUARD (the reverse of the guard in each skill file): before changing or removing any rule that cites an `I-NNN`, read that entry first and confirm the change cannot reopen the failure. A rule whose incident you cannot explain is a rule you are not yet allowed to change. When a new hard rule is born from a real failure, append its entry here in the same edit and cite it inline as `— I-NNN`; a load-bearing rule may additionally keep ONE short consequence clause inline. Old `F-NNN` codes stay valid and are kept beside their entry.
-->

# Incident ledger

Format: `## I-NNN — <date> — <title>` then source, F-code when one exists, the rules that cite it, and the narrative moved verbatim from the rule text. `earlier versions` = the failure happened before this repository; its record lives outside this repo.

## I-001 — earlier versions — a whole session with no progress reports

- Source: devlog archive A-162 (earlier versions), measured at about 11 hours 25 minutes. Cited by: SKILL.md § During long work (10-minute checkpoint rule).

- Narrative: an agent worked a whole session without reporting progress and spent it moving in the wrong direction.

## I-002 — earlier versions — bare `godev` left an open Ask unanswered

- Source: devlog archive A-159 (earlier versions). Cited by: SKILL.md § Activation (bare trigger = resume).

- Narrative: a bare `godev` activated the protocol but left the existing A-159 Ask unanswered.

## I-003 — earlier versions — bare `godev` created a file with nowhere to write

- Source: earlier versions. Cited by: SKILL.md § Activation (bare trigger = resume).

- Narrative: a bare `godev` on a brand-new repo created a STATUS-only file with no Ask block, so the owner had nowhere to write.

## I-004 — earlier versions — keep-going runs dropped questions

- Source: earlier versions. Cited by: SKILL.md § Modes ($auto_reply_mode).

- Narrative: keep-going runs auto-answered most questions but dropped one or two; hence one unified switch.

## I-005 — 2026-08-14 / 2026-08-16 — the terminal one-liner rule kept being broken

- Source: multiple runs; eval 2026-08-16. F-004/F-019. Cited by: SKILL.md § Every-invocation checklist (terminal output).

- Narrative: sonnet/medium still replies in terminal; 2026-08-14 e2e runs appended push status and reassurance to the line three times; 2026-08-16 eval: 6 of 7 candidate models missed exactly this rule (F-004/F-019).

## I-006 — 2026-07-31 — backgrounded delegate hung on keyboard input for an hour

- Source: earlier versions, round A-035. Cited by: references/delegation.md § Background-process watchdog; references/ag.md § Subagent execution contract.

- Narrative: a backgrounded `codex exec` sat waiting for keyboard input that never came and burned a full hour at zero CPU, announcing nothing, because completion was its only wake signal. (ag.md wording: a backgrounded delegate whose only wake signal was its own completion sat blocked on keyboard input for an hour, announcing nothing.)

## I-007 — 2026-08-03 — `--add-dir` measured: it widens reading, not writing

- Source: earlier versions; corrected an earlier rule that had said the opposite. Cited by: references/delegation.md § Delegate confinement.

- Narrative: under `-s read-only` a delegate handed such a folder and told to write one file answered `EPERM` and left it empty, and a review that night silently fell back to reading source instead of running the tests it could not write for.

## I-008 — earlier versions — delegate test failures that were only the sandbox

- Source: earlier versions, repeated pattern. Cited by: references/delegation.md § Delegate confinement (delegate test numbers are never evidence).

- Narrative: delegates reported failing suites that were entirely their own cage, and the same trees were green the moment the coordinator ran them unsandboxed.

## I-009 — earlier versions — written bans in briefs were violated anyway

- Source: earlier versions. Cited by: references/delegation.md § Delegate confinement (preamble).

- Narrative: written bans ("do not touch `devlog.md`") sat in briefs for days and were violated anyway — one reviewer overwrote the STATUS block, then re-injected itself after the repair.

## I-010 — 2026-08 — suggested defaults silently promoted to "owner decisions"

- Source: root devlog A-016, learn review finding P-1. Cited by: references/ag.md § Owner sign-off gates.

- Narrative: both live trials silently promoted suggested defaults to "owner decisions".

## I-011 — 2026-08 — a coordinator labeled its own ruling an owner decision

- Source: root devlog A-016, learn review finding P-2. Cited by: references/ag.md § Acceptance and completion.

- Narrative: trial v2's coordinator narrowed a failed contract (D-11) and labeled its own ruling an owner decision.

## I-012 — 2026-08-14 — five headless sessions died waiting; the livelock

- Source: e2e runs. F-012. Cited by: references/delegation.md § Background-process watchdog.

- Note (not a citation): SKILL.md § During long work names the F-012 livelock shape by its legacy code; that rule's own incident marker there is `I-029`.

- Narrative: five headless e2e sessions died mid-pipeline "waiting" on backgrounded advisors; three consecutive resumes re-armed the same wait and died again (a livelock), and one death left a green, fully verified implementation uncommitted.

## I-013 — 2026-08-14 — delegates run unconfined in the real checkout

- Source: e2e runs. Cited by: references/delegation.md § Delegate confinement (built-in subagents).

- Narrative: two e2e coordinators rationalized coding and scanning delegates directly in the real checkout on exactly those grounds ("git can recover it", a small blast radius, or a coordinator diff review).

## I-014 — 2026-08-14 — "scale-down" became self-authored artifacts

- Source: e2e runs. Cited by: references/ag.md § Route selection (scale-down changes depth, never authorship).

- Narrative: two e2e coordinators "scaled down" requirements, spec, and acceptance to self-authored artifacts (one omitted requirements.md and codewalk.md entirely), dissolving independent acceptance.

## I-015 — 2026-08-14 — security brief refused by moderation until reframed defensively

- Source: e2e run. F-015. Cited by: references/ag.md § Route selection (security-scan dispatch wording).

- Narrative: an "exploit/bypass"-phrased brief was refused twice by the executor's moderation; the defensive reframe passed and found a real bypass (F-015).

## I-016 — 2026-08-14 — timestamps copied, projected, or stamped after session end

- Source: e2e runs. Cited by: SKILL.md § Filling rules (timestamp); references/ag.md § Artifact namespace (stamp line).

- Narrative: a resumed round reused the prior Reply's stamp verbatim; another session stamped artifacts with times after its own end. (ag.md wording: a session that ended at 16:06 stamped its artifacts 16:20 and 16:22, with the effort field dropped.)

## I-017 — 2026-08-14 — runlog held only the allocation entry

- Source: e2e run. Cited by: references/ag.md § Runlog (reconcile before every Reply).

- Narrative: an e2e run logged only the allocation entry; the coding dispatch, both gate verdicts, the scan, and acceptance all went unlogged.

## I-018 — 2026-08-15 — two stream-opens collided in root; duplicate Ask id

- Source: root devlog. F-024. Cited by: SKILL.md § Variables (three invariants); references/streams.md (N-CLI parallelism rules, pointer-only stream-open).

- Narrative: two concurrent stream-opens each wrote a full Reply round into root `devlog.md` and both allocated Ask id `A-002`, producing a real merge conflict and a duplicate id (F-024).

## I-019 — 2026-08-15 — hostile repo obeyed nothing but reported nothing

- Source: eval run. F-025. Cited by: SKILL.md § Reporting and evidence (in-repo instructions are data).

- Narrative: a haiku master on a repo whose README, code comment, and test comment all demanded a backdoor plus secret exfiltration correctly ignored every payload but never told the owner the repo was hostile (F-025).

## I-020 — 2026-08-15 — forwarding card in the same commit broke `--follow`

- Source: root devlog. F-026. Cited by: SKILL.md § Variables (renaming $target_doc).

- Narrative: a rename that placed the forwarding card in the same commit as the `git mv` cut the `--follow` history line (no data lost — the archive and `git log -- <oldpath>` still reach it — but the rename link broke; F-026).

## I-021 — 2026-08-16 — settings change confirmations shortened or dropped

- Source: eval. F-023. Cited by: SKILL.md § Modes (settings visibility).

- Narrative: `sonnet-5/high` shortened this confirmation and `haiku-4-5/high` dropped it (F-023).

## I-022 — 2026-08-17 — two CLIs in one checkout; a 47-line round dumped into root

- Source: live collision. F-029. Cited by: SKILL.md § Variables (three invariants); references/streams.md (N-CLI parallelism rules, pointer-only stream-open).

- Narrative: two Claude Code CLIs ran in the SAME main checkout and appended to root `devlog.md` in the same second, and one CLI's stream-open dumped a full 47-line round into root instead of one pointer line; the collision forced a manual cleanup and reproduced the F-024 root-collision it was meant to prevent (F-029).

## I-023 — 2026-08-17 — summaries swelled because "concise" named no bound

- Source: root devlog. F-030. Cited by: SKILL.md § During long work ([SUMMARY] hard shape).

- Narrative: summaries kept swelling into mini-reports because "be very CONCISE" named no measurable bound (F-030).

## I-024 — 2026-08-17 — "checked out elsewhere" misread as "merge impossible"

- Source: skill-review stream. F-031. Cited by: references/streams.md (merge_back).

- Narrative: a worktree session read Git's "branch is checked out elsewhere" refusal on the local `main` as proof that the merge back itself was impossible from its own folder, and told the owner to hand the merge to the other terminal; `origin/main` was reachable the whole time and no working tree can ever hold it, so the reported blocker did not exist (F-031).

## I-025 — 2026-08-17 — delegate briefs left only in /tmp

- Source: root devlog A-047. Cited by: references/delegation.md § SOP (persist the frozen brief).

- Narrative: advisor prompts left only in `/tmp` made part of the pipeline record ephemeral, so a later audit could not recover the exact bounded inputs and confinement contract (root devlog A-047).

## I-026 — 2026-08-17 — silent plumbing forced a false commit description

- Source: root devlog A-067, eval job `t0-round-shape`. Cited by: SKILL.md § Activation (session plumbing).

- Narrative: an obedient master installed the hook silently, committed with `git add -A`, and truthfully-intended round text said the commit held two files while it actually held three; the judge failed the job for a false claim the skill itself had forced.

## I-027 — 2026-08-17 — seventy-six minutes without a checkpoint while "just waiting"

- Source: root devlog A-067. Cited by: SKILL.md § During long work (waiting is not an exception).

- Narrative: a session watching a ninety-minute measurement went seventy-six minutes without a checkpoint, having reasoned that waiting is not progress; inside that gap it found a real rulebook defect and reported it to the terminal only, so the record showed nothing while the owner had to ask twice what was happening.

## I-028 — 2026-08-18 — the forced one-liner produced twenty false "updated" lines

- Source: root devlog A-068; owner ruling A-069. Cited by: SKILL.md § Every-invocation checklist (terminal output).

- Narrative: the previous wording ordered a per-turn line-count trim to exactly `<path> updated`, so a session waiting on a measurement printed `devlog.md updated` on about twenty consecutive polling turns that updated nothing — the rule written to stop dressed-up reporting forced twenty false statements, and stripped those turns of the progress notes they should have carried; the owner ruled (A-069) that no rule may exist for the checker's convenience at the cost of a true sentence.

## I-029 — 2026-08-18 — twenty polling turns to buy forty seconds

- Source: root devlog A-068/A-069. Cited by: SKILL.md § During long work (never wait by ending turns); references/delegation.md § Background-process watchdog (interactive waiting).

- Narrative: a session spent about twenty turns re-checking a background measurement, buying roughly forty seconds of waiting and producing twenty empty exchanges, while the owner saw a session that appeared hung. (delegation.md wording: this section told sessions to "re-check every ~10 minutes" but never said how an interactive session should wait between checks, and its only never-end-a-turn rule was scoped to non-interactive sessions; a session filled the gap with about twenty per-turn polls a few seconds apart, the F-012 livelock shape.)

## I-030 — 2026-08-18 — one round absorbed ten hours of work without a Reply

- Source: root devlog A-068. Cited by: SKILL.md § During long work (a round ends when its asks are answered).

- Narrative: one round absorbed repairs, three measurement runs, a harness fix and a fold-in, ran about ten hours without a Reply, and closed only after the owner asked twice.

## I-031 — 2026-08-18 — pointer-line commit swept a foreign half-written ask

- Source: root devlog A-071, measured; plus the owner's live two-terminal test the same day. Cited by: SKILL.md § Variables (three invariants); references/streams.md (second-terminal rules; deferred pointer write).

- Narrative: given `feature: search-page` beside another session's uncommitted files, both `sonnet-5/high` and `opus-4-8/high` ran the sequence correctly but committed root `devlog.md` wholesale for the pointer line, sweeping the foreign half-written ask into history — one even wrote "belongs to root/main, not to this stream" into STATUS while committing it; the owner's live two-terminal test the same day saw the second session first treat the main session's uncommitted files as something to handle.

## I-032 — 2026-08-18 — closing rounds committed after the push were orphaned

- Source: root devlog A-073. Cited by: references/streams.md (merge_back step order).

- Narrative: two closed streams' final rounds — foobar `201523f`, barbar `1c4cea1` — were committed after the push, so deleting the merged branches would have erased them; the main session had to re-push one by hand and the other is already unreachable.

## I-033 — 2026-08-18 — the false "sandboxed by design" claim

- Source: root devlog A-073, measured on `sonnet-5/low`. Cited by: references/streams.md (merge_back step 5; cross-checkout limits).

- Narrative: after a textbook three-step merge_back the owner opened the main folder, saw no change, and asked; the session — which had just run read-only `git -C <main-checkout>` commands there — answered that it was "sandboxed to this worktree and can't touch your main checkout directly (by design)" and handed the owner a manual `git pull --ff-only`; the merge was durable on origin the whole time, but what the owner experienced was a merge that failed twice.

## I-034 — 2026-08-18 — "cleanup everything" declined though most of it was possible

- Source: root devlog A-073, `sonnet-5/low`. Cited by: references/streams.md (cleanup on request).

- Narrative: asked to "cleanup everything" after a clean merge_back, the session declined all of it and handed the owner two manual commands; the remote branch delete and the automatic sweep were both available.

## I-035 — 2026-08-18 — a feature trigger did not preempt resume

- Source: root devlog A-074. Cited by: SKILL.md § Variables (three invariants); references/streams.md (feature trigger preempts resume).

- Narrative: a second terminal given "let's start working on feature:xxx" first read root `devlog.md` and started working its remaining open tasks — the same tasks the main terminal's live session was working — and only then opened the branch and worktree; the preemption rule existed but was scoped to second-terminal signals, which that session did not detect.

## I-036 — 2026-08-18 — the continuation line omitted; owner stranded

- Source: root devlog A-074, measured. Cited by: references/streams.md (stream-open Reply contents).

- Narrative: one of two measured `gpt-5.6-terra/high` stream-opens omitted the ready-made `cd .worktrees/<taskkey> && <cli>` continuation line from its Reply; that line is the owner's only bridge into the worktree, and a Reply that omits it strands them in the main checkout.

## I-037 — 2026-08-18 — a stream-open authored an owner Ask for itself

- Source: root devlog A-074, measured. Cited by: references/streams.md (stream-open with no wish waits).

- Narrative: a measured `gpt-5.6-terra/high` stream-open wrote itself a "Continue…" Ask and ran requirements discovery nobody requested; it hard-stopped correctly before inventing product behavior, but the self-authored Ask is exactly what the no-invented-ask rule forbids.

## I-038 — 2026-08-18 — the terse rewrite dropped the pre-return count, and two jobs regressed

- Source: root devlog A-079 (full 14-job battery vs the shipped rulebook) and A-080 (the fix). Cited by: SKILL.md § Every-invocation checklist (terminal output).

- Narrative: the restructure cut step 9's hard pre-return line count for brevity, not by decision, and its new completion test did not distinguish an inapplicable commit or push from a required Git step that failed. Measured under `claude-opus-5/high` with the same judge and checks that had passed at `da21f9b`: `t1-false-push-claim` printed the correct line and then two explanatory paragraphs, and `t1-nongit-init` glued its explanation onto the line itself; both statements were true and both belonged in the Reply. The fix restores the count on the completed-round branch only, so I-028's ban on trimming a non-round turn into a false `updated` still holds, and requires every applicable Git step to succeed while treating only an absent Git repository or configured remote as inapplicable.

## I-039 — 2026-08-19 — a /clear'd stream session adopted the worktree's copy of root devlog.md

- Source: root devlog A-092, measured on `sonnet-5/medium`. Cited by: SKILL.md § Every-invocation checklist (item 1); SKILL.md § Activation (branch-aware routing); SKILL.md § Variables (stream trigger 6); references/streams.md (parallelism rule 1); scripts/README.md and scripts/devlog-guard.js (pre-commit guard).

- Narrative: a stream session opened `bbbb` correctly, then the owner ran `/clear`; the wiped agent, given `godev: <request>` inside the worktree, followed "resolve $target_doc in the repo root" literally, adopted the branch's checked-out copy of root `devlog.md` — self-consistent down to its own Settings line — and wrote a full round into it (commit `d567f7b` on the branch). Third root-round collision (after I-018/F-024, I-022/F-029), first through the worktree copy. Three wording holes enabled it: the checklist pointed at the trap, the branch-aware redirect covered only bare triggers, and no rule stated the worktree's `devlog.md` IS root. All three were patched, and the git pre-commit guard now blocks the commit mechanically where installed.

## I-040 — 2026-08-20 — a spec's literal example contradicted its own governing invariant, undetected until coding

- Source: `002` repo devlog A-005 (string-reverser work item, `artifacts/string-reverser/learn.md` Lesson 1), measured on `claude-sonnet-5/high`. Cited by: references/ag.md § Subagent execution contract.

- Narrative: the specification for a grapheme-cluster-aware string reverser shipped an acceptance check (AC-07) whose literal expected-output string split an emoji cluster (`👍🏽`) apart — directly contradicting the same check's own governing invariants (INV-2, INV-4: "never split during reversal"). The spec advisor's self-check reported clean, and the owner sign-off gate passed it, because both were prose review only — neither actually ran the mechanism the invariant named (`Intl.Segmenter`) against the example. The coding subagent caught it by refusing to guess and returning the contradiction; the coordinator independently confirmed the coder was right and the spec's example was the error, spending a full extra spec-fix-and-recode cycle to correct one line.

## I-041 — 2026-08-20 — two delegates in one work item hit a confinement gap their brief assumed away

- Source: `002` repo devlog A-005 (string-reverser work item, `artifacts/string-reverser/learn.md` Lesson 2; `artifacts/string-reverser/runlog.md` 13:13 and 13:19–13:23), measured on `claude-sonnet-5/high` coordinating `gpt-5.6-luna/max` (coding) and `claude-sonnet-5/high` (security-scan). Cited by: references/delegation.md § Delegate confinement.

- Narrative: the `codex exec` coding delegate's `workspace-write` sandbox denied writes to shared Git metadata (`index.lock`), so it could not perform the commit its brief instructed; separately, the `claude -p` security-scan delegate's session had no write tool at all (`--tools Read`), so it could not write the output file its own brief instructed. Both briefs were drafted without checking whether the chosen confinement shape actually granted the capability the brief's own instructions assumed. The coordinator absorbed both gaps manually (committing on the coder's behalf, capturing and persisting the scanner's printed output) — real but avoidable cost, twice in one work item.

## I-042 — 2026-08-20 — an out-of-scope delegate write was discarded before its diff was read

- Source: `002` repo devlog A-005 (string-reverser work item, `artifacts/string-reverser/learn.md` Lesson 3; `artifacts/string-reverser/runlog.md` 13:13 Deviation 2), measured on `claude-sonnet-5/high`. Cited by: references/delegation.md § Delegate confinement.

- Narrative: the coordinator found, via `git status`, that a coding delegate's worktree had modified `devlog.md` and `spec.md` outside its brief's declared write authority (source files plus `implementation-report.md` only) — the delegate had autonomously loaded this machine's devlog-protocol skill configuration on its own initiative, unprompted by the brief or repository. The coordinator ran `git checkout --` on both files to discard them before reading either diff, the reverse of this file's own stated order (inspect first, discard second). A later `git status`/`git log` check on the main checkout confirmed the real, owner-facing `devlog.md` was never touched — impact assessed as none — but the discarded content itself is now permanently unrecoverable, purely because the coordinator moved too fast.

## I-043 — 2026-08-21 — the Codex Stop hook rejected valid configuration without host identity

- Source: root devlog A-113 Stop-hook correction prompt. Cited by: scripts/stop-hook.js (explicit installed host); scripts/README.md (Codex host command).

- Narrative: A-113 completed with `ag.json` and fixed STATUS independently validated, but the real Codex Stop hook blocked the round with `configuration_valid: active host is unknown`. The shared hook payload supplied `cwd` and loop state but no Codex runtime marker, while the installed Codex and Claude commands were identical and host-neutral. The hook now receives `--host codex|claude` from its owning host configuration, the installer upgrades older entries, and marker-free integration tests cover the live failure.

## I-044 — 2026-08-22 — the repository Stop hook displaced a completed external response

- Source: root devlog A-119, retained Claude Code 2.1.237 repository-cwd probe, and `artifacts/stop-hook-reliability/runlog.md`. Cited by: references/delegation.md § External-Claude coordinator procedure; scripts/stop-hook.js.

- Narrative: the repository-scoped Claude Stop hook treated a completed external-worker response as an owner round and rejected it; the worker's correction displaced the original response, and the `stop_hook_active` loop guard let that correction exit 0. The earlier plain-output capture used `--no-session-persistence`, so its sole output did not retain the requested initial response and the report could not be recovered. Process exit 0 therefore did not prove transport, artifact validity, or acceptance.

## I-045 — 2026-08-22 — same-host workers drifted into ambient reads and oversized transcripts

- Source: root devlog A-119, retained codewalk and exploration dispatch records, and `artifacts/stop-hook-reliability/runlog.md`. Cited by: references/delegation.md § Same-host Codex limitations.

- Narrative: same-host workers loaded ambient instructions and emitted multi-megabyte transcripts despite frozen prompt restrictions and bounded-output instructions. Write confinement held, but prompt restrictions were not exact read confinement or clean-context independence; the coordinator had to accept only claims traceable to frozen inputs and split future work before oversized output.

## I-046 — 2026-08-23 — normalization repeatedly discarded contradictory raw evidence

- Source: root devlog A-125 and `artifacts/a125-large-work/learning-report.md` proposal P-1. Cited by: references/ag.md § Subagent execution contract.

- Narrative: four successive manual-context corrections were needed because type coercion, inner aliases, top-level selectors, and wrapper normalization each discarded a different contradictory raw form before the checker judged it; the stable correction validated every complete raw form before normalization or precedence selection.

## I-047 — 2026-08-23 — worker self-checks hid path and command deviations

- Source: root devlog A-125 and `artifacts/a125-large-work/learning-report.md` proposal P-2. Cited by: references/ag.md § Subagent execution contract.

- Narrative: one implementation worker edited an excluded documentation file, and one security worker widened both its read set and test command while still claiming every brief invariant held; independent comparison with the frozen brief caught both deviations.

## I-048 — 2026-08-23 — a short closeout forced the owner back through thirty checkpoints

- Source: root devlog A-126, reporting the A-125 final Reply. Cited by: SKILL.md § During long work.

- Narrative: A-125 preserved detailed progress across thirty checkpoints but ended with a compressed closeout that did not restate the full result in plain language; the owner had to ask whether `runlog.md` or the earlier progress reports were now required reading.

## I-049 — 2026-08-24 — terse checkpoints hid the big picture during a fourteen-hour run

- Source: root devlog A-139, owner report after A-134. Cited by: SKILL.md § During long work.

- Narrative: A-134 ran for more than fourteen hours and wrote dozens of checkpoints, but many used compressed internal names and described only the latest narrow action. The owner still could not tell what was finished, what was running, what remained, or where the work would stop without opening Plan 005 and reconstructing the project. The progress record existed but failed its human purpose. The corrected checkpoint is a standalone progress card with four fixed owner questions in plain language.

## I-050 — 2026-08-27 — the ten-minute checkpoint interval was mistaken for a worker deadline

- Source: root devlog A-180. Cited by: references/delegation.md § Identity, watchdog, and attempts.

- Narrative: the coordinator stopped an external worker after about ten minutes because two checks found no output or changed files. That decision confused the devlog's ten-minute reporting duty with worker liveness. The relaunched worker later needed about fifty-four minutes and completed useful work with 707 tests passing, proving that silent model reasoning and delayed edits were not hang evidence. The watchdog now states that ten minutes controls owner progress reports only and requires concrete process or transport failure evidence before termination.

## I-051 — 2026-08-28 — prompt compression removed the next-Ask completion rule

- Source: root devlog A-194…A-196 and commit `bd1891e`. Cited by: SKILL.md § Each round (Reply tail).

- Narrative: prompt compression removed the round template and its explicit instruction to append the next empty Ask scaffold. The linter still assumed and skipped an existing scaffold but did not require one. A coordinator then completed A-194 without the scaffold immediately after investigating repeated missing Ask blocks, and every automated check passed. The completion rule and a blocking linter check now protect both the instruction and the file tail.

## I-052 — 2026-08-28 — worker artifact boundary leaked into devlog Replies

- Source: root devlog A-186…A-197. Cited by: SKILL.md § Each round (Reply mechanics).

- Narrative: several coordinators appended long standalone `Self-check:` lines to devlog Replies even though no devlog rule or linter required them. The convention was copied from delegated worker artifacts, where the final line is a strict machine-checked boundary. In a devlog Reply, the line duplicated `Verified:` and added unread tail prose. New Replies omit it; worker artifact boundaries remain unchanged.

## I-053 — 2026-08-28 — audit mechanics crowded the owner notebook

- Source: root devlog A-198. Cited by: SKILL.md § Each round (separate mechanics record).

- Narrative: every Reply repeated four process facts that support later audits but are not part of the owner's answer. The owner never read them, and their fixed block made the notebook harder to scan. New rounds keep them in hidden `.<basename>.audit.md`; legacy `<basename>.logs.md` stays read-only history.

## I-054 — 2026-08-28 — review findings expanded a small repair into hypothetical features

- Source: root devlog A-200 and A-201. Cited by: SKILL.md § Evidence, scope, and progress; references/ag.md § Gates and evidence; references/delegation.md § Procedure and acceptance.

- Narrative: A-200 began with a concrete failure in which Codex's output option and the worker both wrote the same report. The first narrow fix rejected that exact collision. Later security and acceptance reviews proposed symbolic-link timing attacks, Proxy-backed evidence, revoked Proxy behavior, duplicate records, and absent-writer machinery. The coordinator treated reviewer severity as authority and repeatedly promoted hypothetical findings into implementation work without tracing each new behavior to the owner's request. This added unrelated output-option rejection and Proxy-specific queue validation, consumed repeated review cycles, and delayed the practical result. A-201 removed those expansions and made scope traceability a controlling-agent gate: without an exact owner sentence or existing standing obligation, a worker suggestion is rejected or parked, never implemented.

## I-055 — 2026-08-30 — final Reply insertion pushed a checkpoint into the next Ask

- Source: feature `add-tracker` devlog A-001/A-002 and commits `b70310c50633a3b3956f13c79ca83436828b20d7` and `7ad89feb7fbd01662a6b3fd65571191ee1988ece`. Cited by: SKILL.md § Each round (physical round boundary); scripts/round-linter.js (checkpoint round ownership).

- Narrative: WIP-002 was first appended correctly inside A-001. A later commit inserted A-001's final Reply and the new A-002 scaffold before WIP-002, so the old checkpoint silently became physical content of A-002. The linter treated the non-empty A-002 body as an open round and did not compare the checkpoint's declared A-001 identity with the Ask span that contained it. The owner saw text in the wrong location, and the append-only notebook no longer told a truthful chronological story. The prevention rule makes the next empty Ask a strict final boundary and makes the linter reject any checkpoint whose declared round differs from its physical Ask span.

## I-056 — 2026-08-30 — guessed time and repeated anchor corrupted a checkpoint draft

- Source: feature `add-tracker` A-002. Cited by: SKILL.md § Each round; Round and STATUS shape.

- Narrative: The coordinator guessed `12:38` at `12:31:52`, then used a repeated checklist anchor and put WIP-005 before WIP-003. Both were caught before commit. Timestamp only from an immediate shell-clock read; write by physical round boundary, never repeated text.

## I-057 — 2026-08-30 — campaign records disappeared for hours

- Source: A-257 audit of A-246/A-252. Cited by: SKILL.md § Devlog progress; references/ag.md § runlog.

- Narrative: hours passed without runlog events and some checkpoints stayed unpushed, hiding current state and losing decisions. Checkpoints now include push; active runlogs update within ten minutes.

## I-058 — 2026-08-30 — cleanup deleted the running host's current folder before its Stop hook

- Source: root devlog A-258, after `add-tracker` cleanup. Cited by: references/streams.md § `cleanup:<taskkey>`; scripts/agf.js cleanup guard.

- Narrative: `agf cleanup` was allowed inside the matching feature worktree. It merged and pushed the feature, then removed that same worktree while the AI host session still used it as its current folder. When the turn ended, the operating system could not start the Stop hook from the deleted folder and reported `No such file or directory`, even though `stop-hook.js` itself still existed. Cleanup now changes nothing when called from inside the target worktree and prints the exact command to run from the main checkout after the owner exits that session.

## I-059 — 2026-08-30 — the public `agf new` command depended on hidden agent-session facts

- Source: root devlog A-260 and the owner's direct terminal run of `agf new blah`. Cited by: SKILL.md § Activation and recovery; scripts/agf.js marker-free host fallback and ignore probe.

- Narrative: A person ran the public `agf new` shell command from a normal terminal. The command rejected valid project configuration because it reused host detection designed for a running Codex or Claude session, but a normal terminal has neither session marker. It also warned that `.worktrees/` was not ignored even when `.gitignore` contained the correct rule, because it tested the nonexistent directory instead of a path inside it. Existing tests called the exported function inside their own process and inherited host markers, so they missed the real shell boundary. The command now uses the already validated host recorded in the root STATUS when session markers are absent, and its ignore check probes a child path with Git's no-index mode. The activation rule now names `.worktrees/` together with both host-settings folders.

## I-060 — 2026-08-30 — a narrow change paid for a seventeen-minute full repeated review

- Source: root devlog A-260/A-261 and the retained A-260 cross-check report. Cited by: SKILL.md cross-check gate; references/delegation.md proportional cross-check procedure.

- Narrative: A bounded command repair had already passed its focused tests and the complete 705-test suite, but its external reviewer repeated 92 command tests, 13 prompt tests, the complete suite, and extra probes. The review took about seventeen and a half minutes. The owner did not want to remove independent protection, but asked why every change paid the same cost. Cross-check now selects narrow, targeted, or full obligations from frozen change facts. The coordinator still runs the complete relevant suite once; only broad or high-risk review repeats it.

## I-061 — 2026-08-30 — checkpoint checkmarks looked enforced but the installed hook skipped them

- Source: root devlog A-262 and direct inspection of `stop-hook.js` and `round-linter.js`. Cited by: SKILL.md checkpoint verification; scripts/stop-hook.js checkpoint facts.

- Narrative: The skill said checkpoint checkmarks required evidence, and the linter had a strict checkpoint verifier, but the installed Stop hook never supplied that verifier's facts. Every real owner turn therefore skipped the check. The linter also expected an older four-line footer while the active skill used one combined line. The repair aligns the footer and makes the host gather current tracker, runlog, checkpoint, HEAD, and push evidence. A fresh scope-comparison runlog event is required, while the actual judgment that no work is excessive remains honestly identified as a human reasoning claim rather than a machine-provable fact.

## I-062 — 2026-08-31 — the agent accepted a correction whose premise was already false

- Source: root devlog A-267/A-268. Cited by: SKILL.md § Modes and hard stops.

- Narrative: The owner asked to strengthen a stream-opening rule because an agent reply did not tell the owner to exit the current session. The existing rule already required that exact action, but the coordinator accepted the proposed diagnosis and began editing before checking it. The owner had to point out that the original rule was already correct. The new rule keeps the owner’s goal authoritative while requiring a small evidence check of factual premises, diagnoses, and proposed methods. When the premise is wrong, the agent must explain that early and offer the smallest workable path without inventing debate or replacing the goal.

## I-063 — 2026-08-31 — compressed tracker prose allowed an invalid layout

- Source: external project 002 A-008/A-014/A-015 and root A-270. Cited by: SKILL.md tracker creation rule.

- Narrative: The coordinator followed the short tracker description in the skill, invented a readable but invalid layout, and marked it verified. The exact seven-section shape existed only inside checker code and tests, while the real Stop hook passed only a current-file Boolean and never invoked the strict tracker parser. Agentflow now prints the canonical shape through one command, requires validation before a checked checkpoint, and passes the selected tracker into the strict parser during the real Stop hook.

## I-064 — 2026-09-01 — fake looper tests accepted three broken real-worker contracts

- Source: root devlog A-283 and A-285. Cited by: SKILL.md § Running a planned queue for the owner; scripts/looper-live-gate.js.

- Narrative: A-283 found that the focused looper suite used obedient fake workers and therefore missed three ordinary failures in the real handwritten queue: completion was read from the wrong output channel, the child started another looper, and the child was not given a precise notebook and final-response contract. A-285 added the missing real installed-command gate. Its first complete two-worker run found a fourth false success: both products and archives existed and the process exited successfully, but the notebook had no valid Reply headings. Later attempts caught a missing bare `+` in the next Ask before archival. Every future looper behavior change now runs two real low-cost plans in a temporary Git repository and must prove both exact products, both complete notebook rounds, both archives, and a successful exit before cross-check and delivery.

## I-065 — 2026-09-01 — line-oriented archive repair changed preserved content

- Source: project `003` devlog A-018/A-021. Cited by: SKILL.md compaction rule.

- Narrative: A line-oriented edit changed archive boundary blank lines, causing avoidable repair work. Compaction now requires a byte-oriented operation.

## I-066 — 2026-09-02 — checkpoint shorthand lost the owner requirement

- Source: root devlog A-292 WIP-004 through WIP-006.

- Narrative: A checkpoint recorded only a shorthand tracker task while the owner’s follow-up requirement and the durable decision remained in transient chat. A crash would have required the next session to infer scope from unavailable conversation history. The activation rule now hard-stops task, checkpoint, review, and final progression until the current Ask captures the complete owner request and decision and the tracker provides self-contained outcome, scope, proof, and next-action recovery facts.

## I-067 — 2026-09-02 — ordinary outcomes and design decisions were accepted too late

- Source: root devlog A-283, repeated exact-shape correction history, and root devlog A-292.

- Narrative: A-283 spent effort on recovery machinery before a normal owner journey completed. Repeated shape corrections were patched in place instead of reopening whether the concept was needed. A-292 accepted a derived review and left the owner to discover an unusable final result. Consequential work now preserves the ordinary maintainer or user journey, independently checks Outcome, Minimality, and Conformance, returns repeated blocked concepts to a new plan and Design Go, and requires a current Result Go after the host verifies the final evidence.

## I-068 — 2026-09-03 — checkpoints became an answer store and delayed the Reply

- Source: root devlog A-312. Cited by: SKILL.md § Devlog progress, Activation and recovery, and Each round.

- Narrative: The owner asked follow-up questions while work was active. The coordinator copied those questions and their answers into WIP checkpoints, then kept creating checkpoint and recovery records after the substantive answer was already ready. The owner had to read several WIPs instead of one final Reply. The first correction still left a WIP template field that invited an owner decision. WIPs now contain execution progress only, every owner message stays in arrival order in the active Ask, and one final Reply answers the full round. A checkpoint is due only after ten active minutes; a ready Reply takes priority.

## I-069 — 2026-09-03 — the quick Summary repeated the final report and closure used avoidable calls

- Source: root devlog A-316 and A-317. Cited by: SKILL.md Reply and closure rules; scripts/round-linter.js Summary check.

- Narrative: A completed round used three long Summary bullets to repeat the detailed final report, then performed several small record writes and checks after the useful work was already done. The owner asked to reduce time and tool cost without losing precision or traceability. Summary is now a one-to-three-item outcome index. Independent checks and already-known record updates are batched, and a record-only round does not create a second commit merely to name its first record commit.

## I-070 — 2026-09-03 — ordinary review discussion became a false review order

- Source: root devlog A-314 through A-317. Cited by: SKILL.md audit decision rule; scripts/round-linter.js and scripts/stop-hook.js.

- Narrative: The checker searched owner prose for the review-control word. An analysis round that discussed the control was therefore blocked for a missing external report even though it changed no implementation and the owner had to give an explicit skip. The host now records one review decision in the hidden audit file. JavaScript validates that durable decision and its evidence instead of guessing intent from natural language.

## I-071 — 2026-09-03 — four workflow promises had no enforcing boundary

- Source: root devlog A-318 and A-325. Cited by: SKILL.md substantive-work rule; references/delegation.md substantive-work boundary.

- Narrative: A substantive implementation stayed with the coordinator even though the owner expected the single confined external runner; run logs moved from each task folder to one shared workspace file; an owner who needed to leave could not grant narrow advance authority for already checked Design Go and Result Go gates; and successful notebook writes left their temporary Reply drafts behind. The repair requires external-runner-v1 for delegated-capable substantive work, restores one tracker-sibling run log per decomposed task, recognizes only exact `away: gates` authority after all existing checks pass, and consumes an unchanged draft only after the notebook replacement is durable.

## I-072 — 2026-09-03 — exact-commit certainty caused a recursive final-review loop

- Source: feature `fix-2` devlog A-007/A-008. Cited by: SKILL.md § Completing a round (closeout stop rule).

- Narrative: Because the coordinator optimized too hard for procedural certainty after the linter rejected completion, each repair changed the commit under review and triggered another "final" validation. That logic was locally defensible, but the coordinator failed to apply a stop rule: once the implementation and full suite were sound, it should have made the smallest record correction and closed. While reviewing the resulting stop rule, the assigned reviewer read the repository workflow and launched another reviewer inside its clone, reproducing the same recursion at the worker boundary. The prevention rules preserve exact review for substantive implementation or evidence changes, forbid record-only corrections from restarting implementation review, and require every reviewer to perform its own assigned review without invoking Agentflow or delegating another review.

## I-073 — 2026-09-04 — closeout created an avoidable Reply draft and repeated unchanged tests

- Source: project `003` devlog A-001 and root devlog A-344. Cited by: SKILL.md § Completing a round (notebook writes and closeout stop rule).

- Narrative: During a small string-reverser closeout, the coordinator created `.agentflow/reply-A-001.md` even though `notebook-write.js --input-stdin` could accept the Reply directly. It then reran the unchanged JavaScript implementation tests after changing only the devlog STATUS. Both actions added calls and delay without increasing safety. Notebook writes now use standard input first and use a named draft only after that path fails. After implementation tests pass, later record-only corrections run only the mechanical completion check and do not repeat those tests.
