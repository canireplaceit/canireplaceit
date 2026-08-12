/**
 * The content model. Every product is one JSON file in `data/products/<slug>.json`,
 * added and edited by pull request — the repo is the admin panel.
 *
 * Translatable prose is a `{ en, fr, … }` map, never a suffixed column, so adding
 * a language is a data change and never a schema change.
 */

import { isLang, type Lang, SupportedLangs, type Translations } from "./index";

/**
 * Editorial judgement of functional parity — how much of the job the best
 * alternative actually does. This is the ONLY judgement a contributor makes;
 * the ladder rung below is derived from it plus verifiable facts.
 *   yes     — feature-complete for the realistic use case
 *   almost  — covers part of it; you lose something real
 *   not-yet — nothing credible exists
 */
export const VERDICTS = ["yes", "almost", "not-yet"] as const;
export type Verdict = (typeof VERDICTS)[number];

/**
 * The exit ladder. Each rung is a strictly stronger claim than the one below,
 * and it is COMPUTED, never authored — so it stays consistent across the whole
 * dataset instead of drifting with whoever wrote the entry.
 *
 *   locked-in      no credible exit at all
 *   partial        alternatives cover part of the job
 *   self-hostable  a real replacement exists, but you run it
 *   drop-in        escape without becoming a sysadmin
 *
 * The self-hostable/drop-in split is the one that decides whether somebody
 * actually switches: Headscale and opencode are both "replaceable", but one
 * hands you a control server to operate forever and the other is a binary.
 */
export const RUNGS = [
	"locked-in",
	"partial",
	"self-hostable",
	"drop-in",
] as const;
export type Rung = (typeof RUNGS)[number];

/** The cheapest realistic way to run an open source alternative. */
export const EFFORTS = ["managed", "docker", "ops"] as const;
export type Effort = (typeof EFFORTS)[number];

export const ALT_KINDS = ["oss", "cheaper"] as const;

/** Prices drift. Every claim carries a receipt so a reviewer can check it. */
export type PriceSource = {
	/** What the vendor calls the tier we priced. */
	plan: string;
	basis: "flat" | "per-seat" | "usage" | "one-time" | "custom";
	url: string;
	/** ISO date, YYYY-MM-DD. */
	checkedOn: string;
	confidence: "high" | "medium" | "low";
};

export const PRICE_BASIS = [
	"flat",
	"per-seat",
	"usage",
	"one-time",
	"custom",
] as const;
export const CONFIDENCE = ["high", "medium", "low"] as const;

/**
 * What the dataset can honestly say about a product's price. Derived, never
 * authored — the three states below are the only three the schema can express,
 * and the UI must not collapse them into one another.
 *
 *   priced      a number, with a receipt if someone left one
 *   no-price    verified: the vendor publishes no price (`notPublic`)
 *   unverified  nobody has looked yet — the DEFAULT, and never a claim
 *
 * The distinction between the last two is the whole point of `notPublic`:
 * before it existed, both were `pricing: null` and every re-check had to redo
 * the ones that were already settled.
 */
export type PriceState = "priced" | "no-price" | "unverified";

export function priceState(product: {
	priceMonthly: number | null;
	pricing: PriceSource | null;
	notPublic?: boolean;
}): PriceState {
	if (product.notPublic) return "no-price";
	if (product.priceMonthly !== null || product.pricing) return "priced";
	return "unverified";
}

/**
 * How much of the catalogue's pricing carries a source, and the most recent
 * date any of it was read on. The site-level freshness line.
 *
 * `latest` is the newest `checkedOn` in the DATA, never the clock. Printing
 * today's date there would tell a reader the catalogue was looked at today,
 * which is a claim only the data can make.
 */
export type PriceFreshness = {
	total: number;
	/** Products whose price has a receipt or is a confirmed non-price. */
	sourced: number;
	/** Newest `checkedOn` across the set, or null if nothing is sourced. */
	latest: string | null;
};

export function priceFreshness(
	products: {
		priceMonthly: number | null;
		pricing: PriceSource | null;
		notPublic?: boolean;
	}[],
): PriceFreshness {
	let sourced = 0;
	let latest: string | null = null;
	for (const p of products) {
		if (p.pricing) {
			sourced++;
			// ISO dates sort lexicographically, so no parsing is needed.
			if (latest === null || p.pricing.checkedOn > latest) {
				latest = p.pricing.checkedOn;
			}
		}
	}
	return { total: products.length, sourced, latest };
}

/**
 * Repo liveness, fetched from the forge into `data/health.json` by
 * `bun run health` and keyed by `healthKey`. Never authored: last-commit dates
 * go stale the moment they are written down, so hand-maintaining them
 * guarantees the site lies.
 *
 * EVERY FIELD IS OPTIONAL, and that is the point. Six forges are queried and
 * they do not answer the same questions: GitLab's unauthenticated API does not
 * report `archived` at all, Bitbucket Server reports neither a language nor a
 * homepage. A forge that cannot tell us something leaves the field out, and a
 * missing field means "we do not know" — never `false`, never zero. Rendering
 * absence as a fact is the one thing this data must not do.
 */
export type Health = {
	/**
	 * ISO date of the last activity on the repo. On GitHub this is exactly
	 * `pushed_at`; on the other forges it is the closest thing they expose
	 * (`updated_at`, `last_activity_at`), which can also be bumped by an issue or
	 * a star. That asymmetry is safe only because of how it is used: the UI
	 * renders this solely to say a project looks DORMANT, so a forge that
	 * over-reports activity can suppress that badge but can never invent it.
	 */
	lastPush?: string;
	/**
	 * The repo is archived — read-only, done. The single most valuable reading
	 * here. Absent for forges that will not say, which is not the same as false.
	 */
	archived?: boolean;
	/** SPDX id as the forge reports it — may disagree with what we claim. */
	license?: string | null;
	/** Ships a compose file in the repo root — i.e. `docker compose up` works. */
	hasCompose?: boolean;
	/** Top language by bytes, as the forge reports it. Null for empty repos. */
	language?: string | null;
	/**
	 * The project's own site, as the forge records it — where the docs and the
	 * install instructions usually are, which is a different question from where
	 * the code is. Null when the repo declares none, and simply absent from
	 * readings taken before this field existed, so callers must treat a missing
	 * one as "we do not know" rather than "there is none".
	 */
	homepage?: string | null;
};

