/**
 * A Markdown twin for every prerendered page.
 *
 * The convention that settled in 2026 is that the same URL with `.md` appended
 * returns the page without the HTML. Agentic crawlers prefer it where both
 * exist: no JS, no navigation to strip, and roughly a fifth of the tokens. This
 * site already renders every page at build time, so the twin costs one more
 * write in the same loop.
 *
 * Built from the same boot payload the React render reads, never by converting
 * the HTML. Converting would inherit the navigation, the sponsor rails and the
 * cookie banner, which is exactly the boilerplate the twin exists to drop.
 *
 * Two rules, both of which matter more than they look:
 *
 *   - The answer goes in the first hundred words. Retrieval weights the opening
 *     of a document heavily, so the verdict and the price lead, and the
 *     reasoning follows.
 *   - Every twin ends with its canonical URL. A model that ingests only the
 *     Markdown still has the link to cite, which is the entire trade this site
 *     is making.
 *
 * Pages whose content lives in the React tree rather than in the payload (the
 * legal documents, the contact form, the dashboard) get no twin. A stub saying
 * "see the HTML" would be a file that exists to be disappointing.
 */

import { COLLECTIONS } from "core/src/collections";
import type {
	Category,
	CategoryStat,
	Health,
	HealthFile,
	OssAlternative,
	Product,
	Project,
} from "core/src/content";
import {
	byExitQuality,
	collectProjects,
	healthKey,
	isArchived,
	projectSlug,
} from "core/src/content";
import type { Lang } from "core/src/index";
import { resolveTranslation } from "core/src/index";
import type { Route } from "core/src/routes";
import { paths } from "core/src/routes";
import { dict } from "../apps/frontend/src/i18n";

/**
 * The one translation table, read here for the same reason scripts/prerender.ts
 * reads it: the glossary and the collection index are copy, not catalogue, and a
 * second copy of those strings in this file would drift from the page the twin
 * is a twin of.
 */
const DICT = dict as unknown as Record<string, Record<string, string>>;
const label = (lang: Lang, key: string): string =>
	DICT[lang]?.[key] ?? DICT.en?.[key] ?? key;

/** The slice of the prerenderer's Boot this module reads. */
export type MdBoot = {
	products: (Product & { switchedCount: number })[];
	categories: Category[];
	projectSlugs: [string, string][];
	health?: HealthFile;
	projectRows?: Project[];
	/** Per-category counts over the WHOLE catalogue, on every page that has them. */
	categoryStats?: [string, CategoryStat][];
	/** Members per collection, over the whole catalogue. */
	collectionCounts?: [string, number][];
	/** The headline counts, on the home pages and nowhere else. */
	stats?: {
		products: number;
		categories: number;
		alternatives: number;
		ossAlternatives: number;
		notYet: number;
		monthlySpendCents: number;
		switches: number;
	};
};

export type MdInput = {
	route: Route;
	url: string;
	lang: Lang;
	title: string;
	description: string;
	boot: MdBoot;
	site: string;
	lastmod: string;
};

/**
 * `/en/alternatives/notion` becomes `en/alternatives/notion.md`, so that
 * appending `.md` to the page URL is the whole rule.
 *
 * An index URL ends in a slash and gets two files: `en/index.md` for the
 * literal `/en/index.md`, and `en.md` so that stripping the slash and appending
 * `.md` also lands somewhere. Two small files beats a rule with an exception in
 * it.
 */
export function mdFor(url: string): string[] {
	const trimmed = url.replace(/^\/+/, "");
	if (trimmed === "") return ["index.md"];
	if (trimmed.endsWith("/")) {
		const bare = trimmed.slice(0, -1);
		return [`${bare}/index.md`, `${bare}.md`];
	}
	return [`${trimmed}.md`];
}

/** A cell that cannot break out of its table row. */
const cell = (v: string | number | null | undefined): string =>
	v === null || v === undefined || v === ""
		? "-"
		: String(v).replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();

const table = (
	headers: string[],
	rows: (string | number | null)[][],
): string =>
	rows.length === 0
		? ""
		: [
				`| ${headers.join(" | ")} |`,
				`|${headers.map(() => "---").join("|")}|`,
				...rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
			].join("\n");

