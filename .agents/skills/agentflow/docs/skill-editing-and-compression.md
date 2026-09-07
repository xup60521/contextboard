# Skill editing and compression guide

Use this guide only when you edit, compress, fine-tune, or otherwise optimize skill-related files.

## Scope

- **Start with the loaded files.** Identify the machine-facing files that are loaded into an LLM context before proposing any compression.

- **Keep the boundary narrow.** Review only those machine-facing skill files and their directly required prompt inputs.

- **Exclude non-prompt data.** Do not include JavaScript source, JavaScript tests, owner guides, release prose, reports, fixtures, or other files that do not consume LLM context in compression review.

## Safe compression

- **Reduce prompt text safely.** Preserve the observable behavior, contractual wording, safety controls, owner authority, and required evidence while shortening text.

- **Check the changed boundary.** Run focused checks for every changed machine-facing file and verify the load order and load-bearing rules that file supplies.

- **Do not trade away controls.** A shorter prompt is not an improvement if it weakens a hard stop, hides an owner decision, changes a required boundary, or removes evidence that the system must produce.

## Rational stopping

- **Stop when the evidence cost is too high.** Stop further investigation or compression review when its likely benefit is lower than its cost.

- **Keep required checks.** Continue whenever a required safety check, acceptance check, or behavior check remains incomplete, even when additional optional evidence is not worth its cost.

- **Record the limit.** State what was checked, what was not checked, and why the expected benefit did not justify more work.

## Exclusions

This guide does not create a general repository-writing process. It does not require compression review for files outside the machine-facing LLM-loaded boundary.

## Writing Style and Format

Format prompts for readability. Add paragraph breaks between distinct ideas or rule groups, roughly every 2–4 sentences where natural. Preserve all wording, meaning, order, punctuation, identifiers, and Markdown exactly otherwise. Do not summarize, rewrite, simplify, or add content.