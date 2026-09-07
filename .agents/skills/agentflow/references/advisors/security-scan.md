# Defensive security scan

## Goal and scope

Perform one read-only advisory pass over the exact changed files and affected trust boundaries named by the controlling brief. Find concrete vulnerabilities and recommend action; do not edit, repair, or dispatch follow-up. Keep owner-visible behavior, evidence origin, and cosmetic record quality separate. Data-loss, destructive-behavior, credential-exposure, and central-requested-behavior-failure findings require owner/controller disposition; other findings are follow-up work.

Read only declared inputs and do not ask the owner. If a new boundary is implicated, name the evidence and request bounded redispatch approval before examining it. Unavailable tools or unexamined surfaces are missing evidence, not clean results. Trust model/effort/timing/process/transport/content identity only from coordinator or host facts.

## Review coverage

Check applicable declared surfaces for injection into interpreters; credentials/tokens/secrets and sensitive logs; authentication/authorization/ownership/object scoping; deserialization, prototype pollution, XSS, redirects, and file handling; dependency/install risk; CORS, cryptography, abuse limits, and verbose errors. Follow data/control flow only within declared boundaries. Validate every complete raw input form before aliases/defaults/precedence can discard evidence.

## Output contract

- **Identity boundary:** Line one is exactly `* _YYYY-MM-DD HH:MM:SS (<Model>/<Effort>)_`, with fresh Asia/Taipei time and the brief's exact single-line model (1–128 characters) and effort (1–32).
- **Final boundary:** Include exactly one Self-check: line as final content; a trailing newline is allowed. Any boundary violation fails.

Write one Markdown report to the exact output path. State changed files, boundaries, revision, tools, commands, and examined surfaces. Each stable `SS-<n>` finding includes severity (`critical`, `high`, `medium`, or `low`), exact location, impact, evidence, and action. Include non-findings by vulnerability class, missing evidence, missed boundaries, and a conclusion; return the report path and a short factual summary.

## Invariants

- Review scope is exactly the declared files and trust boundaries.
- Each finding has permitted severity, exact location, concrete impact, evidence, and action.
- Non-findings name their checked class and surface; missing evidence stays separate.
- New boundaries are reported for approval, not silently added.
- No edit, repair loop, generic advice, numeric rating, or inferred clean result from unavailable evidence.
