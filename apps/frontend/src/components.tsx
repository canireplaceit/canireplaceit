import type {
	Alternative,
	CheaperAlternative,
	Facts,
	OssAlternative,
	PriceSource,
	Product,
	Source,
	Verdict,
} from "core/src/content";
import {
	byExitQuality,
	EFFORTS,
	isArchived,
	priceState,
} from "core/src/content";
import { paths } from "core/src/routes";
import { Archive, ExternalLink, Globe, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AdBadge, adLabel, HOUSE, useAdPreview } from "./ads";
import {
	altIcon,
	assetUrl,
	formatDate,
	healthOf,
	homepageOf,
	money,
	outboundUrl,
	productIcon,
	relativeDate,
	type Slot,
	sponsorClickUrl,
} from "./api";
import { type Key, type Lang, useNow } from "./i18n";
import {
	ComposeIcon,
	type FactMark,
	type FactTone,
	ForgeIcon,
	forgeName,
	LicenceIcon,
	openCoreMark,
	residencyMark,
	selfHostMark,
	ssoMark,
} from "./icons";
import { Link } from "./nav";
import { glossaryAnchor } from "./seo";

// grid-cols-1 forces the auto column to stay one track wide; without it a single long child (a tag, a name) widens the grid past the viewport and scrolls the page sideways.
export const GRID_1COL = "grid grid-cols-1";

export const CARD =
	"rounded-[calc(var(--radius))] border border-border bg-surface p-3.5";

type T = (key: Key) => string;

export const VERDICT_COLOR: Record<Verdict, string> = {
	yes: "var(--v-yes)",
	almost: "var(--v-almost)",
	"not-yet": "var(--v-no)",
};

export function Logo({
	src,
	name,
	size = 32,
	eager = false,
}: {
	src: string | null;
	name: string;
	size?: number;
	// Set for the first screenful; lazy loading still costs a layout round trip that delays visible logos.
	eager?: boolean;
}) {
	const [failedIconUrl, setFailedIconUrl] = useState<string | null>(null);
	const imgRef = useRef<HTMLImageElement>(null);
	const resolvedSrc = assetUrl(src);
	const loadFailed = resolvedSrc !== null && resolvedSrc === failedIconUrl;
	// Keyed by url (not a boolean) so a src change is treated as untested rather than latching a permanent failure.
	useEffect(() => {
		if (imgRef.current?.complete && imgRef.current.naturalWidth === 0)
			setFailedIconUrl(resolvedSrc);
	}, [resolvedSrc]);
	if (!resolvedSrc || loadFailed) {
		return (
			<span
				aria-hidden
				className="grid shrink-0 place-items-center rounded-[calc(var(--radius))] border border-border font-semibold text-muted"
				style={{ width: size, height: size, fontSize: size * 0.42 }}
			>
				{name.slice(0, 1).toUpperCase()}
			</span>
		);
	}
	return (
		<img
			ref={imgRef}
			src={resolvedSrc}
			alt=""
			width={size}
			height={size}
			loading={eager ? "eager" : "lazy"}
			decoding="async"
			fetchPriority={eager ? "high" : "auto"}
			onError={() => setFailedIconUrl(resolvedSrc)}
			className="shrink-0 rounded-[calc(var(--radius))] object-contain"
			style={{ width: size, height: size }}
		/>
	);
}

export const ProductLogo = ({
	product,
	size,
	eager,
}: {
	product: Product;
	size?: number;
	eager?: boolean;
}) => (
	<Logo
		src={productIcon(product)}
		name={product.name}
		size={size}
		eager={eager}
	/>
);

export function VerdictMark({
	verdict,
	t,
	lang,
}: {
	verdict: Verdict;
	t: T;
	/** Set only where the mark is NOT already inside a link — see `DefinedTerm`. */
	lang?: Lang;
}) {
	const color = VERDICT_COLOR[verdict];
	const isReplaceable = verdict === "yes";
	return (
		<span className="inline-flex shrink-0 items-center gap-2">
			<span
				className={`size-2 rounded-full ${isReplaceable ? "pulse-yes" : ""}`}
				style={{ background: color }}
			/>
			{/* "Replaceable / Almost / Not yet" are editorial judgements with defined
			    meanings, printed on all 527 rows of the index and, until this link,
			    explained only in a tooltip. */}
			<DefinedTerm
				label={`verdict.${verdict}`}
				t={t}
				lang={lang}
				className="cursor-help font-mono text-[10px] uppercase tracking-[0.12em] decoration-dotted underline-offset-2 hover:underline"
			>
				<span style={{ color }}>{t(`verdict.${verdict}` as Key)}</span>
			</DefinedTerm>
		</span>
	);
}

/** The verdict as a stamp. Remounting via `key` restarts the slam on click. */
export function VerdictStamp({ verdict, t }: { verdict: Verdict; t: T }) {
	const [take, setTake] = useState(0);
	return (
		<button
			key={take}
			type="button"
			onClick={() => setTake((n) => n + 1)}
			className="stamp stamp-slam"
			style={{ color: VERDICT_COLOR[verdict] }}
			title={definitionOf(`verdict.${verdict}`, t)}
		>
			{t(`verdict.${verdict}` as Key)}
		</button>
	);
}

