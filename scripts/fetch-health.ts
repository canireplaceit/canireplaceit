#!/usr/bin/env bun
/**
 * Project health, fetched from the forges into `data/health.json`.
 *
 * Kept OUT of the product files on purpose: last-commit dates go stale the
 * moment they are written down, so hand-maintaining them guarantees the site
 * lies. This regenerates weekly from .github/workflows/health.yml — nobody is
 * expected to remember to run it, and the UI hides these readings entirely once
 * the file is more than a month old, so a broken workflow degrades to silence
 * rather than to a confident wrong date.
 *
 *   bun run health            # only repos with no reading yet (resumable)
 *   REFRESH=1 bun run health  # re-read everything
 *   ONLY=gitlab,gitea bun run health
 *
 * SIX FORGES, and they do not answer the same questions:
 *
 *   github                       api.github.com/repos/{path}
 *   gitea/forgejo/codeberg       {origin}/api/v1/repos/{path}
 *   gitlab (incl. self-hosted)   {origin}/api/v4/projects/{urlencoded path}
 *   bitbucket server             {origin}/rest/api/1.0/projects/{P}/repos/{r}
 *   savannah                     nothing — no API, recorded as unsupported
 *
 * Whatever a forge will not tell us is LEFT OUT of that repo's entry rather
 * than defaulted. GitLab unauthenticated returns a 20-field subset with no
 * `archived`; Bitbucket Server has no language and no homepage. A missing field
 * reads as "we do not know" everywhere downstream — see `Health` in core.
 *
 * Auth: GITHUB_TOKEN if set, otherwise `gh auth token`. Unauthenticated GitHub
 * allows 60 requests/hour, which is not enough for this dataset. The other
 * forges are read unauthenticated and politely; set GITLAB_TOKEN to also get
 * `archived` out of gitlab.com, which is the one fact its public API withholds.
 *
 * It also cross-checks the licence we claim against the one GitHub reports and
 * flags archived repos — that is how you catch a project dying without anyone
 * noticing, which has already happened twice in this dataset (MinIO,
 * Sourcegraph) and is true of grafana/oncall right now.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type Forge,
	type Health,
	type HealthFile,
	healthKey,
	type OssAlternative,
	type Product,
	type Source,
} from "core/src/content";

const ROOT = join(import.meta.dir, "..");
const DATA = join(ROOT, "data");
const OUT = join(DATA, "health.json");

export type { Health };

const COMPOSE_FILES = new Set([
	"docker-compose.yml",
	"docker-compose.yaml",
	"compose.yml",
	"compose.yaml",
]);

const isCompose = (name: string) => COMPOSE_FILES.has(name.toLowerCase());

/** ISO instant or epoch ms -> YYYY-MM-DD, or undefined if the forge sent junk. */
const day = (raw: unknown): string | undefined => {
	if (typeof raw !== "string" && typeof raw !== "number") return undefined;
	const ms = typeof raw === "number" ? raw : Date.parse(raw);
	return Number.isFinite(ms)
		? new Date(ms).toISOString().slice(0, 10)
		: undefined;
};

/**
 * The homepage as the forge stores it, which is whatever the maintainer typed
 * into a text box: plenty are bare hostnames, a few are empty strings, and one
 * page cannot render `www.example.com` as a working href. Anything that is not
 * a URL after that is dropped rather than guessed at.
 */
function homepage(raw: string | null | undefined): string | null {
	const value = raw?.trim();
	if (!value) return null;
	const url = /^https?:\/\//i.test(value) ? value : `https://${value}`;
	try {
		return new URL(url).hostname.includes(".") ? url : null;
	} catch {
		return null;
	}
}

async function ghToken(): Promise<string | undefined> {
	if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
	try {
		const proc = Bun.spawn(["gh", "auth", "token"], {
			stdout: "pipe",
			stderr: "ignore",
		});
		const out = (await new Response(proc.stdout).text()).trim();
		return out || undefined;
	} catch {
		return undefined;
	}
}

const products: Product[] = readdirSync(join(DATA, "products"))
	.filter((f) => f.endsWith(".json"))
	.map(
		(f) =>
			JSON.parse(readFileSync(join(DATA, "products", f), "utf8")) as Product,
	);

