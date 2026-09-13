# Writing styles protocol

## Scope

Apply this style by default to all human-readable prose and Markdown, including devlogs, RUNs, Replies, trackers, designs, reports, guides, manuals, tutorials, slides, specifications, operational logs, prompts, and skills. Preserve an established stricter format when required. Machine-serialized data, source code, tables, exact quotations, and formats whose contract requires adjacent lines are exempt from presentation-only spacing rules.

## Concise list style

- Keep the body list-based, with one result, incident, reason, decision, evidence item, or next action per bullet. Aim for fewer than 50 words per item; clarity and completeness take priority. Connected sentences may explain the same idea.

- Lead items with concrete results or actions. Use short bold scan cues for important items, never entire sentences. Put lengthy evidence in supporting bullets or links when it obscures the result.

- Use everyday words in plain English. Say what happened, what it means for them, and what happens next. Explain unavoidable technical terms once; include filenames and internal details only when readers need them. Number ordered steps; put necessary detail in supporting bullets.

- Separate every adjacent Markdown list item with exactly one empty line, including nested bullets and numbered items. Apply this loose-list spacing by default in all writing governed by this protocol, including Agentflow Ask/RUN/WIP/Reply content. Do not compact consecutive list items onto adjacent non-empty lines. Preserve adjacency only where a machine format, table, code block, exact quotation, or established contract requires it.

## Opening and reader action

- Make the opening understandable on its own: state the outcome, why it matters, and any needed action or decision. Put a warning or decision first when it changes the reader's next step; say that no immediate action is needed only when that could otherwise be unclear. Avoid activity lists, miniature reports, and repeating the same result throughout the document.

- Group supporting explanations around the reader's questions and preserve the document's established format.

## Evidence and status

- Keep essential evidence beside its conclusion; move hashes, process accounting, repair history, raw paths, and lengthy technical evidence into links or later supporting detail.

- Distinguish tests running, requested behavior working, and task completion; separate earlier from current results. State uncertainty plainly and preserve material failures and limitations when shortening.

- Before delivery, check that the opening conveys the outcome, material problem or limitation, and next action, and that the details explain them in everyday words. Reader comprehension is the acceptance test. This author check and presentation choices are advisory, never automated completion gates; they do not replace required content, evidence, or established formats.

## Document-specific formats

- For `show-diff`, follow SKILL.md's reasoned unified-diff format; standalone-report opening and supporting-section guidance does not apply to the diff.

- For Agentflow devlogs, follow `references/closeout.md` for exact Reply structure and apply this style within the Ask/RUN/WIP/Reply format. A `[FINAL REPORT]` section is still a devlog answer, not a standalone report.

- Worker reports and specifications follow this report guidance even when their document type is outside the default style scope.

- For standalone reports and guides, write for a human reader. Place a short TL;DR, BLUF or summary after required identity and revision lines.

- Use two to four short opening bullets covering the result or decision, material risks or missing evidence, and the next action or owner choice. Scale to the report; do not invent issues or actions to fill slots.

- Fit that opening within the stage's allowed headings. A short bold label needs no extra heading.

- In requirements refreshes, keep append-only question history unchanged and put the current overview in the one replaceable `# Final requirements summary`; do not create a second authoritative summary.

- Keep findings and closing limits list-based, with one idea per bullet. Separate trigger, impact, evidence and action when they are distinct; put paths, hashes and scope accounting after the conclusion they support. Preserve exact verdict fields, severity, IDs, uncertainty, literal patch blocks and final `Self-check:` boundaries.

## Editing writing instructions

- Before editing, record the exact requested improvement and preserved format obligations in the current task record. Compare every deletion with its replacement and owner authorization; leave unrelated rules intact.

- Inspect a resulting example for the outcome, material warning or limitation, and next action. Preserve its document-specific format, including numbered devlog answers. This author inspection adds no automated gate and does not waive substantive checks.
