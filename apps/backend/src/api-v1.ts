/**
 * The public API, versioned and meant for agents.
 *
 * Two rules hold the whole thing together.
 *
 * Every object carries `url` and `api`. `url` is the page a reader lands on and
 * is the only thing this site gets back for answering the question, so nothing
 * ships without one. `api` is the same record's own route, so a caller walks
 * the catalogue by following links instead of guessing how routes are spelled.
 *
 * Nothing here is authored. Products and categories are read from git at boot
 * by ./content, projects are derived from the products, and health and features
 * are read lazily from their generated files. A field that is absent is absent
 * on purpose: `null` means nobody has established it, never zero.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	bestOpenness,
	byWeight,
	COLLECTIONS,
	collectionBySlug,
	collectionMembers,
	easiestEffort,
	openness,
} from "core/src/collections";
import {
	type Alternative,
	CATEGORY_GROUPS,
	type Category,
	type CategoryGroup,
	classifyLicense,
	collectProjects,
	type Health,
	type HealthFile,
	healthKey,
	type OssAlternative,
	type Product,
	type Project,
	projectSlug,
	rungOf,
	type Source,
} from "core/src/content";
import {
	DEFAULT_LANG,
	isLang,
	type Lang,
	resolveTranslation,
	type Translations,
} from "core/src/index";
import { buildProjectSlugs, paths } from "core/src/routes";
import { Elysia } from "elysia";
import { rateLimit } from "elysia-rate-limit";
import { content } from "./content";
import { projectCounts, voteCounts } from "./counts";
import { env } from "./env";
import { log } from "./log";

/** Requests per minute per IP. Published in the discovery doc so a caller can pace itself. */
const RATE_MAX = 60;
const RATE_WINDOW_MS = 60_000;

/** Default page size, and the ceiling a caller can ask for. */
const LIMIT_DEFAULT = 10;
const LIMIT_MAX = 50;

const LICENSE = "CC-BY-4.0. Attribution required: link the `url` field.";

const SITE = env.webOrigin;
const API = `${SITE}/api/v1`;

const pageUrl = (path: string) => `${SITE}${path}`;
const apiUrl = (...parts: string[]) => `${API}/${parts.join("/")}`;

/** The five characters that would otherwise end the document early. */
const xml = (s: string) =>
	s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");

/** A translated string in the requested locale, or null when the field is absent. */
const tr = (v: Translations | undefined | null, lang: Lang): string | null =>
	v ? resolveTranslation(v, lang) : null;

/* ------------------------------------------------------------------ */
/* Derived once at boot. The catalogue only changes on deploy.         */
/* ------------------------------------------------------------------ */

const projects = collectProjects(content.products);

/**
 * Forge id to the slug the site actually puts in a URL.
 *
 * A Project carries `github-appflowy-io-appflowy`, but its page is at
 * `/en/tools/appflowy`. Built exactly as scripts/prerender.ts builds it, with
 * the product slugs passed in, because the two must agree: a `url` field that
 * does not resolve is worse than no API at all.
 */
const prettySlug = buildProjectSlugs(
	projects,
	content.products.map((p) => p.slug),
);

/** The pretty slug is the public id, so `/api/v1/projects/appflowy` matches the page. */
const projectBySlug = new Map(
	projects.map((p) => [prettySlug.get(p.slug) as string, p]),
);

/** The forge id still resolves, since it is what a vote row and an older link carry. */
const projectByForgeId = new Map(projects.map((p) => [p.slug, p]));
const productBySlug = new Map(content.products.map((p) => [p.slug, p]));
const categoryBySlug = new Map(content.categories.map((c) => [c.slug, c]));

const productsInCategory = new Map<string, Product[]>();
for (const p of content.products) {
	const bucket = productsInCategory.get(p.category);
	if (bucket) bucket.push(p);
	else productsInCategory.set(p.category, [p]);
}

/** The alternative entries behind one project, for the fields Project does not carry. */
const altsByProject = new Map<string, OssAlternative[]>();
for (const product of content.products) {
	for (const alt of product.alternatives) {
		if (alt.kind !== "oss") continue;
		const slug = projectSlug(alt.source);
		const bucket = altsByProject.get(slug);
		if (bucket) bucket.push(alt);
		else altsByProject.set(slug, [alt]);
	}
}

/* ------------------------------------------------------------------ */
/* Generated files, read lazily.                                       */
/*                                                                      */
/* Both are written by tooling outside this app and are regenerated     */
/* while the server is running, so a missing or half-written file must  */
/* degrade to "we do not know" rather than take the API down with it.   */
/* content.ts is fatal on bad data for the opposite reason: that data   */
/* is reviewed in a PR and is the product.                             */
/* ------------------------------------------------------------------ */

const DATA = env.contentDir ?? join(import.meta.dir, "../../../data");

function lazyJson<T>(file: string): () => T | null {
	let cached: T | null | undefined;
	return () => {
		if (cached !== undefined) return cached;
		try {
			cached = JSON.parse(readFileSync(join(DATA, file), "utf8")) as T;
		} catch (err) {
			log.warn({ err, file }, "optional data file unreadable");
			cached = null;
		}
		return cached;
	};
}

const healthFile = lazyJson<HealthFile>("health.json");

