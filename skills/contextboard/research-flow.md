# Research flow

An agentic research loop for building a clear, traceable synthesis from multiple sources. The loop is tool-agnostic: a harness may implement its phases with workflows, sub-agents, fresh sessions, or one agent carrying explicit state.

The goal is not novelty. A successful result organizes prior work well enough that a reader can understand the field, compare sources, inspect the evidence behind a claim, and resume the research without starting over.

## Principles

- Separate source-bound reading from idea-bound synthesis. Notes preserve what a source said in context; synthesis reorganizes material across sources.
- Treat provenance as part of the artifact. A synthesis claim must lead to the note that supports it, and the note must lead to a locatable passage in the original source.
- Loop because of a named gap, not because more research might be interesting.
- Keep workflow state separate from knowledge artifacts. Cards should contain knowledge, not agent bookkeeping.
- Stop relative to the agreed scope and budget. Open-ended research is never globally exhausted.
- Let users change policies. The phases are stable; their depth, source rules, validation thresholds, and stopping conditions are configurable.

## The loop

```text
Pre-round
   |
   v
Gather sources -> Read into source notes -> Fidelity validation
   ^                                          |
   |                                          v
   +------ targeted gap research <- Synthesize across sources
                                               |
                                               v
                                      Support and gap validation
                                               |
                                    continue --+-- stop
```

The normal path is:

1. Clarify the task and agree on a research brief.
2. Gather a bounded set of sources.
3. Produce source overviews and a limited number of detail notes.
4. Validate that the notes faithfully represent their sources.
5. Choose an organizing principle and synthesize across sources.
6. Validate the synthesis, its support, its coverage, and its unresolved gaps.
7. Stop with an honest coverage report, or return to research for a specific gap.

## 1. Pre-round: agree on the research contract

Begin with two required inputs:

- What does the user want to understand?
- Why do they want to understand it?

Ask only the questions needed to produce a usable research brief. The pre-round is complete when:

- the question and motivation are clear;
- included and excluded territory is specific enough to judge whether new material belongs;
- the desired depth is observable;
- the user has selected a budget preset or explicit limits; and
- no ambiguity remains that would send the research in substantially different directions.

Then present the brief once for confirmation. Do not carry the exploratory conversation into research when a clean context is available; pass the confirmed brief instead.

### Research brief

```yaml
question: The question the research should help answer
reason: Why this understanding is useful to the user
includes: Topics, periods, places, groups, or perspectives in scope
excludes: Deliberate exclusions and why they were made
depth: What a sufficient understanding should let the reader explain or compare
source_policy: Default source priorities and any task-specific constraints
budget:
  rounds: Maximum targeted research rounds
  sources: Maximum sources to admit into the active set
done_when:
  concepts: What conceptual coverage or saturation looks like
  questions: Which questions must have defensible answers
unresolved_tensions: Important ambiguity retained deliberately, if any
```

Offer simple, standard, and deep presets for `budget`; expose their actual limits so users can modify them. A card-count limit is not a research budget because it encourages artificial splitting or compression.

## 2. Gather: build a purposeful source set

Search against the brief, not just its topic words. Record why each admitted source belongs and what role it may play.

The minimum source rule is classification, not a universal credible/not-credible binary. For each source, identify:

- its type, author or institution, date, and publication context;
- whether it contributes research evidence, primary material, reporting, interpretation, or a situated perspective;
- the evidence base it relies on;
- the part of the research question it can address; and
- limitations that affect how it may be used.

Prefer scholarship and authoritative primary material when the task calls for research claims. Search results are leads, not evidence. Reporting and first-person or advocacy material may be valuable for events, discourse, and situated perspectives; label that use instead of pretending every source carries the same evidential weight. Source priority and quality thresholds are configurable policies, but source type and intended use must always remain visible.

Do not count source volume as consensus. Prefer a source set that exposes the important approaches, disagreements, periods, or levels of analysis within scope.

## 3. Read: preserve source context before synthesis

Reading notes are source-bound. They are deliberately exempt from a final synthesis rule such as "split by idea, not by source."

### Source overview

Create one overview for each source admitted into active research. It should make clear:

- the question or problem the source addresses;
- its publication context, approach, material, or method;
- its central claims and how it reaches them;
- its scope and important limitations; and
- why it matters to the current research brief.

An overview is not an abstract pasted into a card. It is a contextual reading note written for later comparison.

### Detail note

Create detail notes sparingly. Split one out only when a passage, result, distinction, case, limitation, or turn in the argument will be independently cited or compared later.

A detail note must remain intelligible away from the source. In natural prose, it should let a reader answer:

> Who, while addressing what question, used what material to make which bounded claim?

It must also:

- refer back to its source overview;
- cite a stable URL, page, section, paragraph, timestamp, or other locator;
- preserve qualifications that change the meaning of the claim; and
- explain enough of its place in the source's argument that it cannot be mistaken for a context-free fact.

Use this as a validation checklist, not a fixed writing template. Do not turn every paragraph into a card, and do not force reading notes to imitate finished argument cards.

## 4. Fidelity validation: check the reading before using it

Validate source notes before synthesis. A validator needs access to the original source, not merely the agent's summary.

For each consequential note:

1. Reopen the cited location and enough surrounding material to recover context.
2. Check that the note preserves the source's claim, evidence, qualifications, population, time, and level of certainty.
3. Check that interpretation is marked as interpretation rather than attributed to the source.
4. Correct ordinary errors in the original note.
5. If the error would change a later conclusion, add a short explanation of why the rejected reading does not hold.

