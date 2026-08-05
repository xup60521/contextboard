---
name: contextboard
description: Read and write a ContextBoard workspace — cards, whiteboards, canvas placement, and relations — over the local HTTP API. Use when asked to add notes to the board, organise a whiteboard, link cards, or read what is on the board.
---

# ContextBoard

ContextBoard is a workspace of markdown cards arranged on whiteboards. The
local agent server exposes the same API whether it is backed by the running
desktop app or by a headless replica.

## Getting the port

Read `~/.contextboard/agent-server.json`. It is the source of truth and contains
the active `port` and `mode` (`desktop` or `replica`). If it is missing, report
that no agent server has published its port; do not guess a default port.

```sh
discovery="$HOME/.contextboard/agent-server.json"
if [ ! -f "$discovery" ]; then
  echo "ContextBoard agent-server discovery file is missing" >&2
  exit 1
fi
if command -v jq >/dev/null 2>&1; then
  port=$(jq -r '.port' "$discovery")
  mode=$(jq -r '.mode' "$discovery")
else
  port=$(python -c 'import json,sys; print(json.load(open(sys.argv[1]))["port"])' "$discovery")
  mode=$(python -c 'import json,sys; print(json.load(open(sys.argv[1]))["mode"])' "$discovery")
fi
curl -sS -X POST "http://127.0.0.1:${port}/api/v1/_health" \
  -H 'content-type: application/json' -d '{}'
```

If `mode` is `desktop`, recovery is: enable the agent server in ContextBoard
Settings and make sure the window is open. If `mode` is `replica`, recovery is:
run `contextboard serve`. The two servers must not be run together on one
machine; the last writer of the discovery file is the active server.

If the box is not logged in, `contextboard serve` prints a `CODE` and an `OPEN`
URL and waits for the user to approve the login in a browser. That is not a
hang: report the code and the URL to the user and wait, or tell them to run
`contextboard serve` themselves if you cannot show them its output.

Discovery endpoints are POST-only as well:

```sh
curl -sS -X POST "http://127.0.0.1:${port}/api/v1/_tools" \
  -H 'content-type: application/json' -d '{}'
```

React to renderer lifecycle errors instead of retrying blindly:

- `503 RENDERER_UNAVAILABLE`: the desktop window is closed or the renderer has
  not subscribed; open ContextBoard and retry after it is ready.
- `503 RENDERER_RESET`: the workspace switched during the call; retry once.
- `504 RENDERER_TIMEOUT`: the renderer did not answer within 30 seconds; report
  the failure and avoid an unbounded retry loop.

## Calling convention

Tool calls are POST requests with a JSON object body. The success envelope is
`{ "ok": true, "result": ... }`; failures are
`{ "ok": false, "error": { "code": "...", "message": "..." } }`.

```sh
curl -X POST "http://127.0.0.1:${port}/api/v1/create_card" \
  -H 'content-type: application/json' \
  -d '{"text":"A short note","whiteboardId":"whiteboard-id"}'
```

The server is loopback-only. Do not add an Origin header or expose it beyond
the machine.

## Text encoding and card formatting safety

- Always read and write card text as UTF-8. Prefer Bun `fetch` or another client
  that explicitly sends and decodes UTF-8; do not round-trip non-ASCII text
  through a shell/client with ambiguous encoding, especially Windows PowerShell.
- Before `update_card`, scan text for mojibake such as `æ...`, `å...`, or `Ã...`,
  replacement characters, and stray control bytes. Stop and repair/verify any
  suspicious text before writing, and use `expectedVersion` for updates.
- ContextBoard lays out separate paragraphs automatically. Do not add blank
  lines between ordinary paragraphs; use a single newline. Keep blank lines
  only when Markdown syntax requires them, such as fenced code blocks or list
  structure.

## Tool reference

### Whiteboards

| Endpoint | Required fields | Optional fields | Purpose |
| --- | --- | --- | --- |
| `list_whiteboards` | none | none | List boards with hierarchy and counts. |
| `get_whiteboard` | `whiteboardId` | none | Read one board and its breadcrumb. |
| `create_whiteboard` | none | `title`, `parentWhiteboardId` | Create a root or nested board. |
| `rename_whiteboard` | `whiteboardId`, `title` | none | Rename a board. |
| `archive_whiteboard` | `whiteboardId` | `deleteCards` | Archive a board and optionally its cards. |