const healthOf = (source: Source | null): Health | null => {
	if (!source) return null;
	return healthFile()?.repos[healthKey(source)] ?? null;
};

type FeatureFile = {
	taxonomyVersion: number;
	domains: {
		key: string;
		kind: string;
		name: Translations;
		features: { key: string; name: Translations }[];
	}[];
	projects: Record<string, Record<string, string>>;
	products: Record<string, Record<string, string>>;
	productTiers: Record<string, Record<string, string>>;
};

const featureFile = lazyJson<FeatureFile>("features.json");

/**
 * Feature answers for one repo.
 *
 * Keyed by `healthKey`, the same key health.json uses, NOT by `source.path`.
 * The two agree on GitHub and diverge everywhere else, where the key carries the
 * forge hostname: `invent.kde.org/graphics/krita`, not `graphics/krita`. A bare
 * path silently resolved 76 fewer projects, and would have collided the two
 * `blender/blender` repos rather than merely missing them.
 */
const projectFeatures = (source: Source | null) =>
	source ? (featureFile()?.projects[healthKey(source)] ?? null) : null;

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

function shapeAlternative(
	alt: Alternative,
	lang: Lang,
	switchedTo: Map<string, number>,
) {
	if (alt.kind === "cheaper") {
		return {
			kind: "cheaper" as const,
			name: alt.name,
			// A cheaper alternative is somebody else's paid product. It has a vendor
			// page and no page here, so it gets `homepage` and no `url`.
			homepage: alt.url,
			price_monthly: alt.priceMonthly,
			price_once: alt.priceOnce ?? null,
			note: tr(alt.note, lang),
		};
	}

	// Two ids, on purpose: votes are recorded against the forge id, and the page
	// lives at the pretty one.
	const forgeId = projectSlug(alt.source);
	const slug = prettySlug.get(forgeId) ?? forgeId;
	const health = healthOf(alt.source);
	return {
		kind: "oss" as const,
		slug,
		name: alt.name,
		license: alt.license,
		foss: classifyLicense(alt.license),
		effort: alt.effort,
		openness: openness(alt),
		self_hostable: alt.facts.selfHostable,
		open_core: alt.facts.openCore,
		paywalled: tr(alt.facts.paywalled, lang),
		sso_in_free: alt.facts.ssoInFree,
		data_residency: alt.facts.dataResidency,
		has_compose: alt.hasCompose ?? health?.hasCompose ?? null,
		// The forge outranks what we authored, and absent is not false.
		archived: health?.archived ?? alt.archived ?? false,
		language: alt.language ?? health?.language ?? null,
		last_push: health?.lastPush ?? null,
		repo: alt.source.url,
		forge: alt.source.host,
		note: tr(alt.note, lang),
		switched_to: switchedTo.get(forgeId) ?? 0,
		url: pageUrl(paths.project(lang, slug)),
		api: apiUrl("projects", slug),
	};
}

function shapeProduct(
	product: Product,
	lang: Lang,
	switched: Map<string, number>,
) {
	const oss = product.alternatives.filter((a) => a.kind === "oss");
	return {
		slug: product.slug,
		name: product.name,
		domain: product.domain,
		category: product.category,
		category_url: pageUrl(paths.category(lang, product.category)),
		verdict: product.verdict,
		rung: rungOf(product),
		price_monthly: product.priceMonthly,
		// Absent means nobody has checked. `not_public` means somebody checked and
		// the vendor publishes nothing, which is a different answer.
		not_public: product.notPublic === true,
		pricing: product.pricing
			? {
					plan: product.pricing.plan,
					basis: product.pricing.basis,
					url: product.pricing.url,
					checked_on: product.pricing.checkedOn,
					confidence: product.pricing.confidence,
				}
			: null,
		alternatives_count: product.alternatives.length,
		oss_count: oss.length,
		best_openness: bestOpenness(product),
		easiest_effort: easiestEffort(product),
		switched_count: switched.get(product.slug) ?? 0,
		url: pageUrl(paths.product(lang, product.slug)),
		api: apiUrl("products", product.slug),
	};
}

function shapeProductDetail(
	product: Product,
	lang: Lang,
	switched: Map<string, number>,
	switchedTo: Map<string, number>,
) {
	return {
		...shapeProduct(product, lang, switched),
		priority: product.priority,
		why: tr(product.why, lang),
		what_you_lose: product.whatYouLose.map((v) => tr(v, lang)),
		features: featureFile()?.products[product.slug] ?? null,
		feature_tiers: featureFile()?.productTiers[product.slug] ?? null,
		alternatives: product.alternatives.map((a) =>
			shapeAlternative(a, lang, switchedTo),
		),
	};
}

