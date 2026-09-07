<!-- Load only for run-looper, run-plans, or work that changes looper behavior. -->

# Looper operation

Use this file for all looper operation, monitoring, recovery, and delivery work.

## Triggers

- `run-looper` authorizes direct execution of `looper.js`. Run `node <agentflow-skill-dir>/scripts/looper.js [options] [planned-directory]` from the checkout where the plans must change files.

- `run-plans` authorizes completion of the existing `$workspace_dir/planned/` queue. Run the installed `agf-looper` shell command from the checkout where the work belongs. Do not replace it with a handwritten loop.

- A plain mention of looper, plans, `planned/`, or a request to create plans does not start the queue. `make-plans` routes each job as simple or complex, publishes a frozen queue, and stops before implementation. Before `plan_jobs`, the natural-language host inspects the owner request and relevant repository evidence and supplies `complexity_reasons`: a unique list containing only applicable reasons from `material_uncertainty`, `cross_subsystem_coordination`, `public_or_stored_data_contract`, `trust_boundary`, and `unresolved_material_decision`.

  Empty routes directly as simple; non-empty routes through the complex pipeline. The owner supplies the work request, not a route, and job length is never used.

## Supported queues

- A handwritten queue contains regular files named exactly `plan-NNN.md`, where `NNN` is three digits. Put them in `$workspace_dir/planned/` or pass their directory with `--tasks-dir`. It does not need `.queue-generation.json` and uses the configured notebook completion line.

- A queue produced by `make-plans` contains numbered plans plus `.queue-generation.json`. Leave every plan and that file unchanged. The envelope records route-specific authority: simple plans use the owner request and repository evidence, and complex plans use the accepted contract. Looper checks their saved fingerprints, order, dependencies, notebook, and final integration plan before it starts work.

- Run only from the checkout where the plan must change files. Use `agf-looper --tasks-dir <path>` for the installed shortcut or `node <agentflow-skill-dir>/scripts/looper.js --tasks-dir <path>` for `run-looper`.

## Normal operation

- Stay responsible for the command until it exits. Looper runs one ready plan at a time, verifies its notebook round and exact completion response, moves a proven plan into `$workspace_dir/planned/done/`, and then starts the next ready plan.

- Looper calls the shared `select_frozen_ready_plans` boundary for generated queues. An ordinary host agent must call the exported `select_host_ready_plans` name before choosing work; it is the exact same function object, so both paths accept the same frozen authority and return the same ordered ready plans.

- Relay each important plan, test, review, commit, or failure milestone to the owner. Provide a short update at least every 60 seconds while useful new facts arrive.

- `Still running` proves the child process is alive. Do not call quiet reasoning a hang. If looper itself produces no update for more than two expected 60-second intervals, inspect only the process this host started before deciding whether it has stopped making progress.

- Use `--show-output` to page only the bounded final worker-output tail. Use `--dump` to save complete stdout and stderr for every worker under `$workspace_dir/artifacts/looper-output/<run>/`. The option is off by default. Looper prints the exact easy-to-open file paths when it creates them.

## Stop, review, and recovery

- Interrupt only the looper process owned by this host. Looper forwards the signal to its child and prints the recovery paths.

- When a plan stops, inspect the plan, notebook, Git changes, `.stop.txt`, and the protected attempt record named by looper. Preserve evidence that matters.

- If another host truly completed the plan, move it to `$workspace_dir/planned/done/` only after the inspection proves completion. Otherwise leave it pending.

- Use `agf-looper --reset` only after confirming that no child or queue owner is live. Reset retires reviewed stale control records and exits. Run plain `agf-looper` separately to resume. Never reset, move a plan, or claim completion while ownership or completion evidence is uncertain.

## Changes to looper behavior

Every change that can alter looper behavior has one mandatory final gate: run `node skills/agentflow/scripts/looper-live-gate.js --report <work-root>/looper-live-gate.json` before the cross-check target is frozen. This gate must create a temporary Git repository, install and invoke the real `agf-looper` shell shortcut, run two real low-cost provider plans, and prove a successful process exit, both exact product files, two completed notebook rounds, and both plans archived under `planned/done/`. Fake workers, injected process functions, a manually invoked `looper.js`, or an earlier run against another implementation cannot replace this evidence. A missing, stale, incomplete, or failed report blocks delivery. — I-064.
