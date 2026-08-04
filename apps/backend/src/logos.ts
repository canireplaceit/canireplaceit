// Sponsor icon upload/serve endpoint, stored next to the database in `data/`. This is an unauthenticated upload surface
// (the creative is filled in before any order exists), so nothing here trusts the request: file type is sniffed from
// magic bytes rather than filename/Content-Type, SVG is refused (would run as same-origin stored XSS), the stored
// filename is server-generated, and unclaimed uploads are pruned (see pruneOrphanLogos).

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { DB_PATH } from "./db";

/** Beside the database, so one volume covers both. */
export const LOGO_DIR = join(DB_PATH, "..", "sponsor-logos");
mkdirSync(LOGO_DIR, { recursive: true });

/** 512 KB. An icon rendered at 40px has no honest reason to be larger. */
export const MAX_LOGO_BYTES = 512 * 1024;

// Magic numbers for accepted formats. SVG is deliberately absent (see file header). GIF is absent by choice — no animated ad units.
const SIGNATURES: {
	ext: string;
	mime: string;
	test: (b: Uint8Array) => boolean;
}[] = [
	{
		ext: "png",
		mime: "image/png",
		test: (b) =>
			b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
	},
	{
		ext: "jpg",
		mime: "image/jpeg",
		test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
	},
	{
		ext: "webp",
		mime: "image/webp",
		// "RIFF" ... "WEBP"
		test: (b) =>
			b[0] === 0x52 &&
			b[1] === 0x49 &&
			b[2] === 0x46 &&
			b[3] === 0x46 &&
			b[8] === 0x57 &&
			b[9] === 0x45 &&
			b[10] === 0x42 &&
			b[11] === 0x50,
	},
];

export type StoredLogo = { url: string; bytes: number; mime: string };

export type LogoError = "too-large" | "unsupported-type" | "empty";

/** Writes an uploaded icon and returns the URL to store on the purchase. Returns an error code rather than throwing, since the buyer can fix any of these. */
export async function storeLogo(
	file: File,
): Promise<StoredLogo | { error: LogoError }> {
	if (file.size === 0) return { error: "empty" };
	// Checked before reading the body, so a lying client can't make us buffer more than this.
	if (file.size > MAX_LOGO_BYTES) return { error: "too-large" };

	const bytes = new Uint8Array(await file.arrayBuffer());
	if (bytes.byteLength === 0) return { error: "empty" };
	if (bytes.byteLength > MAX_LOGO_BYTES) return { error: "too-large" };

	const kind = SIGNATURES.find((s) => s.test(bytes));
	if (!kind) return { error: "unsupported-type" };

	// Server-generated name only — nothing from the request reaches the filesystem path.
	const name = `${randomUUID()}.${kind.ext}`;
	await Bun.write(join(LOGO_DIR, name), bytes);

	return {
		url: `/api/sponsor-logos/${name}`,
		bytes: bytes.byteLength,
		mime: kind.mime,
	};
}

/** `logo.png` → the file, or null. Anything that is not a name we minted is null. */
export function readLogo(name: string): { path: string; mime: string } | null {
	// Matches the whole `<uuid>.<ext>` shape rather than stripping "../", so traversal is unrepresentable, not just blocked.
	const m = /^([0-9a-f-]{36})\.(png|jpg|webp)$/.exec(name);
	if (!m) return null;
	const kind = SIGNATURES.find((s) => s.ext === m[2]);
	if (!kind) return null;
	return { path: join(LOGO_DIR, name), mime: kind.mime };
}

// A day: long enough to outlast picking an icon and paying, short enough that unclaimed uploads don't accumulate.
export const ORPHAN_TTL_MS = 24 * 60 * 60 * 1000;

// Deletes stored icons older than ORPHAN_TTL_MS that no purchase references. Run from the upload path (not a schedule),
// same pattern as auth.ts pruning magic links on the way past. `keep` is filenames, not URLs.
export async function pruneOrphanLogos(keep: Set<string>): Promise<number> {
	const cutoff = Date.now() - ORPHAN_TTL_MS;
	let removed = 0;
	for (const name of await readdir(LOGO_DIR)) {
		if (keep.has(name)) continue;
		// mtime is the age: these files are written once and never touched again.
		const s = await stat(join(LOGO_DIR, name)).catch(() => null);
		if (!s?.isFile() || s.mtimeMs > cutoff) continue;
		await rm(join(LOGO_DIR, name), { force: true });
		removed++;
	}
	return removed;
}

/** `#rrggbb`, lowercased, or null. Anything else is dropped rather than stored. */
export function normalizeTint(v: unknown): string | null {
	if (typeof v !== "string") return null;
	const s = v.trim().toLowerCase();
	return /^#[0-9a-f]{6}$/.test(s) ? s : null;
}
