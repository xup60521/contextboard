# ContextBoard performance and structural audit

Audit date: 2026-08-06
Audited commit: `a7192f51d02bf1ac964630f69684353d3cbcf20c`
Status labels: **CONFIRMED** means read directly in source; **SUSPECTED** means the failure mode is plausible but was not reproduced.

Two pre-existing uncommitted files were outside this audit and remediation scope and must not be overwritten: `apps/desktop/src-tauri/Cargo.toml` and `apps/web/src/routeTree.gen.ts`.

## Method and scope

The application lifecycles were read directly and then independently challenged in a second read-only Codex CLI pass using `gpt-5.6-luna` with xhigh reasoning. Corrections from that pass are incorporated here. The audit covers the React/tldraw UI, application services, IndexedDB repository, Rust/SQLite desktop repository, and change-log sync client. It does not deeply audit the Cloudflare Worker proxy, Better Auth, the agent CLI replica, or blob throughput.

ContextBoard is a local-first canvas workspace: TipTap markdown cards on tldraw whiteboards, persisted to Dexie/IndexedDB on web and Rust/SQLite on desktop behind `WorkspaceRepository`, with a Bun change-log sync server.

The central finding is that the application did not model *what* changed. A write notified every subscriber, subscribers re-read their full owned state, and the two-second sync timer could trigger the same cascade while idle. Canvas guards such as hydration suppression, measured-height tracking, echo suppression, and interaction suppression treated symptoms of this invalidation model. The dirty-content guard was not connected in production.

## Ranked findings

| ID | Finding | Impact | Status |
|---|---|---:|---|
| F0 | Idle web app rebuilt the board every two seconds | Critical | CONFIRMED |
| F1 | Every write notified every subscriber without scope | Critical | CONFIRMED |
| F2 | Board reload rebuilt and deep-compared the whole drawing | Critical | CONFIRMED |
| F3 | Relation reconciliation ran on every tldraw store change | High | CONFIRMED |
| F4 | The pending change log was fully read and revalidated per tick | High | CONFIRMED |
| F5 | Card save, detail, and search used whole-table scans | High | CONFIRMED |
| F6 | Each keystroke serialized, parsed, laid out, and transacted a full document | High | CONFIRMED |
| F7 | Hydration contained quadratic paths | Medium | CONFIRMED |
| F8 | `dirty-card-content` was dead at runtime | Medium / data loss | CONFIRMED |
| F9 | Child-whiteboard tiles always showed zero counts | Medium | CONFIRMED |
| F10 | Deleting the last record could resurrect a legacy snapshot | Medium / data loss | CONFIRMED |
| F11 | Remote apply held one long IndexedDB write transaction | Medium | CONFIRMED |
| F12 | Full card bodies lived in `shape.props.content` | Structural | CONFIRMED |
| F13 | Web and desktop merge semantics diverged | Data divergence | CONFIRMED |
| F14 | Camera movement performed two whole-board traversals | Low–Medium | CONFIRMED |
| F15 | Hydration suppression used a non-reference-counted boolean | Low | SUSPECTED |

## Findings

### F0 — idle board rebuild

`SyncCoordinator.#sync` transitioned through `syncing` and `idle` on every poll. The web runtime capability object depended on that state, so each transition recreated all service objects. `useWhiteboardData` depended on the canvas service identity and synchronously cleared its data on each recreated service. Item hydration then observed an empty item set while its drawing key still matched, deleted every managed shape, and recreated/hydrated them when the reload completed. Empty pulls also called remote apply, which emitted another unscoped repository notification.

This was the highest-leverage issue: an idle client performed a network pull, pending-log scan, remote-apply transaction, notification cascade, service churn, board teardown, and visible-card hydration every two seconds.

### F1/F2 — global invalidation and drawing reload

The repositories exposed one listener set for cards, canvas, and whiteboards. A card autosave therefore refreshed sidebar lists, card detail, card library, board items, and drawing state. A board refresh loaded both items and the tldraw document. Document reconstruction read all active canvas records; reconciliation validated and sorted them, then used `JSON.stringify` equality for every record. Concurrent loads had no ordering token, so stale requests could commit after newer ones.

### F3 — relation reconciliation

The card-relation hook listened to all user document changes without determining whether an arrow or binding was involved. Its 60 ms debounce was short enough to run between ordinary keystrokes. Each run walked page shapes and read whiteboards, cards, and relations. Text edits, drags, and ink therefore paid relation work even when no relation could change.

### F4 — monotonically growing pending-log work