const link = (text: string, href: string) => `[${text}](${href})`;

const yesNo = (v: boolean | null | undefined, lang: Lang): string =>
	v === null || v === undefined
		? "-"
		: v
			? lang === "fr"
				? "oui"
				: "yes"
			: lang === "fr"
				? "non"
				: "no";

const t = (lang: Lang, en: string, fr: string) => (lang === "fr" ? fr : en);

/** Thousands separated the way the locale writes them: 6,723 and 6 723. */
const num = (n: number, lang: Lang): string =>
	new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-GB").format(n);

/** `2026-08-02` as `2 August 2026` / `2 août 2026`, for a sentence rather than a field. */
function longDate(iso: string, lang: Lang): string {
	const d = new Date(`${iso}T00:00:00Z`);
	if (Number.isNaN(d.getTime())) return iso;
	const text = new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-GB", {
		day: "numeric",
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	}).format(d);
	// French writes the first of the month as "1er".
	return lang === "fr" ? text.replace(/^1 /, "1er ") : text;
}

/**
 * A meta description clipped to fit a SERP, put back into whole sentences.
 *
 * `seo.ts` clamps descriptions at the length Google renders and marks the cut
 * with an ellipsis, which is right in a `<meta>` tag and wrong in a document:
 * /en/gaps.md opened on "...a catalogue of alternat…". Dropping back to the last
 * full stop loses a clause and keeps a sentence.
 */
function untruncated(text: string): string {
	if (!text.endsWith("…")) return text;
	const body = text.slice(0, -1).trimEnd();
	const stop = body.lastIndexOf(". ");
	// No sentence boundary to fall back to, so at least end on a whole word.
	return stop > 0 ? body.slice(0, stop + 1) : `${body.replace(/\s*\S+$/, "")}…`;
}

/** USD per month, or the honest reason there is no number. */
function priceLine(product: Product, lang: Lang): string {
	if (product.priceMonthly === null) {
		if (product.notPublic) {
			return t(
				lang,
				`${product.name} publishes no price. The vendor asks you to contact sales.`,
				`${product.name} ne publie aucun tarif. L'éditeur renvoie vers son service commercial.`,
			);
		}
		return t(
			lang,
			`No price recorded for ${product.name} yet.`,
			`Aucun tarif relevé pour ${product.name} pour l'instant.`,
		);
	}
	const checked = product.pricing
		? t(
				lang,
				` Checked on ${product.pricing.checkedOn} at ${product.pricing.url}.`,
				` Relevé le ${product.pricing.checkedOn} sur ${product.pricing.url}.`,
			)
		: "";
	const plan = product.pricing ? ` (${product.pricing.plan})` : "";
	return t(
		lang,
		`${product.name} costs ${product.priceMonthly} USD per month${plan}.${checked}`,
		`${product.name} coûte ${product.priceMonthly} USD par mois${plan}.${checked}`,
	);
}

/**
 * The verdict with nobody in it, kept for the products the templates below
 * cannot fill: a `yes` or an `almost` with no living open source alternative to
 * name has no winner, and a sentence naming one would be inventing it.
 */
const VERDICT: Record<string, { en: string; fr: string }> = {
	yes: {
		en: "Yes, a credible open source replacement exists.",
		fr: "Oui, un remplaçant open source crédible existe.",
	},
	almost: {
		en: "Almost. The replacements are close, with a real gap.",
		fr: "Presque. Les remplaçants sont proches, avec un vrai manque.",
	},
	"not-yet": {
		en: "Not yet. Nothing credible replaces it at the time of writing.",
		fr: "Pas encore. Rien de crédible ne le remplace à ce jour.",
	},
};

/**
 * The one liftable sentence.
 *
 * A model asked "what is the best open source alternative to Notion?" reads the
 * first paragraph and quotes it or moves on. The strings above answered with no
 * subject — "Almost. The replacements are close, with a real gap." names no
 * product, no winner and no number, so nothing in it can be lifted into an
 * answer. Every figure below is already in the payload this function is handed:
 * the check date, the ranked alternatives, the licence and the monthly price.
 *
 * `whatYouLose` is quoted verbatim after a colon rather than folded into the
 * grammar. The entries are noun phrases written by hand and 592 of them start
 * every way English can — "The commit graph", "ships with nearly every Unix",
 * "Everyone already has it" — so any sentence that tries to own one breaks on
 * some product nobody will ever read.
 */
