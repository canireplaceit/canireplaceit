/**
 * The self-hosting plan. One page, two steps, then a result you can keep.
 *
 * It used to be a spend calculator with a lead form bolted on, and it answered
 * the wrong question. What a reader wants is not "your stack costs $4,200" — it
 * is "here is what I would run, how hard each piece is, and what I give up". The
 * money is a consequence of the plan, so it is reported after it and never as the
 * headline.
 *
 * Three decisions worth defending:
 *
 * 1. THE PLAN LIVES IN THE URL. `?plan=notion~appflowy,slack&seats=25`. A plan
 *    that dies on refresh is worth very little, and the alternative — a database
 *    row — would mean an account, a table and a privacy claim to defend for
 *    something the address bar does for free. Shareable plans come with it.
 *    Keyed by the replacement's NAME, not its index in the file, so a pull
 *    request that reorders an array cannot quietly change what a shared link
 *    means. See `encodePlan` in core.
 *
 * 2. THE URL IS ADOPTED AFTER MOUNT, never during the first render. This page is
 *    prerendered with an empty selection; reading `location.search` while
 *    rendering would make the first client tree disagree with the static HTML on
 *    any shared link, which is exactly the hydration mismatch (#418) that throws
 *    the prerendered document away. Same pattern as `useTheme` and `useNow`.
 *
 * 3. A NOT-YET PRODUCT OFFERS NOTHING. Those files still list alternatives —
 *    that is how the verdict was reached — and this page must not present one as
 *    "your replacement". It says there is no credible exit, keeps the bill where
 *    it is, and that honesty is the whole proposition of the site. How many such
 *    products there are is read from the data at render time and never written
 *    into the copy, because that number moves as verdicts are re-argued.
 */

import type { Alternative, OssAlternative, Product } from "core/src/content";
import {
	altId,
	decodePlan,
	defaultReplacement,
	encodePlan,
	KEEP,
	monthlyCentsOf,
	replacements,
	type Spend,
	spendOf,
} from "core/src/plan";
import { paths } from "core/src/routes";
import { Check, Link2, Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	altIcon,
	api,
	type Category,
	healthOf,
	type ListedProduct,
	money,
} from "./api";
import { Logo, ProductLogo, Tag, VerdictMark } from "./components";
import type { Key, Lang } from "./i18n";
import { MEASURE } from "./listShared";

type T = (k: Key) => string;
type TC = (v: { en: string }) => string;

/** How many products the picker draws before it asks you to keep typing. */
const SHOWN = 36;
/** The seeded list, so an empty page is never a blank one. */
const SEEDED = 18;
const DEFAULT_SEATS = 10;

/**
 * How well a product answers what was typed, best first.
 *
 * A plain substring test made "zoom" offer ZoomInfo before Zoom, and "gitlab"
 * offer GitHub — which lists GitLab as an alternative and outranks it on
 * editorial weight. So the name wins over what the name replaces, and an exact
 * name wins over a longer one that merely starts the same way. 3 is "no match".
 */
const rank = (
	p: { name: string; alternatives: { name: string }[] },
	needle: string,
): number => {
	const name = p.name.toLowerCase();
	if (name === needle) return 0;
	if (name.startsWith(needle)) return 1;
	if (name.includes(needle)) return 2;
	return p.alternatives.some((a) => a.name.toLowerCase().includes(needle))
		? 2.5
		: 3;
};

const field =
	"w-full rounded-[calc(var(--radius))] border border-border bg-surface px-3 py-2.5 text-sm outline-none placeholder:text-muted focus:border-[color-mix(in_srgb,var(--brand)_60%,var(--color-border))]";

const card = "rounded-[calc(var(--radius))] border border-border bg-surface";

const Step = ({
	n,
	label,
	hint,
}: {
	n: number;
	label: string;
	hint?: string;
}) => (
	<div className="mb-3">
		<h2 className="flex items-center gap-2.5 font-display text-lg font-semibold">
			<span
				className="nums grid size-6 shrink-0 place-items-center rounded-full text-xs"
				style={{ background: "var(--brand)", color: "#fff" }}
			>
				{n}
			</span>
			{label}
		</h2>
		{hint && <p className="mt-1.5 text-sm text-muted">{hint}</p>}
	</div>
);