function shapeProject(
	project: Project,
	lang: Lang,
	switchedTo: Map<string, number>,
) {
	const health = healthOf(project.source);
	const slug = prettySlug.get(project.slug) ?? project.slug;
	return {
		slug,
		name: project.name,
		license: project.license,
		foss: classifyLicense(project.license),
		effort: project.effort,
		openness: openness(project),
		self_hostable: project.facts.selfHostable,
		open_core: project.facts.openCore,
		sso_in_free: project.facts.ssoInFree,
		data_residency: project.facts.dataResidency,
		// The citing products disagree about these fields, so no single value here
		// would be honest. A caller that cares should read the products.
		facts_vary: project.factsVary,
		foss_vary: project.fossVary,
		has_compose: project.hasCompose ?? health?.hasCompose ?? null,
		archived: health?.archived ?? project.archived ?? false,
		language: project.language ?? health?.language ?? null,
		last_push: health?.lastPush ?? null,
		homepage: health?.homepage ?? null,
		repo: project.source.url,
		forge: project.source.host,
		replaces_count: project.replaces.length,
		// The vote rows key on the forge id, which the Project still carries.
		switched_to: switchedTo.get(project.slug) ?? 0,
		url: pageUrl(paths.project(lang, slug)),
		api: apiUrl("projects", slug),
	};
}

function shapeProjectDetail(
	project: Project,
	lang: Lang,
	switchedTo: Map<string, number>,
) {
	return {
		...shapeProject(project, lang, switchedTo),
		features: projectFeatures(project.source),
		paywalled: tr(
			altsByProject.get(project.slug)?.find((a) => a.facts.paywalled)?.facts
				.paywalled,
			lang,
		),
		replaces: project.replaces.map((r) => ({
			slug: r.slug,
			name: r.name,
			note: tr(r.note, lang),
			url: pageUrl(paths.product(lang, r.slug)),
			api: apiUrl("products", r.slug),
		})),
	};
}

function shapeCategory(category: Category, lang: Lang) {
	return {
		slug: category.slug,
		name: resolveTranslation(category.name, lang),
		group: category.group,
		icon: category.icon,
		position: category.position,
		products_count: productsInCategory.get(category.slug)?.length ?? 0,
		url: pageUrl(paths.category(lang, category.slug)),
		api: apiUrl("categories", category.slug),
	};
}

function shapeGroup(group: CategoryGroup, lang: Lang) {
	const cats = content.categories.filter((c) => c.group === group);
	return {
		slug: group,
		// The display names for the ten themes live in the web app's dictionary,
		// not in the content, so the API returns the slug and the categories
		// under it rather than inventing a second set of names to drift from.
		categories_count: cats.length,
		products_count: cats.reduce(
			(n, c) => n + (productsInCategory.get(c.slug)?.length ?? 0),
			0,
		),
		url: pageUrl(paths.group(lang, group)),
		api: apiUrl("groups", group),
	};
}

function shapeCollection(slug: string, of: "product" | "project", lang: Lang) {
	const members = collectionMembers(slug, content.products, projects);
	return {
		slug,
		of,
		count: of === "product" ? members.products.length : members.projects.length,
		unresolved_count: members.unresolved.length,
		url: pageUrl(paths.collection(lang, slug)),
		api: apiUrl("collections", slug),
	};
}

/* ------------------------------------------------------------------ */
/* Query parsing                                                       */
/* ------------------------------------------------------------------ */

type Query = Record<string, string | undefined>;

const langOf = (q: Query): Lang => (isLang(q.lang) ? q.lang : DEFAULT_LANG);

const intOf = (raw: string | undefined, fallback: number, max: number) => {
	const n = Number.parseInt(raw ?? "", 10);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(Math.max(n, 0), max);
};

/** Tri-state: absent means "do not filter on this", which is not the same as false. */
const boolOf = (raw: string | undefined): boolean | undefined =>
	raw === "true" ? true : raw === "false" ? false : undefined;

const oneOf = <T extends string>(
	raw: string | undefined,
	allowed: readonly T[],
): T | undefined =>
	raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : undefined;

