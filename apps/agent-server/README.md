# ContextBoard agent server

The `contextboard` binary exposes the ContextBoard workspace through a guarded
loopback HTTP API for a headless replica. A fresh box needs no configuration:

```sh
contextboard serve
```

When the box has no credentials, `serve` starts a device login — it prints a
short code, opens the approval page in your browser, and waits. Approve it with
the GitHub account that owns the workspace and the same process goes straight on
to serving; there is nothing to restart and no token to copy by hand.

`contextboard login` runs that flow on its own, which is useful for logging in
ahead of time or after `contextboard logout`:

```sh
contextboard login
contextboard login --server https://your-contextboard.example  # self-hosted
```

Both commands accept `--server URL` and `--device-name NAME`. Without `--server`
the CLI uses `CONTEXTBOARD_SYNC_URL`, then the server recorded in an existing
credentials file, then the deployed default. The login writes
`~/.contextboard/credentials.json` (owner-only) and verifies the token against
the server before returning.

The server writes `~/.contextboard/agent-server.json` while running. The full
HTTP contract, tool schemas, placement guidance, and recipes live in
[`skills/contextboard/SKILL.md`](../../skills/contextboard/SKILL.md).

The local server exposes the canonical skill document for agents that need to
refresh their instructions:

```sh
curl -sS -X POST "http://127.0.0.1:<port>/api/v1/_skill" \
  -H 'content-type: application/json' -d '{}'
```

The endpoint is loopback-only and POST-only, like `/_health` and `/_tools`. It
returns the raw Markdown with `content-type: text/markdown; charset=utf-8` and
an `ETag` based on the document contents. The desktop bridge exposes the same
contract.

Replica mode performs an initial sync before exposing the agent tools, then
continues pulling remote changes every two seconds while the server is alive.
Transient sync failures use bounded exponential backoff; stopping the server
stops the poller before the final flush and database close.

## Containers and CI

Where no one can approve a browser prompt, inject the credentials instead and
turn the login off, so a missing token fails fast rather than looking like a
hang:

```sh
CONTEXTBOARD_AGENT_TOKEN=cbat_… CONTEXTBOARD_SYNC_URL=https://… contextboard serve
contextboard serve --no-login   # fail immediately if not already logged in
```

Mint a token for `CONTEXTBOARD_AGENT_TOKEN` at `/agent-tokens` in the Web UI.
The environment takes precedence over the credentials file, and existing
credentials files containing only `token` and `serverUrl` remain supported.
`CONTEXTBOARD_NO_LOGIN` is equivalent to `--no-login`, and `--no-browser` (or
`CONTEXTBOARD_NO_BROWSER`) prints the code without launching a browser. The
browser is left alone automatically over SSH and when stdout is not a terminal.
