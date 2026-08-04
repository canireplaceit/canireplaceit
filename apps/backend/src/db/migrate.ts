/**
 * Applies `drizzle/*.sql` to the SQLite file, creating it if it is not there.
 *
 * `drizzle-kit push` cannot be used: it needs a live connection to diff against,
 * and its only SQLite connectors are `better-sqlite3` and `@libsql/client` —
 * external native packages, which is exactly the setup friction dropping
 * Postgres was meant to remove. `drizzle-kit generate` needs no driver (it only
 * reads the schema file), so the split is: generate with drizzle-kit, apply with
 * Bun's own driver. Idempotent — already-applied migrations are skipped.
 *
 *   bun run db:generate   after changing schema.ts, commit the new SQL
 *   bun run db:push       apply whatever is pending
 *
 * This also runs at API boot. With a server database that would be reckless; with
 * a local file it costs microseconds when there is nothing to do, and it means
 * every entry point works on a fresh clone — `bun run dev`, running the backend
 * directly, or a test. Without it the schema only exists if someone remembered to
 * run a separate command first, and the failure is silent: the seed throws "no
 * such table" into a catch and the API serves an empty site.
 */

import { join } from "node:path";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { log } from "../log";
import { DB_PATH, db } from ".";

export function applyMigrations(): void {
	migrate(db, { migrationsFolder: join(import.meta.dir, "../../drizzle") });
}

// Running this file directly is the `db:push` path.
if (import.meta.main) {
	applyMigrations();
	log.info(`schema up to date: ${DB_PATH}`);
}
