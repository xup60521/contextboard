# Cross-check formatting correction, final start

Read `.agentflow/A-009-agentflow-update/review-brief-2.md` and repeat its independent review for implementation `3d2fdbd4cdcff6e0fc36451e86aac98e27ac70be`. Preserve or revise the verdict based on the evidence. This is not permission to rely on the prior verdict without checking it.

Return the complete report on stdout only. Do not write a clone-local report.

The first line must be a fresh stamp matching this exact structural example: `* _2026-09-13 15:15:00 +0800 (gpt-5.6-terra/high)_`.

The final line must begin `Self-check:` and contain a nonempty sentence after the colon, for example `Self-check: I verified the commit identity, verdict fields, and final boundary.` Put no content after it.

Include exactly one each of `Outcome: PASS|BLOCKING`, `Minimality: PASS|BLOCKING`, `Conformance: PASS|BLOCKING`, and `Verdict: PASS|BLOCKING`.

Scope discipline — implement exactly the ask; park everything else as a proposal. The ask's scope is what the user wrote plus tests, commits, the notebook, STATUS, and any records required by the active route. Do not refactor, rename, reformat, add dependencies, or repair adjacent behavior unless the Ask requires it. Pass this paragraph verbatim in every worker brief.