/** key -> the source plus the products citing it, so a mismatch reports usefully. */
type Cited = { source: Source; cites: { product: string; license: string }[] };
const repos = new Map<string, Cited>();
for (const p of products) {
	for (const a of p.alternatives) {
		if (a.kind !== "oss") continue;
		const alt = a as OssAlternative;
		const key = healthKey(alt.source);
		const entry = repos.get(key) ?? { source: alt.source, cites: [] };
		entry.cites.push({ product: p.slug, license: alt.license });
		repos.set(key, entry);
	}
}

const auth = await ghToken();
if (!auth) {
	console.warn(
		"No GITHUB_TOKEN and `gh auth token` failed — 60 req/hour will not be enough.",
	);
}

const ghHeaders: Record<string, string> = {
	accept: "application/vnd.github+json",
	"user-agent": "canireplaceit-health",
};
if (auth) ghHeaders.authorization = `Bearer ${auth}`;

const forgeHeaders: Record<string, string> = {
	accept: "application/json",
	"user-agent": "canireplaceit-health",
};

/**
 * The remaining GitHub budget as the LAST REAL RESPONSE reported it. Not from
 * /rate_limit, which has been seen claiming 5000 remaining while every actual
 * call was being rejected; the header on a request that did work is the only
 * truth, and two calls per repo across 869 repos is most of an hour's budget.
 */
let ghRemaining: number | null = null;

const get = (url: string, headers: Record<string, string>) =>
	fetch(url, { headers, signal: AbortSignal.timeout(20_000) });

/** Thrown for a repo the forge says does not exist — distinct from a failure. */
const GONE = Symbol("gone");
/** Thrown for a forge we have no way to query at all. */
const UNSUPPORTED = Symbol("unsupported");

async function readGithub(source: Source): Promise<Health> {
	const res = await get(
		`https://api.github.com/repos/${source.path}`,
		ghHeaders,
	);
	const left = res.headers.get("x-ratelimit-remaining");
	if (left !== null) ghRemaining = Number(left);
	if (res.status === 404) throw GONE;
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const r = (await res.json()) as {
		pushed_at: string;
		archived: boolean;
		license: { spdx_id: string } | null;
		language: string | null;
		homepage: string | null;
	};

	// Best-effort, and deliberately not fatal: a repo whose contents listing
	// fails still has a perfectly good liveness reading.
	let hasCompose: boolean | undefined;
	try {
		const tree = await get(
			`https://api.github.com/repos/${source.path}/contents/`,
			ghHeaders,
		);
		if (tree.ok) {
			const entries = (await tree.json()) as { name: string; type: string }[];
			hasCompose = entries.some((e) => e.type === "file" && isCompose(e.name));
		}
	} catch {}

	return {
		lastPush: day(r.pushed_at),
		archived: r.archived,
		license: r.license?.spdx_id ?? null,
		...(hasCompose === undefined ? {} : { hasCompose }),
		language: r.language,
		homepage: homepage(r.homepage),
	};
}

/** Gitea, and the two things built on it: Forgejo and Codeberg. */
async function readGitea(source: Source): Promise<Health> {
	const origin = new URL(source.url).origin;
	const res = await get(`${origin}/api/v1/repos/${source.path}`, forgeHeaders);
	if (res.status === 404) throw GONE;
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const r = (await res.json()) as {
		updated_at: string;
		archived: boolean;
		language: string | null;
		website: string | null;
	};

	let hasCompose: boolean | undefined;
	try {
		const tree = await get(
			`${origin}/api/v1/repos/${source.path}/contents/`,
			forgeHeaders,
		);
		if (tree.ok) {
			const entries = (await tree.json()) as { name: string; type: string }[];
			hasCompose = entries.some((e) => e.type === "file" && isCompose(e.name));
		}
	} catch {}

	return {
		lastPush: day(r.updated_at),
		archived: r.archived,
		...(hasCompose === undefined ? {} : { hasCompose }),
		language: r.language || null,
		homepage: homepage(r.website),
	};
}