/**
 * The price of one product, with the assumption spelled out rather than implied.
 * A per-seat line shows the multiplication it is doing; nothing else pretends to
 * one, which is the bug this page was rebuilt to fix.
 */
function PriceLine({
	product,
	seats,
	t,
	lang,
}: {
	product: Product;
	seats: number;
	t: T;
	lang: Lang;
}) {
	if (product.priceMonthly === null) {
		return (
			<span className="text-xs text-muted">
				{product.pricing?.basis === "one-time"
					? t("price.basis.one-time")
					: t("price.noPublic")}
			</span>
		);
	}
	const basis = product.pricing?.basis ?? "flat";
	const unit = money(Math.round(product.priceMonthly * 100), lang);
	const total = monthlyCentsOf(product, seats);
	return (
		<span className="nums text-xs text-muted">
			{basis === "per-seat" ? (
				<>
					{unit} × {seats} = {money(total ?? 0, lang)}
					{t("row.perMonth")}
				</>
			) : (
				<>
					{unit}
					{t("row.perMonth")} · {t(`price.basis.${basis}` as Key)}
				</>
			)}
		</span>
	);
}

/** The receipts on one replacement, all of them derived or verified, none authored here. */
function AltFacts({ alt, t, lang }: { alt: Alternative; t: T; lang: Lang }) {
	if (alt.kind !== "oss") {
		return (
			<>
				<Tag accent>{t("alt.cheaper")}</Tag>
				<Tag>
					{alt.priceOnce !== undefined
						? `${money(alt.priceOnce * 100, lang)} ${t("row.once")}`
						: alt.priceMonthly === null
							? t("row.quoteOnly")
							: `${money(alt.priceMonthly * 100, lang)}${t("row.perMonth")}`}
				</Tag>
			</>
		);
	}
	// Only GitHub is polled, so this is null for a good part of the catalogue —
	// rendered as nothing at all rather than as "no compose file".
	const compose = healthOf(alt.source)?.hasCompose;
	return (
		<>
			<Tag>{t(`effort.${alt.effort}` as Key)}</Tag>
			<Tag>{alt.license}</Tag>
			{compose && <Tag>{t("repo.compose")}</Tag>}
			{alt.facts.openCore !== "none" && (
				<Tag warn>
					{t("facts.openCore")}: {alt.facts.openCore}
				</Tag>
			)}
			{alt.facts.ssoInFree === false && <Tag warn>{t("facts.ssoPaid")}</Tag>}
			{alt.facts.ssoInFree === true && <Tag>{t("facts.sso")}</Tag>}
			{alt.facts.dataResidency !== "unknown" && (
				<Tag>{t(`facts.residency.${alt.facts.dataResidency}` as Key)}</Tag>
			)}
		</>
	);
}