/** Current price, the cheaper paid escape if one exists, and the best live OSS rung. */
export function ExitLadder({
	product,
	t,
	tc,
	lang,
	projectHref,
}: {
	product: Product;
	t: T;
	tc: (m: { en: string }) => string;
	lang: Lang;
	projectHref?: (alt: Alternative) => string | undefined;
}) {
	const oss = product.alternatives.filter(
		(a): a is OssAlternative => a.kind === "oss",
	);
	const live = oss.filter((a) => !isArchived(a, healthOf(a.source)));
	const best = byExitQuality(live, (a) => healthOf(a.source))[0];
	const cheaper = product.alternatives.find(
		(a): a is CheaperAlternative => a.kind === "cheaper",
	);
	// One rung is not a ladder; the alternative cards already cover it.
	if (!best || (!cheaper && product.priceMonthly === null)) return null;

	const monthly = product.priceMonthly;
	const saveYearly = (m: number) =>
		`${t("ladder.save")} ${money(m * 1200, lang)}${t("ladder.perYear")}`;
	const bestHref = projectHref?.(best);

	return (
		<section>
			<h2 className="eyebrow mb-2">{t("ladder.title")}</h2>
			<ul className="ladder mt-3">
				<li data-here="true">
					<p className="eyebrow">{t("ladder.here")}</p>
					<p className="font-display font-semibold">{product.name}</p>
					{monthly !== null && monthly > 0 && (
						<p className="nums text-muted text-xs">
							{money(monthly * 100, lang)}
							{t("row.perMonth")} — {money(monthly * 1200, lang)}
							{t("ladder.perYear")}
						</p>
					)}
				</li>
				{cheaper && (
					<li>
						<p className="eyebrow">{t("ladder.cheaper")}</p>
						<p className="font-display font-semibold">{cheaper.name}</p>
						<p className="nums text-muted text-xs">
							{cheaper.priceMonthly !== null && cheaper.priceMonthly > 0 && (
								<>
									{money(cheaper.priceMonthly * 100, lang)}
									{t("row.perMonth")}
								</>
							)}
							{cheaper.priceOnce !== undefined && (
								<>
									{money(cheaper.priceOnce * 100, lang)} {t("row.once")}
								</>
							)}
							{monthly !== null &&
								cheaper.priceMonthly !== null &&
								monthly > cheaper.priceMonthly && (
									<>
										{" · "}
										<span style={{ color: "var(--v-yes)" }}>
											{saveYearly(monthly - cheaper.priceMonthly)}
										</span>
									</>
								)}
						</p>
					</li>
				)}
				<li>
					<p className="eyebrow">{t("ladder.oss")}</p>
					<p className="font-display font-semibold">
						{bestHref ? (
							<Link href={bestHref} className="hover:underline">
								{best.name}
							</Link>
						) : (
							best.name
						)}
					</p>
					<p className="nums text-muted text-xs">
						{t(`effort.${best.effort}` as Key)} · {best.license}
						{monthly !== null && monthly > 0 && (
							<>
								{" · "}
								<span style={{ color: "var(--v-yes)" }}>
									{saveYearly(monthly)}
								</span>
							</>
						)}
					</p>
					{/* A list page ships its alternatives without the prose only this
					    page prints, so a client-side navigation that lands here before
					    the catalogue has loaded has a name and no note. */}
					{best.note && (
						<p className="mt-0.5 text-muted text-xs">{tc(best.note)}</p>
					)}
				</li>
			</ul>
		</section>
	);
}

export const hostOf = (url: string) => {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return url;
	}
};

// Absolute date is what the prerendered HTML carries and goes stale; the relative reading is added post-hydration from the reader's clock (useNow).
function FreshDate({
	iso,
	lang,
	compact,
}: {
	iso: string;
	lang: Lang;
	/** Show only the relative reading once mounted — for a chip with no room. */
	compact?: boolean;
}) {
	const now = useNow();
	const rel = now === null ? null : relativeDate(iso, lang, now);
	return (
		<time dateTime={iso}>
			{compact && rel ? rel : formatDate(iso, lang)}
			{!compact && rel && ` (${rel})`}
		</time>
	);
}

function ConfidenceChip({
	confidence,
	t,
}: {
	confidence: PriceSource["confidence"];
	t: T;
}) {
	// "high" is the common case, and returning null for it left a "Confidence"
	// label with nothing after it on most product pages — a dangling row in the
	// receipt and an empty cell to anything parsing the page.
	const isLowConfidence = confidence === "low";
	return (
		<span
			title={isLowConfidence ? t("price.confidence.lowNote") : undefined}
			className="rounded-[calc(var(--radius))] border px-1.5 py-0.5 text-[10px] uppercase tracking-wider"
			style={
				isLowConfidence
					? { borderColor: "var(--v-almost)", color: "var(--v-almost)" }
					: { borderColor: "var(--color-border)" }
			}
		>
			{t(`price.confidence.${confidence}` as Key)}
		</span>
	);
}

export function PriceBlock({
	product,
	t,
	lang,
}: {
	product: Product;
	t: T;
	lang: Lang;
}) {
	const state = priceState(product);
	const pricing = product.pricing;

	if (state === "unverified") {
		// No check date exists; printing today's would falsely assert one.
		return (
			<div className="text-sm">
				<p className="text-muted">{t("price.unverified")}</p>
				<p className="mt-0.5 text-xs text-muted">{t("price.unverifiedNote")}</p>
			</div>
		);
	}

	const value =
		product.priceMonthly !== null
			? product.priceMonthly === 0
				? t("row.free")
				: `${money(product.priceMonthly * 100, lang)}${t("row.perMonth")}`
			: state === "no-price"
				? t("price.noPublic")
				: pricing
					? t(`price.basis.${pricing.basis}` as Key)
					: t("row.quoteOnly");

	const isUnconfirmed = pricing?.confidence === "low";

	return (
		<div className="text-sm">
			<p
				className="nums font-semibold text-xl"
				style={
					isUnconfirmed
						? {
								textDecoration: "underline dotted",
								textUnderlineOffset: "3px",
								color: "var(--v-almost)",
							}
						: undefined
				}
			>
				{/* The figure a parser should read, beside the one a reader does:
				    "$9/mo" is a currency, a number and a period glued together, and
				    only the number is comparable. */}
				{product.priceMonthly !== null ? (
					<data value={String(product.priceMonthly)}>{value}</data>
				) : (
					value
				)}
			</p>
			{state === "no-price" && (
				<p className="mt-1 text-xs text-muted">{t("price.noPublicNote")}</p>
			)}
			{pricing && (
				<div className="mt-2">
					{pricing.plan && (
						<p className="receipt-row">
							<span className="text-muted">{t("price.plan")}</span>
							<span className="min-w-0 text-right">{pricing.plan}</span>
						</p>
					)}
					<p className="receipt-row">
						<span className="text-muted">{t("price.basisLabel")}</span>
						<span className="nums">
							{t(`price.basis.${pricing.basis}` as Key)}
						</span>
					</p>
					<p className="receipt-row">
						<span className="text-muted">{t("price.checked")}</span>
						<span className="nums">
							<FreshDate iso={pricing.checkedOn} lang={lang} />
						</span>
					</p>
					<p className="receipt-row">
						<span className="text-muted">{t("price.confidenceLabel")}</span>
						<ConfidenceChip confidence={pricing.confidence} t={t} />
					</p>
					<p className="receipt-row border-b-0">
						<span className="text-muted">{t("price.source")}</span>
						<a
							href={outboundUrl(pricing.url, "price")}
							target="_blank"
							rel="noopener nofollow"
							className="inline-flex min-w-0 items-center gap-1 text-brand hover:underline"
						>
							<span className="truncate">{hostOf(pricing.url)}</span>
							<ExternalLink className="size-3 shrink-0" aria-hidden />
						</a>
					</p>
					<span className="receipt-edge" aria-hidden />
				</div>
			)}
		</div>
	);
}

