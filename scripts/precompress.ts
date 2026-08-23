/**
 * Write `.br` and `.gz` twins beside the hashed bundles in `dist/static`, for
 * the `brotli_static` and `gzip_static` in apps/frontend/front.conf to serve.
 *
 * ## Why only dist/static
 *
 * Everything else the site serves is compressed per request, by the frontend
 * nginx, at brotli 6. Precompressing the rest is a real gain that is not this
 * script's to take. Measured over 120 random pages and Markdown twins, quality
 * 11 is another 10.8% under what the filter produces on the same bytes — but
 * `en/` and `fr/` are 1.27 GB, brotli 11 runs at 0.96 MiB/s, so that is 23
 * CPU-minutes per build and 170 MB added to an image that gets pushed and
 * pulled on every deploy. Quality 10 is 9.1% for 6.5 CPU-minutes and the same
 * 170 MB. This repo runs slimtoolkit over that image on every build precisely
 * to keep it small, so the size is the owner's call to make, not a side effect
 * of a compression script. Nothing here would need to change to take it:
 * `brotli_static` is already on and would find the twins.
 *
 * dist/static is the trade this script does take. It is five files and 1.35 MB,
 * it takes 1.7 seconds of a 42-second build, the filenames carry a content hash
 * so a twin can never go stale against its original, and every visitor
 * downloads all of them on a cold start. At quality 11 the main bundle lands at
 * 95,258 bytes where the filter's quality 6 leaves it at 106,000.
 *
 * `gzip_static on` has been in front.conf for a while with nothing writing a
 * `.gz` for it to find, so the gzip half of this is that directive becoming
 * true rather than a new one.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const DIR = join(import.meta.dir, "../apps/frontend/dist/static");
/** Fonts are already compressed; a second pass on woff2 only adds bytes. */
const COMPRESSIBLE = /\.(js|css|mjs|json|svg|txt|map)$/;
/** The same floor as `gzip_min_length`: under it the headers cost more than the body saves. */
const MIN_LENGTH = 256;

function* walk(dir: string): Generator<string> {
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) yield* walk(path);
		else yield path;
	}
}

let files = 0;
let raw = 0;
let br = 0;
let gz = 0;

for (const path of walk(DIR)) {
	if (!COMPRESSIBLE.test(path)) continue;
	const body = readFileSync(path);
	if (body.length < MIN_LENGTH) continue;

	const brotli = brotliCompressSync(body, {
		params: {
			[constants.BROTLI_PARAM_QUALITY]: 11,
			[constants.BROTLI_PARAM_SIZE_HINT]: body.length,
		},
	});
	const gzip = gzipSync(body, { level: 9 });

	// nginx serves the twin whenever it exists, so a twin that came out bigger
	// than its original would be a permanent, silent regression on that URL.
	if (brotli.length < body.length) writeFileSync(`${path}.br`, brotli);
	if (gzip.length < body.length) writeFileSync(`${path}.gz`, gzip);

	files += 1;
	raw += body.length;
	br += brotli.length;
	gz += gzip.length;
}

const kb = (n: number) => `${(n / 1024).toFixed(0)} kB`;
console.log(
	`precompressed ${files} files: ${kb(raw)} → ${kb(br)} brotli, ${kb(gz)} gzip`,
);
