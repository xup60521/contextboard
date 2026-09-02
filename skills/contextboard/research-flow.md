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
3. Invoke `taking-note.md` once per admitted source to produce a source overview and a coverage-complete, source-bound argument tree.
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

A source's literature review names other work, and naming is not admitting. Admit an original only when the board will make a claim *about* it: "A argues the earlier accounts missed X" needs only A, because A is the subject of that sentence, while "the earlier accounts missed X" needs the earlier accounts. Chasing an original spends the same source budget as ordinary reading — do not give it a separate allowance, or the cheap kind of reading will crowd out the expensive kind. When the budget cannot cover an original the board needs, record it as a blocking gap (section 7) instead of dropping the claim or padding the set.

## 3. Read: preserve source context before synthesis

Reading notes are source-bound. They are deliberately exempt from a final synthesis rule such as "split by idea, not by source." Read `taking-note.md` and invoke it once for each admitted web page or PDF. It owns source identity, integrity checks, provisional outlining, section-by-section reading, coverage state, card roles, epistemic status, and the complete source-note tree.

### Source overview

Create one overview for each source admitted into active research. The overview is also that source's coverage ledger. It should make clear:

- the question or problem the source addresses;
- its publication context, approach, material, or method;
- its central claims and how it reaches them;
- how it positions itself against earlier work — what it says prior accounts did, missed, or got wrong;
- its scope and important limitations; and
- why it matters to the current research brief.

It also records every section as `covered`, `unread`, `in progress`, or `omitted with reason`, plus source completeness, OCR or figure risks, and validation state. A source is not complete while any section is unread or in progress. Long sources are processed in coherent sections; they never silently degrade into summaries.

An overview is not an abstract pasted into a card. It is a contextual reading note written for later comparison.

The positioning line is the cheapest context on a research board, because the author already did the comparing: a literature review is a source telling you who it is arguing with. Write it only where the source actually has one — a book chapter, a first-person account or a news report may not — and where it does not, say so and say where the positioning came from instead ("this chapter has no literature review; its position is inferred from X"). Positioning is a claim like any other and carries a verbatim quotation with a locator. If it cannot be quoted, the source did not make it, and the overview does not get one. A fabricated position is more dangerous than a missing one: it reads perfectly plausible and there is no page number to catch it.

### Detail note

Make a detail note for a natural argumentative section or turn, not for every passage, result, evidence type, or metadata role. A long detail note may carry several claims, reasons, examples, and limits under Markdown headings. Split it only when a branch can be understood independently and the split materially improves navigation or comparison, or when combining it would obscure the argument. Preserve the complete movement from question through claim, reasoning, evidence, and consequential limits. Notes written to fit the synthesis have no surplus, and the surplus is the point: it is what lets the user read what the source actually said, and what lets a later reading go somewhere this one did not. If nearly every note ends up cited exactly once, the notes were reverse-engineered from the conclusions rather than read out of the sources, and the argument layer will have nothing to reason with.

A separate positioning note is worth splitting out when a source's account of earlier work is substantial enough to be cited more than once — a review article is mostly this.

A detail note must remain intelligible away from the source. In natural prose, it should let a reader answer:

> Who, while addressing what question, used what material to make which bounded claim?

It must also:

- refer back to its source overview;
- cite a stable URL, page, section, paragraph, timestamp, or other locator;
- carry at least one verbatim quotation from the source, each quotation with its own locator;
- attribute second-hand material to whoever is speaking — a review's account of earlier work is that reviewer's reading, so the subject of the sentence is the reviewer, not the author being described;
- preserve qualifications that change the meaning of the claim; and
- explain enough of its place in the source's argument that it cannot be mistaken for a context-free fact.

End with one visible provenance line linking the source and `Source overview`. Put the complete `Role`, `Status`, `Locator`, `Source`, and `Parent` fields in a Markdown HTML comment. This keeps machine-readable state on the card without forcing the reader through a metadata wall. If one long card mixes epistemic statuses, record its primary status there and mark every reconstructed or uncertain passage visibly in the prose.

Use this as a validation checklist, not a fixed writing template. A detail note borrows the readable movement of an argument card: a claim-bearing title, an opening question or tension, evidence and caveats placed where they change the claim, and a final consequence that carries the reader forward. It remains source-bound and does not need cross-source synthesis or the argument card's five-slot coverage.

Quote in the source's own language. A translated quotation is a paraphrase wearing quotation marks, and it stops being evidence the moment it is translated; the surrounding commentary is where the reader's language belongs. Inline 「」 is the default, so the quotation sits inside the sentence that uses it — reserve a blockquote for a passage long enough to carry a whole step of the argument. Do not open every note with a quotation: a note layer where all the cards start the same way has replaced one template with another.

## 4. Fidelity validation: check the reading before using it

Validate source notes before synthesis. A validator needs access to the original source, not merely the agent's summary.

For each consequential note:

1. Reopen the cited location and enough surrounding material to recover context.
2. Check that the note preserves the source's claim, evidence, qualifications, population, time, and level of certainty.
3. Check that interpretation is marked as interpretation rather than attributed to the source.
4. Correct ordinary errors in the original note.
5. If the error would change a later conclusion, add a short explanation of why the rejected reading does not hold.

Short quotations with locators are the ordinary substance of a reading note, not an exception to be rationed. What is forbidden is wholesale duplication — a chapter or an article reproduced into cards. Keep each quotation to the span that carries the claim. If the source cannot be reopened, record the validation limitation instead of claiming fidelity was verified.