The web pending-batch query ordered the entire change log, materialized it, parsed every row to detect a legacy format, and only then sliced to the requested limit. Offline use accumulated a row per autosave, making each two-second poll progressively more expensive. Desktop applied a SQL limit but lacked the matching `(workspace_id, valid, created_at, change_id)` index.

### F5/F7 — hot scans and quadratic hydration

Card content save loaded all file references, card references, and files. Card detail scoped the card itself but loaded all placements, references, and whiteboards. Search loaded complete card bodies only to discard them after deriving summaries. `hydrateCardShapes` scanned every shape for each card, `getManyDetails` filtered all items per card, and the IndexedDB ids path issued one `get` per id instead of `bulkGet`.

### F6/F12 — card content crossed the canvas boundary

The full TipTap document was stored as a serialized string in the tldraw shape. Each key generated editor JSON, stringified it into shape props, forced a height layout read, ran a tldraw transaction, stringified again for save comparison, and parsed it for rendering. Height changes also drove the separate frame-write stream.

Managed card shapes were correctly excluded from drawing persistence, so this did not create canvas-record storage bloat. Its costs were main-thread CPU and guard complexity: content filtering, deferred bindings, hydration echo/version state, a dirty registry, and measured-height coordination. The correct boundary is for tldraw to own geometry plus `cardId`, while the card store owns the TipTap body and drafts.

### F8 — dirty draft protection was disconnected

`useDebouncedCardSave` called an optional runtime UI callback, but neither composition root supplied that callback. The production dirty registry therefore stayed empty. Hydration could replace an unsaved draft, and blur during an in-flight save was protected only while the shape remained the active editing shape. Tests passed because they populated the registry directly.

### F9/F10 — isolated correctness defects

Child-board counts were derived from rows already scoped to the parent, so neither child items nor grandchildren could match. Separately, `getDocument` selected record storage only when active record rows existed; deleting the last record could cause fallback to an old legacy snapshot. A durable storage-mode marker is required because an empty record store is valid state.

### F11 — oversized remote transaction

All pulled batches were processed sequentially in a single IndexedDB write transaction. Whiteboard validation additionally loaded the whole whiteboard table inside that transaction. Large pulls blocked local writes for the entire duration. Applied-batch IDs make bounded chunks safe and idempotent.

### F13 — platform merge divergence

Web used revision conflict detection, deterministic conflict-copy cards, and hierarchy validation. Desktop used last-writer-wins HLC comparison and returned zero conflicts. The handwritten allowlists had drifted: Rust accepted `conflict` and `todo` while TypeScript rejected them; file defaults also used `pending` although the domain permits `active | pending_delete`. The SQLite EAV primary key makes point access reasonable; its practical penalty was repeated IPC and JSON conversion, not asymptotic point-query behavior.

### F14/F15 — camera and hydration coordination

Visible-content hydration reacted to culled shapes but also requested and sorted all page shapes, then repeated traversal in candidate collection. Camera work therefore scaled with total board size. Hydration suppression used a shared boolean cleared by independent timers, allowing one hydration path to unguard another; root-board managed-shape removal also wrote without the guard.

## Existing strengths to preserve

- Viewport-aware content batches of at most 30, versioned LRU caching, and in-flight deduplication.
- Pointer-interaction suppression, producing one frame write on release rather than one per drag frame.
- Exclusion of managed card shapes from drawing-record persistence.
- One-shot measured-height tracking with a deadband.
- Deferred editor mounting and static rendering for non-editing cards.

## Remediation order and measurement

1. Stop runtime identity churn and empty-pull application.
2. Add scoped notifications and independent, ordered item/document loaders.
3. Filter relation triggers, limit pending-log reads, and add typed indexed queries.
4. Remove quadratic hydration and bound remote transactions.
5. Establish one shared entity/merge protocol for web and desktop.
6. Move card bodies into a dedicated content entity through a two-release compatibility protocol.

Measurements are opt-in through `?perf=1` and exposed only in that mode as `window.__contextboardPerf`. The deterministic reference fixture contains 200 cards, 50 arrows, five child boards, representative TipTap documents, and an optional 10,000-row pending log. Acceptance scenarios are cold open, 60 seconds idle, continuous typing, panning, search, and a limited pending-log read. No diagnostic data is sent remotely or persisted.

## Source evidence from the audited commit

Finding IDs remain stable even when remediation moves the cited lines.

