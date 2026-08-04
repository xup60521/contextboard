# ContextBoard agent server

The `contextboard` binary exposes the ContextBoard workspace through a guarded
loopback HTTP API for a headless replica:

```sh
contextboard serve
contextboard login --server https://your-contextboard.example
```

The server writes `~/.contextboard/agent-server.json` while running. The full
HTTP contract, tool schemas, placement guidance, and recipes live in
[`skills/contextboard/SKILL.md`](../../skills/contextboard/SKILL.md).

The replica reads `CONTEXTBOARD_AGENT_TOKEN` and `CONTEXTBOARD_SYNC_URL`, or
the credentials file created by `contextboard login`. Existing credentials
files containing only `token` and `serverUrl` remain supported.
