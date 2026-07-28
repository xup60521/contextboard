import { join } from "node:path";
import { createSyncApp } from "./app";
import { createServerAuth, dataRoot } from "./configuration";
import { SyncStore } from "./store";

const store = new SyncStore(
	join(dataRoot, "sync.sqlite"),
	join(dataRoot, "blobs"),
);
const auth = createServerAuth();
const port = Number(process.env.PORT ?? 8788);
const app = createSyncApp(store, auth);

Bun.serve({
	hostname: process.env.HOST ?? "127.0.0.1",
	port,
	fetch: app.fetch,
});

console.log(JSON.stringify({ event: "sync_server_started", port }));