function lede(
	product: Product,
	lang: Lang,
	best: OssAlternative | undefined,
): string {
	const checked = product.pricing?.checkedOn;
	const asOf = checked
		? t(
				lang,
				`As of ${longDate(checked, lang)}, `,
				`Au ${longDate(checked, lang)}, `,
			)
		: "";

	const saves =
		product.priceMonthly !== null && product.priceMonthly > 0
			? t(
					lang,
					` and switching saves $${num(Math.round(product.priceMonthly * 12), lang)} a year`,
					` et vous économisez ${num(Math.round(product.priceMonthly * 12), lang)} USD par an`,
				)
			: "";

	const lose = product.whatYouLose[0]
		? t(
				lang,
				` What you give up: ${resolveTranslation(product.whatYouLose[0], lang)}.`,
				` Ce que vous perdez : ${resolveTranslation(product.whatYouLose[0], lang)}.`,
			)
		: "";

	const named = best ? `${best.name} (${best.license})` : "";

	let claim: string;
	if (product.verdict === "not-yet") {
		claim = t(
			lang,
			`nothing in this catalogue credibly replaces ${product.name} yet.`,
			`rien dans ce catalogue ne remplace ${product.name} de façon crédible.`,
		);
	} else if (!best) {
		// No living alternative to name, so fall back rather than invent a winner.
		return VERDICT[product.verdict]?.[lang] ?? product.verdict;
	} else if (product.verdict === "yes") {
		claim = t(
			lang,
			`${product.name} can be replaced: ${named} does the job${saves}.`,
			`${product.name} peut être remplacé : ${named} fait le travail${saves}.`,
		);
	} else {
		claim = t(
			lang,
			`${product.name} can almost be replaced: ${named} covers most of it${saves}.`,
			`${product.name} peut presque être remplacé : ${named} en couvre l'essentiel${saves}.`,
		);
	}

	const sentence = asOf
		? `${asOf}${claim}`
		: `${claim.charAt(0).toUpperCase()}${claim.slice(1)}`;
	return `${sentence}${lose}`;
}

/**
 * The shape of the field, in one sentence, from the page's own rows.
 *
 * Omitted below two alternatives, where "of the 1 open source alternative
 * tracked here" is a worse sentence than no sentence.
 */
function fieldLine(oss: OssAlternative[], lang: Lang): string {
	if (oss.length < 2) return "";
	const open = oss.filter((a) => a.facts.openCore === "none").length;
	const managed = oss.filter((a) => a.effort === "managed").length;
	const clauses = [
		open > 0 &&
			t(
				lang,
				`${open} with nothing held back behind a paid tier`,
				`${open} sans rien retenir derrière une offre payante`,
			),
		managed > 0 &&
			t(
				lang,
				`${managed} with a hosted option that spares you a server`,
				`${managed} avec une option hébergée qui vous évite un serveur`,
			),
	].filter((c): c is string => typeof c === "string");

	const head = t(
		lang,
		`${oss.length} open source alternatives are tracked here`,
		`${oss.length} alternatives open source sont suivies ici`,
	);
	return clauses.length === 0
		? `${head}.`
		: `${head}${t(lang, ": ", " : ")}${clauses.join(", ")}.`;
}

/** The footer every twin carries, because the link is the point. */
function footer(input: MdInput, api?: string): string {
	const lines = [
		"---",
		"",
		t(
			input.lang,
			`Source: ${input.site}${input.url}`,
			`Source : ${input.site}${input.url}`,
		),
	];
	if (api) lines.push(`API: ${api}`);
	lines.push(
		t(
			input.lang,
			`Last updated ${input.lastmod}. Data licensed CC-BY-4.0: cite the source URL above.`,
			`Mis à jour le ${input.lastmod}. Données sous licence CC-BY-4.0 : citez l'URL ci-dessus.`,
		),
	);
	return lines.join("\n");
}

