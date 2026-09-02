# Taking note

Build a source-bound, argument-shaped tree of readable cards that lets a reader reconstruct one web page or PDF without pretending a compressed conclusion is a reading. Run this workflow once per source. Do not compare sources or write synthesis cards here.

## Contract

The result is one `Source overview` root and a wide, shallow tree of `Detail note` cards. The root also holds the complete coverage ledger. It replaces a separate coverage card.

A successful note tree does two jobs:

- a reader can follow the author's questions, claims, reasons, evidence, objections, and limits without reopening the source on every step;
- a later synthesis can cite notes that existed before its conclusions were drafted.

Readable reconstruction is the product. Traceability is a mandatory acceptance condition. Never silently downgrade a long or damaged source into a summary.

## 1. Establish source identity and integrity

Accept one canonical web page or one PDF. Record:

- canonical URL or file identity;
- title, author, publication date, edition or version, and access date;
- content hash when a stable version identifier is unavailable;
- the expected and available page, section, or paragraph range;
- missing pages, collapsed web content, paywalls, OCR defects, and unreadable figures.

Reuse an existing root when its source identity matches. If a mutable web page changed, create a versioned root and link the versions in prose. Do not merge versions.

Set the source state to `complete source` only when the whole declared source is available. Otherwise use `partial source` and name every inaccessible range. Never reconstruct a missing passage from a secondary account.

## 2. Map before extracting

Scan the complete available source once. Build a provisional outline from its actual sections and argumentative turns before writing final cards. Give every outline item one coverage state:

- `unread`
- `in progress`
- `covered`
- `omitted with reason`

An allowed omission is repetition, navigation or publishing apparatus, acknowledgements, or a procedure that cannot affect interpretation. "Irrelevant" is not a reason. State what the passage contains and why it does not change the source's argument.

For a source too long for one invocation, finish coherent sections and leave the rest `unread`. Publish completed subtrees as partial work. Do not call the source complete until no item remains `unread` or `in progress`.

## 3. Read section by section

Read each outline item in context, then revise the provisional structure. Organize by argumentative dependency rather than paragraph boundaries, metadata roles, or simple reading order. Begin with the fewest coherent cards that preserve the source:

```text
Source overview and coverage ledger
  -> major argument card
      -> dependent claim or mechanism
      -> parallel evidence, case, objection, or consequence
```

A `Detail note` may contain several claims, reasons, evidence items, objections, and limits. Use Markdown `##` headings to make those internal movements scannable. Metadata roles do not create card boundaries.

Split only when a branch can be understood independently and the split materially improves navigation or comparison, or when combining it would make the card's argumentative movement incoherent. Do not split merely because the passage changes from claim to evidence, introduces a qualification, or contains another quotable result. There is no target card count. Excessive fragmentation and overcompressed summary are both failures.

## 4. Preserve complete reading paths

Every path through the tree must let a reader recover:

- the question being answered;
- the bounded claim;
- why the author thinks it follows;
- the material or evidence used;
- conditions, objections, and limits that change its force;
- the card's job in its parent's argument.

These are path requirements, not headings or a per-card template. An upstream card may supply context that a child explicitly inherits. If a conclusion appears without its premise, evidence, or qualification somewhere in the card or its path, return to the source and revise the cards.

Preserve numbers, populations, comparisons, temporal scope, modality, and the difference between correlation, mechanism, interpretation, and causal claim. Treat tables, figures, and formulas as evidence. Explain what each measures or compares, what result it carries, and what it cannot establish. Expand methods when they affect interpretation, reproducibility, or scope.

## 5. Mark attribution and uncertainty

Give each substantive card one or two primary roles for machine routing:

`context`, `claim`, `reasoning`, `evidence`, `example`, `objection`, `limitation`, or `definition`.

Give it one epistemic status:

- `stated`: the source says it directly;
- `reconstructed`: the connection follows from multiple passages but is not stated in one place;
- `note`: a reading aid or judgement added by the agent;
- `uncertain`: the source supports more than one reading.

A card may contain passages with different epistemic statuses. Record its primary status in metadata, mark every reconstructed or uncertain passage in the visible prose, and cite every passage used in the reconstruction. Later synthesis must not promote it to a direct author claim.

Write explanations in the user's language. Keep technical terms and quotations in the source language. Attribute secondary material to the source currently being read, not to the work it describes.

## 6. Quote and locate

Every substantive claim, evidence, objection, and limitation card carries the shortest verbatim passage sufficient to anchor the reading, plus a stable locator. Navigation and grouping cards do not need quotations.