/**
 * `data/health.json` as a whole. The wrapper exists for `fetchedAt`: readings
 * that a failed request carried over from an earlier run keep that run's
 * numbers, so the file needs its own date before anything renders how old the
 * oldest of them might be — and, since nobody runs this by hand, before the UI
 * can decide the whole file is too old to show at all.
 */
export type HealthFile = {
	/** ISO date, YYYY-MM-DD, of the run that wrote this file. */
	fetchedAt: string;
	/** Keyed by `healthKey`. */
	repos: Record<string, Health>;
};

/**
 * Key for one repo's readings in `data/health.json`.
 *
 * GitHub keeps its bare `owner/name`, because 869 entries are already written
 * under it and rewriting them would throw away a full sweep to gain nothing.
 * Every other forge is prefixed with its hostname, which is the only thing that
 * makes the key unique: `blender/blender` exists on projects.blender.org AND on
 * GitHub as a mirror, and three separate Gitea instances are queried here.
 */
export const healthKey = (source: Source): string =>
	source.host === "github"
		? source.path
		: `${(() => {
				try {
					return new URL(source.url).hostname.replace(/^www\./, "");
				} catch {
					return source.host;
				}
			})()}/${source.path}`;

/**
 * Is this project done? One place, so the badge, the ordering and the
 * collections can never disagree about a project's state.
 *
 * The forge wins when it has an opinion: it is checked nightly and we are not.
 * `archived` on the entry covers the two-thirds of cited repos that have no
 * health reading at all, and outlives a health file that gets truncated or
 * goes stale.
 *
 * Deliberately NOT read from the note. Prose is where this fact used to live,
 * and it cannot be trusted for it: of the notes matching /archived/, several
 * were describing a DIFFERENT project's death ("Roo Code's own repo is now
 * archived, so this is the live fork") — which is the opposite claim.
 */
export const isArchived = (
	entry: { archived?: boolean },
	/** This repo's reading, already resolved — `healthOf(source)` in the app. */
	health?: Pick<Health, "archived"> | null,
): boolean => health?.archived ?? entry.archived === true;

/**
 * The facts that decide whether an "open source alternative" actually frees you.
 * Required: an entry without these is a claim, not information.
 */
export type Facts = {
	/** Can you genuinely run it yourself, or is it open source in name only? */
	selfHostable: boolean;
	/**
	 * How much is withheld from the free/self-hosted build.
	 *   none  — the self-hosted build is the whole product
	 *   minor — a few enterprise conveniences are paid
	 *   major — the free build is a demo; the useful half is paid
	 */
	openCore: "none" | "minor" | "major";
	/** What exactly is paywalled, if anything. One short line. */
	paywalled?: Translations;
	/** SSO/SAML without paying. The "SSO tax" — null when genuinely unknown. */
	ssoInFree: boolean | null;
	/**
	 * Where the data can legally sit.
	 *   self      — your server, so GDPR is your own posture
	 *   eu-option — hosted, with an EU region you can choose
	 *   us-only   — hosted in the US only
	 */
	dataResidency: "self" | "eu-option" | "us-only" | "unknown";
};

export const OPEN_CORE = ["none", "minor", "major"] as const;
export const RESIDENCY = ["self", "eu-option", "us-only", "unknown"] as const;

/**
 * Where the code actually lives. Plenty of important projects are not on GitHub
 * — Forgejo is on Codeberg, Inkscape and Krita are on GitLab, and several are on
 * their own Gitea. Dropping those would misrepresent the ecosystem, so the host
 * is part of the model rather than an assumption.
 */
export const FORGES = [
	"github",
	"gitlab",
	"codeberg",
	"gitea",
	"forgejo",
	"sourcehut",
	"bitbucket",
	"savannah",
	"other",
] as const;
export type Forge = (typeof FORGES)[number];

export type Source = {
	host: Forge;
	/** owner/name, or the closest equivalent the host has. */
	path: string;
	/** Canonical URL. Always present so nothing has to guess how a host builds URLs. */
	url: string;
};

export type OssAlternative = {
	kind: "oss";
	name: string;
	source: Source;
	license: string;
	effort: Effort;
	note: Translations;
	facts: Facts;
	/**
	 * Does the repo ship a compose file you can actually run? Detected at build
	 * time by `bun run health`, not authored — see scripts/fetch-health.ts.
	 */
	hasCompose?: boolean;
	/**
	 * The project is done — the forge says archived, or its maintainers have
	 * said so. Archived entries are KEPT and shown, because a catalogue that
	 * silently drops what died only ever describes the present tense; they are
	 * demoted in the ordering and badged, never hidden.
	 *
	 * This is authored on the entry rather than read from `health.json` alone:
	 * health covers about a third of the cited repos, so reading it as the only
	 * source left 142 projects we already knew were dead rendering as alive.
	 * `health.archived` still wins when it disagrees — the forge outranks us —
	 * see `isArchived`.
	 */
	archived?: boolean;
};

export type CheaperAlternative = {
	kind: "cheaper";
	name: string;
	url: string;
	/**
	 * USD per month. Must undercut the product it replaces.
	 * Null when the price is quote-only, or when it is a perpetual licence —
	 * in which case `priceOnce` carries the real figure.
	 */
	priceMonthly: number | null;
	/**
	 * USD, paid once, for perpetual licences. Without this, a one-time purchase
	 * has to be written as `priceMonthly: 0`, which renders as "free" — REAPER is
	 * $60 and DaVinci Resolve Studio is $295, so that is simply a lie.
	 */
	priceOnce?: number;
	note: Translations;
};

