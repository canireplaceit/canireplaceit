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
					note: product.pricing.note,
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
			// Sparse on purpose: only slugs with a counted vote, which is a few
			// dozen keys rather than 592 + 3,479 zeroes. The prerender reads these
			// so a CI build with no database still bakes the real numbers in.
			switched_by_product: Object.fromEntries(switched),
			switched_by_project: Object.fromEntries(switchedTo),
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

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

/**
 * Every response this API can produce, named.
 *
 * The 429 is the one a client MUST handle — 60 requests a minute is the only
 * rule here that will actually stop a caller — so it is attached to every route
 * rather than mentioned in prose. The 404 is attached only where a path
 * parameter can miss; a list route has nothing to not-find.
 */
const RATE_LIMITED = {
	description: `Rate limited. ${RATE_MAX} requests per minute per IP. Read RateLimit-Reset and wait, or take /dump.json instead.`,
	content: { "application/json": { schema: ref("RateLimitError") } },
};

const NOT_FOUND = {
	description: "No record with that slug.",
	content: { "application/json": { schema: ref("NotFoundError") } },
};

const okJson = (description: string, schema: string) => ({
	"200": {
		description,
		content: { "application/json": { schema: ref(schema) } },
	},
	"429": RATE_LIMITED,
});

const op = (
	summary: string,
	schema: string,
	parameters: unknown[] = [],
	description?: string,
) => ({
	get: {
		summary,
		description,
		parameters: [LANG_PARAM, ...parameters],
		responses: okJson(summary, schema),
	},
});

/** A GET on a `{slug}` path: the same as `op`, plus the 404 it can answer with. */
const item = (
	summary: string,
	schema: string,
	slugSchema: Record<string, unknown> = { type: "string" },
	parameters: unknown[] = [],
	description?: string,
) => ({
	get: {
		summary,
		description,
		parameters: [
			{ name: "slug", in: "path", required: true, schema: slugSchema },
			LANG_PARAM,
			...parameters,
		],
		responses: { ...okJson(summary, schema), "404": NOT_FOUND },
	},
});

/* ------------------------------------------------------------------ */
/* Schemas                                                             */
/*                                                                     */
/* Written against the shape functions above, field for field. The rule */
/* that matters to a caller: `null` means nobody established the fact,  */
/* never zero and never false, so nearly everything here is nullable.   */
/* ------------------------------------------------------------------ */

const str = { type: "string" } as const;
const nullableStr = { type: ["string", "null"] };
const nullableNum = { type: ["number", "null"] };
const nullableBool = { type: ["boolean", "null"] };

/** `{ total, limit, offset, ...extra, results, license }`, the envelope every list route returns. */
const paged = (
	itemSchema: Record<string, unknown>,
	extra: Record<string, unknown> = {},
	extraRequired: string[] = [],
) => ({
	type: "object",
	properties: {
		total: { type: "integer", description: "Rows before paging." },
		limit: { type: "integer" },
		offset: { type: "integer" },
		...extra,
		results: { type: "array", items: itemSchema },
		license: { ...str, description: LICENSE },
	},
	required: [
		"total",
		"limit",
		"offset",
		"results",
		"license",
		...extraRequired,
	],
});

