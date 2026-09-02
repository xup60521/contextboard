# Sub-agent orchestration

This is a work-in-progress guide for designing workflows that use sub-agents. It describes the responsibilities and decisions involved, not a calling API or serialization format.

The orchestrator protects its context by delegating sustained, general-purpose work. It understands the objective well enough to design and revise the workflow, but it does not perform the workflow's content work itself.

## Responsibilities

The top-level orchestrator:

- designs the initial workflow;
- splits and triages tasks;
- defines task scope, dependencies, and acceptance criteria;
- decides which tasks deserve independent validation;
- schedules safe independent work in parallel;
- controls retries and workflow revisions;
- decides when replanning requires user input; and
- reports an overview of the final workflow state.

Producers perform content work and write artifacts. Validators judge selected artifacts against their acceptance criteria. Planners inspect content when new information requires content-dependent changes to the workflow. Adjudicators resolve repeated repair failures.

These roles describe responsibilities. A workflow may instantiate them differently when the task warrants it.

## Design the workflow

Represent the workflow as a dependency graph. A task becomes runnable when its required dependencies have been accepted. Split independent work so it can run concurrently, and prioritize tasks that unblock more of the graph or cheaply reduce uncertainty.

Dispatch a task only when it has:

- a bounded objective;
- explicit inputs;
- a verifiable output artifact;
- acceptance criteria; and
- no dependency on unstated parent context.

A task contract should declare its objective, allowed scope, input artifact paths, expected output path, acceptance criteria, dependencies, delegation permission, relevant resource limits, and retry-history paths. The orchestrator or an approved planner determines what the sub-agent may do. This guide does not prescribe a schema for that contract.

## Delegate with judgment

Sub-agents may dispatch child tasks when doing so remains within their assigned scope. This is useful when a bounded task grows unexpectedly, such as source discovery becoming too large for the agent that will take notes.

Prefer a shallow workflow. Several levels of delegation often mean the original task was not decomposed well. Treat this as a judgment rule, not a fixed depth limit. A task may decide how to split its allowed work, but must request replanning before it changes the objective, exceeds its scope, or needs materially different resources.

## Spend validation where it matters

Validation has a cost and validators can also be wrong. Do not validate every small helper result by default. The orchestrator chooses validation for heavy or consequential tasks. Useful signals include:

- substantial context or synthesis;
- many downstream tasks depending on the result;
- errors that later stages would struggle to detect;
- factual or interpretive claims;
- high cost to repeat the work; and
- external or irreversible consequences.

Use deterministic checks before an agent validator when they can test the requirement directly. Reserve additional validators for unusually high-impact work, disagreement, or repeated failure.

## Use a strict producer-validator loop

A producer writes each attempt as a new immutable artifact in the run's temporary folder. A validator receives the task contract, declared inputs, output artifact, and acceptance criteria. Give it a fresh context without the producer's conversation or self-assessment.

The validator returns one of two results:

- `ok` means the artifact meets the acceptance criteria.
- `retry` includes a concise reason for the orchestrator and a concrete fixing prompt for the producer.

A validator must identify the failed criterion, point to the relevant evidence in the artifact, and state what the producer must correct. Vague feedback such as "needs improvement" is not a valid retry. The validator must not repair the artifact, broaden the task, or replace the producer's approach with a personal preference.

The orchestrator owns the repair loop. On `retry`, it normally resumes the same producer with the current artifact and fixing prompt. The producer writes a new immutable attempt, which is validated again. A fresh context can repeat the same mistake, so changing producers is not the default response.

After three failed repair attempts, dispatch an adjudicator. It decides whether to accept the result, abandon the branch, or request replanning. Use a fresh producer only when replanning determines that the previous direction or instructions were categorically wrong.

## Replan without flooding the orchestrator

The initial workflow cannot anticipate every content-dependent discovery. When an agent finds that the workflow's assumptions, scope, or direction no longer hold, dispatch a planner that may read the relevant raw artifacts in the run folder.

The planner returns a compact proposal containing:

- the suggested workflow revision;
- reasons tied to affected task identifiers;
- assumptions that changed; and
- new or revised acceptance criteria.

The planner does not push all source material back into the orchestrator's context. The top-level orchestrator reviews the proposal and decides whether to revise the workflow. Version each revision, identify its affected nodes, preserve unaffected accepted work, and revalidate changed branches where required.

Stop and ask the user when a proposed revision would change the objective or fixed constraints, add material cost or external impact, discard substantial accepted work, require a choice that cannot be inferred safely, or expand far beyond the original task.

## Keep artifacts outside agent messages

Sub-agents save their substantive output in a run-scoped temporary folder. The orchestrator may retain paths, task identifiers, dependencies, attempt counts, statuses, validator reasons, and other control metadata. It should not pull full artifacts into its context during normal scheduling.

The same constraint applies in the other direction, and it is the one that actually leaks. A sub-agent's reply lands in the orchestrator's context whether or not the orchestrator wants it, so every task contract must state the return shape explicitly. A producer returns its output path, a terminal status, and at most a few lines of control information such as what it could not complete or what it wants replanned. It does not summarize its findings, restate its reasoning, or quote the artifact. Content that matters belongs in the file; content that reaches the orchestrator is scheduling metadata only.

Treat a long reply as a contract violation rather than a helpful extra. If the orchestrator needs to know something about an artifact's content in order to schedule, that judgment belongs to a validator or planner whose own return shape is already bounded.

Publish accepted deliverables to their declared permanent destinations before cleanup. The workflow is complete only when:

- every required task has reached an accepted terminal state;
- every selected heavy task has received validator `ok` or an adjudicated acceptance;
- final deliverables have been published and checked;
- no replanning request remains unresolved; and
- temporary artifacts have been cleaned up.

Delete the temporary run folder after successful completion. Retain it when a run fails, is cancelled, or stops for user input so the evidence remains available for diagnosis.

The orchestrator's final report should summarize the workflow graph, task states, retries, revisions, adjudications, and terminal outcome. This summary exists for debugging. It should not reproduce the artifacts themselves.

## Example: multi-source research

An orchestrator may split a research request into source discovery and source-specific note-taking tasks. Discovery can run in parallel where the search areas are independent. A discovery agent may dispatch scoped note-taking agents if search consumes more context than expected.

The orchestrator may classify each substantial note artifact as heavy and assign an independent validator. Accepted notes unblock synthesis. The synthesis task receives the accepted artifact paths, produces its own artifact, and goes through validation if its importance warrants the cost.

This is one possible workflow, not a required architecture. A smaller research task may need fewer agents, no nested delegation, or validation only at synthesis. The orchestrator decides from the task's actual shape.

## Out of scope

This guide does not define programmatic agent calls, manifests, wire formats, file-collision handling, or coordination of external side effects. Those mechanisms should implement the decisions above without replacing the orchestrator's judgment.