function Picker({
	products,
	categories,
	picked,
	toggle,
	t,
	tc,
	lang,
}: {
	products: ListedProduct[];
	categories: Category[];
	picked: string[];
	toggle: (slug: string) => void;
	t: T;
	tc: TC;
	lang: Lang;
}) {
	const [q, setQ] = useState("");
	const [cat, setCat] = useState("");
	const input = useRef<HTMLInputElement>(null);
	const chosen = useMemo(() => new Set(picked), [picked]);

	/**
	 * What the picker shows before anybody types: one product from each of the
	 * most general categories, in the order the category file lists them.
	 *
	 * The requirement is that a reader recognises the grid in about two seconds —
	 * a wall of vertical enterprise software (Editorial Manager, REDCap, Procore)
	 * reads as "not for me". Nothing in the schema says "recognisable", and
	 * `priority` is not it: Notion, Slack, Figma, Jira and Zoom are all 3, while
	 * Strava, Duolingo and Substack are 5. Ranking on it alone would seed the page
	 * with consumer apps and hide the team stack.
	 *
	 * Category order is the signal that does work. The file lists the horizontal
	 * categories first — AI, Analytics, Auth, Comms, Design, Dev tools, Notes,
	 * Observability, Payments — and the verticals after them, so taking the
	 * heaviest product from each in turn produces a grid that reads as a stack
	 * rather than a list, without a hand-written set of names to rot. Everything
	 * else is one keystroke away, never removed.
	 */
	const seed = useMemo(() => {
		const heaviest = new Map<string, ListedProduct>();
		for (const p of [...products].sort(
			(a, b) =>
				b.switchedCount - a.switchedCount ||
				b.priority - a.priority ||
				a.name.localeCompare(b.name),
		)) {
			if (!heaviest.has(p.category)) heaviest.set(p.category, p);
		}
		const at = new Map(categories.map((c) => [c.slug, c.position]));
		return [...heaviest.values()]
			.sort(
				(a, b) =>
					(at.get(a.category) ?? Number.MAX_SAFE_INTEGER) -
					(at.get(b.category) ?? Number.MAX_SAFE_INTEGER),
			)
			.slice(0, SEEDED);
	}, [products, categories]);

	const matches = useMemo(() => {
		const needle = q.trim().toLowerCase();
		return products
			.filter((p) => !cat || p.category === cat)
			.filter((p) => !needle || rank(p, needle) < 3)
			.sort(
				(a, b) =>
					(needle ? rank(a, needle) - rank(b, needle) : 0) ||
					b.switchedCount - a.switchedCount ||
					b.priority - a.priority ||
					a.name.localeCompare(b.name),
			);
	}, [products, q, cat]);

	const browsing = !q.trim() && !cat;
	const shown = browsing ? seed : matches.slice(0, SHOWN);
	const rest = browsing ? 0 : matches.length - shown.length;

	return (
		<>
			<div className="flex flex-col gap-2 sm:flex-row">
				<input
					ref={input}
					value={q}
					onChange={(e) => setQ(e.target.value)}
					onKeyDown={(e) => {
						// Type three letters, press Enter, type the next one. The whole
						// reason this is a search box and not a wall of checkboxes.
						if (e.key !== "Enter" || !shown[0]) return;
						e.preventDefault();
						toggle(shown[0].slug);
						setQ("");
					}}
					placeholder={t("plan.searchPlaceholder")}
					aria-label={t("plan.searchPlaceholder")}
					className={`${field} sm:flex-1`}
				/>
				<select
					value={cat}
					onChange={(e) => setCat(e.target.value)}
					aria-label={t("filter.allCategories")}
					className={`${field} sm:w-56`}
				>
					<option value="">{t("filter.allCategories")}</option>
					{categories.map((c) => (
						<option key={c.slug} value={c.slug}>
							{tc(c.name)}
						</option>
					))}
				</select>
			</div>

			<p className="mt-2 text-xs text-muted">
				{browsing ? t("plan.popular") : t("plan.enterHint")}
			</p>

			<ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
				{shown.map((p) => {
					const on = chosen.has(p.slug);
					return (
						<li key={p.slug}>
							<button
								type="button"
								onClick={() => toggle(p.slug)}
								aria-pressed={on}
								className="flex w-full items-center gap-2.5 rounded-[calc(var(--radius))] border px-2.5 py-2 text-left transition hover:border-[color-mix(in_srgb,var(--brand)_50%,var(--color-border))]"
								style={{
									borderColor: on ? "var(--brand)" : "var(--color-border)",
									background: on
										? "color-mix(in srgb, var(--brand) 8%, transparent)"
										: "var(--surface)",
								}}
							>
								<ProductLogo product={p} size={22} />
								<span className="min-w-0 flex-1 truncate text-sm">
									{p.name}
								</span>
								<span className="nums shrink-0 text-xs text-muted">
									{p.priceMonthly === null
										? "—"
										: money(Math.round(p.priceMonthly * 100), lang)}
								</span>
								{on ? (
									<Check
										className="size-4 shrink-0"
										style={{ color: "var(--brand)" }}
										aria-hidden
									/>
								) : (
									<Plus className="size-4 shrink-0 text-muted" aria-hidden />
								)}
							</button>
						</li>
					);
				})}
			</ul>

			{shown.length === 0 && (
				<p className="py-6 text-center text-sm text-muted">{t("empty.none")}</p>
			)}
			{rest > 0 && (
				<p className="mt-2 text-xs text-muted">
					{t("plan.more").replace("{n}", String(rest))}
				</p>
			)}
		</>
	);
}

