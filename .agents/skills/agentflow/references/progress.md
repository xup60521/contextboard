# Progress records

- Keep a central tracker for decomposed work. Use `tracker-contract.js template` at `<work-root>/tracker.md`. Each task states outcome, exact paths and work boundary, needed contract decisions, proof command or inspection, failure handling, and `Source:`. Keep implementation decisions inside the task so a new implementer need not reconstruct the conversation; link lengthy inputs and raw evidence. Apply this to new or open tasks, preserving completed records. After material updates run `tracker-contract.js validate --refresh --repo <repo> --tracker <path>`; it derives totals without marking tasks complete. Link the tracker from the devlog. — I-063.

- After a material result, decision, failure, or recovery transition, send its factual body to `notebook-write.js append-run --notebook <target-doc> --ask <A-NNN> --input-stdin`. The writer supplies the RUN number, local time, and heading. Format the body as scannable Markdown bullets with one short result per bullet and the outcome first; RUNs explain progress, not command transcripts or dense narrative paragraphs, be concise and terse. Existing full headings remain supported.

- If the Reply is ready, skip the separate RUN write and include each new RUN exactly once in closeout. A RUN already written to the notebook is omitted; use `"run_events":[]` when none remain.

- After ten active minutes, save a readable checkpoint through `notebook-write.js append-wip` with the same flags and a body containing **Finished:**, **Running now:**, **Still to do:**, **Next work action:**, and `[x] tracker.md | [x] devlog RUN | [x] scope matches tracker`. The writer supplies its heading. Verify those checks before claiming them. The footer is a reminder: automated field and freshness checks do not prove scope agreement or implementation correctness. Keep the owner informed even when no new worker result is known. Skip the checkpoint only when the complete Reply is ready. — I-074.

- Before a checked checkpoint, validate the tracker, compare actual changed paths with its expected paths, and record that comparison in the preceding RUN event.