export type Alternative = OssAlternative | CheaperAlternative;

export type Product = {
	slug: string;
	name: string;
	/** Primary domain — used for the favicon and the outbound link. Null until someone fills it in. */
	domain: string | null;
	category: string;
	/** USD per month for the typical paid tier. Null when it genuinely varies. */
	priceMonthly: number | null;
	pricing: PriceSource | null;
	/**
	 * Set ONLY after somebody looked and confirmed the vendor publishes no price
	 * at all — "contact sales", and nothing else. Absent is the default and means
	 * nobody has checked yet.
	 *
	 * Without this flag those two are the same `pricing: null`, and the site has
	 * no way to say "we know" rather than "we don't". Every price-verification
	 * pass then re-does the same settled entries, which is exactly what happened
	 * three times before this field existed. It is a claim, so it carries a
	 * receipt: `pricing` must be present with the page that was read and the date
	 * it was read on.
	 */
	notPublic?: true;
	verdict: Verdict;
	/** The argument. One or two sentences, opinionated, per language. */
	why: Translations;
	/**
	 * What you actually give up by leaving. 2-4 short bullets per language, and
	 * the bounds are enforced — see `WHAT_YOU_LOSE_MIN`/`MAX`.
	 */
	whatYouLose: Translations[];
	alternatives: Alternative[];
	/** Editorial weight for default ordering, 1 (low) to 5 (high). */
	priority: number;
};

/**
 * The themes the 84 categories are filed under, in the order the index reads
 * them: the software most people already pay for first, the specialist and
 * personal corners last.
 *
 * AUTHORED, and deliberately so. The index used to be one flat 84-row ranking,
 * and the obvious cheap way to section it was to slice on `position` — the runs
 * in that field really do cluster (0–26 is the original core set, 27–40 the
 * infrastructure block, 41+ the later business and industry additions). That
 * reading is an accident of the order the categories were ADDED, not a
 * statement about what they are, and it stops being true the moment somebody
 * inserts a row: every category after the seam silently changes theme. So the
 * theme is a field on the category, `validateCategory` refuses one that is
 * missing or unknown, and a new category cannot land ungrouped.
 *
 * `position` keeps its own job — it is still the adjacency `neighboursOf` reads
 * for "nearby categories", and it is still the lookup order in the full menu.
 */
export const CATEGORY_GROUPS = [
	"work",
	"dev",
	"infra",
	"security",
	"ai-data",
	"growth",
	"commerce",
	"operations",
	"creative",
	"home",
] as const;

export type CategoryGroup = (typeof CATEGORY_GROUPS)[number];

export type Category = {
	slug: string;
	name: Translations;
	/** Lucide icon name, rendered by the web app. */
	icon: string;
	/** Which theme the index files this under. See `CATEGORY_GROUPS`. */
	group: CategoryGroup;
	position: number;
};

export type Issue = { path: string; message: string };

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

/**
 * `whatYouLose` bounds, enforced rather than suggested.
 *
 * One bullet is not a list, it is a shrug — and the field is the only place the
 * site argues against itself, so a single grudging entry is exactly the failure
 * mode worth blocking. The ceiling is a layout fact: these render as chips in a
 * row, and past four they wrap into a paragraph nobody scans. Documented in
 * CONTRIBUTING.md with the same two numbers.
 */
export const WHAT_YOU_LOSE_MIN = 2;
export const WHAT_YOU_LOSE_MAX = 4;

/**
 * Fields that belong to exactly one kind of alternative.
 *
 * The two kinds answer different questions, and an entry carrying the other
 * kind's fields is one that was edited from one into the other and left half
 * converted — a `cheaper` row with a `license` reads as open source in every
 * view that checks for one, and an `oss` row with a `priceMonthly` invites a
 * price to be rendered for something that is free. Neither is caught by the
 * per-field checks below, because those only look at fields they expect.
 */
const OSS_ONLY_FIELDS = [
	"source",
	"repo",
	"license",
	"effort",
	"facts",
	"hasCompose",
	"archived",
] as const;
const CHEAPER_ONLY_FIELDS = ["url", "priceMonthly", "priceOnce"] as const;

function checkTranslations(v: unknown, path: string, issues: Issue[]): void {
	if (!isPlainObject(v)) {
		issues.push({
			path,
			message: "must be a translations object, e.g. { en, fr }",
		});
		return;
	}
	if (typeof v.en !== "string" || v.en.trim() === "") {
		issues.push({
			path: `${path}.en`,
			message: "English is required — it is the fallback",
		});
	}
	for (const [key, value] of Object.entries(v)) {
		if (!isLang(key)) {
			issues.push({
				path: `${path}.${key}`,
				message: `unknown locale — supported: ${SupportedLangs.join(", ")}`,
			});
		} else if (typeof value !== "string" || value.trim() === "") {
			issues.push({
				path: `${path}.${key}`,
				message: "must be a non-empty string",
			});
		}
	}
}