function productMarkdown(
	product: Product & { switchedCount?: number },
	input: MdInput,
	slugOf: (forgeId: string) => string,
	healthOf: (source: Product["alternatives"][number]) => Health | null,
): string {
	const { lang, site } = input;
	const oss = product.alternatives.filter(
		(a): a is OssAlternative => a.kind === "oss",
	);
	const cheaper = product.alternatives.filter((a) => a.kind === "cheaper");

	// The same ranking the page itself leads with — see `Ladder` in
	// components.tsx — so the twin and the HTML never name a different winner.
	const live = oss.filter((a) => !isArchived(a, healthOf(a)));
	const best = byExitQuality(live, (a) => healthOf(a))[0];
	const shape = fieldLine(oss, lang);

	const out: string[] = [
		`# ${input.title}`,
		"",
		// The answer, before anything else on the page.
		`**${lede(product, lang, best)}**`,
		"",
		...(shape ? [shape, ""] : []),
		priceLine(product, lang),
		"",
		resolveTranslation(product.why, lang),
	];

	if (product.whatYouLose.length > 0) {
		out.push(
			"",
			`## ${t(lang, "What you lose by leaving", "Ce que vous perdez en partant")}`,
			"",
			...product.whatYouLose.map((v) => `- ${resolveTranslation(v, lang)}`),
		);
	}

	if (oss.length > 0) {
		out.push(
			"",
			`## ${t(lang, "Open source alternatives", "Alternatives open source")}`,
			"",
			table(
				[
					t(lang, "Project", "Projet"),
					t(lang, "Licence", "Licence"),
					t(lang, "Self-host", "Auto-hébergeable"),
					t(lang, "Open core", "Open core"),
					t(lang, "Effort", "Effort"),
					t(lang, "Last commit", "Dernier commit"),
				],
				oss.map((a) => {
					if (a.kind !== "oss") return [];
					const health = healthOf(a);
					// `projectSlug` lowercases and normalises, so the forge id cannot
					// be spelled by hand here without drifting from the map.
					const slug = slugOf(projectSlug(a.source));
					return [
						link(a.name, `${site}${paths.project(lang, slug)}`),
						a.license,
						yesNo(a.facts.selfHostable, lang),
						a.facts.openCore,
						a.effort,
						health?.lastPush ?? "-",
					];
				}),
			),
			"",
			...oss.flatMap((a) => {
				if (a.kind !== "oss") return [];
				const health = healthOf(a);
				const dead = isArchived(a, health);
				const notes = [
					`### ${a.name}`,
					"",
					resolveTranslation(a.note, lang),
					"",
					`- ${t(lang, "Licence", "Licence")}: ${a.license}`,
					`- ${t(lang, "Repository", "Dépôt")}: ${a.source.url}`,
				];
				if (a.facts.paywalled) {
					notes.push(
						`- ${t(lang, "Paid only", "Payant uniquement")}: ${resolveTranslation(a.facts.paywalled, lang)}`,
					);
				}
				if (a.facts.ssoInFree !== null) {
					notes.push(
						`- ${t(lang, "SSO without paying", "SSO sans payer")}: ${yesNo(a.facts.ssoInFree, lang)}`,
					);
				}
				if (dead) {
					notes.push(
						`- ${t(lang, "**Archived.** The repository is read-only.", "**Archivé.** Le dépôt est en lecture seule.")}`,
					);
				}
				notes.push("");
				return notes;
			}),
		);
	}

	if (cheaper.length > 0) {
		out.push(
			`## ${t(lang, "Cheaper paid alternatives", "Alternatives payantes moins chères")}`,
			"",
			table(
				[
					t(lang, "Name", "Nom"),
					t(lang, "Price", "Tarif"),
					t(lang, "Note", "Note"),
				],
				cheaper.map((a) => {
					if (a.kind !== "cheaper") return [];
					const price =
						a.priceMonthly !== null
							? `${a.priceMonthly} USD/mo`
							: a.priceOnce !== undefined
								? `${a.priceOnce} USD once`
								: t(lang, "on request", "sur demande");
					return [link(a.name, a.url), price, resolveTranslation(a.note, lang)];
				}),
			),
			"",
		);
	}

	out.push("", footer(input, `${site}/api/v1/products/${product.slug}`));
	return out.join("\n");
}