Save a short excerpt only when it is needed for reliable relocation or when the source may not remain accessible. Do not duplicate large portions of copyrighted text. If the source cannot be reopened, record the validation limitation instead of claiming fidelity was verified.

A fresh validator is preferable because it is less likely to defend the original reading. Fresh context is an implementation advantage, not a requirement: a single-agent harness may run the same explicit checks.

## 5. Synthesize: reorganize by idea

Synthesis cards are idea-bound, not source-bound. This is where the existing card-style rules for argument, hub, case, evidence, voice, and joints apply.

Before drafting, inspect the validated notes and choose an organizing principle that helps answer the brief. Common choices include:

- competing explanations;
- consensus, disagreement, and unresolved questions;
- historical development;
- levels of analysis;
- phenomena, mechanisms, and consequences; or
- a task-specific conceptual structure discovered in the material.

The agent should choose a defensible structure itself and briefly record why it fits. Selecting a different organizing principle is a useful customization exercise because every structure foregrounds some relations and obscures others.

A synthesis is not a sequence of source summaries. Each important claim should compare, combine, distinguish, or place multiple notes in relation. Cite the relevant reading-note cards inline at the sentences where they do work. The provenance chain is:

```text
synthesis claim -> reading note -> original source and locator
```

Unused notes remain available. Their presence is valuable: a user can inspect what was read, recover context, challenge an exclusion, or construct a different synthesis later.

## 6. Support and gap validation

Validate the synthesis independently of prose quality.

For every consequential synthesis claim, ask:

- Do the cited notes actually support this wording and strength?
- Does the claim combine material, or merely place summaries next to one another?
- Are contrary cases, source disagreements, and alternative explanations represented fairly?
- Does the structure answer the confirmed question at the requested depth?
- Which missing fact or perspective could materially change the current picture?

Respond to a failure according to its cause:

- If evidence supports a weaker claim, narrow the wording.
- If the synthesis misreads an existing note, correct it and record a short explanation when the correction changes the conclusion.
- If a nonessential branch is interesting, add it to the backlog.
- If a missing piece blocks a defensible answer, create a targeted research gap.
- If the gap requires a major change to scope, return the decision to the user.

## 7. Decide: loop or stop

Every additional research round must begin with a gap statement:

```yaml
missing: The specific concept, evidence, perspective, or resolution needed
impact: What part of the current synthesis remains unreliable without it
search_target: The source or material likely to resolve the gap
stop_when: What finding or coverage would be enough for this gap
```

Two discoveries must be treated differently:

- A **blocking gap** undermines the current answer and may trigger another round within budget.
- An **interesting branch** extends the topic without threatening the current answer and goes into the backlog.

The loop stops when any of these conditions applies:

- new material no longer changes the important concepts or their relations within scope;
- the brief's required questions have defensible, traceable answers;
- no unresolved blocking gap remains; or
- the agreed budget is exhausted.

Stopping does not mean the topic has been exhausted. End with a coverage report stating what is well supported, what remains uncertain or excluded, which branches were deferred, and what another round would most likely change.

## Loop state

Keep one compact control artifact outside the knowledge cards:

```yaml
phase: pre-round | gather | read | fidelity | synthesize | validate | decide
coverage: Questions or concepts currently covered
blocking_gaps: Gaps that threaten the current synthesis
branch_backlog: Worthwhile directions outside the active scope
budget_used:
  rounds: 0
  sources: 0
next_action: The next phase or targeted research action
reason: Why that action is warranted
```

Update it only at phase boundaries or when a validator changes the route. A harness may use workflows, clean sub-agent contexts, or resumable tasks to execute the state. Portability comes from preserving the artifact contracts, not from reproducing one tool's orchestration syntax.

## Contextboard mapping

Keep research notes and synthesis on the same whiteboard so the work remains visible and revisable.

- Place the synthesis spine across the upper part of the board, reading left to right.
- Place source overview and detail-note clusters below it, grouped spatially by source.
- Use card titles to mark `Source overview` and `Detail note` as semantic roles for now; do not add a new product-level card type yet.
- Let synthesis cards cite reading notes with inline `contextboard:card/...` references.
- Let reading notes cite source overviews and external sources inline.
- Do not draw provenance arrows between synthesis and research layers. Provenance lives in references and backlinks.
- Keep the board wider than it is tall. Add horizontal room before turning the research layer into a long vertical scroll.

The research-note layer is exempt from card-style requirements that only make sense for finished arguments: it may split by source, and a detail note need not manufacture a complete argument or an argumentative joint. The synthesis layer continues to split by idea and follows the existing card style.

### Deferred arrow semantics

The current card style permits an arrow only as a visual echo of a prose joint. The user's working habit also uses arrows for reading direction and mind-map-like conceptual sequence. Do not silently merge these meanings or modify the card style yet.

Until that visual language is compared separately:

- inline references remain the only provenance mechanism;
- this workflow does not introduce source-containment arrows; and
- existing card-style arrow rules remain authoritative when producing a styled synthesis board.

## Teaching the loop

The first exercise should use one demonstration question and the same default loop for every group. Students experience the loop before editing it.

In the second pass, each group modifies the workflow according to problems it notices and the needs it values. The loop is a system, so groups may revise several connected policies rather than isolate one artificial variable. Teaching assistants help groups turn discomfort with an output into an explicit workflow decision.

A modification does not need to improve the first result to be worthwhile. A group succeeds when it can explain:

1. what it changed;
2. how that change affected the process or artifacts; and
3. when the trade-off would or would not be appropriate.

Useful comparison targets include source selection, note granularity, validation depth, organizing principle, retry triggers, stopping policy, traceability, and the cost of the loop. Every observed failure is material for learning how the system behaves.