function checkAlternative(v: unknown, path: string, issues: Issue[]): void {
	if (!isPlainObject(v)) {
		issues.push({ path, message: "must be an object" });
		return;
	}
	if (v.kind !== "oss" && v.kind !== "cheaper") {
		issues.push({
			path: `${path}.kind`,
			message: `must be one of: ${ALT_KINDS.join(", ")}`,
		});
		return;
	}
	if (typeof v.name !== "string" || !v.name.trim()) {
		issues.push({ path: `${path}.name`, message: "required" });
	}
	checkTranslations(v.note, `${path}.note`, issues);

	// Wrong-kind fields. Checked before the per-field rules so the message names
	// the real mistake ("this is not an oss entry") rather than the symptom.
	const strays = (v.kind === "oss" ? CHEAPER_ONLY_FIELDS : OSS_ONLY_FIELDS)
		.filter((f) => v[f] !== undefined)
		.join(", ");
	if (strays) {
		issues.push({
			path,
			message: `a "${v.kind}" alternative must not carry ${strays} — that belongs to the other kind`,
		});
	}

	// Required on open source entries — that is the whole claim being made.
	if (v.kind === "oss" && v.facts === undefined) {
		issues.push({
			path: `${path}.facts`,
			message: "required: selfHostable, openCore, ssoInFree, dataResidency",
		});
	} else if (v.facts !== undefined) {
		const f = v.facts;
		if (!isPlainObject(f)) {
			issues.push({ path: `${path}.facts`, message: "must be an object" });
		} else {
			if (typeof f.selfHostable !== "boolean") {
				issues.push({
					path: `${path}.facts.selfHostable`,
					message: "must be true or false",
				});
			}
			if (!OPEN_CORE.includes(f.openCore as (typeof OPEN_CORE)[number])) {
				issues.push({
					path: `${path}.facts.openCore`,
					message: `must be one of: ${OPEN_CORE.join(", ")}`,
				});
			}
			if (f.ssoInFree !== null && typeof f.ssoInFree !== "boolean") {
				issues.push({
					path: `${path}.facts.ssoInFree`,
					message: "must be true, false, or null when unknown",
				});
			}
			if (!RESIDENCY.includes(f.dataResidency as (typeof RESIDENCY)[number])) {
				issues.push({
					path: `${path}.facts.dataResidency`,
					message: `must be one of: ${RESIDENCY.join(", ")}`,
				});
			}
			// A claim of withheld features has to say what is withheld.
			if (f.openCore !== "none" && f.paywalled === undefined) {
				issues.push({
					path: `${path}.facts.paywalled`,
					message: "say what is paywalled when openCore is not 'none'",
				});
			}
			if (f.paywalled !== undefined) {
				checkTranslations(f.paywalled, `${path}.facts.paywalled`, issues);
			}
		}
	}

	if (v.kind === "oss") {
		const s = v.source;
		if (!isPlainObject(s)) {
			issues.push({
				path: `${path}.source`,
				message: "required: { host, path, url }",
			});
		} else {
			if (!FORGES.includes(s.host as Forge)) {
				issues.push({
					path: `${path}.source.host`,
					message: `must be one of: ${FORGES.join(", ")}`,
				});
			}
			if (typeof s.path !== "string" || !REPO_RE.test(s.path)) {
				issues.push({
					path: `${path}.source.path`,
					message: "must look like owner/name",
				});
			}
			if (typeof s.url !== "string" || !s.url.startsWith("https://")) {
				issues.push({
					path: `${path}.source.url`,
					message: "must be the canonical https URL",
				});
			}
		}
		if (typeof v.license !== "string" || !v.license.trim()) {
			issues.push({
				path: `${path}.license`,
				message: "required, e.g. AGPL-3.0",
			});
		}
		if (!EFFORTS.includes(v.effort as Effort)) {
			issues.push({
				path: `${path}.effort`,
				message: `must be one of: ${EFFORTS.join(", ")}`,
			});
		}
	} else {
		if (typeof v.url !== "string" || !v.url.startsWith("http")) {
			issues.push({ path: `${path}.url`, message: "must be an http(s) URL" });
		}
		// Null is legitimate: plenty of "cheaper" options are also quote-only.
		if (
			v.priceMonthly !== null &&
			(typeof v.priceMonthly !== "number" || v.priceMonthly < 0)
		) {
			issues.push({
				path: `${path}.priceMonthly`,
				message: "must be a number >= 0, or null when quote-only",
			});
		}
		if (v.priceOnce !== undefined) {
			if (typeof v.priceOnce !== "number" || v.priceOnce <= 0) {
				issues.push({
					path: `${path}.priceOnce`,
					message: "must be a positive number — what it costs to buy once",
				});
			}
			// Otherwise the page would show both a monthly and a one-off price.
			if (v.priceMonthly !== null) {
				issues.push({
					path: `${path}.priceMonthly`,
					message:
						"must be null when priceOnce is set — it is not a subscription",
				});
			}
		}
	}
}

/**
 * Validates one product file. `filename` is the basename without extension, so
 * we can enforce that it matches the slug — the thing reviewers forget most.
 */