function projectMarkdown(
	project: Project,
	input: MdInput,
	health: Health | null,
): string {
	const { lang, site } = input;
	const dead = isArchived(project, health);

	const out: string[] = [
		`# ${project.name}`,
		"",
		t(
			lang,
			`${project.name} is licensed ${project.license} and replaces ${project.replaces.length} paid product${project.replaces.length === 1 ? "" : "s"}.`,
			`${project.name} est sous licence ${project.license} et remplace ${project.replaces.length} produit(s) payant(s).`,
		),
		"",
		`- ${t(lang, "Self-hostable", "Auto-hébergeable")}: ${yesNo(project.facts.selfHostable, lang)}`,
		`- ${t(lang, "Open core", "Open core")}: ${project.facts.openCore}`,
		`- ${t(lang, "Effort", "Effort")}: ${project.effort}`,
		`- ${t(lang, "Repository", "Dépôt")}: ${project.source.url}`,
	];

	if (health?.lastPush) {
		out.push(
			`- ${t(lang, "Last commit", "Dernier commit")}: ${health.lastPush}`,
		);
	}
	if (project.language) {
		out.push(`- ${t(lang, "Language", "Langage")}: ${project.language}`);
	}
	if (dead) {
		out.push(
			"",
			t(
				lang,
				"**This project is archived.** The repository is read-only and is kept here because a catalogue that quietly drops what died only ever describes the present tense.",
				"**Ce projet est archivé.** Le dépôt est en lecture seule et reste listé ici, parce qu'un catalogue qui efface ce qui est mort ne décrit jamais que le présent.",
			),
		);
	}
	if (project.factsVary.length > 0) {
		out.push(
			"",
			t(
				lang,
				`The products citing this project disagree about: ${project.factsVary.join(", ")}. Read the product pages rather than treating those fields as settled.`,
				`Les produits qui citent ce projet ne s'accordent pas sur : ${project.factsVary.join(", ")}. Consultez les fiches produit plutôt que de considérer ces champs comme établis.`,
			),
		);
	}

	if (project.replaces.length > 0) {
		out.push(
			"",
			`## ${t(lang, "Replaces", "Remplace")}`,
			"",
			table(
				[t(lang, "Product", "Produit"), t(lang, "How", "Comment")],
				project.replaces.map((r) => [
					link(r.name, `${site}${paths.product(lang, r.slug)}`),
					resolveTranslation(r.note, lang),
				]),
			),
		);
	}

	const slug = (input.route as { slug?: string }).slug ?? project.slug;
	out.push("", footer(input, `${site}/api/v1/projects/${slug}`));
	return out.join("\n");
}

/**
 * The corpus, written down as a sentence.
 *
 * These numbers were only ever available as JSON on /api/v1/stats, so the most
 * quotable claim this site owns — "43 of 592 paid products have no credible open
 * source replacement" — appeared nowhere a model reading a page could lift it.
 * `null` when the page carries no counts to say it with.
 */
function corpusLine(input: MdInput, notYet: number): string | null {
	const { lang, boot } = input;
	const total =
		boot.stats?.products ??
		boot.categoryStats?.reduce((n, [, c]) => n + c.products, 0) ??
		0;
	if (total === 0) return null;
	const on = t(
		lang,
		`, as of ${longDate(input.lastmod, lang)}`,
		`, au ${longDate(input.lastmod, lang)}`,
	);
	if (!boot.stats) {
		return t(
			lang,
			`${num(notYet, lang)} of the ${num(total, lang)} paid products in this catalogue have no credible open source replacement${on}.`,
			`${num(notYet, lang)} des ${num(total, lang)} produits payants de ce catalogue n'ont aucun remplaçant open source crédible${on}.`,
		);
	}

	const { categories, alternatives, ossAlternatives } = boot.stats;
	return t(
		lang,
		`${num(total, lang)} paid products are tracked here across ${num(categories, lang)} categories, with ${num(alternatives, lang)} alternatives recorded against them, ${num(ossAlternatives, lang)} of those open source. ${num(notYet, lang)} of those ${num(total, lang)} products have no credible open source replacement${on}.`,
		`${num(total, lang)} produits payants sont suivis ici dans ${num(categories, lang)} catégories, avec ${num(alternatives, lang)} alternatives recensées, dont ${num(ossAlternatives, lang)} open source. ${num(notYet, lang)} de ces ${num(total, lang)} produits n'ont aucun remplaçant open source crédible${on}.`,
	);
}