/**
 * GitLab, gitlab.com and self-hosted alike (invent.kde.org, gitlab.gnome.org,
 * gitlab.isc.org, code.castopod.org, …).
 *
 * Unauthenticated it answers with a 20-field subset carrying no `archived`, no
 * language and no homepage — checked against projects that ARE archived, which
 * still do not carry the flag. So GitLab contributes a liveness date and a
 * compose check, and `archived` is left absent rather than written as false.
 * GITLAB_TOKEN, when set, is sent to gitlab.com only and recovers it there.
 */
async function readGitlab(source: Source): Promise<Health> {
	const origin = new URL(source.url).origin;
	const id = encodeURIComponent(source.path);
	const headers = { ...forgeHeaders };
	if (process.env.GITLAB_TOKEN && origin === "https://gitlab.com") {
		headers.authorization = `Bearer ${process.env.GITLAB_TOKEN}`;
	}
	const res = await get(`${origin}/api/v4/projects/${id}`, headers);
	if (res.status === 404) throw GONE;
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const r = (await res.json()) as {
		last_activity_at: string;
		archived?: boolean;
	};

	let hasCompose: boolean | undefined;
	try {
		const tree = await get(
			`${origin}/api/v4/projects/${id}/repository/tree?per_page=100`,
			headers,
		);
		if (tree.ok) {
			const entries = (await tree.json()) as { name: string; type: string }[];
			hasCompose = entries.some((e) => e.type === "blob" && isCompose(e.name));
		}
	} catch {}

	return {
		lastPush: day(r.last_activity_at),
		...(typeof r.archived === "boolean" ? { archived: r.archived } : {}),
		...(hasCompose === undefined ? {} : { hasCompose }),
	};
}

/**
 * Bitbucket Server / Data Center — one entry in this catalogue, Zabbix's own
 * `git.zabbix.com`. The repo endpoint carries no dates at all, so the liveness
 * date comes from the newest commit on the default branch. There is no archived
 * flag, no language and no website in this API; all three stay absent. Bitbucket
 * Cloud is a different API and is not in the dataset.
 */
async function readBitbucket(source: Source): Promise<Health> {
	const origin = new URL(source.url).origin;
	const [project, repo] = source.path.split("/");
	if (!project || !repo) throw UNSUPPORTED;
	const base = `${origin}/rest/api/1.0/projects/${project.toUpperCase()}/repos/${repo}`;
	const res = await get(base, forgeHeaders);
	if (res.status === 404) throw GONE;
	if (!res.ok) throw new Error(`HTTP ${res.status}`);

	const commits = await get(`${base}/commits?limit=1`, forgeHeaders);
	if (!commits.ok) throw new Error(`HTTP ${commits.status} (commits)`);
	const c = (await commits.json()) as {
		values?: { authorTimestamp?: number; committerTimestamp?: number }[];
	};
	const first = c.values?.[0];
	const lastPush = day(first?.committerTimestamp ?? first?.authorTimestamp);
	if (!lastPush) throw new Error("no commit timestamp");
	return { lastPush };
}

/**
 * Savannah — and sourcehut, if one ever lands here — publishes no JSON API
 * worth asking: its project pages are server-rendered HTML with no stable
 * machine-readable liveness anywhere on them. Rather than scrape a page that
 * will change shape without warning, those are recorded as unsupported and the
 * UI shows nothing for them, which is the honest outcome.
 */
const READERS: Partial<Record<Forge, (s: Source) => Promise<Health>>> = {
	github: readGithub,
	gitea: readGitea,
	forgejo: readGitea,
	codeberg: readGitea,
	gitlab: readGitlab,
	bitbucket: readBitbucket,
};

const existing: Record<string, Health> = (() => {
	try {
		return JSON.parse(readFileSync(OUT, "utf8")).repos ?? {};
	} catch {
		return {};
	}
})();

const health: Record<string, Health> = { ...existing };
const archived: string[] = [];
const gone: string[] = [];
const unsupported: string[] = [];
const failed: string[] = [];
const licenseDrift: string[] = [];

const only = process.env.ONLY?.split(",").map((s) => s.trim());
const all = [...repos.keys()]
	.filter((k) => !only || only.includes(repos.get(k)?.source.host as string))
	.sort();