/**
 * How many alternatives lead the section before the rest fold away.
 *
 * Three, because that is how many fit across the section at desktop width and
 * still read as recommendations rather than as a list. 389 of 527 products cite
 * 11–20 alternatives, so folding is the common case, not the edge.
 */
const LEAD = 3;

// Below a year, a stale commit date is trivia (plenty of finished tools go quiet); past a year it's the answer readers came for.
const DORMANT_DAYS = 365;

/** The one archived badge, so the two paths through `RepoFreshness` agree. */
function ArchivedBadge({ t }: { t: T }) {
	return (
		<span
			className="inline-flex items-center gap-1 rounded-[calc(var(--radius))] border px-1.5 py-0.5 font-medium"
			style={{ borderColor: "var(--v-no)", color: "var(--v-no)" }}
		>
			<Archive className="size-3" aria-hidden />
			{t("repo.archived")}
		</span>
	);
}

export function RepoFreshness({
	source,
	t,
	lang,
	full,
	archived,
}: {
	source: Source;
	t: T;
	lang: Lang;
	/** Compose spelled out rather than abbreviated, for the project's own page. */
	full?: boolean;
	/**
	 * The entry's own reading, for the two-thirds of cited repos with no health
	 * record. Without it this component returned null for them, so a project we
	 * knew was dead rendered exactly like a live one.
	 */
	archived?: boolean;
}) {
	const health = healthOf(source);
	// The forge wins when it has an opinion; the entry covers everything else.
	const isDead = health?.archived ?? archived === true;
	// Nothing known from either source is still nothing to say.
	if (!health) {
		return isDead ? <ArchivedBadge t={t} /> : null;
	}
	const lastPushMs = health.lastPush ? Date.parse(health.lastPush) : Number.NaN;
	const dormantSince =
		Number.isFinite(lastPushMs) &&
		Date.now() - lastPushMs > DORMANT_DAYS * 86_400_000
			? (health.lastPush as string)
			: null;
	return (
		<>
			{isDead && <ArchivedBadge t={t} />}
			{dormantSince && !isDead && (
				<Tag>
					<span className="nums" style={{ color: "var(--v-almost)" }}>
						{t("repo.dormant")}{" "}
						<FreshDate iso={dormantSince} lang={lang} compact={!full} />
					</span>
				</Tag>
			)}
			{health.hasCompose && (
				<Tag>
					<span
						className="inline-flex items-center gap-1"
						title={full ? undefined : t("repo.compose")}
					>
						<ComposeIcon />
						{t(full ? "repo.compose" : "repo.composeShort")}
					</span>
				</Tag>
			)}
			{full && health.language && (
				<Tag>
					<span>
						{t("repo.language")} {health.language}
					</span>
				</Tag>
			)}
		</>
	);
}

export function AlternativeCard({
	alt,
	t,
	tc,
	lang,
	projectHref,
}: {
	alt: Alternative;
	t: T;
	tc: (v: { en: string }) => string;
	lang: Lang;
	/** The project's own page here, when it has one. The forge link stays too. */
	projectHref?: string;
}) {
	const href = alt.kind === "oss" ? alt.source.url : alt.url;
	const health = alt.kind === "oss" ? healthOf(alt.source) : null;
	const homepage = alt.kind === "oss" ? homepageOf(alt.source) : null;
	const websiteLabel = `${alt.name} — ${t("alt.website")}`;
	return (
		<li
			className="rounded-[calc(var(--radius))] border bg-bg p-3.5"
			style={{
				// Same resolver as the badge and the demotion, or a project with no
				// health reading gets the badge and keeps a neutral border.
				borderColor:
					alt.kind === "oss" && isArchived(alt, health)
						? "color-mix(in srgb, var(--v-no) 55%, transparent)"
						: "var(--color-border)",
			}}
		>
			<div className="flex items-center gap-2.5">
				<Logo src={altIcon(alt)} name={alt.name} size={26} />
				{projectHref ? (
					<Link
						href={projectHref}
						className="min-w-0 flex-1 truncate font-medium hover:underline"
					>
						{alt.name}
					</Link>
				) : (
					<a
						href={outboundUrl(href, alt.kind === "oss" ? "repo" : "alt")}
						target="_blank"
						rel="noopener"
						className="min-w-0 flex-1 truncate font-medium hover:underline"
					>
						{alt.name}
					</a>
				)}
				{homepage && (
					<IconLink
						href={outboundUrl(homepage, "homepage")}
						label={websiteLabel}
					>
						<Globe className="size-3.5" aria-hidden />
					</IconLink>
				)}
				{alt.kind === "oss" ? (
					<IconLink
						href={outboundUrl(alt.source.url, "repo")}
						label={`${alt.name} ${t("repo.at")} ${forgeName(alt.source.host, t)}`}
					>
						<ForgeIcon host={alt.source.host} />
					</IconLink>
				) : (
					<IconLink href={outboundUrl(alt.url, "alt")} label={websiteLabel}>
						<ExternalLink className="size-3.5" aria-hidden />
					</IconLink>
				)}
			</div>
			{alt.note && <p className="mt-1.5 text-sm text-muted">{tc(alt.note)}</p>}
			{alt.kind === "oss" && alt.facts.paywalled && (
				<p className="mt-1 text-xs text-muted">— {tc(alt.facts.paywalled)}</p>
			)}
			<p className="mt-2.5 flex flex-wrap gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted">
				{alt.kind === "oss" ? (
					<>
						{/* Only when it is not "none" — that is 87% of the catalogue, and
						    a card wearing "fully open" beside eleven identical cards
						    says nothing. What matters is spotting the 13% that hold
						    something back. */}
						{alt.facts.openCore !== "none" && (
							<FactTag
								mark={openCoreMark(alt.facts.openCore)}
								t={t}
								lang={lang}
							/>
						)}
						<Tag>
							<DefinedTerm
								label={`effort.${alt.effort}`}
								t={t}
								lang={lang}
								className="cursor-help decoration-dotted underline-offset-2 hover:underline"
							>
								{t(`effort.${alt.effort}` as Key)}
							</DefinedTerm>
						</Tag>
						<FactMarks
							facts={alt.facts}
							license={alt.license}
							t={t}
							lang={lang}
						/>
						<RepoFreshness
							source={alt.source}
							t={t}
							lang={lang}
							archived={alt.archived}
						/>
					</>
				) : (
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
				)}
			</p>
		</li>
	);
}