function listMarkdown(
	input: MdInput,
	slugOf: (forgeId: string) => string,
	apiPath = "search",
	opening?: string | null,
): string {
	const { lang, site, boot } = input;
	const out: string[] = [`# ${input.title}`, ""];
	if (opening) out.push(`**${opening}**`, "");
	out.push(untruncated(input.description), "");

	if (boot.projectRows && boot.projectRows.length > 0) {
		out.push(
			table(
				[
					t(lang, "Project", "Projet"),
					t(lang, "Licence", "Licence"),
					t(lang, "Self-host", "Auto-hébergeable"),
					t(lang, "Replaces", "Remplace"),
				],
				boot.projectRows.map((p) => [
					link(p.name, `${site}${paths.project(lang, slugOf(p.slug))}`),
					p.license,
					yesNo(p.facts.selfHostable, lang),
					p.replaces.length,
				]),
			),
		);
	} else if (boot.products.length > 0) {
		out.push(
			table(
				[
					t(lang, "Product", "Produit"),
					t(lang, "Category", "Catégorie"),
					t(lang, "Price", "Tarif"),
					t(lang, "Verdict", "Verdict"),
					t(lang, "Alternatives", "Alternatives"),
				],
				boot.products.map((p) => [
					link(p.name, `${site}${paths.product(lang, p.slug)}`),
					p.category,
					p.priceMonthly === null ? "-" : `${p.priceMonthly} USD/mo`,
					p.verdict,
					p.alternatives.filter((a) => a.kind === "oss").length,
				]),
			),
		);
	}

	out.push("", footer(input, `${site}/api/v1/${apiPath}`));
	return out.join("\n");
}

/**
 * The category index, which is how an agent finds everything else.
 *
 * This twin used to be 336 bytes — a title, a clamped description and a footer —
 * because `listMarkdown` only draws a table when the payload holds rows, and the
 * two hub pages carry counts rather than products. The HTML lists all 85 with
 * links; a crawler that starts here and reads the Markdown found none of them.
 */
function categoriesMarkdown(input: MdInput): string {
	const { lang, site, boot } = input;
	const stats = new Map(boot.categoryStats ?? []);
	const rows = [...boot.categories]
		.sort((a, b) => a.position - b.position)
		.map((c) => [
			link(
				resolveTranslation(c.name, lang),
				`${site}${paths.category(lang, c.slug)}`,
			),
			c.group,
			stats.get(c.slug)?.products ?? "-",
			stats.get(c.slug)?.medianPrice === null ||
			stats.get(c.slug)?.medianPrice === undefined
				? "-"
				: `${stats.get(c.slug)?.medianPrice} USD/mo`,
		]);

	return [
		`# ${input.title}`,
		"",
		untruncated(input.description),
		"",
		table(
			[
				t(lang, "Category", "Catégorie"),
				t(lang, "Theme", "Thème"),
				t(lang, "Products", "Produits"),
				t(lang, "Median price", "Tarif médian"),
			],
			rows,
		),
		"",
		footer(input, `${site}/api/v1/categories`),
	].join("\n");
}

/**
 * The collection index, for the same reason.
 *
 * `derivation` is the rule the slice is built from, and it is the single most
 * useful thing here: it tells a caller what "fully open" was made to mean before
 * it quotes the membership.
 */