| Finding | Audited source locations |
|---|---|
| F0 | `packages/client-core/src/index.ts:311,358`; `apps/web/src/integrations/sync/provider.tsx:290-302`; `apps/web/src/integrations/application/WebApplicationRuntime.tsx:59`; `packages/web-ui/src/components/whiteboard/hooks/useWhiteboardData.ts:106,132,236`; `packages/web-ui/src/components/whiteboard/hooks/useItemsHydration.ts:17-28,68,106`; `packages/web-ui/src/components/whiteboard/hooks/useDrawingHydration.ts:69,284` |
| F1 | `packages/storage-indexeddb/src/index.ts:36-41`; `packages/storage-desktop/src/index.ts:66-73`; `apps/web/src/components/sidebar/SidebarTabsContext.tsx:121-147`; `packages/application/src/cards/repository-cards-service.ts:172-180` |
| F2 | `packages/web-ui/src/components/whiteboard/hooks/useWhiteboardData.ts:127`; `packages/application/src/canvas/services.ts:705-747`; `packages/web-ui/src/components/whiteboard/tldraw-persistence.ts:71-97,117-169` |
| F3 | `packages/web-ui/src/components/whiteboard/hooks/useCardRelationSync.ts:57-71`; `packages/application/src/canvas/derive/card-relations.ts:40-81`; `packages/application/src/relations/repository-card-relations-service.ts:196-285` |
| F4 | `packages/local-db/src/index.ts:297-314,506`; `apps/desktop/src-tauri/src/storage.rs:325-332,938-941` |
| F5 | `packages/application/src/cards/repository-cards-service.ts:196-224,317-321,501-512`; `packages/application/src/search/repository-search-service.ts:10-14`; `packages/storage-indexeddb/src/entity-store.ts:169-213` |
| F6 | `packages/editor/src/hooks/useRichTextEditorInstance.ts:89-91`; `packages/web-ui/src/components/whiteboard/hooks/useMarkdownCardAutoHeight.ts:43-54`; `packages/web-ui/src/components/cards/useDebouncedCardSave.ts:65-78`; `packages/web-ui/src/components/whiteboard/MarkdownCardShell.tsx:10-18`; `packages/web-ui/src/components/whiteboard/hooks/useResolvedCardContent.ts:57-71`; `packages/web-ui/src/components/whiteboard/hooks/useStoreListener.ts:105-164`; `packages/web-ui/src/components/whiteboard/hooks/useFrameSync.ts:101-118` |
| F7 | `packages/web-ui/src/components/whiteboard/whiteboard-canvas-helpers.ts:371-404`; `packages/application/src/cards/repository-cards-service.ts:244-261`; `packages/storage-indexeddb/src/entity-store.ts:238-247` |
| F8 | `packages/web-ui/src/components/cards/useDebouncedCardSave.ts:48-76`; `packages/application/src/runtime.ts:438-441`; `apps/web/src/integrations/application/WebApplicationRuntime.tsx:22-59`; `apps/desktop/src/runtime/DesktopApplicationRuntime.tsx:38-79`; `packages/web-ui/src/components/whiteboard/dirty-card-content.ts:13-24`; `packages/web-ui/src/components/whiteboard/PersistedMarkdownCardShape.tsx:54-56` |
| F9 | `packages/application/src/canvas/services.ts:439`; `packages/application/src/canvas/derive/counts.ts:26-37` |
| F10 | `packages/storage-indexeddb/src/entity-store.ts:238-254`; `packages/application/src/canvas/services.ts:713-747` |
| F11 | `packages/local-db/src/index.ts:546-618` |
| F12 | `packages/web-ui/src/components/whiteboard/MarkdownCardShapeTypes.ts:12-24`; `packages/web-ui/src/components/whiteboard/hooks/useStoreListener.ts:133-164`; `packages/web-ui/src/components/whiteboard/tldraw-persistence.ts:198-210` |
| F13 | `packages/local-db/src/index.ts:538`; `apps/desktop/src-tauri/src/storage.rs:15-27,161-166,350,415,938-945,1127-1164`; `packages/storage-indexeddb/src/entity-store.ts:103,287-304` |
| F14 | `packages/web-ui/src/components/whiteboard/hooks/useVisibleCardContentHydration.ts:249` |
| F15 | `packages/web-ui/src/components/whiteboard/hooks/useDrawingHydration.ts:111-123`; `packages/web-ui/src/components/whiteboard/hooks/useItemsHydration.ts:103-157`; `packages/web-ui/src/components/whiteboard/hooks/useStoreListener.ts:62-71` |