// Marks are 14px; the hit area is enlarged to 24px via a negative margin so it stays a usable touch target without changing the visual size.
const IconLink = ({
	href,
	label,
	children,
}: {
	href: string;
	label: string;
	children: React.ReactNode;
}) => (
	<a
		href={href}
		target="_blank"
		rel="noopener"
		aria-label={label}
		title={label}
		className="-m-1 grid size-6 shrink-0 place-items-center text-muted transition hover:text-text"
	>
		{children}
	</a>
);

export const Tag = ({
	children,
	accent,
	warn,
	bad,
}: {
	children: React.ReactNode;
	accent?: boolean;
	warn?: boolean;
	/** Stronger than `warn`: this fact disqualifies the entry, not just costs. */
	bad?: boolean;
}) => (
	<span
		className="rounded-[calc(var(--radius))] border px-1.5 py-0.5"
		style={
			accent
				? { borderColor: "var(--accent)", color: "var(--accent)" }
				: bad
					? { borderColor: "var(--v-no)", color: "var(--v-no)" }
					: warn
						? { borderColor: "var(--v-almost)", color: "var(--v-almost)" }
						: { borderColor: "var(--color-border)" }
		}
	>
		{children}
	</span>
);

// unknown/vary stay uncoloured on purpose: "nobody checked" is not a warning.
const TONE_COLOR: Record<FactTone, string | undefined> = {
	plain: undefined,
	warn: "var(--v-almost)",
	bad: "var(--v-no)",
	unknown: undefined,
	vary: undefined,
};

// Word is never optional here (no icon-only variant): these are compliance-adjacent claims (EU region, SSO) that must not depend on guessing an icon.
/**
 * The definition of a term, if we wrote one.
 *
 * Every label here — "hosted option", "open core", "mostly open" — is a precise
 * term whose meaning lived in a code comment and nowhere a reader could reach.
 * `def.<label>` is that comment, moved to where the term is used. Missing is
 * fine and silent: a term with no definition renders exactly as before.
 */
export const definitionOf = (label: string, t: T): string | undefined => {
	const d = t(`def.${label}` as Key);
	// The translator returns the key itself when there is no entry.
	return d === `def.${label}` ? undefined : d;
};

/**
 * A term whose meaning we wrote down, linked to where we wrote it.
 *
 * `title` alone was the whole affordance: not focusable, so a keyboard user
 * could never read it, invisible to a touch reader with no hover, and invisible
 * to Google. The definition already exists as a `<dd>` on the glossary, so the
 * fix is a link to it — which also gives the glossary the inbound links it had
 * none of.
 *
 * `lang` is what gates it: rendered inside an `<a>` (a product card, a project
 * row) callers leave it off and get the old non-interactive span, because a
 * nested anchor is not markup a browser will keep.
 */
export function DefinedTerm({
	label,
	t,
	lang,
	className,
	children,
}: {
	label: string;
	t: T;
	lang?: Lang;
	className?: string;
	children: React.ReactNode;
}) {
	const definition = definitionOf(label, t);
	if (!definition) return <span className={className}>{children}</span>;
	if (!lang)
		return (
			<span className={className} title={definition}>
				{children}
			</span>
		);
	return (
		<a
			href={`${paths.glossary(lang)}#${glossaryAnchor(label)}`}
			title={definition}
			className={className}
		>
			{children}
		</a>
	);
}

export function FactTag({
	mark,
	t,
	lang,
}: {
	mark: FactMark;
	t: T;
	/** Set only where the tag is NOT already inside a link — see `DefinedTerm`. */
	lang?: Lang;
}) {
	const { Icon, tone } = mark;
	const definition = definitionOf(mark.label, t);
	return (
		<Tag warn={tone === "warn"} bad={tone === "bad"}>
			<DefinedTerm
				label={mark.label}
				t={t}
				lang={lang}
				className={`inline-flex items-center gap-1${definition ? " cursor-help decoration-dotted underline-offset-2 hover:underline" : ""}`}
			>
				<Icon className="size-3 shrink-0" aria-hidden />
				{t(mark.label as Key)}
			</DefinedTerm>
		</Tag>
	);
}

export function FactMarks({
	facts,
	license,
	t,
	lang,
	vary = [],
	full,
}: {
	facts: Facts;
	license?: string;
	t: T;
	/** Set only where the marks are NOT already inside a link. */
	lang?: Lang;
	// Fields the citing products disagree on; see Product.factsVary. Non-empty only on project pages.
	vary?: (keyof Facts)[];
	/** Show the facts nobody has checked, rather than dropping them. */
	full?: boolean;
}) {
	const disagreesOn = (k: keyof Facts) => vary.includes(k);
	const marks = [
		selfHostMark(facts.selfHostable, disagreesOn("selfHostable")),
		ssoMark(facts.ssoInFree, disagreesOn("ssoInFree")),
		residencyMark(facts.dataResidency, disagreesOn("dataResidency")),
	];
	return (
		<>
			{license && (
				<Tag>
					<span className="inline-flex items-center gap-1">
						<LicenceIcon className="size-3 shrink-0" aria-hidden />
						{license}
					</span>
				</Tag>
			)}
			{marks
				// `unremarkable` is the value 87–99.8% of entries share; see FactMark.
				// A row of tags that never vary is decoration, and it buries the one or
				// two that do.
				.filter((m) => full || (m.tone !== "unknown" && !m.unremarkable))
				.map((m) => (
					<FactTag key={m.label} mark={m} t={t} lang={lang} />
				))}
		</>
	);
}

