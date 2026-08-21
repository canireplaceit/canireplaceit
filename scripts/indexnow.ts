/**
 * Tell Bing, Yandex and Seznam what changed, right after a deploy.
 *
 * IndexNow is one POST. It matters more than it used to because Bing's index is
 * what Copilot answers from, and waiting for a crawl to notice a price change
 * means the wrong price is quoted for a week.
 *
 * Submits the index pages every time, since their contents shift on every
 * deploy, plus the specific product and project pages whose data files changed
 * in this release. Submitting the whole sitemap on every deploy is how a site
 * gets its IndexNow submissions ignored.
 *
 * Never fails a deploy. A search engine not hearing about a release is a worse
 * outcome than nothing, but it is not worth rolling back for.
 *
 *   bun scripts/indexnow.ts [since-git-ref]
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SupportedLangs } from "core/src/index";
import { paths } from "core/src/routes";

const ROOT = join(import.meta.dir, "..");
const HOST = process.env.SITE_DOMAIN ?? "canireplaceit.com";
const SITE = `https://${HOST}`;
const ENDPOINT = "https://api.indexnow.org/indexnow";

const key = readFileSync(
	join(ROOT, "apps/frontend/public/indexnow-key.txt"),
	"utf8",
).trim();

/** Files changed since a ref, or null when this checkout has no history to read. */
function changedSince(ref: string): string[] | null {
	const proc = Bun.spawnSync(
		["git", "diff", "--name-only", `${ref}..HEAD`, "--", "data/"],
		{ cwd: ROOT },
	);
	if (proc.exitCode !== 0) return null;
	return proc.stdout
		.toString()
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
}

const urls = new Set<string>();

// The pages whose contents move on every deploy, in both locales.
for (const lang of SupportedLangs) {
	urls.add(`${SITE}${paths.home(lang)}`);
	urls.add(`${SITE}${paths.projects(lang)}`);
	urls.add(`${SITE}${paths.categories(lang)}`);
	urls.add(`${SITE}${paths.collections(lang)}`);
	urls.add(`${SITE}${paths.gaps(lang)}`);
	urls.add(`${SITE}${paths.stats(lang)}`);
}

const since = process.argv[2] ?? "HEAD~1";
const changed = changedSince(since);

if (changed === null) {
	console.log(
		`indexnow: no git history back to ${since}, submitting index pages only`,
	);
} else {
	for (const file of changed) {
		const product = file.match(/^data\/products\/(.+)\.json$/);
		if (!product) continue;
		for (const lang of SupportedLangs) {
			urls.add(`${SITE}${paths.product(lang, product[1])}`);
		}
	}
	console.log(`indexnow: ${changed.length} data files changed since ${since}`);
}

const urlList = [...urls];

if (!process.env.INDEXNOW_ENABLED) {
	console.log(
		`indexnow: INDEXNOW_ENABLED unset, would have submitted ${urlList.length} urls`,
	);
	for (const url of urlList.slice(0, 5)) console.log(`  ${url}`);
	process.exit(0);
}

const res = await fetch(ENDPOINT, {
	method: "POST",
	headers: { "content-type": "application/json; charset=utf-8" },
	body: JSON.stringify({
		host: HOST,
		key,
		keyLocation: `${SITE}/indexnow-key.txt`,
		urlList,
	}),
}).catch((err: unknown) => {
	console.warn("indexnow: request failed", err);
	return null;
});

// 200 accepted, 202 accepted but the key is still being verified. Anything else
// is worth reading in the deploy log, and worth ignoring otherwise.
console.log(
	res
		? `indexnow: ${res.status} for ${urlList.length} urls`
		: "indexnow: skipped",
);
