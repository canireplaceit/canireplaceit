/**
 * SQLite, via Bun's built-in driver. One file, no service: a fresh clone runs
 * `bun run dev` and gets a working database with no Docker and nothing to start.
 *
 * The three pragmas below are not optional:
 *   journal_mode = WAL   readers do not block the writer, so a vote arriving
 *                        during the nightly rebuild's read does not fail
 *   busy_timeout         wait for a held write lock instead of throwing
 *                        SQLITE_BUSY immediately
 *   foreign_keys = ON    off by default in SQLite; the sponsorClicks →
 *                        sponsorPurchases cascade depends on it
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { env } from "../env";
import * as schema from "./schema";

/** Repo-root `data/canireplaceit.db` unless DATABASE_URL names another file. */
export const DB_PATH =
	env.databaseUrl ??
	join(import.meta.dir, "../../../..", "data/canireplaceit.db");

// Every clone from before the SQLite move has a postgres:// URL in its gitignored
// .env. Left alone that becomes a file with a very strange name, so say so instead.
if (/^[a-z+]+:\/\//i.test(DB_PATH)) {
	throw new Error(
		`DATABASE_URL must be a file path, got "${DB_PATH}". This project uses SQLite — drop the line from .env to use the default.`,
	);
}

mkdirSync(dirname(DB_PATH), { recursive: true });

export const sqlite = new Database(DB_PATH, { create: true });
sqlite.exec("PRAGMA journal_mode = WAL");
sqlite.exec("PRAGMA busy_timeout = 5000");
sqlite.exec("PRAGMA foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export { schema };