function Swap({
	product,
	value,
	onChange,
	seats,
	t,
	tc,
	lang,
}: {
	product: ListedProduct;
	/** `altId` of the chosen replacement, or KEEP. */
	value: string;
	onChange: (v: string) => void;
	seats: number;
	t: T;
	tc: TC;
	lang: Lang;
}) {
	const oss = replacements(product);
	const cheaper = product.alternatives.filter(
		(a): a is Extract<Alternative, { kind: "cheaper" }> =>
			a.kind === "cheaper" && product.verdict !== "not-yet",
	);
	const options: Alternative[] = [...oss, ...cheaper];

	const Option = ({ alt }: { alt: Alternative }) => {
		const id = altId(alt.name);
		const on = value === id;
		return (
			<label
				className="flex cursor-pointer gap-2.5 rounded-[calc(var(--radius))] border p-2.5 transition"
				style={{
					borderColor: on ? "var(--brand)" : "var(--color-border)",
					background: on
						? "color-mix(in srgb, var(--brand) 7%, transparent)"
						: "var(--bg)",
				}}
			>
				<input
					type="radio"
					name={`swap-${product.slug}`}
					checked={on}
					onChange={() => onChange(id)}
					className="mt-1 size-4 shrink-0 accent-[var(--brand)]"
				/>
				<span className="min-w-0 flex-1">
					<span className="flex items-center gap-2">
						<Logo src={altIcon(alt)} name={alt.name} size={20} />
						<span className="min-w-0 truncate text-sm font-medium">
							{alt.name}
						</span>
					</span>
					<span className="mt-1 block text-xs text-muted">{tc(alt.note)}</span>
					{alt.kind === "oss" && alt.facts.paywalled && (
						<span className="mt-1 block text-xs text-muted">
							— {tc(alt.facts.paywalled)}
						</span>
					)}
					<span className="mt-1.5 flex flex-wrap gap-1 font-mono text-[10px] uppercase tracking-wider text-muted">
						<AltFacts alt={alt} t={t} lang={lang} />
					</span>
				</span>
			</label>
		);
	};

	return (
		<article className={`${card} p-4`}>
			<header className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
				<ProductLogo product={product} size={26} />
				<span className="font-medium">{product.name}</span>
				<PriceLine product={product} seats={seats} t={t} lang={lang} />
				<span className="ml-auto">
					<VerdictMark verdict={product.verdict} t={t} />
				</span>
			</header>

			{options.length === 0 ? (
				/* The site's whole proposition: an honest no, with the reasoning, and
				   no bad option offered in its place. */
				<div
					className="mt-3 rounded-[calc(var(--radius))] border p-3"
					style={{
						borderColor: "color-mix(in srgb, var(--v-no) 45%, transparent)",
					}}
				>
					<p className="text-sm font-medium" style={{ color: "var(--v-no)" }}>
						{t("plan.noCredible")}
					</p>
					<p className="mt-1 text-sm text-muted">{tc(product.why)}</p>
					<p className="mt-1.5 text-xs text-muted">
						{t("plan.noCredibleNote")}
					</p>
				</div>
			) : (
				<fieldset className="mt-3">
					<legend className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
						{t("plan.replaceWith")}
					</legend>
					<div className="grid gap-1.5 sm:grid-cols-2">
						{options.map((a) => (
							<Option key={a.name} alt={a} />
						))}
						<label
							className="flex cursor-pointer items-center gap-2.5 rounded-[calc(var(--radius))] border p-2.5"
							style={{
								borderColor:
									value === KEEP ? "var(--brand)" : "var(--color-border)",
							}}
						>
							<input
								type="radio"
								name={`swap-${product.slug}`}
								checked={value === KEEP}
								onChange={() => onChange(KEEP)}
								className="size-4 shrink-0 accent-[var(--brand)]"
							/>
							<span className="text-sm">
								{t("plan.keepPaying")}
								<span className="block text-xs text-muted">
									{t("plan.keepPayingNote")}
								</span>
							</span>
						</label>
					</div>
				</fieldset>
			)}

			{product.whatYouLose.length > 0 &&
				value !== KEEP &&
				options.length > 0 && (
					<p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted">
						<span className="font-mono text-[10px] uppercase tracking-[0.16em]">
							{t("row.whatYouLose")}
						</span>
						{product.whatYouLose.map((l) => (
							<span
								key={l.en}
								className="rounded-[calc(var(--radius))] border border-border px-2 py-0.5"
							>
								{tc(l)}
							</span>
						))}
					</p>
				)}
		</article>
	);
}