/** The envelope every list route returns. */
function paginate<T>(
	items: T[],
	q: Query,
	extra: Record<string, unknown> = {},
) {
	const limit = Math.max(1, intOf(q.limit, LIMIT_DEFAULT, LIMIT_MAX));
	const offset = intOf(q.offset, 0, Number.MAX_SAFE_INTEGER);
	return {
		total: items.length,
		limit,
		offset,
		...extra,
		results: items.slice(offset, offset + limit),
		license: LICENSE,
	};
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

const norm = (s: string) => s.toLowerCase();

/** Name, category, and the names of the alternatives, so "notion" finds AppFlowy's page too. */
const productHaystack = new Map(
	content.products.map((p) => [
		p.slug,
		norm(
			[p.slug, p.name, p.category, ...p.alternatives.map((a) => a.name)].join(
				" ",
			),
		),
	]),
);

const projectHaystack = new Map(
	projects.map((p) => [
		p.slug,
		norm(
			[
				p.slug,
				p.name,
				p.license,
				p.language ?? "",
				...p.replaces.map((r) => r.name),
			].join(" "),
		),
	]),
);

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

export const publicApi = new Elysia({ prefix: "/api/v1" })
	.use(
		rateLimit({
			// This group only. The vote, sponsor and Stripe routes have their own
			// rules and must not inherit these.
			scoping: "scoped",
			duration: RATE_WINDOW_MS,
			max: RATE_MAX,
			headers: true,
			countFailedRequest: false,
			errorResponse: new Response(
				JSON.stringify({
					error: "rate limited",
					limit: `${RATE_MAX} requests per minute per IP`,
					hint: "Need the whole catalogue? One request: /api/v1/dump.json",
					docs: API,
				}),
				{
					status: 429,
					headers: { "content-type": "application/json; charset=utf-8" },
				},
			),
			// nginx OVERWRITES X-Forwarded-For with $remote_addr, so the client
			// cannot spoof it and the first hop is the real caller. Without this the
			// default generator reads the docker bridge address and puts the entire
			// internet in one bucket.
			generator: (request, server) =>
				request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
				server?.requestIP(request)?.address ||
				"unknown",
		}),
	)

	.onAfterHandle(({ set, path }) => {
		// Read-only public data, so anyone may read it from anywhere. Assignment
		// rather than append, so this wins over the site's credentialed CORS rule
		// instead of emitting a second header a browser would reject.
		set.headers["access-control-allow-origin"] = "*";
		// `*` and allow-credentials together are invalid, and the site-wide CORS
		// rule sets credentials for the cookie-bearing routes. Nothing here reads a
		// cookie, so drop it rather than emit a pair a browser has to reject.
		delete set.headers["access-control-allow-credentials"];
		set.headers.vary = "Accept-Encoding";
		// The catalogue changes on deploy. Vote counts move faster than that but
		// only decide ordering, so five minutes of staleness costs nothing and a
		// polite caller gets to skip most of its requests.
		set.headers["cache-control"] =
			path === "/api/v1/dump.json"
				? "public, max-age=3600"
				: "public, max-age=300";
	})

	/** Discovery. Everything a caller needs to use the rest without guessing. */
	.get("/", ({ query }) => {
		const lang = langOf(query as Query);
		return {
			name: "canireplaceit",
			description:
				"Paid SaaS products mapped to open source and cheaper replacements, with licence, self-hosting, open-core and repo-health facts, each carrying the date it was checked.",
			site: SITE,
			skill: `${SITE}/skill.md`,
			openapi: apiUrl("openapi.json"),
			languages: ["en", "fr"],
			rate_limit: {
				requests: RATE_MAX,
				window_seconds: RATE_WINDOW_MS / 1000,
				per: "ip",
				headers: "RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset",
				bulk: apiUrl("dump.json"),
			},
			counts: {
				products: content.products.length,
				projects: projects.length,
				categories: content.categories.length,
				groups: CATEGORY_GROUPS.length,
				collections: COLLECTIONS.length,
			},
			routes: {
				search: apiUrl("search"),
				products: apiUrl("products"),
				projects: apiUrl("projects"),
				categories: apiUrl("categories"),
				groups: apiUrl("groups"),
				collections: apiUrl("collections"),
				graveyard: apiUrl("collections", "archived"),
				gaps: apiUrl("gaps"),
				features: apiUrl("features"),
				stats: apiUrl("stats"),
				dump: apiUrl("dump.json"),
				feed: `${SITE}/feed.xml`,
			},
			vocabulary: {
				verdict: {
					yes: "a credible replacement exists",
					almost: "close, with a real gap",
					"not-yet": "nothing credible yet",
				},
				effort: {
					managed: "somebody else can run it for you",
					docker: "one compose file and a server",
					ops: "you are running infrastructure",
				},
				open_core: {
					none: "the self-hosted build is the whole product",
					minor: "a few enterprise conveniences are paid",
					major: "the free build is a demo",
				},
				openness:
					"hosted-only, source-available, open-core, mostly-open, fully-open. Higher is freer.",
			},
			license: LICENSE,
			cite: `Link the url field. Pages live at ${SITE}/${lang}/`,
		};
	})

	/**
	 * The route the skill leads with. Searches products and projects together,
	 * because a caller asking "what replaces Notion" and one asking "what does
	 * AppFlowy replace" are the same question from two ends.
	 */
	.get("/search", async ({ query }) => {
		const q = query as Query;
		const lang = langOf(q);
		const [switched, switchedTo] = await Promise.all([
			voteCounts(),
			projectCounts(),
		]);

		const text = q.q ? norm(q.q.trim()) : "";
		const type = oneOf(q.type, ["product", "project"] as const);
		const selfHostable = boolOf(q.self_hostable);
		const openCore = oneOf(q.open_core, ["none", "minor", "major"] as const);
		const verdict = oneOf(q.verdict, ["yes", "almost", "not-yet"] as const);
		const effort = oneOf(q.effort, ["managed", "docker", "ops"] as const);
		// Dead projects are real and are kept, but nobody asking for a replacement
		// wants one by default. Pass archived=true to ask for them on purpose.
		const archived = boolOf(q.archived) ?? false;
		const license = q.license ? norm(q.license) : undefined;
		const maxPrice = q.max_price ? Number.parseFloat(q.max_price) : undefined;

		const wantsProducts = type !== "project";
		const wantsProjects = type !== "product";

		// Filters that describe a project should not silently drop every product,
		// so a product passes when any of its own alternatives passes.
		const altPasses = (alt: OssAlternative) =>
			(selfHostable === undefined || alt.facts.selfHostable === selfHostable) &&
			(openCore === undefined || alt.facts.openCore === openCore) &&
			(effort === undefined || alt.effort === effort) &&
			(license === undefined || norm(alt.license).includes(license));

		const projectFilters =
			selfHostable !== undefined ||
			openCore !== undefined ||
			effort !== undefined ||
			license !== undefined;

		const matchedProducts = wantsProducts
			? byWeight(
					content.products.filter((p) => {
						if (text && !productHaystack.get(p.slug)?.includes(text))
							return false;
						if (verdict && p.verdict !== verdict) return false;
						if (q.category && p.category !== q.category) return false;
						if (q.group && categoryBySlug.get(p.category)?.group !== q.group)
							return false;
						if (
							maxPrice !== undefined &&
							(p.priceMonthly === null || p.priceMonthly > maxPrice)
						)
							return false;
						if (
							projectFilters &&
							!p.alternatives.some((a) => a.kind === "oss" && altPasses(a))
						)
							return false;
						return true;
					}),
				)
			: [];

		const matchedProjects = wantsProjects
			? projects.filter((p) => {
					if (text && !projectHaystack.get(p.slug)?.includes(text))
						return false;
					if (
						selfHostable !== undefined &&
						p.facts.selfHostable !== selfHostable
					)
						return false;
					if (openCore !== undefined && p.facts.openCore !== openCore)
						return false;
					if (effort !== undefined && p.effort !== effort) return false;
					if (license !== undefined && !norm(p.license).includes(license))
						return false;
					const dead = healthOf(p.source)?.archived ?? p.archived ?? false;
					if (dead !== archived) return false;
					if (q.category) {
						const inCategory = p.replaces.some(
							(r) => productBySlug.get(r.slug)?.category === q.category,
						);
						if (!inCategory) return false;
					}
					// Verdict and price are facts about a paid product, so a project
					// inherits them from whatever it is offered as a replacement for.
					if (
						verdict &&
						!p.replaces.some(
							(r) => productBySlug.get(r.slug)?.verdict === verdict,
						)
					)
						return false;
					return true;
				})
			: [];

		// Most-cited first. A project that replaces nine products is a better
		// answer than one cited once, and the vote counts are too thin to order on.
		matchedProjects.sort((a, b) => b.replaces.length - a.replaces.length);

		const results = [
			...matchedProducts.map((p) => ({
				type: "product" as const,
				...shapeProduct(p, lang, switched),
			})),
			...matchedProjects.map((p) => ({
				type: "project" as const,
				...shapeProject(p, lang, switchedTo),
			})),
		];

		return paginate(results, q, {
			query: {
				q: q.q ?? null,
				type: type ?? "both",
				lang,
				self_hostable: selfHostable ?? null,
				open_core: openCore ?? null,
				verdict: verdict ?? null,
				effort: effort ?? null,
				license: q.license ?? null,
				category: q.category ?? null,
				group: q.group ?? null,
				max_price: maxPrice ?? null,
				archived,
			},
			matched: {
				products: matchedProducts.length,
				projects: matchedProjects.length,
			},
		});
	})

	.get("/products", async ({ query }) => {
		const q = query as Query;
		const lang = langOf(q);
		const switched = await voteCounts();
		let items = content.products;
		if (q.category) items = items.filter((p) => p.category === q.category);
		if (q.verdict) items = items.filter((p) => p.verdict === q.verdict);
		return paginate(
			byWeight(items).map((p) => shapeProduct(p, lang, switched)),
			q,
		);
	})

	.get("/products/:slug", async ({ params, query, status }) => {
		const product = productBySlug.get(params.slug);
		if (!product)
			return status(404, {
				error: "no such product",
				slug: params.slug,
				search: apiUrl("search"),
			});
		const lang = langOf(query as Query);
		const [switched, switchedTo] = await Promise.all([
			voteCounts(),
			projectCounts(),
		]);
		return {
			...shapeProductDetail(product, lang, switched, switchedTo),
			license: LICENSE,
		};
	})

	.get("/projects", async ({ query }) => {
		const q = query as Query;
		const lang = langOf(q);
		const switchedTo = await projectCounts();
		let items = projects;
		const archived = boolOf(q.archived);
		if (archived !== undefined) {
			items = items.filter(
				(p) =>
					(healthOf(p.source)?.archived ?? p.archived ?? false) === archived,
			);
		}
		if (q.language)
			items = items.filter(
				(p) => norm(p.language ?? "") === norm(q.language as string),
			);
		const ordered = [...items].sort(
			(a, b) => b.replaces.length - a.replaces.length,
		);
		return paginate(
			ordered.map((p) => shapeProject(p, lang, switchedTo)),
			q,
		);
	})

	.get("/projects/:slug", async ({ params, query, status }) => {
		const project =
			projectBySlug.get(params.slug) ?? projectByForgeId.get(params.slug);
		if (!project)
			return status(404, {
				error: "no such project",
				slug: params.slug,
				search: apiUrl("search"),
			});
		const switchedTo = await projectCounts();
		return {
			...shapeProjectDetail(project, langOf(query as Query), switchedTo),
			license: LICENSE,
		};
	})

	.get("/categories", ({ query }) => {
		const q = query as Query;
		const lang = langOf(q);
		let items = content.categories;
		if (q.group) items = items.filter((c) => c.group === q.group);
		return paginate(
			[...items]
				.sort((a, b) => a.position - b.position)
				.map((c) => shapeCategory(c, lang)),
			{ ...q, limit: q.limit ?? String(LIMIT_MAX) },
		);
	})

	.get("/categories/:slug", async ({ params, query, status }) => {
		const category = categoryBySlug.get(params.slug);
		if (!category)
			return status(404, {
				error: "no such category",
				slug: params.slug,
				index: apiUrl("categories"),
			});
		const q = query as Query;
		const lang = langOf(q);
		const switched = await voteCounts();
		const members = byWeight(productsInCategory.get(category.slug) ?? []);
		return {
			...shapeCategory(category, lang),
			group_api: apiUrl("groups", category.group),
			...paginate(
				members.map((p) => shapeProduct(p, lang, switched)),
				q,
			),
		};
	})

	.get("/groups", ({ query }) => {
		const lang = langOf(query as Query);
		return {
			total: CATEGORY_GROUPS.length,
			results: CATEGORY_GROUPS.map((g) => shapeGroup(g, lang)),
			license: LICENSE,
		};
	})

	.get("/groups/:slug", ({ params, query, status }) => {
		const group = CATEGORY_GROUPS.find((g) => g === params.slug);
		if (!group)
			return status(404, {
				error: "no such theme",
				slug: params.slug,
				index: apiUrl("groups"),
				known: CATEGORY_GROUPS,
			});
		const lang = langOf(query as Query);
		return {
			...shapeGroup(group, lang),
			categories: content.categories
				.filter((c) => c.group === group)
				.sort((a, b) => a.position - b.position)
				.map((c) => shapeCategory(c, lang)),
			license: LICENSE,
		};
	})

	.get("/collections", ({ query }) => {
		const lang = langOf(query as Query);
		return {
			total: COLLECTIONS.length,
			note: "A collection is a query over the catalogue, never a hand-kept list. `archived` is the graveyard.",
			results: COLLECTIONS.map((c) => shapeCollection(c.slug, c.of, lang)),
			license: LICENSE,
		};
	})

	.get("/collections/:slug", async ({ params, query, status }) => {
		const def = collectionBySlug.get(params.slug);
		if (!def)
			return status(404, {
				error: "no such collection",
				slug: params.slug,
				index: apiUrl("collections"),
				known: COLLECTIONS.map((c) => c.slug),
			});
		const q = query as Query;
		const lang = langOf(q);
		const [switched, switchedTo] = await Promise.all([
			voteCounts(),
			projectCounts(),
		]);
		const members = collectionMembers(def.slug, content.products, projects);
		// Two different row shapes, one list. `object[]` keeps the ternary from
		// narrowing to whichever branch TypeScript reads first.
		const rows: object[] =
			def.of === "product"
				? byWeight(members.products).map((p) => shapeProduct(p, lang, switched))
				: [...members.projects]
						.sort((a, b) => b.replaces.length - a.replaces.length)
						.map((p) => shapeProject(p, lang, switchedTo));
		return {
			slug: def.slug,
			of: def.of,
			url: pageUrl(paths.collection(lang, def.slug)),
			...paginate(rows, q, {
				// Projects whose own citations disagree on the field this collection is
				// built from. Named rather than dropped, because dropping them would
				// assert a consensus nobody established.
				unresolved: members.unresolved.map((p) => {
					const slug = prettySlug.get(p.slug) ?? p.slug;
					return {
						slug,
						name: p.name,
						url: pageUrl(paths.project(lang, slug)),
						api: apiUrl("projects", slug),
					};
				}),
			}),
		};
	})

	/** The products with no credible replacement. The one list here that says no. */
	.get("/gaps", async ({ query }) => {
		const q = query as Query;
		const lang = langOf(q);
		const switched = await voteCounts();
		const rows = byWeight(
			content.products.filter((p) => p.verdict === "not-yet"),
		);
		return {
			note: "Products where the catalogue has found nothing credible yet. Absence of an entry here is not a claim that a replacement exists.",
			url: pageUrl(paths.gaps(lang)),
			...paginate(
				rows.map((p) => shapeProduct(p, lang, switched)),
				q,
			),
		};
	})

	/** The feature taxonomy, not the per-project matrix. That is on each record. */
	.get("/features", ({ query, status }) => {
		const lang = langOf(query as Query);
		const file = featureFile();
		if (!file)
			return status(503, {
				error: "feature data is being regenerated",
				retry: "later",
			});
		return {
			taxonomy_version: file.taxonomyVersion,
			url: pageUrl(paths.features(lang)),
			note: "Answers are `yes`, `no` or `paid`, and are read from a product's or project's own record. Sparse: an absent key means unknown, never no.",
			covered: {
				products: Object.keys(file.products).length,
				projects: Object.keys(file.projects).length,
			},
			domains: file.domains.map((d) => ({
				key: d.key,
				kind: d.kind,
				name: resolveTranslation(d.name, lang),
				features: d.features.map((f) => ({
					key: f.key,
					name: resolveTranslation(f.name, lang),
				})),
			})),
			license: LICENSE,
		};
	})

	.get("/stats", async () => {
		const [switched, switchedTo] = await Promise.all([
			voteCounts(),
			projectCounts(),
		]);
		const sum = (m: Map<string, number>) =>
			[...m.values()].reduce((a, b) => a + b, 0);
		const priced = content.products.filter((p) => p.priceMonthly !== null);
		return {
			products: content.products.length,
			projects: projects.length,
			categories: content.categories.length,
			groups: CATEGORY_GROUPS.length,
			collections: COLLECTIONS.length,
			alternatives: content.products.reduce(
				(n, p) => n + p.alternatives.length,
				0,
			),
			oss_alternatives: content.products.reduce(
				(n, p) => n + p.alternatives.filter((a) => a.kind === "oss").length,
				0,
			),
			gaps: content.products.filter((p) => p.verdict === "not-yet").length,
			priced_products: priced.length,
			tracked_monthly_usd: Math.round(
				priced.reduce((n, p) => n + (p.priceMonthly ?? 0), 0),
			),
			switches: sum(switched),
			switches_to_projects: sum(switchedTo),
			health_fetched_at: healthFile()?.fetchedAt ?? null,
			license: LICENSE,
		};
	})

	/**
	 * The whole catalogue in one response.
	 *
	 * This exists so that wanting everything costs one request instead of five
	 * hundred. Cheaper for this server than refusing and being scraped anyway.
	 */
	.get("/dump.json", async ({ query }) => {
		const lang = langOf(query as Query);
		const [switched, switchedTo] = await Promise.all([
			voteCounts(),
			projectCounts(),
		]);
		return {
			generated_for: lang,
			site: SITE,
			counts: {
				products: content.products.length,
				projects: projects.length,
				categories: content.categories.length,
			},
			categories: content.categories.map((c) => shapeCategory(c, lang)),
			products: content.products.map((p) =>
				shapeProductDetail(p, lang, switched, switchedTo),
			),
			projects: projects.map((p) => shapeProject(p, lang, switchedTo)),
			license: LICENSE,
		};
	})

	/**
	 * Recently re-verified prices, as Atom.
	 *
	 * A feed of "new products" would need a created date the catalogue does not
	 * keep, and inventing one from git would be a date about a file rather than
	 * about a product. `pricing.checkedOn` is a real event with a real date: a
	 * human read a vendor page and wrote down what it said. That is the thing
	 * worth subscribing to here, and it is the thing nobody else publishes.
	 */
	.get("/feed.xml", ({ set }) => {
		const lang = DEFAULT_LANG;
		const dated = content.products
			.filter((p) => p.pricing?.checkedOn)
			.sort((a, b) =>
				(b.pricing?.checkedOn ?? "").localeCompare(a.pricing?.checkedOn ?? ""),
			)
			.slice(0, 50);

		const updated = dated[0]?.pricing?.checkedOn ?? "1970-01-01";
		const stamp = (day: string) => `${day}T00:00:00Z`;

		const entries = dated
			.map((p) => {
				const url = pageUrl(paths.product(lang, p.slug));
				const price =
					p.priceMonthly === null
						? "no public price"
						: `${p.priceMonthly} USD per month`;
				const summary = `${p.name}: ${price} (${p.pricing?.plan}). Verdict: ${p.verdict}. Checked at ${p.pricing?.url}`;
				return [
					"  <entry>",
					`    <title>${xml(`${p.name} price checked ${p.pricing?.checkedOn}`)}</title>`,
					`    <link href="${xml(url)}"/>`,
					`    <id>${xml(`${url}#${p.pricing?.checkedOn}`)}</id>`,
					`    <updated>${stamp(p.pricing?.checkedOn ?? updated)}</updated>`,
					`    <summary>${xml(summary)}</summary>`,
					"  </entry>",
				].join("\n");
			})
			.join("\n");

		set.headers["content-type"] = "application/atom+xml; charset=utf-8";
		return [
			'<?xml version="1.0" encoding="utf-8"?>',
			'<feed xmlns="http://www.w3.org/2005/Atom">',
			"  <title>canireplaceit: prices just verified</title>",
			`  <link href="${SITE}/feed.xml" rel="self"/>`,
			`  <link href="${SITE}${paths.home(lang)}"/>`,
			`  <id>${SITE}/feed.xml</id>`,
			`  <updated>${stamp(updated)}</updated>`,
			"  <subtitle>Every price on this site carries the date a human last read it off the vendor's own page. This is that log.</subtitle>",
			`  <rights>${xml(LICENSE)}</rights>`,
			entries,
			"</feed>",
			"",
		].join("\n");
	})

	.get("/openapi.json", () => openapi());

/* ------------------------------------------------------------------ */
/* OpenAPI                                                             */
/* ------------------------------------------------------------------ */

const param = (
	name: string,
	description: string,
	schema: Record<string, unknown> = { type: "string" },
) => ({ name, in: "query", description, schema, required: false });

const LANG_PARAM = param("lang", "Locale for names, notes and URLs.", {
	type: "string",
	enum: ["en", "fr"],
	default: "en",
});
const PAGE_PARAMS = [
	param("limit", `Rows to return. Max ${LIMIT_MAX}.`, {
		type: "integer",
		default: LIMIT_DEFAULT,
		maximum: LIMIT_MAX,
	}),
	param("offset", "Rows to skip.", { type: "integer", default: 0 }),
];

const okJson = (description: string) => ({
	"200": { description, content: { "application/json": {} } },
});

const op = (
	summary: string,
	parameters: unknown[] = [],
	description?: string,
) => ({
	get: {
		summary,
		description,
		parameters: [LANG_PARAM, ...parameters],
		responses: okJson(summary),
	},
});

function openapi() {
	return {
		openapi: "3.1.0",
		info: {
			title: "canireplaceit",
			version: "1.0.0",
			description: [
				"Paid SaaS products mapped to open source and cheaper replacements.",
				"",
				`Every object carries \`url\` (the page a reader lands on) and \`api\` (the record's own route). ${LICENSE}`,
				"",
				`Rate limit: ${RATE_MAX} requests per minute per IP, reported in RateLimit-* headers. For the whole catalogue use /dump.json, which is one request.`,
			].join("\n"),
			license: { name: "CC-BY-4.0" },
		},
		servers: [{ url: API }],
		paths: {
			"/": op("Discovery: routes, counts, rate limit and vocabulary."),
			"/search": op(
				"Search products and projects together.",
				[
					param("q", "Free text over names, categories and alternatives."),
					param("type", "Restrict to one kind.", {
						type: "string",
						enum: ["product", "project"],
					}),
					param("self_hostable", "Can you genuinely run it yourself.", {
						type: "boolean",
					}),
					param("open_core", "How much is withheld from the free build.", {
						type: "string",
						enum: ["none", "minor", "major"],
					}),
					param("license", "Licence substring, case-insensitive. e.g. agpl"),
					param("verdict", "Is a replacement credible yet.", {
						type: "string",
						enum: ["yes", "almost", "not-yet"],
					}),
					param("effort", "What running it asks of you.", {
						type: "string",
						enum: ["managed", "docker", "ops"],
					}),
					param("category", "Category slug."),
					param("group", "Theme slug.", {
						type: "string",
						enum: CATEGORY_GROUPS,
					}),
					param("max_price", "Ceiling on the paid product's monthly USD.", {
						type: "number",
					}),
					param(
						"archived",
						"Dead projects are excluded unless you ask for them.",
						{ type: "boolean", default: false },
					),
					...PAGE_PARAMS,
				],
				"The route to start from. Project filters applied to products keep any product with at least one alternative that passes.",
			),
			"/products": op("The paid products.", [
				param("category", "Category slug."),
				param("verdict", "Filter by verdict.", {
					type: "string",
					enum: ["yes", "almost", "not-yet"],
				}),
				...PAGE_PARAMS,
			]),
			"/products/{slug}": {
				get: {
					summary:
						"One product: pricing with its source and check date, what you lose, every alternative, feature answers.",
					parameters: [
						{
							name: "slug",
							in: "path",
							required: true,
							schema: { type: "string" },
						},
						LANG_PARAM,
					],
					responses: okJson("One product."),
				},
			},
			"/projects": op("The replacements, most-cited first.", [
				param("archived", "Only dead, or only living.", { type: "boolean" }),
				param("language", "Top language as the forge reports it."),
				...PAGE_PARAMS,
			]),
			"/projects/{slug}": {
				get: {
					summary: "One project, including every product it can replace.",
					parameters: [
						{
							name: "slug",
							in: "path",
							required: true,
							schema: { type: "string" },
						},
						LANG_PARAM,
					],
					responses: okJson("One project."),
				},
			},
			"/categories": op("The categories.", [
				param("group", "Theme slug.", {
					type: "string",
					enum: CATEGORY_GROUPS,
				}),
			]),
			"/categories/{slug}": {
				get: {
					summary: "One category and the products in it.",
					parameters: [
						{
							name: "slug",
							in: "path",
							required: true,
							schema: { type: "string" },
						},
						LANG_PARAM,
						...PAGE_PARAMS,
					],
					responses: okJson("One category."),
				},
			},
			"/groups": op("The ten themes the categories are filed under."),
			"/groups/{slug}": {
				get: {
					summary: "One theme and its categories.",
					parameters: [
						{
							name: "slug",
							in: "path",
							required: true,
							schema: { type: "string", enum: CATEGORY_GROUPS },
						},
						LANG_PARAM,
					],
					responses: okJson("One theme."),
				},
			},
			"/collections": op("Derived slices of the catalogue."),
			"/collections/{slug}": {
				get: {
					summary:
						"One collection. `archived` is the graveyard: projects that died.",
					parameters: [
						{
							name: "slug",
							in: "path",
							required: true,
							schema: {
								type: "string",
								enum: COLLECTIONS.map((c) => c.slug),
							},
						},
						LANG_PARAM,
						...PAGE_PARAMS,
					],
					responses: okJson("One collection."),
				},
			},
			"/gaps": op(
				"Products with no credible replacement yet.",
				PAGE_PARAMS,
				"The catalogue arguing against itself. Quote it when the honest answer is that nothing is good enough.",
			),
			"/features": op(
				"The feature taxonomy. Per-record answers ride on each product and project.",
			),
			"/stats": op("Corpus counts and the health sweep date."),
			"/dump.json": op(
				"The whole catalogue in one response.",
				[],
				"Use this instead of paging through everything. Cached for an hour.",
			),
			"/feed.xml": op(
				"Atom feed of the 50 most recently re-verified prices.",
				[],
				"Also reachable at https://canireplaceit.com/feed.xml.",
			),
			"/openapi.json": op("This document."),
		},
	};
}