export function OpenCorePanel({
	facts,
	t,
	tc,
	vary = [],
}: {
	facts: Facts;
	t: T;
	tc: (v: { en: string }) => string;
	// List, not boolean: the grade and what's paywalled can disagree independently across citing products.
	vary?: (keyof Facts)[];
}) {
	const varyGrade = vary.includes("openCore");
	const mark = openCoreMark(facts.openCore, varyGrade);
	const { Icon } = mark;
	const color = TONE_COLOR[mark.tone] ?? "var(--brand)";
	return (
		<div
			className="rounded-[calc(var(--radius))] border p-3.5"
			style={{
				borderColor: `color-mix(in srgb, ${color} 45%, var(--color-border))`,
				background: `color-mix(in srgb, ${color} 5%, transparent)`,
			}}
		>
			<p className="flex items-center gap-2 font-medium" style={{ color }}>
				<Icon className="size-4 shrink-0" aria-hidden />
				{t(mark.label as Key)}
			</p>
			<p className="mt-1.5 text-sm text-muted">
				{varyGrade
					? t("facts.variesNote")
					: t(`facts.openCore.${facts.openCore}Note` as Key)}
			</p>
			{facts.paywalled &&
				(vary.includes("paywalled") ? (
					// Only show the "varies" note when the grade itself agrees, to avoid conflicting messages.
					!varyGrade && (
						<p className="mt-1.5 text-sm text-muted">
							{t("facts.paywalledVaries")}
						</p>
					)
				) : (
					<p className="mt-1.5 text-sm">
						<span className="font-mono text-[10px] uppercase tracking-wider text-muted">
							{t("facts.paywalledLabel")}
						</span>{" "}
						{tc(facts.paywalled)}
					</p>
				))}
		</div>
	);
}

export function AlternativeList({
	product,
	t,
	tc,
	lang,
	projectHref,
}: {
	product: Product;
	t: T;
	tc: (v: { en: string }) => string;
	lang: Lang;
	/** Where this project's page lives, if it has one. */
	projectHref?: (alt: Alternative) => string | undefined;
}) {
	const allOss = product.alternatives.filter((a) => a.kind === "oss");
	// Archived projects stay on the page — the catalogue records what existed as
	// well as what exists — but they must not hold the same position as a live
	// one. Nothing here is dropped; it is moved below the fold of the section and
	// named for what it is.
	const ranked = byExitQuality(allOss, (a) => healthOf(a.source));
	const dead = ranked.filter((a) => isArchived(a, healthOf(a.source)));
	const oss = ranked.filter((a) => !isArchived(a, healthOf(a.source)));
	const cheaper = product.alternatives.filter((a) => a.kind === "cheaper");

	/**
	 * Two narrowings, on the two axes a reader actually arrives with: "I am not
	 * running a server" and "no strings attached". Deliberately not a filter bar
	 * — three pills on a page section, not the six-control apparatus the index
	 * needed. Applied to the live list only; the archived block is a record, not
	 * a shortlist, and filtering a graveyard is not a thing anyone wants.
	 */
	const [narrow, setNarrow] = useState<"" | "no-server" | "no-strings">("");
	const shown =
		narrow === "no-server"
			? oss.filter((a) => a.effort === "managed")
			: narrow === "no-strings"
				? oss.filter((a) => a.facts.openCore === "none")
				: oss;

	return (
		<div className="space-y-4">
			<section>
				<div className="mb-2 flex flex-wrap items-center gap-2">
					<h2 className="eyebrow">{t("alt.ossHeading")}</h2>
					{/* Only worth offering when there is enough to narrow. */}
					{oss.length > LEAD && (
						<div className="flex flex-wrap gap-1.5">
							{(
								[
									["", "alt.filterAll"],
									["no-server", "alt.filterNoServer"],
									["no-strings", "alt.filterNoStrings"],
								] as const
							).map(([value, key]) => (
								<button
									key={value || "all"}
									type="button"
									aria-pressed={narrow === value}
									onClick={() => setNarrow(value)}
									className="pill"
								>
									{t(key)}
								</button>
							))}
						</div>
					)}
				</div>
				{/* The three narrowing pills are `aria-pressed`; this is what says
				    what happened to the list under them. */}
				<p className="sr-only" aria-live="polite" aria-atomic="true">
					{t("a11y.results").replace("{n}", String(shown.length))}
				</p>
				<ul className={`${GRID_1COL} gap-2 sm:grid-cols-2`}>
					{shown.slice(0, LEAD).map((a) => (
						<AlternativeCard
							key={a.name}
							alt={a}
							t={t}
							tc={tc}
							lang={lang}
							projectHref={projectHref?.(a)}
						/>
					))}
				</ul>
				{/*
				 * The rest, behind one control.
				 *
				 * Claude Code cites 36 of these and they arrived as one flat wall of
				 * identical cards, so the three worth trying looked exactly like the
				 * thirty-third. `byExitQuality` decides which three lead.
				 *
				 * A native <details>, not conditional rendering: every card stays in
				 * the served HTML. This page's own title is "36 open source Claude
				 * Code alternatives" and the site's traffic is organic landings — a
				 * title promising 36 over a document containing 3 is the kind of thing
				 * that gets a catalogue demoted rather than ranked.
				 */}
				{shown.length > LEAD && (
					<details className="group mt-2">
						<summary className="inline-flex cursor-pointer items-center gap-1.5 rounded-[calc(var(--radius))] border border-border px-3 py-1.5 text-sm transition marker:content-none hover:border-brand">
							{t("alt.showAll").replace("{n}", String(shown.length))}
							<span className="inline-block transition-transform group-open:rotate-90">
								›
							</span>
						</summary>
						{/* Three across once there is room. The lead cards stay at two so
						    they read as recommendations; this list is 27 rows deep on the
						    biggest products and benefits from the extra column. */}
						{/*
						 * Grouped by what leaving actually costs, rather than one flat run of
						 * 27 cards. The three headings are the three answers to "what do I
						 * have to do" — install it, run one container, or operate a server —
						 * which is the question a reader is holding while they scroll.
						 */}
						{EFFORTS.map((effort) => {
							const inRung = shown
								.slice(LEAD)
								.filter((a) => a.effort === effort);
							if (inRung.length === 0) return null;
							return (
								<div key={effort} className="mt-3">
									<h3 className="eyebrow mb-1.5">
										{t(`effort.${effort}` as Key)}
										<span className="nums ml-1.5">{inRung.length}</span>
									</h3>
									<ul
										className={`${GRID_1COL} gap-2 sm:grid-cols-2 xl:grid-cols-3`}
									>
										{inRung.map((a) => (
											<AlternativeCard
												key={a.name}
												alt={a}
												t={t}
												tc={tc}
												lang={lang}
												projectHref={projectHref?.(a)}
											/>
										))}
									</ul>
								</div>
							);
						})}
					</details>
				)}
			</section>
			{dead.length > 0 && (
				// A <details> rather than conditional rendering: the entries stay in
				// the served HTML, so the page's own "36 alternatives" title still
				// matches what a crawler can count.
				<details className="group">
					<summary className="cursor-pointer font-mono text-[10px] text-muted uppercase tracking-[0.16em] marker:content-none">
						{t("alt.archivedHeading").replace("{n}", String(dead.length))}
						<span className="ml-1 inline-block transition-transform group-open:rotate-90">
							›
						</span>
					</summary>
					<p className="mt-1.5 mb-2 text-muted text-xs">
						{t("alt.archivedBlurb")}
					</p>
					<ul className={`${GRID_1COL} gap-2 opacity-70 sm:grid-cols-2`}>
						{dead.map((a) => (
							<AlternativeCard
								key={a.name}
								alt={a}
								t={t}
								tc={tc}
								lang={lang}
								projectHref={projectHref?.(a)}
							/>
						))}
					</ul>
				</details>
			)}
			{cheaper.length > 0 && (
				<section>
					<h2 className="eyebrow mb-2">{t("alt.cheaperHeading")}</h2>
					<ul className={`${GRID_1COL} gap-2 sm:grid-cols-2`}>
						{cheaper.map((a) => (
							<AlternativeCard key={a.name} alt={a} t={t} tc={tc} lang={lang} />
						))}
					</ul>
				</section>
			)}
		</div>
	);
}

