# Agentflow Windows journey

Implementation commit: `cb57770`.

- `node codex-worker.js --version` returned `codex-cli 0.153.4` with exit 0.
- `external-runner-v1` cloned the repository independently, removed all remotes, kept stdin closed, launched the committed wrapper, returned exit 0, and reported no clone changes.
- A fresh PowerShell process loaded `agf` and `agf-looper` as functions and loaded `AGF_OPEN` from the managed profile block.
- `agf settings validate` returned `valid ag.json for codex`.
