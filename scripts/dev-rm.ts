/**
 * Throw away the local dev state: the mail container and its volume, and the
 * SQLite file. `bun run dev` then rebuilds both from scratch.
 *
 * ## Why this is a script and not two shell commands
 *
 * Deleting the database file while `bun run dev` is running does NOT give you a
 * clean database. On Linux the running server keeps the deleted inode open and
 * happily goes on reading and writing a file that no longer has a name, while
 * `bun run dev` recreates a different file at the same path. You then have two
 * databases: the one on disk that the seed filled, and the ghost one the API is
 * actually answering from. Everything looks seeded except the API, and the
 * numbers disagree with the file for as long as that process lives.
 *
 * That cost an hour of "why does the endpoint say zero clicks when the table has
 * 983", so the check is in the tool rather than in a README nobody reads.
 */

import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const DB = join(ROOT, "data/canireplaceit.db");

/** Anything still holding the database open, other than us. */
function holders(): string[] {
	const ps = Bun.spawnSync(["ps", "-eo", "pid,args"]);
	return ps.stdout
		.toString()
		.split("\n")
		.filter(
			(l) => /bun.*(src\/index\.ts|turbo run dev)/.test(l) && !/\[ps\]/.test(l),
		)
		.map((l) => l.trim());
}

const running = holders();
if (running.length > 0 && !process.argv.includes("--force")) {
	console.error(
		"The dev server is still running:\n" +
			running.map((l) => `  ${l}`).join("\n") +
			"\n\nStop it first (Ctrl-C in that terminal), then run this again.\n" +
			"Deleting the database under a live server leaves it reading the deleted\n" +
			"file, so the API and the file on disk disagree until it restarts.\n" +
			"Pass --force only if you are about to restart it anyway.",
	);
	process.exit(1);
}

const compose = Bun.spawnSync(["docker", "compose", "down", "-v"], {
	cwd: ROOT,
});
console.log(
	compose.success
		? "mail container and volume removed"
		: "docker compose down failed (carrying on)",
);

for (const suffix of ["", "-wal", "-shm"]) {
	const path = `${DB}${suffix}`;
	if (existsSync(path)) {
		rmSync(path);
		console.log(`removed ${path}`);
	}
}

console.log("\nclean. `bun run dev` will recreate and reseed.");