export function WhatYouLose({
	product,
	t,
	tc,
}: {
	product: Product;
	t: T;
	tc: (v: { en: string }) => string;
}) {
	if (product.whatYouLose.length === 0) return null;
	return (
		<div>
			<h2 className="eyebrow mb-1.5">{t("row.whatYouLose")}</h2>
			<ul className="flex flex-wrap gap-1.5">
				{product.whatYouLose.map((b) => (
					<li
						key={b.en}
						className="rounded-[calc(var(--radius))] border border-border px-2 py-0.5 text-xs text-muted"
					>
						{tc(b)}
					</li>
				))}
			</ul>
		</div>
	);
}

// Wall cell: logo + name only, no border of its own (the grid draws one shared hairline via gap-px). min-w-0/truncate keep a long sponsor name from widening the column and reflowing the wall.
const WALL_CELL =
	"group relative flex min-h-[68px] items-center justify-center gap-2.5 bg-surface px-3 py-4 text-center transition";

function HeroCard({
	slot,
	t,
	tc,
	lang,
	house = false,
}: {
	slot: Slot;
	t: T;
	tc: (v: { en: string }) => string;
	lang: Lang;
	/** True only for the one cell that carries the house ad. */
	house?: boolean;
}) {
	const preview = useAdPreview();
	const draftForThisSlot =
		preview.draft && preview.ids.has(slot.id) ? preview.draft : null;

	if (draftForThisSlot) {
		return (
			<div
				data-ad-slot={slot.id}
				className={`${WALL_CELL} animate-[pulse_2.5s_ease-in-out_infinite]`}
			>
				<Logo
					src={draftForThisSlot.logoUrl || null}
					name={draftForThisSlot.name || "?"}
					size={26}
				/>
				<span className="min-w-0 truncate font-semibold text-sm tracking-tight">
					{draftForThisSlot.name || t("creative.yourName")}
				</span>
				<span
					className="absolute right-2 bottom-1.5 font-mono text-[9px] uppercase tracking-[0.16em]"
					style={{ color: draftForThisSlot.tint || "var(--accent)" }}
				>
					{slot.id} · {t("ads.previewing")}
				</span>
			</div>
		);
	}

	const s = slot.sponsor;
	if (s) {
		return (
			<a
				href={sponsorClickUrl(s.purchaseId, slot.id)}
				data-ad-slot={slot.id}
				data-ad-purchase={s.purchaseId}
				target="_blank"
				rel="sponsored noopener"
				aria-label={adLabel(t, tc(s.name), s.tagline ? tc(s.tagline) : null)}
				// Deliberately untinted: the wall is one uniform grid of logos, unlike the rails/in-list cards which carry a sponsor's colour.
				className={`${WALL_CELL} hover:bg-[color-mix(in_srgb,var(--brand)_7%,var(--color-surface))]`}
			>
				<Logo src={s.logoUrl} name={tc(s.name)} size={26} eager />
				<span className="min-w-0 truncate font-semibold text-sm tracking-tight">
					{tc(s.name)}
				</span>
				{/* Always visible, never hover-only: this is a paid disclosure, not decoration. */}
				<AdBadge
					t={t}
					className="pointer-events-none absolute right-2 bottom-1.5 opacity-60"
				/>
			</a>
		);
	}

	if (house) {
		return (
			<a
				href={HOUSE.url}
				target="_blank"
				rel="noopener"
				data-ad-slot={slot.id}
				aria-label={`${HOUSE.name} — ${t("ads.houseLabel")}`}
				className={`${WALL_CELL} hover:bg-[color-mix(in_srgb,var(--brand)_9%,var(--color-surface))]`}
			>
				<Logo src={HOUSE.logoUrl} name={HOUSE.name} size={26} />
				<span className="min-w-0 truncate font-semibold text-sm tracking-tight">
					{HOUSE.name}
				</span>
			</a>
		);
	}

	return (
		<a
			href={paths.sponsor(lang, slot.id)}
			data-ad-slot={slot.id}
			className={`${WALL_CELL} hover:bg-[color-mix(in_srgb,var(--accent)_8%,var(--color-surface))]`}
		>
			<span className="sr-only">{tc(slot.label)}</span>
			<span
				aria-hidden
				className="grid size-[26px] shrink-0 place-items-center rounded-[6px] border border-dashed"
				style={{
					borderColor: "color-mix(in srgb, var(--accent) 50%, transparent)",
					color: "var(--accent)",
				}}
			>
				<Plus className="size-3" />
			</span>
			<span className="min-w-0 truncate text-muted text-sm">
				<span className="font-mono text-[10px] uppercase tracking-wider">
					{slot.id}
				</span>{" "}
				{t("ads.yourLogoHere")}
			</span>
		</a>
	);
}