export function validateProduct(
	value: unknown,
	filename: string,
	knownCategories: ReadonlySet<string>,
): Issue[] {
	const issues: Issue[] = [];
	if (!isPlainObject(value))
		return [{ path: ".", message: "file must contain a JSON object" }];

	if (typeof value.slug !== "string" || !SLUG_RE.test(value.slug)) {
		issues.push({ path: "slug", message: "must be lowercase-with-hyphens" });
	} else if (value.slug !== filename) {
		issues.push({
			path: "slug",
			message: `must match the filename (${filename}.json)`,
		});
	}

	if (typeof value.name !== "string" || !value.name.trim()) {
		issues.push({ path: "name", message: "required" });
	}
	if (
		value.domain !== null &&
		(typeof value.domain !== "string" || !value.domain.includes("."))
	) {
		issues.push({
			path: "domain",
			message: "e.g. notion.so — no scheme, no slash. Null if unknown.",
		});
	}
	if (
		typeof value.category !== "string" ||
		!knownCategories.has(value.category)
	) {
		issues.push({
			path: "category",
			message: `unknown category — add it to data/categories.json first`,
		});
	}
	if (!VERDICTS.includes(value.verdict as Verdict)) {
		issues.push({
			path: "verdict",
			message: `must be one of: ${VERDICTS.join(", ")}`,
		});
	}
	if (value.priceMonthly !== null && typeof value.priceMonthly !== "number") {
		issues.push({
			path: "priceMonthly",
			message: "must be a number, or null if it varies",
		});
	}

	// PRESENT, even when null. `Product.pricing` is `PriceSource | null` — a
	// required key — and the frontend parses it as `PriceSourceSchema.nullable()`,
	// which accepts null and REJECTS an absent key. Without this check the
	// validator passes files that blow up /api/products at runtime, which is
	// exactly what happened to 34 products in the CLI batch.
	if (!("pricing" in value)) {
		issues.push({
			path: "pricing",
			message:
				"required — use null when nobody has checked the price. An absent key fails the frontend schema even though null passes.",
		});
	} else if (value.pricing !== null && value.pricing !== undefined) {
		if (!isPlainObject(value.pricing)) {
			issues.push({ path: "pricing", message: "must be an object, or null" });
		} else {
			const p = value.pricing;
			if (typeof p.url !== "string" || !p.url.startsWith("http")) {
				issues.push({
					path: "pricing.url",
					message: "link the vendor's pricing page",
				});
			}
			if (typeof p.checkedOn !== "string" || !DATE_RE.test(p.checkedOn)) {
				issues.push({
					path: "pricing.checkedOn",
					message: "must be a YYYY-MM-DD date",
				});
			}
			// The UI shows a low-confidence price differently from a high-confidence
			// one, so an unrecognised value would silently render as the strongest.
			if (!CONFIDENCE.includes(p.confidence as (typeof CONFIDENCE)[number])) {
				issues.push({
					path: "pricing.confidence",
					message: `must be one of: ${CONFIDENCE.join(", ")}`,
				});
			}
			if (!PRICE_BASIS.includes(p.basis as (typeof PRICE_BASIS)[number])) {
				issues.push({
					path: "pricing.basis",
					message: `must be one of: ${PRICE_BASIS.join(", ")}`,
				});
			}
		}
	}

	// "Verified as quote-only" is a claim, so it needs a receipt and a date — the
	// entire reason the flag exists is to stop the next reviewer re-checking it.
	if (value.notPublic !== undefined) {
		if (value.notPublic !== true) {
			issues.push({
				path: "notPublic",
				message:
					"must be true, or absent — there is no 'false', absent means nobody checked",
			});
		}
		if (value.priceMonthly !== null) {
			issues.push({
				path: "notPublic",
				message: "only for products with priceMonthly: null — you have a price",
			});
		}
		if (!isPlainObject(value.pricing)) {
			issues.push({
				path: "pricing",
				message:
					"required with notPublic: the page you read and the date you read it",
			});
		}
	}

	checkTranslations(value.why, "why", issues);

	if (!Array.isArray(value.whatYouLose)) {
		issues.push({ path: "whatYouLose", message: "must be an array" });
	} else {
		if (
			value.whatYouLose.length < WHAT_YOU_LOSE_MIN ||
			value.whatYouLose.length > WHAT_YOU_LOSE_MAX
		) {
			issues.push({
				path: "whatYouLose",
				message: `list ${WHAT_YOU_LOSE_MIN}-${WHAT_YOU_LOSE_MAX} short, honest downsides — ${value.whatYouLose.length} given`,
			});
		}
		value.whatYouLose.forEach((b, i) => {
			checkTranslations(b, `whatYouLose[${i}]`, issues);
		});
	}

	if (!Array.isArray(value.alternatives) || value.alternatives.length === 0) {
		issues.push({
			path: "alternatives",
			message: "at least one alternative is required",
		});
	} else {
		value.alternatives.forEach((a, i) => {
			checkAlternative(a, `alternatives[${i}]`, issues);
		});
		if (!value.alternatives.some((a) => isPlainObject(a) && a.kind === "oss")) {
			issues.push({
				path: "alternatives",
				message:
					"at least one open source alternative is required — that is the point of the site",
			});
		}
	}

	if (
		typeof value.priority !== "number" ||
		value.priority < 1 ||
		value.priority > 5
	) {
		issues.push({ path: "priority", message: "must be a number from 1 to 5" });
	}

	return issues;
}

export function validateCategory(value: unknown, index: number): Issue[] {
	const issues: Issue[] = [];
	if (!isPlainObject(value))
		return [{ path: `[${index}]`, message: "must be an object" }];
	if (typeof value.slug !== "string" || !SLUG_RE.test(value.slug)) {
		issues.push({
			path: `[${index}].slug`,
			message: "must be lowercase-with-hyphens",
		});
	}
	if (typeof value.icon !== "string" || !value.icon.trim()) {
		issues.push({
			path: `[${index}].icon`,
			message: "required — a lucide icon name",
		});
	}
	// The whole point of an authored theme is that it cannot be forgotten, so an
	// absent or misspelled one is an error and never a default.
	if (!CATEGORY_GROUPS.includes(value.group as CategoryGroup)) {
		issues.push({
			path: `[${index}].group`,
			message: `must be one of ${CATEGORY_GROUPS.join(", ")}`,
		});
	}
	checkTranslations(value.name, `[${index}].name`, issues);
	return issues;
}

/**
 * The categories filed under each theme, in `CATEGORY_GROUPS` order, with the
 * rows inside a theme left in the order they were handed over.
 *
 * Empty themes are dropped rather than rendered as a heading over nothing.
 */
export function byGroup<T extends { group: CategoryGroup }>(
	cats: T[],
): { group: CategoryGroup; cats: T[] }[] {
	return CATEGORY_GROUPS.map((group) => ({
		group,
		cats: cats.filter((c) => c.group === group),
	})).filter((g) => g.cats.length > 0);
}

/**
 * Where a product sits on the exit ladder. Derived, never authored.
 *
 * "Drop-in" requires an alternative you do not have to operate: either a
 * managed/hosted tier, or something that runs on your own machine. That is the
 * difference between "you could leave" and "you will leave".
 */
export function rungOf(product: Product): Rung {
	const oss = product.alternatives.filter(
		(a): a is OssAlternative =>
			a.kind === "oss" && a.facts?.selfHostable !== false,
	);
	if (product.verdict === "not-yet" || oss.length === 0) return "locked-in";
	if (product.verdict === "almost") return "partial";
	return oss.some((a) => a.effort === "managed") ? "drop-in" : "self-hostable";
}

