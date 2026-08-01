# ContextBoard agent gateway (MCP)

An MCP server that lets a coding agent — Claude Code, Codex — read and write a
ContextBoard workspace: create whiteboards, write cards with their sources, and
cite one card from another so the result is a structured body of knowledge
rather than a chat summary that disappears.

## How it works

The MCP server holds **no credentials**. It talks to the running desktop app
over a loopback HTTP bridge, and the desktop app owns authentication and
synchronization. A write here lands in the desktop's local SQLite store and is
pushed to the sync server by the app's own coordinator, so it reaches your other
devices exactly like an edit you made by hand.

```
agent  ──stdio──>  agent-mcp  ──127.0.0.1──>  desktop app  ──>  sync server
```

The agent and this server must run **on the same machine as the desktop app**.
There is no remote access, no tunnel, and no exposed port. A standalone CLI that
carries its own session and needs no desktop app is a separate, later thing.

## Setup

1. Open the desktop app and sign in.
2. Turn on **Allow local AI agents to use this workspace** in the sidebar. It is
   off by default. The app then listens on `127.0.0.1:8787` and publishes the
   live port to `~/.contextboard/bridge.json`, so nothing else needs configuring.
3. Register the server with your agent.

Claude Code:

```sh
claude mcp add contextboard -- bun run /path/to/contextboard/apps/agent-mcp/src/index.ts
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.contextboard]
command = "bun"
args = ["run", "/path/to/contextboard/apps/agent-mcp/src/index.ts"]
```

Set `CONTEXTBOARD_BRIDGE_PORT` to override port discovery.

## Tools

| Tool | Purpose |
| --- | --- |
| `list_whiteboards`, `get_whiteboard` | Find where existing work lives |
| `create_whiteboard` | New board, or a sub-board nested in one |
| `rename_whiteboard`, `archive_whiteboard` | Maintain board structure |
| `list_cards`, `search_cards`, `get_card` | Read cards, placements and backlinks |
| `create_card`, `update_card`, `archive_card` | Write cards |
| `list_board_items`, `place_card`, `archive_item` | Arrange cards on boards |
| `list_relations`, `create_relation`, `delete_relation` | Read and draw the arrows between cards |

## The two ways cards connect

Both exist, and they are not redundant.

**References** live in a card's text. Write
`[label](contextboard:card/<cardId>)` inline, in the sentence that makes the
claim. This is a real link: it produces a backlink on the target, it is global
(it travels with the card to every board it appears on), and it is directional.
This is the one to reach for when recording where a claim came from.

**Relations** are the arrows drawn between cards on a board. They are scoped to
that board — a card can sit on several boards, and an arrow means something in
the context of one of them — undirected, and their meaning is whatever the
person who drew them intended. Read them with `list_relations` and draw one with
`create_relation`, which needs both cards to already be on the board. The arrow
it draws is a real one — the user sees it on the canvas and can drag or delete
it like any other.

## Scope

Card text is markdown: headings, lists, blockquotes, fenced code, pipe tables
and `$…$` math round trip through `get_card` and `update_card`. The first line
becomes the title. Image upload is not supported yet.

`update_card` replaces the whole card, so read it with `get_card` first and send
the full text back — anything you leave out is removed.

Conventions for how your workspace should be organised belong in your project's
`CLAUDE.md` or `AGENTS.md`, not in these tools — the tools describe what is
possible and leave the judgement to you.

## Security

The bridge has no token. It is protected by being unreachable from anywhere
except this machine, and by rules that stop a web page you happen to be visiting
from reaching it: requests carrying an `Origin` header are rejected, a JSON
content type is required (so cross-origin requests must preflight, and no CORS
headers are ever returned), the `Host` must name loopback, and `GET` is refused.

While the toggle is on, **any program running as you on this computer can read
and write your boards.** If this endpoint is ever exposed beyond the local
machine, it will need a token first.
