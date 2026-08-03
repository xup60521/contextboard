# ContextBoard agent gateway (MCP)

An MCP server that lets Claude Code or Codex read and write a ContextBoard
workspace: create whiteboards, write cards with their sources, and connect
cards with references and relations.

## Modes

The mode is selected at startup with `CONTEXTBOARD_AGENT_MODE`:

- `bridge` (the default) talks to the running desktop app over its loopback
  bridge. Reads include the desktop's live, possibly unsynced replica.
- `replica` runs without the desktop app, keeps a persistent SQLite replica at
  `~/.contextboard/replica.sqlite`, and syncs with the cloud using a revocable
  agent token. Its device id is stable in `~/.contextboard/device.json`.

```text
agent --stdio--> agent-mcp --loopback--> desktop app --> sync server
agent --stdio--> agent-mcp --HTTPS + token----------------> sync server
```

Replica mode performs a pull before the first read, flushes after every write,
and flushes again when the MCP process exits.

## Bridge setup

1. Open the desktop app and sign in.
2. Turn on **Allow local AI agents to use this workspace** in the sidebar. The
   app listens on `127.0.0.1:8787` and publishes its live port to
   `~/.contextboard/bridge.json`.
3. Register the server with your agent:

```sh
claude mcp add contextboard -- bun run /path/to/contextboard/apps/agent-mcp/src/index.ts
```

```toml
[mcp_servers.contextboard]
command = "bun"
args = ["run", "/path/to/contextboard/apps/agent-mcp/src/index.ts"]
```

Set `CONTEXTBOARD_BRIDGE_PORT` to override port discovery.

Bridge mode must run on the same machine as the desktop app. The loopback
bridge is never exposed off-machine.

## Remote replica setup

1. Issue an agent token from the Web app's agent-token settings page. The
   plaintext is shown only once.
2. On the remote box, create `~/.contextboard/credentials.json` with mode
   `0600`:

```json
{
  "token": "cbat_...",
  "serverUrl": "https://your-contextboard-worker.example"
}
```

3. Register the MCP server using replica mode:

```sh
CONTEXTBOARD_AGENT_MODE=replica bun run /path/to/contextboard/apps/agent-mcp/src/index.ts
```

The first run joins the account's default workspace and pulls it before serving
the first read. Set `CONTEXTBOARD_WORKSPACE_ID` when the account has multiple
workspaces. For containers or service managers, `CONTEXTBOARD_AGENT_TOKEN` plus
`CONTEXTBOARD_SYNC_URL` can replace the credentials file.

## Tools

| Tool | Purpose |
| --- | --- |
| `list_whiteboards`, `get_whiteboard` | Find where existing work lives |
| `create_whiteboard` | Create a root or nested board |
| `rename_whiteboard`, `archive_whiteboard` | Maintain board structure |
| `list_cards`, `search_cards`, `get_card` | Read cards, placements and backlinks |
| `create_card`, `update_card`, `archive_card` | Write cards |
| `list_board_items`, `place_card`, `move_item`, `archive_item` | Arrange cards |
| `list_relations`, `create_relation`, `delete_relation` | Read and draw card relations |

Card text is markdown. `update_card` replaces the whole card, so read it first
and send the complete text back.

## Placement

`create_card` and `place_card` take an optional `x`, `y`, `w` and `h`. Leave `x`
and `y` out and the card is placed automatically in free space beside the
board's existing cards. Passing coordinates overrides that, and `x: 0, y: 0`
is a literal position rather than a request for auto-placement. Read the
current layout with `list_board_items` before choosing coordinates, and use
`move_item` to move or resize an existing item.

## The two ways cards connect

**References** live in a card's text. Write
`[label](contextboard:card/<cardId>)` inline, in the sentence that makes the
claim. This produces a backlink on the target, travels with the card to every
board it appears on, and is directional.

**Relations** are the arrows drawn between cards on a board. They are scoped to
that board, undirected, and their meaning is whatever the person who drew them
intended. Read them with `list_relations` and draw one with `create_relation`,
which needs both cards to already be on the board.

## Scope

Card text is markdown: headings, lists, blockquotes, fenced code, pipe tables
and `$…$` math round trip through `get_card` and `update_card`. Image upload is
not supported yet.

Conventions for how a workspace should be organised belong in a project's
`CLAUDE.md` or `AGENTS.md`, not in these tools.

## Security

The bridge has no token; its safety depends on being reachable only from
loopback. Any program running as the local user can use it while enabled, so
never expose that endpoint beyond the machine.

Replica mode uses a bearer token. Keep `credentials.json` owner-readable and
revoke the token in the Web app if the remote box is lost.