/**
 * Whether a `license` string describes a genuinely free/open source licence.
 *
 * THREE states, not two. `license` is free prose — 83 distinct strings across
 * 1,463 alternatives, from "MIT" to "AGPL-3.0 core, partner program under a
 * commercial ee licence" — so a string that matches neither list is `unknown`
 * and simply does not appear anywhere a claim is made. Absence is not a claim;
 * membership is. Defaulting the tail into `foss` would be the site asserting a
 * licence on a project's behalf on the strength of not recognising it.
 *
 * Why this is tractable where a copyleft-vs-permissive filter was not: "is this
 * licence open source?" is a CLOSED-SET question. The licences that publish
 * source without being open source are a short, famous, named list, and the OSI
 * licence families are a short, famous, named list too. "Is this copyleft?"
 * needs the terms parsed; this needs only the name recognised.
 *
 * The rules, in the order they fire:
 *
 *  1. A NON-OPEN LICENCE FAMILY ANYWHERE IN THE STRING ⇒ `not-foss`, outright,
 *     even when an OSI name sits beside it. "AGPL-3.0 + Commons Clause" is the
 *     case that forces this: Commons Clause does not carve out a subdirectory,
 *     it strips the freedom to sell from the whole work, so position-based or
 *     "the first licence wins" rules get it wrong. The cost is ZeroTier
 *     ("MPL-2.0 (core) / source-available non-commercial (controller)") and
 *     OpenReplay, whose MPL and MIT cores arguably are free — they fall out of
 *     the FOSS side rather than into it, which is the safe direction to be
 *     wrong in.
 *
 *  2. A RECOGNISED OSI FAMILY ⇒ `foss`, INCLUDING open-core strings such as
 *     "MIT core with an ee/ directory", "AGPL-3.0 or commercial" and
 *     "Apache-2.0 (Community Edition only)". This is the judgement call worth
 *     naming, and it goes this way on purpose: FOSS is a question about the
 *     LICENCE OF THE PUBLISHED CODEBASE, self-hostability is a question about
 *     whether you can run it, and how much is held back is a THIRD question
 *     that `facts.openCore` already answers and the `open-core` collection
 *     already publishes. GitLab CE and Grafana are free software by every
 *     standard reading; folding "sells an enterprise edition" into "not FOSS"
 *     would say otherwise and would duplicate `openCore` under a wronger name.
 *     Enterprise wording — `ee/`, `enterprise`, `commercial`, `LicenseRef-SEL`
 *     — therefore does NOT appear in the non-open list, so the two strings the
 *     catalogue uses for Stalwart ("AGPL-3.0 / LicenseRef-SEL" and "AGPL-3.0 +
 *     Stalwart Enterprise Licence") cannot classify differently from each other.
 *
 *  3. Proprietary wording with no OSI family named at all ⇒ `not-foss`. Nothing
 *     in the catalogue reaches this rule today; it is here so that a future
 *     bare "Proprietary" cannot land in `unknown` and read as merely unrecognised.
 *
 *  4. Anything else ⇒ `unknown`. One string today: "CC-BY-4.0" (Font Awesome's
 *     free tier), a free CULTURE licence and not an OSI software licence.
 *
 * Checked against GitHub's own SPDX id from `data/health.json` for the 660
 * projects where GitHub reports one: zero disagreements. The remaining projects
 * are ones GitHub itself returns NOASSERTION for, which is the same signal this
 * function is reading — an unrecognisable licence.
 */
export type FossClass = "foss" | "not-foss" | "unknown";

/**
 * Licence families that publish source without being open source.
 *
 * Every name here is a specific, named licence, not an inference. `BSL`/`BUSL`
 * (Business Source), `SSPL`, `ELv2`/Elastic, `FSL`, Commons Clause, Sustainable
 * Use, Polyform and `MRPL` are licences; a vendor `EULA` is not an open source
 * licence by definition; and the three vendor-named ones (tldraw, Zrythm,
 * Defold) are bespoke licences their own vendors do not call open source.
 * "source-available", "not OSI" and "not open source" are the dataset saying so
 * in its own words.
 *
 * `BSL` is deliberately matched bare: all five alternatives carrying it are
 * Business Source (Outline, Directus, Sentry), not the Boost Software Licence.
 * If a Boost project is ever added it must be written "BSL-1.0 (Boost)" or,
 * better, "Boost" — the test file records this trap.
 */
const NOT_FOSS_LICENSE =
	/\b(?:BSL|BUSL|SSPL|ELv2|MRPL|EULA|MS-RSL)\b|\bFSL-1\.|\belastic\b|\bcommons\s+clause\b|\bsustainable[\s-]+use\b|\bpolyform\b|\bsource[\s-]available\b|\bnon-commercial\b|\bnot\s+OSI\b|\bnot\s+open\s+source\b|\banti-capitalist\b|\b(?:tldraw|zrythm|defold)\s+licen[cs]e\b/i;

/**
 * OSI-approved licence families, as the catalogue actually spells them.
 *
 * A positive match is REQUIRED for `foss` — an unrecognised string is `unknown`,
 * never FOSS by default. Loose enough to catch how the data really reads:
 * "Biopython License (MIT-style)" and "PSF-based BSD" are both genuinely free
 * and both name their family inside a longer phrase.
 */
const OSI_LICENSE =
	/\b(?:MIT|Apache-2\.0|AGPL(?:-3\.0)?|GPL-[23]\.0|LGPL(?:-[23]\.[01])?|MPL-[12]\.[01]|BSD-[234]-Clause|0BSD|BSD|ISC|EPL-[12]\.0|CDDL-1\.0|Zlib|Unlicense|CC0|OSL-3\.0|EUPL-1\.[12]|CPAL-1\.0|OFL-1\.1|PostgreSQL|PSF|Artistic-2\.0|MS-PL|NCSA|Boost|Vim|WTFPL|CECILL-2\.[01]|ECL-2\.0|AAL|ImageMagick)\b/i;

/** Closed-source wording, only consulted when no OSI family is named. */
const PROPRIETARY_LICENSE =
	/\bproprietar|\bclosed[\s-]source\b|\ball\s+rights\s+reserved\b/i;