const SCHEMAS: Record<string, unknown> = {
	RateLimitError: {
		type: "object",
		properties: {
			error: { const: "rate limited" },
			limit: str,
			hint: str,
			docs: { ...str, format: "uri" },
		},
		required: ["error", "limit", "docs"],
	},

	NotFoundError: {
		type: "object",
		properties: {
			error: { ...str, description: "e.g. `no such product`." },
			slug: { ...str, description: "The slug that was asked for." },
			search: {
				...str,
				format: "uri",
				description: "Where to look it up instead. Present on record routes.",
			},
			index: {
				...str,
				format: "uri",
				description: "The index to browse instead. Present on index routes.",
			},
			known: {
				type: "array",
				items: str,
				description: "The legal values, on the closed-vocabulary routes.",
			},
		},
		required: ["error", "slug"],
	},

	Pricing: {
		type: "object",
		description:
			"The receipt for the price. Quote `checked_on` and `url` together or do not quote the price.",
		properties: {
			plan: { ...str, description: "The plan the figure was read off." },
			basis: {
				...str,
				description: "What the price is per, e.g. `per-seat`.",
			},
			url: {
				...str,
				format: "uri",
				description: "The vendor page it was read on.",
			},
			checked_on: {
				...str,
				format: "date",
				description: "The day a human read it.",
			},
			confidence: { type: "string", enum: ["high", "medium", "low"] },
		},
		required: ["plan", "url", "checked_on"],
	},

	CheaperAlternative: {
		type: "object",
		description:
			"Somebody else's paid product. It has a vendor page, not a page here.",
		properties: {
			kind: { const: "cheaper" },
			name: str,
			homepage: { ...str, format: "uri" },
			price_monthly: nullableNum,
			price_once: nullableNum,
			note: nullableStr,
		},
		required: ["kind", "name", "homepage"],
	},

	OssAlternative: {
		type: "object",
		description: "One open source replacement, as cited by one paid product.",
		properties: {
			kind: { const: "oss" },
			slug: str,
			name: str,
			license: {
				...str,
				description: "SPDX-ish, as authored. e.g. `AGPL-3.0`.",
			},
			foss: {
				type: "string",
				enum: ["foss", "source-available", "not-foss"],
				description: "The licence string classified.",
			},
			effort: { type: "string", enum: ["managed", "docker", "ops"] },
			openness: {
				type: "string",
				enum: [
					"hosted-only",
					"source-available",
					"open-core",
					"mostly-open",
					"fully-open",
				],
			},
			self_hostable: nullableBool,
			open_core: {
				type: ["string", "null"],
				enum: ["none", "minor", "major", null],
			},
			paywalled: {
				...nullableStr,
				description: "What exactly the free build withholds.",
			},
			sso_in_free: {
				...nullableBool,
				description: "The SSO tax. `null` is unknown, not no.",
			},
			data_residency: nullableStr,
			has_compose: nullableBool,
			archived: {
				type: "boolean",
				description: "The forge's reading wins over ours.",
			},
			language: nullableStr,
			last_push: { ...nullableStr, format: "date" },
			repo: { ...str, format: "uri" },
			forge: {
				...str,
				description: "Host of the repository, e.g. `github.com`.",
			},
			note: nullableStr,
			switched_to: {
				type: "integer",
				description:
					"Self-reported switches. Thin: order on it, never quote it.",
			},
			url: { ...str, format: "uri", description: "The page. Link this." },
			api: { ...str, format: "uri" },
		},
		required: ["kind", "slug", "name", "license", "effort", "url", "api"],
	},

	Alternative: {
		description:
			"An open source project, or somebody else's cheaper paid product.",
		oneOf: [ref("OssAlternative"), ref("CheaperAlternative")],
	},

	Product: {
		type: "object",
		description: "A paid product, as a row.",
		properties: {
			slug: str,
			name: str,
			domain: nullableStr,
			category: str,
			category_url: { ...str, format: "uri" },
			verdict: {
				type: "string",
				enum: ["yes", "almost", "not-yet"],
				description: "Is a credible replacement here yet.",
			},
			rung: {
				type: "string",
				enum: ["locked-in", "partial", "self-hostable", "drop-in"],
				description:
					"How far up the exit ladder this product's best exit gets.",
			},
			price_monthly: {
				...nullableNum,
				description: "USD per month. `null` needs `not_public` to read.",
			},
			not_public: {
				type: "boolean",
				description:
					"true means somebody checked and the vendor publishes nothing. false with a null price means nobody has checked. Different answers.",
			},
			pricing: { oneOf: [ref("Pricing"), { type: "null" }] },
			alternatives_count: { type: "integer" },
			oss_count: { type: "integer" },
			best_openness: nullableStr,
			easiest_effort: {
				type: ["string", "null"],
				enum: ["managed", "docker", "ops", null],
			},
			switched_count: { type: "integer" },
			url: { ...str, format: "uri", description: "The page. Link this." },
			api: { ...str, format: "uri" },
		},
		required: [
			"slug",
			"name",
			"category",
			"verdict",
			"not_public",
			"url",
			"api",
		],
	},

	ProductDetail: {
		type: "object",
		description: "One paid product, with everything the page renders.",
		allOf: [
			ref("Product"),
			{
				type: "object",
				properties: {
					priority: { type: ["integer", "null"] },
					why: { ...nullableStr, description: "The one-paragraph argument." },
					what_you_lose: { type: "array", items: str },
					features: {
						...ref("FeatureAnswers"),
						description:
							"Sparse. An absent key means nobody checked, never no.",
					},
					feature_tiers: {
						type: ["object", "null"],
						additionalProperties: str,
						description:
							"Which plan gates a paid feature. Sparser still: a missing tier means unknown, never included in the free plan.",
					},
					alternatives: { type: "array", items: ref("Alternative") },
					license: str,
				},
			},
		],
	},

	Project: {
		type: "object",
		description: "One replacement, derived from every product that cites it.",
		properties: {
			slug: str,
			name: str,
			license: str,
			foss: { type: "string", enum: ["foss", "source-available", "not-foss"] },
			effort: { type: "string", enum: ["managed", "docker", "ops"] },
			openness: {
				type: "string",
				enum: [
					"hosted-only",
					"source-available",
					"open-core",
					"mostly-open",
					"fully-open",
				],
			},
			self_hostable: nullableBool,
			open_core: {
				type: ["string", "null"],
				enum: ["none", "minor", "major", null],
			},
			sso_in_free: nullableBool,
			data_residency: nullableStr,
			facts_vary: {
				type: "array",
				items: str,
				description:
					"Fields the citing products disagree about. Do not state these as settled; read the product records.",
			},
			foss_vary: { type: "boolean" },
			has_compose: nullableBool,
			archived: { type: "boolean" },
			language: nullableStr,
			last_push: { ...nullableStr, format: "date" },
			homepage: { ...nullableStr, format: "uri" },
			repo: { ...str, format: "uri" },
			forge: str,
			replaces_count: { type: "integer" },
			switched_to: { type: "integer" },
			url: { ...str, format: "uri", description: "The page. Link this." },
			api: { ...str, format: "uri" },
		},
		required: ["slug", "name", "license", "effort", "archived", "url", "api"],
	},

	ProjectDetail: {
		type: "object",
		allOf: [
			ref("Project"),
			{
				type: "object",
				properties: {
					features: ref("FeatureAnswers"),
					paywalled: nullableStr,
					replaces: {
						type: "array",
						items: {
							type: "object",
							properties: {
								slug: str,
								name: str,
								note: nullableStr,
								url: { ...str, format: "uri" },
								api: { ...str, format: "uri" },
							},
							required: ["slug", "name", "url", "api"],
						},
					},
					license: str,
				},
			},
		],
	},

	FeatureAnswers: {
		type: ["object", "null"],
		additionalProperties: { type: "string", enum: ["yes", "no", "paid"] },
		description:
			"Feature key to answer. Sparse: an absent key means nobody checked, never that the answer is no.",
	},

	Category: {
		type: "object",
		properties: {
			slug: str,
			name: { ...str, description: "In the requested locale." },
			group: { type: "string", enum: CATEGORY_GROUPS },
			icon: nullableStr,
			position: { type: "integer" },
			products_count: { type: "integer" },
			url: { ...str, format: "uri" },
			api: { ...str, format: "uri" },
		},
		required: ["slug", "name", "group", "products_count", "url", "api"],
	},

	Group: {
		type: "object",
		description:
			"One of the ten themes. It carries no display name: those live in the web app's dictionary, and a second set here would drift.",
		properties: {
			slug: { type: "string", enum: CATEGORY_GROUPS },
			categories_count: { type: "integer" },
			products_count: { type: "integer" },
			url: { ...str, format: "uri" },
			api: { ...str, format: "uri" },
		},
		required: ["slug", "categories_count", "products_count", "url", "api"],
	},

	Collection: {
		type: "object",
		description: "A query over the catalogue, never a hand-kept list.",
		properties: {
			slug: { type: "string", enum: COLLECTIONS.map((c) => c.slug) },
			of: { type: "string", enum: ["product", "project"] },
			count: { type: "integer" },
			unresolved_count: {
				type: "integer",
				description:
					"Projects whose own citations disagree on the field this collection is built from.",
			},
			url: { ...str, format: "uri" },
			api: { ...str, format: "uri" },
		},
		required: ["slug", "of", "count", "url", "api"],
	},

	ProjectRef: {
		type: "object",
		properties: {
			slug: str,
			name: str,
			url: { ...str, format: "uri" },
			api: { ...str, format: "uri" },
		},
		required: ["slug", "name", "url", "api"],
	},

	Discovery: {
		type: "object",
		description: "Everything a caller needs to use the rest without guessing.",
		properties: {
			name: { const: "canireplaceit" },
			description: str,
			site: { ...str, format: "uri" },
			skill: { ...str, format: "uri" },
			openapi: { ...str, format: "uri" },
			languages: {
				type: "array",
				items: { type: "string", enum: ["en", "fr"] },
			},
			rate_limit: {
				type: "object",
				properties: {
					requests: { type: "integer" },
					window_seconds: { type: "integer" },
					per: { const: "ip" },
					headers: str,
					bulk: { ...str, format: "uri" },
				},
			},
			counts: { type: "object", additionalProperties: { type: "integer" } },
			routes: {
				type: "object",
				additionalProperties: { ...str, format: "uri" },
			},
			vocabulary: {
				type: "object",
				description:
					"What the words mean here. The same set /en/glossary defines.",
			},
			license: str,
			cite: str,
		},
		required: ["name", "site", "routes", "license"],
	},

	SearchResults: paged(
		{
			description:
				"A product or a project, told apart by `type`. Both are shipped from one route because 'what replaces Notion' and 'what does AppFlowy replace' are the same question from two ends.",
			oneOf: [
				{
					allOf: [
						{ type: "object", properties: { type: { const: "product" } } },
						ref("Product"),
					],
				},
				{
					allOf: [
						{ type: "object", properties: { type: { const: "project" } } },
						ref("Project"),
					],
				},
			],
		},
		{
			query: {
				type: "object",
				description:
					"Every filter as it was actually parsed, including the ones you did not send.",
			},
			matched: {
				type: "object",
				properties: {
					products: { type: "integer" },
					projects: { type: "integer" },
				},
			},
		},
		["query", "matched"],
	),

	ProductList: paged(ref("Product")),
	ProjectList: paged(ref("Project")),
	CategoryList: paged(ref("Category")),

	CategoryDetail: {
		type: "object",
		description: "One category, with the products in it as a paged envelope.",
		allOf: [
			ref("Category"),
			{
				type: "object",
				properties: { group_api: { ...str, format: "uri" } },
			},
			paged(ref("Product")),
		],
	},

	GroupList: {
		type: "object",
		properties: {
			total: { type: "integer" },
			results: { type: "array", items: ref("Group") },
			license: str,
		},
		required: ["total", "results", "license"],
	},

	GroupDetail: {
		type: "object",
		allOf: [
			ref("Group"),
			{
				type: "object",
				properties: {
					categories: { type: "array", items: ref("Category") },
					license: str,
				},
				required: ["categories"],
			},
		],
	},

	CollectionList: {
		type: "object",
		properties: {
			total: { type: "integer" },
			note: str,
			results: { type: "array", items: ref("Collection") },
			license: str,
		},
		required: ["total", "results", "license"],
	},

	CollectionDetail: {
		type: "object",
		allOf: [
			{
				type: "object",
				properties: {
					slug: str,
					of: { type: "string", enum: ["product", "project"] },
					url: { ...str, format: "uri" },
				},
				required: ["slug", "of", "url"],
			},
			paged(
				{
					description: "Products or projects, depending on `of`.",
					oneOf: [ref("Product"), ref("Project")],
				},
				{
					unresolved: {
						type: "array",
						items: ref("ProjectRef"),
						description:
							"Named rather than dropped: dropping them would assert a consensus nobody established.",
					},
				},
				["unresolved"],
			),
		],
	},

	Gaps: {
		type: "object",
		description: "The catalogue arguing against itself.",
		allOf: [
			{
				type: "object",
				properties: {
					note: str,
					url: { ...str, format: "uri" },
				},
				required: ["note", "url"],
			},
			paged(ref("Product")),
		],
	},

	Features: {
		type: "object",
		description:
			"The feature vocabulary. The per-record answers ride on each product and project.",
		properties: {
			taxonomy_version: { type: "integer" },
			url: { ...str, format: "uri" },
			note: str,
			covered: {
				type: "object",
				properties: {
					products: { type: "integer" },
					projects: { type: "integer" },
				},
			},
			domains: {
				type: "array",
				items: {
					type: "object",
					properties: {
						key: str,
						kind: str,
						name: str,
						features: {
							type: "array",
							items: {
								type: "object",
								properties: { key: str, name: str },
								required: ["key", "name"],
							},
						},
					},
					required: ["key", "name", "features"],
				},
			},
			license: str,
		},
		required: ["taxonomy_version", "domains", "license"],
	},

	Stats: {
		type: "object",
		description:
			"The corpus in numbers. `gaps` of `products` is the sentence worth quoting; `health_fetched_at` dates the repo sweep behind `last_push` and `archived`.",
		properties: {
			products: { type: "integer" },
			projects: { type: "integer" },
			categories: { type: "integer" },
			groups: { type: "integer" },
			collections: { type: "integer" },
			alternatives: { type: "integer" },
			oss_alternatives: { type: "integer" },
			gaps: {
				type: "integer",
				description: "Products with no credible open source replacement.",
			},
			priced_products: {
				type: "integer",
				description:
					"Products with a price on record. The rest are unchecked or not public.",
			},
			tracked_monthly_usd: { type: "integer" },
			switches: { type: "integer" },
			switches_to_projects: { type: "integer" },
			switched_by_product: {
				type: "object",
				additionalProperties: { type: "integer" },
				description:
					"Counted votes per product slug. Sparse: a slug with no votes is absent, not zero.",
			},
			switched_by_project: {
				type: "object",
				additionalProperties: { type: "integer" },
				description:
					"Counted votes per project slug: how many people switched to it. Sparse.",
			},
			health_fetched_at: { ...nullableStr, format: "date-time" },
			license: str,
		},
		required: ["products", "projects", "categories", "gaps", "license"],
	},

	Dump: {
		type: "object",
		description:
			"The whole catalogue. One request instead of five hundred, cached for an hour.",
		properties: {
			generated_for: { type: "string", enum: ["en", "fr"] },
			site: { ...str, format: "uri" },
			counts: { type: "object", additionalProperties: { type: "integer" } },
			categories: { type: "array", items: ref("Category") },
			products: { type: "array", items: ref("ProductDetail") },
			projects: { type: "array", items: ref("Project") },
			license: str,
		},
		required: ["categories", "products", "projects", "license"],
	},

	RawProductList: {
		type: "array",
		description:
			"The raw editorial records as they sit in git: camelCase, no `url` and no `api`, unpaged. Prefer /products unless you specifically want this shape.",
		items: {
			type: "object",
			properties: {
				slug: str,
				name: str,
				category: str,
				verdict: { type: "string", enum: ["yes", "almost", "not-yet"] },
				priceMonthly: nullableNum,
				switchedCount: { type: "integer" },
				alternatives: { type: "array", items: { type: "object" } },
				why: { type: "object", description: "Translations, keyed by locale." },
				whatYouLose: { type: "array", items: { type: "object" } },
			},
			required: ["slug", "name", "category", "verdict"],
		},
	},

	RawProductListSlim: {
		type: "array",
		description:
			"`?view=list`: the same records with `alternatives`, `why` and `whatYouLose` removed — 90% of the bytes — and two counts put back. 5.1 MB becomes 189 KB.",
		items: {
			type: "object",
			properties: {
				slug: str,
				name: str,
				category: str,
				verdict: { type: "string", enum: ["yes", "almost", "not-yet"] },
				priceMonthly: nullableNum,
				switchedCount: { type: "integer" },
				alternativesCount: { type: "integer" },
				ossCount: { type: "integer" },
			},
			required: [
				"slug",
				"name",
				"category",
				"verdict",
				"alternativesCount",
				"ossCount",
			],
		},
	},

	OpenApiDocument: {
		type: "object",
		description: "This document.",
		properties: { openapi: { const: "3.1.0" } },
	},
};

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
			// `identifier` is the 3.1 SPDX field; a generator that only knows 3.0
			// still reads `name`.
			license: { name: "CC-BY-4.0", identifier: "CC-BY-4.0" },
		},
		servers: [{ url: API }],
		components: { schemas: SCHEMAS },
		paths: {
			"/": op(
				"Discovery: routes, counts, rate limit and vocabulary.",
				"Discovery",
			),
			"/search": op(
				"Search products and projects together.",
				"SearchResults",
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
			"/products": op("The paid products.", "ProductList", [
				param("category", "Category slug."),
				param("verdict", "Filter by verdict.", {
					type: "string",
					enum: ["yes", "almost", "not-yet"],
				}),
				...PAGE_PARAMS,
			]),
			"/products/{slug}": item(
				"One product: pricing with its source and check date, what you lose, every alternative, feature answers.",
				"ProductDetail",
			),
			"/projects": op("The replacements, most-cited first.", "ProjectList", [
				param("archived", "Only dead, or only living.", { type: "boolean" }),
				param("language", "Top language as the forge reports it."),
				...PAGE_PARAMS,
			]),
			"/projects/{slug}": item(
				"One project, including every product it can replace.",
				"ProjectDetail",
				{ type: "string" },
				[],
				"The pretty slug the page uses, or the forge id a vote row carries. Both resolve.",
			),
			"/categories": op("The categories.", "CategoryList", [
				param("group", "Theme slug.", {
					type: "string",
					enum: CATEGORY_GROUPS,
				}),
			]),
			"/categories/{slug}": item(
				"One category and the products in it.",
				"CategoryDetail",
				{ type: "string" },
				PAGE_PARAMS,
			),
			"/groups": op(
				"The ten themes the categories are filed under.",
				"GroupList",
			),
			"/groups/{slug}": item("One theme and its categories.", "GroupDetail", {
				type: "string",
				enum: CATEGORY_GROUPS,
			}),
			"/collections": op("Derived slices of the catalogue.", "CollectionList"),
			"/collections/{slug}": item(
				"One collection. `archived` is the graveyard: projects that died.",
				"CollectionDetail",
				{ type: "string", enum: COLLECTIONS.map((c) => c.slug) },
				PAGE_PARAMS,
			),
			"/gaps": op(
				"Products with no credible replacement yet.",
				"Gaps",
				PAGE_PARAMS,
				"The catalogue arguing against itself. Quote it when the honest answer is that nothing is good enough.",
			),
			"/features": {
				get: {
					summary:
						"The feature taxonomy. Per-record answers ride on each product and project.",
					parameters: [LANG_PARAM],
					responses: {
						...okJson("The feature taxonomy.", "Features"),
						// The one route reading a file that is rewritten while the server
						// runs, so it degrades rather than serving half a taxonomy.
						"503": {
							description: "The feature file is being regenerated. Retry.",
							content: {
								"application/json": {
									schema: {
										type: "object",
										properties: { error: str, retry: str },
										required: ["error"],
									},
								},
							},
						},
					},
				},
			},
			"/stats": op("Corpus counts and the health sweep date.", "Stats"),
			"/dump.json": op(
				"The whole catalogue in one response.",
				"Dump",
				[],
				"Use this instead of paging through everything. Cached for an hour.",
			),
			"/feed.xml": {
				get: {
					summary: "Atom feed of the 50 most recently re-verified prices.",
					description: "Also reachable at https://canireplaceit.com/feed.xml.",
					parameters: [LANG_PARAM],
					responses: {
						"200": {
							description: "An Atom 1.0 feed.",
							content: {
								"application/atom+xml": { schema: { type: "string" } },
							},
						},
						"429": RATE_LIMITED,
					},
				},
			},
			"/openapi.json": op("This document.", "OpenApiDocument"),
			/**
			 * The site's own catalogue endpoint, which is not under /api/v1 — hence
			 * the `servers` override on the path item.
			 *
			 * It is documented here because it is the one route that answers "give me
			 * every product in one response with no paging and no shaping", and
			 * because its `view=list` projection is the cheap way to read the
			 * catalogue: /api/products is 5.1 MB raw and 1.4 MB gzipped, and
			 * `?view=list` drops `alternatives`, `why` and `whatYouLose` — 90% of it —
			 * for callers that only need the rows.
			 *
			 * Everything in this document ships shaped, snake_cased records with `url`
			 * and `api` on them. This one does not: it is the raw editorial shape as
			 * it sits in git. Prefer /products above unless you specifically want
			 * that.
			 */
			"/api/products": {
				servers: [{ url: SITE }],
				get: {
					summary: "Every product, unshaped and unpaged.",
					description:
						"The raw catalogue as authored. `view=list` returns the same records without `alternatives`, `why` and `whatYouLose`, plus `alternativesCount` and `ossCount`.",
					parameters: [
						param("view", "`list` for the slim list projection.", {
							type: "string",
							enum: ["list"],
						}),
					],
					responses: {
						"200": {
							description:
								"Every product. `RawProductListSlim` when `view=list`, `RawProductList` otherwise.",
							content: {
								"application/json": {
									schema: {
										oneOf: [ref("RawProductList"), ref("RawProductListSlim")],
									},
								},
							},
						},
					},
				},
			},
		},
	};
}