const Figure = ({
	label,
	value,
	strong,
}: {
	label: string;
	value: string;
	strong?: boolean;
}) => (
	<div className="bg-surface px-3.5 py-3">
		<dd
			className={`nums ${strong ? "text-xl font-bold" : "text-lg"}`}
			style={strong ? { color: "var(--brand)" } : undefined}
		>
			{value}
		</dd>
		<dt className="mt-1 text-[10px] uppercase tracking-widest text-muted">
			{label}
		</dt>
	</div>
);

/** The assumptions behind the figure, as a list, in words, on the page. */
function Working({
	spend,
	paidReplacements,
	t,
}: {
	spend: Spend;
	paidReplacements: number;
	t: T;
}) {
	const lines = [
		spend.perSeat.count > 0 &&
			t("plan.mathPerSeat")
				.replace("{n}", String(spend.perSeat.count))
				.replace("{seats}", String(spend.seats)),
		spend.flat.count > 0 &&
			t("plan.mathFlat").replace("{n}", String(spend.flat.count)),
		spend.usage.count > 0 &&
			t("plan.mathUsage").replace("{n}", String(spend.usage.count)),
		spend.oneTime.count > 0 &&
			t("plan.mathOneTime").replace("{n}", String(spend.oneTime.count)),
		spend.unpriced > 0 &&
			t("plan.mathUnpriced").replace("{n}", String(spend.unpriced)),
		paidReplacements > 0 &&
			t("plan.mathPaidAlt").replace("{n}", String(paidReplacements)),
	].filter((l): l is string => typeof l === "string");

	if (lines.length === 0) return null;
	return (
		<ul className="mt-3 space-y-1 text-xs text-muted">
			{lines.map((l) => (
				<li key={l}>· {l}</li>
			))}
		</ul>
	);
}