/**
 * `null` is accepted because it occurs: a repo with no LICENSE file at all. That
 * is not a gap in the data, it is a finding — an unlicensed repo is not legally
 * reusable — and it lands on `unknown` alongside the empty string rather than
 * falling through to `foss`, which is the only outcome here that could mislead.
 */
export function classifyLicense(license: string | null | undefined): FossClass {
	const s = license?.trim();
	if (!s) return "unknown";
	if (NOT_FOSS_LICENSE.test(s)) return "not-foss";
	if (OSI_LICENSE.test(s)) return "foss";
	if (PROPRIETARY_LICENSE.test(s)) return "not-foss";
	return "unknown";
}

/**
 * A single open source project, collected from every product it is cited against.
 *
 * The dataset is authored product-first ("what replaces Notion?"), but people
 * arrive project-first too ("what does Nextcloud get me out of?"). Deriving this
 * rather than authoring it means the two views can never disagree.
 */
export type Project = {
	/** URL-safe id, unique per source URL. */
	slug: string;
	name: string;
	source: Source;
	license: string;
	effort: Effort;
	/**
	 * The facts as the first citing product stated them. Only honest to render a
	 * field from here when the same field is absent from `factsVary` — see below.
	 */
	facts: Facts;
	/**
	 * Fact fields the citing products do not agree on.
	 *
	 * `facts` lives on the alternative, not on the project, so a project cited
	 * against five products carries five opinions of its SSO tax. They usually
	 * match; across the current catalogue 111 of the 326 multi-cited projects have
	 * at least one field where they do not. Picking one and printing it as "the"
	 * fact would be inventing a consensus, so the field is named here instead and
	 * the UI says the citations disagree rather than guessing which is right.
	 */
	factsVary: (keyof Facts)[];
	/**
	 * True when the citing products do not agree on whether this project's licence
	 * is open source — `factsVary`, but for the licence, which lives beside the
	 * facts rather than inside them.
	 *
	 * Deliberately keyed on `classifyLicense` and not on the raw string. Nineteen
	 * projects are described with different licence PROSE by different citations
	 * ("MIT" against "MIT core with an ee/ directory"), and almost all of those
	 * are two accurate descriptions of one open-core project rather than a
	 * disagreement — `facts.openCore` is where that difference belongs. What a
	 * licence-derived collection cannot assert over is a genuine split about
	 * openness itself, and there is exactly one: OpenReplay, cited five times as
	 * "ELv2/MIT mix with an ee/ directory", "AGPL-3.0 outside the ee/ directory"
	 * and "Elastic-2.0".
	 */
	fossVary: boolean;
	hasCompose?: boolean;
	/**
	 * Archived per its citing alternatives. Unlike the facts above this needs no
	 * `vary` treatment: a repo is archived or it is not, so any citation saying
	 * so is enough and disagreement just means one citation is out of date.
	 */
	archived?: boolean;
	/** Products this project is offered as a replacement for, best-known first. */
	replaces: { slug: string; name: string; note: Translations }[];
};

/** Every field of `Facts`, so a new one cannot quietly skip the vary check. */
const FACT_KEYS = [
	"selfHostable",
	"openCore",
	"paywalled",
	"ssoInFree",
	"dataResidency",
] as const satisfies readonly (keyof Facts)[];

/**
 * Which file under `public/icons/alts` carries this project's mark.
 *
 * GitHub keys on the owner, because what we fetch there is the owner's avatar
 * and 1,415 entries already have their file on disk under that name.
 *
 * Every other forge keys on the forge's own label plus the repo name. Keying on
 * the hostname alone — as this did — was invisible while the catalogue was 100%
 * GitHub, and the moment the hosts were corrected it handed all 22 GitLab
 * projects one shared `gitlab.com.png`: GIMP, Krita, Kdenlive and Okular would
 * all have worn the same mark.
 */
export const altIconKey = (source: Source): string | null => {
	if (source.host === "github") {
		const owner = source.path.split("/")[0];
		return owner ? owner.toLowerCase() : null;
	}
	let hostname: string;
	try {
		hostname = new URL(source.url).hostname.replace(/^www\./, "");
	} catch {
		return null;
	}
	// The label under the TLD, so `invent.kde.org` reads as "kde" rather than
	// "invent" and `codeberg.org` as "codeberg".
	const labels = hostname.split(".");
	const forge = labels.length > 1 ? labels[labels.length - 2] : labels[0];
	// The repo, not the owner: `graphics/krita` on KDE's forge is one project,
	// and "graphics" names a section of it rather than the thing being drawn.
	const repo = source.path.split("/").filter(Boolean).pop();
	if (!forge || !repo) return null;
	return `${forge}-${repo}`
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
};

/** Stable id for a project: the forge path, which is unique per host. */
export const projectSlug = (source: Source): string =>
	`${source.host}-${source.path}`
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");

export function collectProjects(products: Product[]): Project[] {
	const byId = new Map<string, Project>();

	for (const product of products) {
		for (const alt of product.alternatives) {
			if (alt.kind !== "oss") continue;
			const slug = projectSlug(alt.source);
			const existing = byId.get(slug);
			const cite = { slug: product.slug, name: product.name, note: alt.note };

			if (existing) {
				existing.replaces.push(cite);
				if (
					!existing.fossVary &&
					classifyLicense(existing.license) !== classifyLicense(alt.license)
				) {
					existing.fossVary = true;
				}
				// A second opinion on the same project. Compare field by field and
				// record the ones that differ; `paywalled` is a Translations object, so
				// this compares serialised values rather than references.
				for (const key of FACT_KEYS) {
					if (existing.factsVary.includes(key)) continue;
					if (
						JSON.stringify(existing.facts[key] ?? null) !==
						JSON.stringify(alt.facts[key] ?? null)
					) {
						existing.factsVary.push(key);
					}
				}
				// The same project can be described differently against different
				// products; keep the least-effort claim, since that is the one a
				// reader can actually act on.
				if (alt.effort === "managed") existing.effort = "managed";
				else if (alt.effort === "docker" && existing.effort === "ops") {
					existing.effort = "docker";
				}
				// Any citation saying archived is enough — see the field's comment.
				if (alt.archived) existing.archived = true;
				continue;
			}

			byId.set(slug, {
				slug,
				name: alt.name,
				source: alt.source,
				license: alt.license,
				effort: alt.effort,
				facts: alt.facts,
				factsVary: [],
				fossVary: false,
				hasCompose: alt.hasCompose,
				archived: alt.archived,
				replaces: [cite],
			});
		}
	}

	// Projects that replace the most products are the most useful to read about.
	return [...byId.values()].sort(
		(a, b) =>
			b.replaces.length - a.replaces.length || a.name.localeCompare(b.name),
	);
}

