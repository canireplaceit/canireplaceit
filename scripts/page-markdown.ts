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

import type {
	Category,
	Health,
	HealthFile,
	Product,
	Project,
} from "core/src/content";
import {
	collectProjects,
	healthKey,
	isArchived,
	projectSlug,
} from "core/src/content";
import type { Lang } from "core/src/index";
import { resolveTranslation } from "core/src/index";
import type { Route } from "core/src/routes";
import { paths } from "core/src/routes";

/** The slice of the prerenderer's Boot this module reads. */
export type MdBoot = {
	products: (Product & { switchedCount: number })[];
	categories: Category[];
	projectSlugs: [string, string][];
	health?: HealthFile;
	projectRows?: Project[];
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
	const oss = product.alternatives.filter((a) => a.kind === "oss");
	const cheaper = product.alternatives.filter((a) => a.kind === "cheaper");
	const verdict = VERDICT[product.verdict];

	const out: string[] = [
		`# ${input.title}`,
		"",
		// The answer, before anything else on the page.
		`**${verdict ? verdict[lang] : product.verdict}**`,
		"",
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

function listMarkdown(
	input: MdInput,
	slugOf: (forgeId: string) => string,
	apiPath = "search",
): string {
	const { lang, site, boot } = input;
	const out: string[] = [`# ${input.title}`, "", input.description, ""];

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
		case "projects":
		case "categories":
		case "collections":
		case "category":
		case "collection":
			return listMarkdown(input, slugOf);

		/**
		 * The one standing page with data to serve.
		 *
		 * The rest return null on purpose and must keep doing so: `features`
		 * fetches a code-split dataset on demand, `stats` reads live figures from
		 * Umami, and `glossary` is static copy that already renders. Gaps is
		 * different only because scripts/prerender.ts now inlines its 43 products,
		 * and it is the page most worth quoting: the catalogue saying no.
		 */
		case "gaps":
			return listMarkdown(input, slugOf, "gaps");

		default:
			return null;
	}
}
