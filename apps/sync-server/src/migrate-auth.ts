import { migrateContextboardAuth } from "@contextboard/auth";
import { createServerAuth } from "./configuration";

const result = await migrateContextboardAuth(createServerAuth());
console.log(JSON.stringify({ event: "auth_migration_complete", ...result }));