export function EstimatePage({
	products,
	categories,
	t,
	tc,
	lang,
}: {
	products: ListedProduct[];
	categories: Category[];
	t: T;
	tc: TC;
	lang: Lang;
}) {
	const [picked, setPicked] = useState<string[]>([]);
	const [choice, setChoice] = useState<Record<string, string>>({});
	const [seats, setSeats] = useState(DEFAULT_SEATS);
	// False until the URL has been read. Guards the writer below, which would
	// otherwise wipe a shared plan on the first paint.
	const [ready, setReady] = useState(false);
	const [copied, setCopied] = useState(false);
	const [sent, setSent] = useState<"idle" | "sending" | "done" | "error">(
		"idle",
	);

	const bySlug = useMemo(
		() => new Map(products.map((p) => [p.slug, p])),
		[products],
	);

	/** The shared link, adopted after mount — never during the first render. */
	useEffect(() => {
		const params = new URLSearchParams(location.search);
		const plan = decodePlan(params.get("plan"));
		if (plan.length > 0) {
			setPicked(plan.map((c) => c.slug));
			setChoice(
				Object.fromEntries(
					plan.filter((c) => c.alt).map((c) => [c.slug, c.alt]),
				),
			);
		}
		const n = Number(params.get("seats"));
		if (Number.isFinite(n) && n >= 1)
			setSeats(Math.min(100_000, Math.round(n)));
		setReady(true);
	}, []);

	/** The plan, resolved against the catalogue: what is picked, and what replaces it. */
	const plan = useMemo(
		() =>
			picked
				.map((slug) => bySlug.get(slug))
				.filter((p): p is ListedProduct => p !== undefined)
				.map((product) => {
					const options: Alternative[] = [
						...replacements(product),
						...(product.verdict === "not-yet"
							? []
							: product.alternatives.filter((a) => a.kind === "cheaper")),
					];
					const fallback = defaultReplacement(product);
					const wanted = choice[product.slug];
					// A link written against an entry that has since been renamed falls
					// back to the default rather than to nothing — visible, not silent.
					const alt =
						wanted === KEEP
							? null
							: (options.find((a) => altId(a.name) === wanted) ?? fallback);
					return {
						product,
						options,
						alt,
						value:
							wanted === KEEP || (!alt && options.length > 0)
								? KEEP
								: alt
									? altId(alt.name)
									: KEEP,
					};
				}),
		[picked, choice, bySlug],
	);

	/** `?plan=…&seats=…`, kept in step with the state it describes. */
	const url = useMemo(() => {
		const base = paths.estimate(lang);
		if (plan.length === 0) return base;
		const query = new URLSearchParams();
		query.set(
			"plan",
			// A product with nothing to choose from writes only its slug: there was
			// no decision to record, so `figma~keep` would be noise in the link and a
			// claim the reader never made.
			encodePlan(
				plan.map((r) => ({
					slug: r.product.slug,
					alt: r.options.length === 0 ? "" : r.value,
				})),
			),
		);
		if (seats !== DEFAULT_SEATS) query.set("seats", String(seats));
		return `${base}?${query}`;
	}, [plan, seats, lang]);

	useEffect(() => {
		if (!ready) return;
		history.replaceState({}, "", url);
		setCopied(false);
	}, [url, ready]);

	const toggle = (slug: string) =>
		setPicked((prev) =>
			prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug],
		);

	const now = spendOf(
		plan.map((r) => r.product),
		seats,
	);
	const staying = plan.filter((r) => r.alt === null).map((r) => r.product);
	const after = spendOf(staying, seats);
	// A cheaper commercial replacement is still a bill. The dataset does not record
	// whether its price is per seat, so it is counted once, at the listed rate, and
	// said so in the working rather than multiplied by a number we do not have.
	const paidReplacements = plan.filter(
		(r) => r.alt?.kind === "cheaper" && r.alt.priceMonthly !== null,
	);
	const paidCents = paidReplacements.reduce(
		(n, r) =>
			n +
			Math.round(
				((r.alt as Extract<Alternative, { kind: "cheaper" }>).priceMonthly ??
					0) * 100,
			),
		0,
	);
	const afterCents = after.monthlyCents + paidCents;
	const leavesCents = now.monthlyCents - afterCents;

	/** One project may replace several products, so the run list is deduplicated. */
	const toRun = useMemo(() => {
		const byName = new Map<
			string,
			{ alt: OssAlternative; products: string[] }
		>();
		for (const row of plan) {
			if (row.alt?.kind !== "oss") continue;
			const hit = byName.get(row.alt.name);
			if (hit) hit.products.push(row.product.name);
			else
				byName.set(row.alt.name, {
					alt: row.alt,
					products: [row.product.name],
				});
		}
		return [...byName.values()];
	}, [plan]);

	const effort = {
		managed: toRun.filter((r) => r.alt.effort === "managed").length,
		docker: toRun.filter((r) => r.alt.effort === "docker").length,
		ops: toRun.filter((r) => r.alt.effort === "ops").length,
	};

	const losing = plan.filter(
		(r) => r.alt !== null && r.product.whatYouLose.length > 0,
	);

	return (
		<main className={`mx-auto ${MEASURE} px-4 pt-10 pb-16`}>
			<p
				className="font-mono text-[10px] uppercase tracking-[0.2em]"
				style={{ color: "var(--brand)" }}
			>
				{t("plan.eyebrow")}
			</p>
			<h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-balance">
				{t("plan.title")}
			</h1>
			<p className="mt-3 max-w-2xl text-pretty text-muted">{t("plan.blurb")}</p>

			{/* ---------------- step 1 ---------------- */}

			<section className="mt-10">
				{/* The count comes from the catalogue in hand, never from a number
				    written into the copy — the catalogue grows every week. */}
				<Step
					n={1}
					label={t("plan.step1")}
					hint={t("plan.step1Hint").replace("{n}", String(products.length))}
				/>

				{plan.length > 0 && (
					<ul className="mb-3 flex flex-wrap gap-1.5">
						{plan.map((r) => (
							<li key={r.product.slug}>
								<button
									type="button"
									onClick={() => toggle(r.product.slug)}
									className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition hover:opacity-80"
									style={{
										borderColor: "var(--brand)",
										color: "var(--brand)",
									}}
									aria-label={`${t("plan.remove")} ${r.product.name}`}
								>
									{r.product.name}
									<X className="size-3" aria-hidden />
								</button>
							</li>
						))}
						<li>
							<button
								type="button"
								onClick={() => {
									setPicked([]);
									setChoice({});
								}}
								className="rounded-full border border-border px-2.5 py-1 text-xs text-muted hover:text-text"
							>
								{t("plan.clear")}
							</button>
						</li>
					</ul>
				)}

				<Picker
					products={products}
					categories={categories}
					picked={picked}
					toggle={toggle}
					t={t}
					tc={tc}
					lang={lang}
				/>
			</section>

			{/* ---------------- step 2 ---------------- */}

			<section className="mt-12">
				<Step n={2} label={t("plan.step2")} hint={t("plan.step2Hint")} />

				{plan.length === 0 ? (
					<p className={`${card} p-5 text-sm text-muted`}>
						{t("plan.step2Empty")}
					</p>
				) : (
					<div className="grid gap-3">
						{plan.map((r) => (
							<Swap
								key={r.product.slug}
								product={r.product}
								value={r.value}
								onChange={(v) =>
									setChoice((prev) => ({ ...prev, [r.product.slug]: v }))
								}
								seats={seats}
								t={t}
								tc={tc}
								lang={lang}
							/>
						))}
					</div>
				)}
			</section>

			{/* ---------------- the plan ---------------- */}

			{plan.length > 0 && (
				<section className="mt-12">
					<h2 className="font-display text-lg font-semibold">
						{t("plan.yourPlan")}
					</h2>

					<div className={`${card} mt-3 p-5`}>
						{toRun.length > 0 ? (
							<>
								<h3 className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
									{t("plan.toRun")}
								</h3>
								<ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
									{toRun.map((r) => (
										<li
											key={r.alt.name}
											className="flex items-center gap-2 text-sm"
										>
											<Logo src={altIcon(r.alt)} name={r.alt.name} size={20} />
											<span className="min-w-0">
												<span className="font-medium">{r.alt.name}</span>
												<span className="block truncate text-xs text-muted">
													{r.products.join(" · ")}
												</span>
											</span>
										</li>
									))}
								</ul>

								<h3 className="mt-5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
									{t("plan.effortHeading")}
								</h3>
								<p className="mt-2 flex flex-wrap gap-1.5 text-xs">
									{effort.managed > 0 && (
										<Tag>
											{effort.managed} × {t("effort.managed")}
										</Tag>
									)}
									{effort.docker > 0 && (
										<Tag>
											{effort.docker} × {t("effort.docker")}
										</Tag>
									)}
									{effort.ops > 0 && (
										<Tag warn>
											{effort.ops} × {t("effort.ops")}
										</Tag>
									)}
								</p>
							</>
						) : (
							<p className="text-sm text-muted">{t("plan.runNothing")}</p>
						)}

						{staying.length > 0 && (
							<>
								<h3 className="mt-5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
									{t("plan.staying")}
								</h3>
								<p className="mt-1.5 text-sm text-muted">
									{staying.map((p) => p.name).join(" · ")}
								</p>
							</>
						)}
					</div>

					{/* ---- money ---- */}

					<div className={`${card} mt-3 p-5`}>
						<label className="flex flex-wrap items-center gap-2 text-sm">
							<span className="text-muted">{t("plan.seats")}</span>
							<input
								type="number"
								min={1}
								max={100000}
								value={seats}
								onChange={(e) =>
									setSeats(
										Math.min(100_000, Math.max(1, Number(e.target.value) || 1)),
									)
								}
								className={`${field} nums w-24`}
							/>
							<span className="text-xs text-muted">{t("plan.seatsNote")}</span>
						</label>

						<dl className="mt-4 grid grid-cols-1 gap-px overflow-hidden rounded-[calc(var(--radius))] border border-border bg-border sm:grid-cols-3">
							<Figure
								label={t("plan.now")}
								value={`${money(now.monthlyCents, lang)}${t("row.perMonth")}`}
							/>
							<Figure
								label={t("plan.after")}
								value={`${money(afterCents, lang)}${t("row.perMonth")}`}
							/>
							<Figure
								label={t("plan.leaves")}
								value={`${money(leavesCents, lang)}${t("row.perMonth")}`}
								strong
							/>
						</dl>

						<Working
							spend={now}
							paidReplacements={paidReplacements.length}
							t={t}
						/>

						{/* Never a "saving". The costs this figure excludes are named, in
						    words, on the page — an inflated number here would cost the site
						    the credibility the rest of it is built on. */}
						<p className="mt-3 text-xs text-muted">{t("plan.notASaving")}</p>
					</div>

					{/* ---- what you give up ---- */}

					{losing.length > 0 && (
						<div className={`${card} mt-3 p-5`}>
							<h3 className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
								{t("row.whatYouLose")}
							</h3>
							<ul className="mt-2 space-y-1.5 text-sm">
								{losing.map((r) => (
									<li key={r.product.slug}>
										<span className="text-muted">{r.product.name}:</span>{" "}
										{r.product.whatYouLose.map((l) => tc(l)).join(" · ")}
									</li>
								))}
							</ul>
						</div>
					)}

					{/* ---- keep it ---- */}

					<div className={`${card} mt-3 flex flex-wrap items-center gap-3 p-5`}>
						<button
							type="button"
							onClick={() => {
								navigator.clipboard
									?.writeText(location.href)
									.then(() => setCopied(true))
									.catch(() => {});
							}}
							className="inline-flex items-center gap-2 rounded-[calc(var(--radius))] px-4 py-2.5 text-sm font-semibold transition hover:brightness-110"
							style={{ background: "var(--brand)", color: "#fff" }}
						>
							<Link2 className="size-4" aria-hidden />
							{copied ? t("plan.copied") : t("plan.copy")}
						</button>
						<p className="text-xs text-muted">{t("plan.shareNote")}</p>
					</div>
				</section>
			)}

			{/* ---------------- the ask, last and skippable ---------------- */}

			<section className="mt-12 border-t border-border pt-8">
				<h2 className="font-display text-lg font-semibold">
					{t("plan.helpTitle")}
				</h2>
				<p className="mt-2 max-w-2xl text-sm text-muted">{t("quote.blurb")}</p>
				<p className="mt-2 text-xs text-muted">{t("plan.helpOptional")}</p>

				{sent === "done" ? (
					<p
						className="mt-5 rounded-[calc(var(--radius))] border p-5 text-sm"
						style={{ borderColor: "var(--v-yes)" }}
					>
						{t("quote.done")}
					</p>
				) : (
					<form
						className="mt-5 grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
						onSubmit={(e) => {
							e.preventDefault();
							const f = new FormData(e.currentTarget);
							setSent("sending");
							api
								.quote({
									email: f.get("email"),
									company: f.get("company") || undefined,
									seats,
									productSlugs: plan.map((r) => r.product.slug),
									// The plan itself, so the reply can be about the migration
									// rather than about which products they ticked.
									plan: encodePlan(
										plan.map((r) => ({
											slug: r.product.slug,
											alt: r.options.length === 0 ? "" : r.value,
										})),
									),
									message: f.get("message") || undefined,
								})
								.then(() => setSent("done"))
								.catch(() => setSent("error"));
						}}
					>
						<input
							name="email"
							type="email"
							required
							placeholder={t("quote.email")}
							className={field}
						/>
						<input
							name="company"
							placeholder={t("quote.company")}
							className={field}
						/>
						<button
							type="submit"
							disabled={sent === "sending"}
							className="rounded-[calc(var(--radius))] border border-border px-5 py-2.5 text-sm font-semibold transition hover:border-[color-mix(in_srgb,var(--brand)_50%,var(--color-border))] disabled:opacity-40"
						>
							{t("quote.submit")}
						</button>
						<textarea
							name="message"
							rows={2}
							placeholder={t("quote.message")}
							className={`${field} sm:col-span-3`}
						/>
						{sent === "error" && (
							<p
								className="text-sm sm:col-span-3"
								style={{ color: "var(--v-no)" }}
							>
								{t("form.error")}
							</p>
						)}
					</form>
				)}
			</section>
		</main>
	);
}