The reading invocation first validates every consequential card. Research-flow then performs a risk-based second pass over all core claims, numbers, figures, limitations, `reconstructed` and `uncertain` cards, plus a sample of ordinary notes. A fresh validator is preferable because it is less likely to defend the original reading. Fresh context is an implementation advantage, not a requirement: a single-agent harness may run the same explicit checks.

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

### What an argument card owes its notes

- **Two sources, not two notes.** An argument card uses notes from at least two different sources. One note in, one card out is not synthesis but transcription, and it shows up as an argument card whose title paraphrases the note it cites. A claim only one source can carry is allowed — say so in the card, in its own words — but a board where more than about 40% of the argument cards are single-source has stopped comparing and gone back to summarising.
- **The evidence lands in the card.** A quotation or figure that stays down in the note is not doing work in the argument. Carry it up into the argument card's own sentence with its locator. The quotation is the universal currency and a figure is one kind of quotation, so a theoretical source is not exempt: quote Bourdieu's sentence where an empirical card would quote a coefficient. There is no exemption list, because an exemption list is where a card goes to avoid the rule.
- **Second-hand material stays second-hand.** A review's account of earlier work belongs to the reviewer, and its note hangs under the reviewer's source, so it cannot supply the second source above. Reading one review is not having read the ten works it names, and a rule that let it count would make reading a review the cheapest way to look widely read. It can supply a disagreement, which is the thing a review is best at.
- **Say where the sources fail to agree.** Every round produces at least one card on a disagreement and why it exists. The comparison that gets you there is workflow and stays out of the cards; its conclusion is knowledge and belongs on the board.
- **A 張力 joint may lean on a source's own literature review**, which is often the sharpest available statement of what an earlier account missed. It lands like any other evidence — the reviewer's words, quoted, with a locator. "This view was later criticised" is the failure this rule exists to catch: a conclusion with the evidence left behind.

## 6. Support and gap validation

Validate the synthesis independently of prose quality.

Validation runs in two stages and the cheap one goes first. A mechanical pass checks what a script can decide — `scripts/lint-board.ts` in this workspace — and nothing else runs until it is clean, because a reviewer asked to judge a board that fails on counting will spend its attention on the counting. The second stage is judgement, and judgement has to be auditable: a reviewer that reports "checked" has reported nothing. Require it to answer by quoting the card — which characters are the named anchor, which of the five joints this is and the sentence carrying it, how the card reads with the joint sentence deleted. Give it the finished board and not the research that produced it; a reviewer who watched the reading will defend it.

Two revisions is the limit. A card still failing the mechanical pass after that leaves the argument layer — demoted to a note, or reported to the user with the reason — because the third attempt is where invented figures come from.

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

Both layers live on one whiteboard, split top and bottom.

- The **argument layer** is the synthesis spine, across the upper part of the board, reading left to right.
- The **note layer** is below it: one wide, shallow argument tree per source, side by side.
- A note card's `y` starts at least **800** below the lowest argument card. Pass that `y` to `place_card` when the card is created; nothing recovers the band once the two layers interleave.
- Keep the board wider than it is tall. Add horizontal room before letting the note layer grow into a vertical scroll.

Card titles say which layer a card is in, and that is the only machine-readable signal there is: a note card's title begins `Source overview` or `Detail note`. Every non-root note keeps the `Detail note` prefix; structure is carried by prose, references, arrows, and placement rather than another title taxonomy.

Because the prefix is load-bearing, the note layer remains distinct from finished synthesis. It splits within one source rather than across sources and is exempt from five-slot coverage. It still borrows argument-card readability and topology: claim-bearing titles, prose joints, evidence near the sentence it supports, and a wide, shallow tree organized by dependency. A joint and arrow appear only where the source actually supplies a relation; neither may be manufactured to make the board look connected. The argument layer splits across sources by idea and follows the card style in full.

### Arrow semantics

The two layers speak different arrow languages, and the layer boundary is what keeps them apart.

In the **argument layer** an arrow is the mechanical projection of a prose joint: one arrow per joint, running the way the joint runs. See `card-style.md`.

In the **note layer**, an arrow is the mechanical projection of a source-bound prose joint. Every detail note must reach its overview through the parent chain, but select the immediate upstream card whose claim the child actually uses, not the card written immediately before it and not the overview by default. The child may inherit, resolve, contrast with, exemplify, decompose, or extend that claim. Its joint sentence contains an inline `contextboard:card/...` reference, and the arrow runs from the card leaned on to the card leaning on it. No joint, no arrow; no arrow, no joint. Source trees are not joined to each other, and there is no root above them.

**No arrow ever crosses the two layers.** A synthesis card cites a note with an inline `contextboard:card/...` reference, never with a line. Cross-layer provenance is a reference; note-layer arrows are reserved for relations inside one source's argument tree.

Layout follows from that split:

- Arrange the **argument layer** after each research round. Pass `cardIds` holding only argument cards, so the note layer below counts as an obstacle and the band survives.
- Lay out a **source tree** from left to right. The x-axis carries argumentative depth; the y-axis separates siblings at the same depth.
- Keep the tree wide and shallow. No card may be the target of more than three joints, and no joint chain may run more than six cards deep. If the overview attracts too many children, merge fragments or introduce a substantive intermediate claim; never add an empty grouping card.
- Arrange a new source tree once, passing only that source's `cardIds`. On an established board, place the tree to the right and do not overwrite hand adjustments or rearrange other structures.
- **Always use the explicit `tree-horizontal` style. Never `auto` or `mindmap`.** The result should look like an argument tree, not a star-shaped topic map or a single chain.