export function SponsorSlot({
	slot,
	t,
	tc,
	lang,
	compact,
	house,
}: {
	slot: Slot;
	t: T;
	tc: (v: { en: string }) => string;
	lang: Lang;
	/** The hero grid: ten cells five across, so its own layout. */
	compact?: boolean;
	/** True only for the one cell that carries the house ad. */
	house?: boolean;
}) {
	if (compact)
		return <HeroCard slot={slot} t={t} tc={tc} lang={lang} house={house} />;

	if (slot.sponsor) {
		const s = slot.sponsor;
		return (
			<a
				href={sponsorClickUrl(s.purchaseId, slot.id)}
				data-ad-slot={slot.id}
				data-ad-purchase={s.purchaseId}
				target="_blank"
				rel="sponsored noopener"
				className="flex items-center gap-3 rounded-[calc(var(--radius))] border border-dashed bg-surface p-3.5 transition hover:border-solid"
				style={{ borderColor: "var(--accent)" }}
			>
				<Logo src={s.logoUrl} name={tc(s.name)} size={34} />
				<span className="min-w-0 flex-1">
					<span className="block font-medium">{tc(s.name)}</span>
					{s.tagline && (
						<span className="block truncate text-sm text-muted">
							{tc(s.tagline)}
						</span>
					)}
				</span>
				<span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.16em] text-muted">
					{t("ads.sponsored")}
				</span>
			</a>
		);
	}

	return (
		<a
			href={paths.sponsor(lang, slot.id)}
			data-ad-slot={slot.id}
			className="flex items-center justify-between gap-3 rounded-[calc(var(--radius))] border border-dashed border-border bg-surface p-3.5 text-sm text-muted transition hover:text-text"
			style={{
				borderColor: "color-mix(in srgb, var(--accent) 45%, transparent)",
			}}
		>
			<span className="min-w-0 truncate">
				{tc(slot.label)} — {t("ads.yourProductHere")}
			</span>
			<span className="shrink-0" style={{ color: "var(--accent)" }}>
				→
			</span>
		</a>
	);
}

/**
 * What the escape from this product actually looks like, in four numbers.
 *
 * Every figure is derived from fields populated on 100% of alternatives
 * (`effort`, `openCore`, `licence`) or from the archived flag, so this block
 * never renders a blank — unlike anything built on the feature data, which is
 * answered for about a third of cited projects. A stat that cannot be computed
 * is dropped rather than shown as zero: "0 with no strings" reads as a finding
 * when it means nobody checked.
 */
export function ProductEscapeStats({ product, t }: { product: Product; t: T }) {
	const oss = product.alternatives.filter(
		(a): a is Extract<Alternative, { kind: "oss" }> => a.kind === "oss",
	);
	if (oss.length === 0) return null;

	const live = oss.filter((a) => !isArchived(a, healthOf(a.source)));
	if (live.length === 0) return null;

	const easiest = byExitQuality(live, (a) => healthOf(a.source))[0];
	const noStrings = live.filter((a) => a.facts.openCore === "none").length;
	const noServer = live.filter((a) => a.effort === "managed").length;

	const cells: { value: string; label: string }[] = [
		{ value: String(live.length), label: t("escape.live") },
		{ value: easiest.name, label: t("escape.easiest") },
		{ value: String(noServer), label: t("escape.noServer") },
		{ value: String(noStrings), label: t("escape.noStrings") },
	];

	return (
		<dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[calc(var(--radius))] border border-border bg-border sm:grid-cols-4">
			{cells.map((c) => (
				/* dt before dd, which is what the content model requires; the value
				   still reads above the label because the column is reversed. */
				<div key={c.label} className="flex flex-col-reverse bg-surface p-3">
					<dt className="mt-0.5 font-mono text-[10px] text-muted uppercase tracking-wider">
						{c.label}
					</dt>
					<dd className="nums truncate font-display font-semibold text-base">
						{c.value}
					</dd>
				</div>
			))}
		</dl>
	);
}

/**
 * The alternatives compared on the axes that are actually populated.
 *
 * The feature matrix answers "does it do SAML", which is a good question for
 * Notion and a category error for a terminal coding agent — and it is answered
 * for about a third of cited projects, so for the rest it prints dashes.
 *
 * These five columns come from fields present on 100% of entries (licence,
 * effort, open-core) plus two backfilled onto every entry that has a reading
 * (language, compose). No cell is ever blank for lack of a survey, and unlike
 * the badge row these genuinely differ between rows — which is the whole test
 * of whether a comparison is worth printing.
 */