function collectionsMarkdown(input: MdInput): string {
	const { lang, site, boot } = input;
	const counts = new Map(boot.collectionCounts ?? []);

	return [
		`# ${input.title}`,
		"",
		untruncated(input.description),
		"",
		table(
			[
				t(lang, "Collection", "Collection"),
				t(lang, "Of", "Porte sur"),
				t(lang, "Members", "Membres"),
				t(lang, "The rule", "La règle"),
			],
			COLLECTIONS.map((def) => [
				link(
					label(lang, `collection.${def.slug}.title`),
					`${site}${paths.collection(lang, def.slug)}`,
				),
				def.of === "product"
					? t(lang, "products", "produits")
					: t(lang, "projects", "projets"),
				counts.get(def.slug) ?? "-",
				label(lang, `collection.${def.slug}.derivation`),
			]),
		),
		"",
		footer(input, `${site}/api/v1/collections`),
	].join("\n");
}

/**
 * The glossary, which is copy rather than catalogue and so has no payload.
 *
 * Every definition is read from the same dictionary the page renders, keyed off
 * the `def.` prefix: `def.verdict.yes` is the definition of the label at
 * `verdict.yes`. Deriving the list from the prefix rather than restating it
 * means a seventeenth term appears here the day it appears on the page.
 *
 * Worth a twin even though it has no data in it: these sixteen words are the
 * ones every other twin uses, so a model reading "open core: major" anywhere
 * else has one place to resolve it.
 */
function glossaryMarkdown(input: MdInput): string {
	const { lang, site } = input;
	const terms = Object.keys(DICT.en ?? {})
		.filter((k) => k.startsWith("def."))
		.map((k) => ({ term: label(lang, k.slice(4)), def: label(lang, k) }));

	return [
		`# ${input.title}`,
		"",
		// The page's own lede, not the meta description: the two say the same thing
		// and this is the one that explains why a rule beats a description.
		label(lang, "glossary.blurb"),
		"",
		...terms.flatMap(({ term, def }) => [`## ${term}`, "", def, ""]),
		footer(input, `${site}/api/v1`),
	].join("\n");
}

/**
 * The twin, or null when this page has nothing a payload can express.
 *
 * Returning null is a real answer here. The legal documents, the contact form
 * and the dashboard render copy that lives in the React tree, so a twin for
 * them could only ever say "look at the HTML instead".
 */
export function markdownFor(input: MdInput): string | null {
	const { boot, route } = input;

	const slugs = new Map(boot.projectSlugs);
	const slugOf = (forgeId: string) => slugs.get(forgeId) ?? forgeId;

	const healthOfSource = (source: {
		host: string;
		path: string;
		url: string;
	}) =>
		boot.health?.repos[healthKey(source as Parameters<typeof healthKey>[0])] ??
		null;

	switch (route.name) {
		case "product": {
			const product = boot.products.find((p) => p.slug === route.slug);
			if (!product) return null;
			return productMarkdown(product, input, slugOf, (alt) =>
				alt.kind === "oss" ? healthOfSource(alt.source) : null,
			);
		}

		case "project": {
			// The project itself does not travel in the payload. It is rebuilt from
			// the products that cite it, which is exactly what the page does.
			const project = collectProjects(boot.products).find(
				(p) => slugOf(p.slug) === route.slug,
			);
			if (!project) return null;
			return projectMarkdown(project, input, healthOfSource(project.source));
		}

		case "home":
			return listMarkdown(
				input,
				slugOf,
				"search",
				corpusLine(input, boot.stats?.notYet ?? 0),
			);

		case "projects":
		case "category":
		case "collection":
		// The ten theme hubs, which ship the products under them exactly the way a
		// category page does. They had no twin at all, so 20 pages of real content
		// were HTML-only.
		case "group":
			return listMarkdown(input, slugOf);

		case "categories":
			return categoriesMarkdown(input);

		case "collections":
			return collectionsMarkdown(input);

		case "glossary":
			return glossaryMarkdown(input);

		/**
		 * The two standing pages with something to serve.
		 *
		 * The rest return null on purpose and must keep doing so: `features`
		 * fetches a code-split dataset on demand and `stats` reads live figures
		 * from Umami, so neither has anything a payload could express. Gaps is
		 * different because scripts/prerender.ts inlines its 43 products, and it is
		 * the page most worth quoting: the catalogue saying no.
		 */
		case "gaps":
			return listMarkdown(
				input,
				slugOf,
				"gaps",
				corpusLine(input, boot.products.length),
			);

		default:
			return null;
	}
}