/**
 * The lowest-effort alternative in a category whose free build is the whole
 * product. `openCore: "none"` is the filter that matters: a "cheapest escape"
 * that turns out to be a demo with the useful half paywalled is the exact claim
 * this site exists to contradict.
 */
export type CheapestEscape = {
	name: string;
	source: Source;
	effort: Effort;
	/** The product it is cited against, so the row can link somewhere real. */
	product: { slug: string; name: string };
};

export type CategoryStat = {
	slug: string;
	/** Products filed under this category. */
	products: number;
	/** Distinct open source projects cited across them. */
	projects: number;
	/** How the products' exit ladder rungs split. Sums to `products`. */
	rungs: Record<Rung, number>;
	/**
	 * Median USD/month across the products that publish one. Null when none do —
	 * a category of usage-priced products has no median, and zero would be a lie.
	 */
	medianPrice: number | null;
	/** How many products the median was taken over, so the figure can be judged. */
	pricedProducts: number;
	cheapestEscape: CheapestEscape | null;
};

/** Cheapest first, so `<` on the index is "easier to run". */
export const EFFORT_RANK: Record<Effort, number> = {
	managed: 0,
	docker: 1,
	ops: 2,
};

const median = (values: number[]): number | null => {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = sorted.length >> 1;
	return sorted.length % 2 === 1
		? sorted[mid]
		: (sorted[mid - 1] + sorted[mid]) / 2;
};

/** A candidate escape, plus how much of its category it covers. */
type Candidate = CheapestEscape & { cites: number };

/**
 * Everything the category index shows, computed from the products themselves.
 *
 * Nothing here is authored: a category's weight, its escape routes and its price
 * level all follow from the entries filed under it, so they cannot drift the way
 * a hand-kept count would across 84 rows.
 */
export function categoryStats(products: Product[]): Map<string, CategoryStat> {
	const out = new Map<string, CategoryStat>();
	const seenProjects = new Map<string, Set<string>>();
	const prices = new Map<string, number[]>();
	const candidates = new Map<string, Map<string, Candidate>>();

	for (const product of products) {
		let stat = out.get(product.category);
		if (!stat) {
			stat = {
				slug: product.category,
				products: 0,
				projects: 0,
				rungs: { "locked-in": 0, partial: 0, "self-hostable": 0, "drop-in": 0 },
				medianPrice: null,
				pricedProducts: 0,
				cheapestEscape: null,
			};
			out.set(product.category, stat);
			seenProjects.set(product.category, new Set());
			prices.set(product.category, []);
			candidates.set(product.category, new Map());
		}

		stat.products += 1;
		stat.rungs[rungOf(product)] += 1;
		if (product.priceMonthly !== null) {
			(prices.get(product.category) as number[]).push(product.priceMonthly);
		}

		const projectIds = seenProjects.get(product.category) as Set<string>;
		const pool = candidates.get(product.category) as Map<string, Candidate>;
		for (const alt of product.alternatives) {
			if (alt.kind !== "oss") continue;
			const id = projectSlug(alt.source);
			projectIds.add(id);

			if (alt.facts?.openCore !== "none" || alt.facts.selfHostable === false) {
				continue;
			}
			const seen = pool.get(id);
			if (seen) {
				seen.cites += 1;
				// The same project can be filed under different efforts against
				// different products; keep the least, exactly as `collectProjects` does.
				if (EFFORT_RANK[alt.effort] < EFFORT_RANK[seen.effort]) {
					seen.effort = alt.effort;
				}
				continue;
			}
			pool.set(id, {
				name: alt.name,
				source: alt.source,
				effort: alt.effort,
				product: { slug: product.slug, name: product.name },
				cites: 1,
			});
		}
	}

	for (const stat of out.values()) {
		const seen = prices.get(stat.slug) as number[];
		stat.projects = (seenProjects.get(stat.slug) as Set<string>).size;
		stat.pricedProducts = seen.length;
		stat.medianPrice = median(seen);

		// Least effort first, then the one that covers the most of this category —
		// among a dozen equally easy projects, the one cited against four of the
		// category's products is the one worth naming. Name breaks the last tie so
		// the same dataset always names the same project, whatever order the files
		// were read in.
		let best: Candidate | null = null;
		for (const c of candidates.get(stat.slug) as Map<string, Candidate>) {
			const cand = c[1];
			if (
				best === null ||
				EFFORT_RANK[cand.effort] < EFFORT_RANK[best.effort] ||
				(EFFORT_RANK[cand.effort] === EFFORT_RANK[best.effort] &&
					(cand.cites > best.cites ||
						(cand.cites === best.cites &&
							cand.name.localeCompare(best.name) < 0)))
			) {
				best = cand;
			}
		}
		stat.cheapestEscape = best
			? {
					name: best.name,
					source: best.source,
					effort: best.effort,
					product: best.product,
				}
			: null;
	}
	return out;
}

/** Which locales a product is fully translated into. Drives the coverage badge. */
export function productLangs(product: Product): Lang[] {
	const maps: Translations[] = [product.why, ...product.whatYouLose];
	for (const a of product.alternatives) maps.push(a.note);
	return SupportedLangs.filter((l) => maps.every((m) => Boolean(m[l]?.trim())));
}