export function SpecStrip({
	alternatives,
	t,
}: {
	alternatives: Alternative[];
	t: T;
}) {
	const oss = alternatives.filter(
		(a): a is Extract<Alternative, { kind: "oss" }> => a.kind === "oss",
	);
	const live = oss.filter((a) => !isArchived(a, healthOf(a.source)));
	// Below three rows there is nothing to compare; the cards already say it all.
	if (live.length < 3) return null;
	const rows = byExitQuality(live, (a) => healthOf(a.source)).slice(0, 8);

	return (
		<section>
			<h2 className="eyebrow mb-2">{t("spec.heading")}</h2>
			<div className="overflow-x-auto">
				<table className="w-full min-w-[34rem] border-collapse text-sm">
					{/* Google's table extraction keys on caption + th. sr-only, because
					    the heading above already says this to a reader. */}
					<caption className="sr-only">
						{t("spec.heading")} — {rows.map((a) => a.name).join(", ")}
					</caption>
					<thead>
						<tr className="border-b text-left text-muted">
							<th scope="col" className="py-2 pr-3 font-normal">
								{t("spec.project")}
							</th>
							<th scope="col" className="px-2 py-2 font-normal">
								{t("spec.licence")}
							</th>
							<th scope="col" className="px-2 py-2 font-normal">
								{t("spec.runIt")}
							</th>
							<th scope="col" className="px-2 py-2 font-normal">
								{t("spec.language")}
							</th>
							<th scope="col" className="px-2 py-2 font-normal">
								{t("spec.strings")}
							</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((a) => (
							<tr key={a.name} className="border-b last:border-0">
								<th scope="row" className="py-1.5 pr-3 text-left font-medium">
									{a.name}
								</th>
								<td className="px-2 py-1.5 text-muted">{a.license}</td>
								<td className="px-2 py-1.5 text-muted">
									{t(`effort.${a.effort}` as Key)}
								</td>
								{/* An em dash, never a blank: no reading is a different
								    statement from "no language", and the features page's own
								    rule is that absence is never rendered as a fact. */}
								<td className="px-2 py-1.5 text-muted">{a.language ?? "—"}</td>
								<td className="px-2 py-1.5 text-muted">
									{a.facts.openCore === "none"
										? t("spec.noStrings")
										: t(`facts.openCore.${a.facts.openCore}` as Key)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</section>
	);
}

/**
 * The verdict as one sentence that survives being quoted on its own.
 *
 * The brand brief names this as a gap: the answer should be the FIRST thing on
 * the page and phrased so a model or a person can lift it whole. Today the page
 * opens with `why`, which is good prose but assumes its context — Claude Code's
 * begins "The terminal-agent space caught up in about a year…", which quoted
 * alone says nothing about Claude Code.
 *
 * Composed from fields the catalogue already holds rather than authored 527
 * times: the verdict, the best exit and its licence, and the first thing you
 * give up. Nothing here is a new claim — it is the same three facts the page
 * makes underneath, arranged so the first line answers the question in the
 * title.
 */
export function VerdictSentence({
	product,
	t,
	tc,
}: {
	product: Product;
	t: T;
	tc: (v: { en: string }) => string;
}) {
	const live = product.alternatives
		.filter((a): a is Extract<Alternative, { kind: "oss" }> => a.kind === "oss")
		.filter((a) => !isArchived(a, healthOf(a.source)));
	if (live.length === 0) return null;
	const best = byExitQuality(live, (a) => healthOf(a.source))[0];
	const lose = product.whatYouLose[0];

	// Three verdicts, three shapes. "not-yet" deliberately does not name a
	// project: the whole claim is that nothing credible exists, and naming one
	// anyway would contradict the sentence in the same breath.
	const sentence =
		product.verdict === "not-yet"
			? t("lede.notYet").replace("{product}", product.name)
			: t(product.verdict === "yes" ? "lede.yes" : "lede.almost")
					.replace("{product}", product.name)
					.replace("{best}", best.name)
					.replace("{licence}", best.license);

	return (
		<p className="text-pretty font-medium text-lg leading-relaxed">
			{sentence}
			{/* Only for "almost". On "yes" there is nothing to give up, and on
			    "not-yet" the clause contradicts the sentence it is attached to —
			    you cannot be giving something up in a switch we just said you
			    cannot make. */}
			{lose && product.verdict === "almost" && (
				<span className="text-muted">
					{" "}
					{t("lede.butLose").replace("{lose}", tc(lose).toLowerCase())}
				</span>
			)}
		</p>
	);
}

/**
 * Default tool → what replaces it, as a table.
 *
 * For a category of things that ship with the system — the Unix defaults, the
 * toolchain commands — cards are the wrong shape. The reader is not choosing
 * between twelve products; they are scanning a mapping they already half know,
 * looking for the two rows they did not. "cd → zoxide" is one line, and one line
 * is what it should take.
 *
 * Only rendered where the category is mostly defaults (priced at 0 with no
 * vendor), so a category of paid SaaS never gets it.
 */
export function DefaultsTable({
	products,
	t,
	tc,
	lang,
}: {
	products: Product[];
	t: T;
	tc: (v: { en: string }) => string;
	lang: Lang;
}) {
	const defaults = products.filter(
		(p) => p.priceMonthly === 0 && p.domain === null,
	);
	// Below five rows a table is just a list with extra furniture.
	if (defaults.length < 5) return null;

	const rows = defaults
		.map((p) => {
			const live = p.alternatives
				.filter(
					(a): a is Extract<Alternative, { kind: "oss" }> => a.kind === "oss",
				)
				.filter((a) => !isArchived(a, healthOf(a.source)));
			const best = byExitQuality(live, (a) => healthOf(a.source))[0];
			return { p, best, lose: p.whatYouLose[0] };
		})
		// A default with nothing verified to replace it has no row to fill.
		.filter((r) => r.best !== undefined);
	if (rows.length < 5) return null;

	return (
		<section className="mt-10">
			<h2 className="font-display font-semibold text-lg">
				{t("defaults.heading")}
			</h2>
			<p className="mt-1 max-w-2xl text-muted text-sm">{t("defaults.blurb")}</p>
			<div className="mt-3 overflow-x-auto">
				<table className="w-full min-w-[36rem] border-collapse text-sm">
					<caption className="sr-only">{t("defaults.heading")}</caption>
					<thead>
						<tr className="border-b text-left text-muted">
							<th scope="col" className="py-2 pr-3 font-normal">
								{t("defaults.tool")}
							</th>
							<th scope="col" className="px-2 py-2 font-normal">
								{t("defaults.replacement")}
							</th>
							<th scope="col" className="px-2 py-2 font-normal">
								{t("defaults.costs")}
							</th>
						</tr>
					</thead>
					<tbody>
						{rows.map(({ p, best, lose }) => (
							<tr key={p.slug} className="border-b last:border-0">
								<th scope="row" className="py-1.5 pr-3 text-left font-normal">
									<Link
										href={paths.product(lang, p.slug)}
										className="font-medium hover:underline"
									>
										{p.name}
									</Link>
								</th>
								<td className="px-2 py-1.5">
									{best?.name}
									<span className="ml-1.5 text-muted text-xs">
										{best?.license}
									</span>
								</td>
								{/* What it costs you, not what it gains you — the gain is why
								    the row exists, the cost is what the reader has not
								    thought about. */}
								<td className="px-2 py-1.5 text-muted">
									{lose ? tc(lose) : "—"}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</section>
	);
}