const list = process.env.REFRESH ? all : all.filter((r) => !existing[r]);
const byForge = new Map<Forge, number>();
for (const k of list) {
	const host = repos.get(k)?.source.host as Forge;
	byForge.set(host, (byForge.get(host) ?? 0) + 1);
}
console.log(
	`${all.length} repositories, ${all.length - list.length} already known — checking ${list.length}` +
		(list.length
			? ` (${[...byForge].map(([h, n]) => `${h} ${n}`).join(", ")})…`
			: "…"),
);

const CONCURRENCY = 4;
const PAUSE_MS = 700;
/**
 * Stop before the budget is gone rather than after. The resumable path is what
 * makes a stopped run harmless — an all-or-nothing sweep once replaced a good
 * dataset with nothing, and it does not get to happen twice.
 */
const GH_FLOOR = 50;
let budgetStop = false;

for (let i = 0; i < list.length; i += CONCURRENCY) {
	if (budgetStop) break;
	if (i) await Bun.sleep(PAUSE_MS);
	await Promise.all(
		list.slice(i, i + CONCURRENCY).map(async (key) => {
			const cited = repos.get(key);
			if (!cited) return;
			const source = cited.source;
			const read = READERS[source.host];
			if (!read) {
				unsupported.push(key);
				return;
			}
			try {
				const h = await read(source);
				health[key] = h;
				if (h.archived) archived.push(key);

				if (source.host === "github") {
					const claimed = cited.cites[0]?.license;
					const actual = h.license;
					if (
						actual &&
						actual !== "NOASSERTION" &&
						claimed &&
						!claimed.startsWith(actual)
					) {
						licenseDrift.push(
							`${key}: we say ${claimed}, GitHub says ${actual}`,
						);
					}
				}
			} catch (e) {
				if (e === GONE) {
					gone.push(key);
					return;
				}
				if (e === UNSUPPORTED) {
					unsupported.push(key);
					return;
				}
				// The previous reading is kept, never blanked: a stale number that the
				// UI can date beats a hole punched by one flaky request.
				if (existing[key]) health[key] = existing[key];
				failed.push(key);
				console.warn(`  ! ${key}: ${(e as Error).message}`);
			}
		}),
	);
	if (ghRemaining !== null && ghRemaining < GH_FLOOR) {
		budgetStop = true;
		console.warn(
			`\nGitHub budget down to ${ghRemaining} — stopping here. Everything read so far is written; re-run to continue.`,
		);
	}
}

const file: HealthFile = {
	fetchedAt: new Date().toISOString().slice(0, 10),
	repos: Object.fromEntries(
		Object.keys(health)
			.sort()
			.map((k) => [k, health[k] as Health]),
	),
};
writeFileSync(OUT, `${JSON.stringify(file, null, "\t")}\n`);
console.log(
	`\nWrote ${Object.keys(health).length} entries to data/health.json`,
);

const STALE_DAYS = 365;
const stale = Object.entries(health)
	.filter(
		([, h]) =>
			h.lastPush !== undefined &&
			Date.now() - Date.parse(h.lastPush) > STALE_DAYS * 86_400_000,
	)
	.map(([repo, h]) => `${repo} (last activity ${h.lastPush})`);

const citedBy = (key: string) =>
	repos
		.get(key)
		?.cites.map((x) => x.product)
		.join(", ");

if (archived.length) {
	console.log(`\nARCHIVED — these should be replaced or removed:`);
	for (const r of archived) console.log(`  - ${r} (cited by ${citedBy(r)})`);
}
if (gone.length) {
	console.log(`\n404 — repo moved or deleted:`);
	for (const r of gone) console.log(`  - ${r} (cited by ${citedBy(r)})`);
}
if (unsupported.length) {
	console.log(`\nNo API to ask — these render no readings at all:`);
	for (const r of unsupported) console.log(`  - ${r}`);
}
if (stale.length) {
	console.log(`\nNo activity in ${STALE_DAYS} days:`);
	for (const r of stale) console.log(`  - ${r}`);
}
if (licenseDrift.length) {
	console.log(`\nLicence disagreement:`);
	for (const r of licenseDrift) console.log(`  - ${r}`);
}
if (failed.length) {
	console.log(
		`\n${failed.length} repo(s) could not be read this run; their previous readings were kept. Re-run to retry.`,
	);
}
if (archived.length || gone.length) {
	console.log(`\n${archived.length + gone.length} repo(s) need attention.`);
}
