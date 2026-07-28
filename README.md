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

Copy `.env.example` to `.env.local` and fill in the GitHub OAuth and Better
Auth secrets, then start both services:

```powershell
Copy-Item .env.example .env.local
bun dev
```

The Web app listens on `http://localhost:3000`; the sync service listens on
`http://127.0.0.1:8788`. To run only one side, use `bun dev:web` or
`bun dev:sync`.

Useful commands:

```bash
bun run build
bun run test
bun run generate-routes
bun run --filter @contextboard/web preview
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
