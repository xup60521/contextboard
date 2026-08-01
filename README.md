# Contextboard

Contextboard is a local-first canvas workspace for rich-text cards and nested whiteboards. Data is stored in the browser with IndexedDB; no account, hosted database, or network connection is required.

## Repository

This is a Bun/Turborepo monorepo:

- `apps/web` — TanStack Start web application deployed to Cloudflare Workers.
- `apps/sync-server` — private Bun sync/auth service backed by SQLite and filesystem blobs.
- `packages/domain` — application-owned entities and integrity rules.
- `packages/local-db` — Dexie schema, workspace/device identity, and atomic change log.
- `packages/sync-protocol` — versioned transport-neutral sync contracts.
- `tools/convex-export` — transitional utility for exporting a previous Convex deployment.

## Development

Requirements: Bun 1.3.13 or newer.

```bash
bun install
```

Each app owns its own configuration. Copy the two examples to `.env.local`,
fill in the GitHub OAuth and Better Auth secrets, then start the stack:

```powershell
Copy-Item apps/sync-server/.env.example apps/sync-server/.env.local
Copy-Item apps/desktop/.env.example apps/desktop/.env.local
bun run dev
```

| Target | Configured by | Holds secrets |
| --- | --- | --- |
| Sync service | `apps/sync-server/.env.local`, `.env.production` | Yes — all of them |
| Cloudflare Worker | `apps/web/wrangler.jsonc` (`vars`, VPC and rate-limit bindings) | No |
| Desktop shell | `apps/desktop/.env.local` | No — inlined at build time |

The sync service owns Better Auth and the change log, so every secret lives
there. The Worker only proxies `/api/auth` and `/api/sync` to it and needs no
env file. The desktop shell needs one public URL.

`bun run dev` starts the complete local stack: the Web app on
`http://localhost:3000`, the Windows desktop app, and the sync service on
`http://127.0.0.1:8789`.

Use a narrower stack when needed:

```powershell
bun run dev:web      # Web + sync service
bun run dev:desktop  # Desktop + sync service
bun run dev:sync     # Sync service only
```

Useful commands:

```bash
bun run build
bun run test
bun run generate-routes
bun run --filter @contextboard/web preview
```

## Windows desktop shell

The Phase 7 desktop shell uses Tauri 2, React, and the shared
`packages/ui` application chrome. Install the Windows Tauri prerequisites
(Rust stable MSVC, Visual C++ Build Tools, a current Windows SDK, and
WebView2), then start the full local stack with:

```powershell
bun run dev
```

Turbo starts the Web app, sync service, and Tauri in parallel. Tauri then
starts and owns the desktop Vite server on `http://localhost:1420`; it also
stops that server when the native app exits. Use `bun run dev:desktop` when
you only need Desktop + sync.

The shell exposes only semantic Tauri commands: the renderer can issue domain
operations, never SQL or filesystem paths. Workspace data lives in SQLite plus
content-addressed blobs under the Tauri app data directory.

### Desktop sync

Desktop signs in through the browser rather than an embedded webview. Choosing
"Sign in with GitHub" opens the system browser at the Web app's `/desktop-auth`
page; after sign-in that page hands a one-time token back to a temporary
`127.0.0.1` listener, and the app exchanges it for a Better Auth bearer token
stored in Windows Credential Manager. Sync then runs the same push/pull/blob
coordinator the Web client uses, against the SQLite repository.

Both `/api/auth` and `/api/sync` are served by the sync service, not the Web
app; the Web origin is the public edge that proxies to it (`SYNC_VPS_URL` or the
VPC binding in `apps/web/wrangler.jsonc`). The desktop therefore points at the
Web origin, and CORS and trusted origins are configured on the sync service.
Because GitHub's OAuth callback resolves against `BETTER_AUTH_URL`, the Web app
must be running for desktop sign-in: use `bun run dev`, not `bun run dev:desktop`.

A device with no local data joins the workspace already on the account; a device
that already holds data remains attached to its current workspace. A migrated
workspace follows a server redirect and replays the canonical change log from
the beginning. Local data is never silently claimed by another account; an
unlinked non-empty workspace must be explicitly created or selected.

To merge an existing workspace safely, stop the sync service and clients, run a
dry run, then apply the migration. The command validates account membership,
device sequences, change IDs, and blobs, and creates a recoverable server
backup before applying:

```powershell
bun run --filter @contextboard/sync-server migrate:workspace -- `
  --source contextboard-desktop `
  --target <account-default-workspace-id> `
  --dry-run
bun run --filter @contextboard/sync-server migrate:workspace -- `
  --source contextboard-desktop `
  --target <account-default-workspace-id> `
  --apply
```

The desktop app keeps its native SQLite workspace and device identity during a
redirect, but resets its sync cursor so it cannot miss earlier changes in the
target workspace. Desktop does not use checkpoints: it replays the change log
from its persisted cursor.

Three settings must line up for this to work:

- `VITE_CONTEXTBOARD_SYNC_URL` in `apps/desktop/.env.local` — public origin the
  desktop signs in and syncs against (the Worker origin in production, not the
  private VPS).
- `CONTEXTBOARD_DESKTOP_ORIGINS` and `BETTER_AUTH_TRUSTED_ORIGINS` in
  `apps/sync-server/.env.*` — must include the desktop origin. That is
  `http://localhost:1420` in development and `http://tauri.localhost` for a
  packaged Windows build (`useHttpsScheme` defaults to false; the
  `tauri://localhost` form is macOS and Linux only).
- `CONTEXTBOARD_ALLOWED_EMAILS` in `apps/sync-server/.env.*` — a
  comma-separated list of exact, case-insensitive, verified email addresses
  allowed to sync. The sync service rejects startup when this list is missing
  or empty; changes take effect after restarting the service.
- `app.security.csp` in `apps/desktop/src-tauri/tauri.conf.json` — `connect-src`
  lists the sync origin explicitly. Add the production origin there before
  shipping a build, since CSP is enforced in a packaged build but not in dev.

Desktop authenticates by bearer token, so the service does not send
`Access-Control-Allow-Credentials` and the client omits cookies. Adding
credentials on one side without the other makes every response fail opaquely.

Build and test the native boundary with:

```powershell
bun run test:desktop
bun run build:desktop
```

## Local data and backups

Open `/data` to export a `.contextboard.zip` backup or import an existing backup. Import validates the archive and its relationships before replacing the current workspace. The importer also accepts Convex export ZIP files containing Contextboard tables.

Browser storage belongs to the current origin and browser profile. Clearing site data can erase the workspace, so keep external backups. Images are retained as IndexedDB blobs and native backups include those blobs by SHA-256.

To create a final raw export from a previous Convex deployment:

```bash
$env:CONVEX_DEPLOYMENT="your-deployment-name"
bun run export:convex -- snapshot.zip
```

The Convex CLI dependency is isolated inside the transitional export tool and is not part of the web runtime or build.

## Deployment

```bash
bun run deploy
```

The Cloudflare Worker serves the application and proxies auth/sync requests to
the private sync service through its configured VPC Service binding.

## Synchronization

IndexedDB remains authoritative. Local commands reserve workspace/device IDs, revisions, tombstones, hybrid logical clocks, and change batches. `packages/sync-protocol` defines push, pull, cursor, conflict, and blob contracts, while the current `LocalOnlyTransport` never performs network requests.

The self-hosted sync server stores its ordered change log and authentication
database in SQLite and content-addressed blobs on the filesystem.
