# Contextboard

## PR

When the user asks for filing a PR, don't make a draft. The PR title should describe the problem it solves, and the description should contain the initial prompt of what happened and the final solution. You should not include implementation detail in the description.

## Environment

Never start the dev server, a watch task, or any other long-lived process. On the remote Linux box a dev server has already leaked memory badly enough to hang the whole machine and force a manual reboot. If you need a running app and cannot reach one, report that as a limit and stop; do not start one yourself.

Code, unit tests, typecheck, and lint run on whichever machine is writing the code. Runtime and browser verification happens only on the laptop, and its results reach an agent as owner-supplied evidence, never as the agent's own command output.

## Agentflow

Only the laptop's main checkout writes the root notebook `.agentflow/devlog.md` and its STATUS. A stream session on any machine writes only its own `.agentflow/features/<taskkey>/` notebook and defers the root `stream:` pointer to the laptop.

Delivery goes through a GitHub PR: `agf finish --prep`, the closing stream Reply, then the PR. Never `agf finish --deliver`, which fast-forwards the default branch and bypasses the PR. After the PR merges, run `cleanup:<taskkey>` from the laptop's main checkout.

## Writing cards

If a task will end in cards on the user's own boards, read
`skills/contextboard/card-style.md` **before starting the research**, not before
writing. It governs what to keep while reading, so loading it at drafting time
is too late. `skills/contextboard/SKILL.md` is the API; that file is the voice,
the joints between cards, and the layout conventions.

## Code & Style

Clean, precise and concise code is always preferred. Find clever solution rather then brute force. Don't write excessive test, only focus on the most important ones. Diligence is a good virtue but burns too many tokens, so be smart about your work. For example, don't write Python-style Typescript code (e.g. one liner function to enforce type), in favor of the one that Matt Pocock would like.