Use page plus section for PDFs when available. Use heading plus paragraph or a text fragment for web pages. Keep quotations adjacent to the explanation they support. Do not reproduce whole sections or turn the tree into chopped-up source text.

End each `Detail note` with one visible provenance line. Keep the full routing metadata in an HTML comment so it remains machine-readable without interrupting the reading:

```markdown
來源脈絡：[Author year, pp. 12-15](<canonical URL>) · stated · [source overview](contextboard:card/<id>)

<!--
Role: claim, reasoning
Status: stated
Locator: pp. 12-15, section "Selection"
Source: <source identity>
Parent: [source overview](contextboard:card/<id>)
-->
```

Keep the title natural and claim-bearing after the required `Detail note` prefix. Put narrow locators beside the quotations or evidence they support; the provenance block records the card's overall span.

## 7. Maintain the root ledger

The `Source overview` root is both reading entrance and complete ledger. Put the readable material first:

- source identity and direct link;
- the problem the source addresses;
- publication context, approach, and material;
- a compact map of the complete argument;
- scope and important limitations.

Then record operational state:

```text
Source state: complete source | partial source
Reading state: provisional | partial | complete
Coverage:
- covered: <range> -> [section overview](contextboard:card/<id>)
- unread: <range>
- omitted with reason: <range> - <specific reason>
Risks: none | <OCR, missing content, figure, or interpretation risk>
Checked: <date and result>
```

Every declared source section appears exactly once in `Coverage`. The root may be long. Do not split the ledger into a hidden duplicate that can drift from the board.

## 8. Revise without erasing the argument

Default to merging material that belongs to one natural argumentative section, even when it plays different roles. Preserve its internal movement with Markdown headings, prose transitions, inline quotations, and locators.

Split or keep cards separate when a branch can travel independently, another card needs it as a distinct premise, or merging would bury a consequential objection or limit. Never merge if doing so removes a claim, reason, evidence item, objection, or limit from the readable path. Delete content only under an explicit `omitted with reason` ledger entry.

## 9. Validate before publishing

Draft and revise the provisional tree before placing final cards. Before marking a section `covered`:

1. Reopen each consequential locator with surrounding context.
2. Check attribution, wording strength, population, time, certainty, evidence, and qualifications.
3. Check every root-to-leaf path for a missing premise or boundary.
4. Check every outline item has one coverage state.
5. Check `reconstructed` and `uncertain` cards cite all supporting passages.
6. Check no card was selected merely because a later synthesis would use it.

Research-flow performs a second, risk-based fidelity pass over all core claims, numbers, figures, limitations, `reconstructed` and `uncertain` cards, plus a sample of ordinary notes.

## 10. Publish to ContextBoard

Follow `SKILL.md` for the HTTP API and `card-style.md` for voice, prose joints, and layout. A `Detail note` borrows the readability of an argument card: use a claim-bearing title, open with the question or tension, keep evidence and qualifications beside the claim they change, and end on the consequence that carries the reader forward. It remains source-bound, so it does not perform cross-source synthesis and does not need the argument card's five-slot coverage.

Use `Source overview` for the root and `Detail note` for every other card. Build the same wide, shallow topology as argument cards. Every detail note must reach the overview through its parent chain, but select the immediate upstream card whose claim the child actually uses, not the card written immediately before it and not the overview by default. Draw an arrow only when the child inherits, resolves, contrasts with, exemplifies, decomposes, or extends that upstream claim. Put a matching inline `contextboard:card/...` reference in the sentence that performs the joint. No joint, no arrow; no arrow, no joint. Do not draw arrows between sources or between note and argument layers.

Use the x-axis for argumentative depth: the overview at the left, dependent cards farther right. Use the y-axis for sibling branches at the same depth. Keep the tree wide and shallow. No card may be the target of more than three joints, and no joint chain may run more than six cards deep. If the overview attracts too many children, merge fragments into larger argument cards or introduce a substantive intermediate claim; never add an empty grouping card. On an existing research board, keep the note layer at least 800 below the argument layer and place the new tree to the right of existing sources. Do not rearrange established structures. On a new board, create the complete tree, draw its arrows, then arrange only those card IDs with an explicit `tree-horizontal` style; never use `auto` or `mindmap`.

Before publishing, confirm that every arrow has a matching prose joint and inline card reference, that deleting the joint sentence would weaken the child, and that the layout forms a wide, shallow argument tree rather than a star-shaped mind map or an essay cut into a chain.

Report source integrity, covered and outstanding ranges, card counts by function, reconstructed or uncertain readings, OCR or figure risks, validation result, and the root card link.