### Cards

| Endpoint | Required fields | Optional fields | Purpose |
| --- | --- | --- | --- |
| `list_cards` | none | `searchTerm`, `sortBy`, `orphanOnly` | List cards across the workspace. |
| `search_cards` | `query` | `limit`, `whiteboardId` | Search card text. |
| `get_card` | `cardId` | none | Read text, placements, and backlinks. |
| `create_card` | `text` | `whiteboardId`, `x`, `y`, `w`, `h` | Create and optionally place a card. |
| `update_card` | `cardId`, `text` | `expectedVersion` | Replace a card's complete markdown. |
| `archive_card` | `cardId` | none | Archive a card and its placements. |

`sortBy` is one of `updated_desc`, `updated_asc`, `title`, or `title_desc`.

### Canvas

| Endpoint | Required fields | Optional fields | Purpose |
| --- | --- | --- | --- |
| `list_board_items` | `whiteboardId` (`null` for root) | none | Inspect placements and layout. |
| `place_card` | `cardId`, `whiteboardId` | `x`, `y`, `w`, `h` | Place an existing card. |
| `move_item` | `whiteboardId` (`null` for root), `itemId` | `x`, `y`, `w`, `h`, `rotation` | Move or resize a placement. |
| `archive_item` | `itemId` | `deleteCards` | Remove one placement. |

### Relations

| Endpoint | Required fields | Optional fields | Purpose |
| --- | --- | --- | --- |
| `list_relations` | none | `whiteboardId`, `cardId` | List canvas arrow relations. |
| `create_relation` | `whiteboardId`, `sourceCardId`, `targetCardId` | none | Draw an arrow between placed cards. |
| `delete_relation` | `relationId` | none | Remove an arrow relation. |

## Placement semantics

Leave x and y out and the card is placed automatically in free space beside the board's existing cards, which is usually what you want. Pass them only when the layout carries meaning — read the current layout with list_board_items first. Note that x: 0, y: 0 is a literal position, not "auto". Cards default to 576 wide, and their height is estimated from the content unless you pass h — leave h out unless you specifically need a fixed size.

Use `list_board_items` before manually choosing coordinates. A card can have
independent placements on several whiteboards.

## References vs relations

Card text is markdown: headings, bullet and numbered lists, blockquotes, fenced code, pipe tables and $…$ math all round trip. To cite another card, write [label](contextboard:card/<cardId>) inline, in the sentence that makes the claim; this creates a real reference and a backlink on the target card, and travels with the card to every whiteboard it appears on. Prefer citing sources this way over listing them at the end.

References live in card body text and travel with the card. Canvas relations
are visible arrows scoped to one whiteboard, are undirected, and require both
cards to already be placed there. Use `create_relation` for an on-canvas arrow;
use a markdown reference for an in-text citation.

## Recipes

### Create and place a card

```sh
curl -sS -X POST "http://127.0.0.1:${port}/api/v1/create_card" \
  -H 'content-type: application/json' \
  -d '{"text":"Project decision\nUse the HTTP agent server.","whiteboardId":"whiteboard-id"}'
```

Omit `x` and `y` unless the user gives a meaningful layout position.

### Find a card, then read it

```sh
curl -sS -X POST "http://127.0.0.1:${port}/api/v1/search_cards" \
  -H 'content-type: application/json' \
  -d '{"query":"HTTP agent server"}'
curl -sS -X POST "http://127.0.0.1:${port}/api/v1/get_card" \
  -H 'content-type: application/json' \
  -d '{"cardId":"card-id"}'
```

### Link two cards

Make sure both cards are on the same whiteboard, then call:

```sh
curl -sS -X POST "http://127.0.0.1:${port}/api/v1/create_relation" \
  -H 'content-type: application/json' \
  -d '{"whiteboardId":"whiteboard-id","sourceCardId":"card-a","targetCardId":"card-b"}'
```

### Walk a whiteboard's items

```sh
curl -sS -X POST "http://127.0.0.1:${port}/api/v1/list_board_items" \
  -H 'content-type: application/json' \
  -d '{"whiteboardId":"whiteboard-id"}'
```

Use the returned item ids and frames with `move_item` only when a purposeful
layout change is needed.

## Not covered

Workspace-specific conventions belong in the project's own `CLAUDE.md` or
`AGENTS.md`, not in this general ContextBoard API guide.
