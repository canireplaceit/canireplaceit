import type {
	Alternative,
	Facts,
	PriceSource,
	Product,
	Source,
	Verdict,
} from "core/src/content";
import { byExitQuality, isArchived, priceState } from "core/src/content";
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

export function VerdictMark({ verdict, t }: { verdict: Verdict; t: T }) {
	const color = VERDICT_COLOR[verdict];
	const isReplaceable = verdict === "yes";
	return (
		<span className="inline-flex shrink-0 items-center gap-2">
			<span
				className={`size-2 rounded-full ${isReplaceable ? "pulse-yes" : ""}`}
				style={{ background: color }}
			/>
			<span
				className="font-mono text-[10px] uppercase tracking-[0.12em]"
				style={{ color }}
			>
				{t(`verdict.${verdict}` as Key)}
			</span>
		</span>
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
	if (confidence === "high") return null;
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
			{t(isLowConfidence ? "price.confidence.low" : "price.confidence.medium")}
		</span>
	);
}

export function PriceReceipt({
	pricing,
	t,
	lang,
}: {
	pricing: PriceSource;
	t: T;
	lang: Lang;
}) {
	return (
		<span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
			<a
				href={outboundUrl(pricing.url, "price")}
				target="_blank"
				rel="noopener nofollow"
				className="inline-flex items-center gap-1 hover:underline"
			>
				{t("price.takenFrom")} {hostOf(pricing.url)} {t("price.on")}{" "}
				<FreshDate iso={pricing.checkedOn} lang={lang} />
				<ExternalLink className="size-3 shrink-0" aria-hidden />
			</a>
			<ConfidenceChip confidence={pricing.confidence} t={t} />
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
		<div className="space-y-1 text-sm">
			<p
				className="nums font-medium"
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
				{value}
			</p>
			{state === "no-price" && (
				<p className="text-xs text-muted">{t("price.noPublicNote")}</p>
			)}
			{pricing?.plan && <p className="text-xs text-muted">{pricing.plan}</p>}
			{pricing && <PriceReceipt pricing={pricing} t={t} lang={lang} />}
		</div>
	);
}

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
			<p className="mt-1.5 text-sm text-muted">{tc(alt.note)}</p>
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
							<FactTag mark={openCoreMark(alt.facts.openCore)} t={t} />
						)}
						<Tag>{t(`effort.${alt.effort}` as Key)}</Tag>
						<FactMarks facts={alt.facts} license={alt.license} t={t} />
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
export function FactTag({ mark, t }: { mark: FactMark; t: T }) {
	const { Icon, tone } = mark;
	return (
		<Tag warn={tone === "warn"} bad={tone === "bad"}>
			<span className="inline-flex items-center gap-1">
				<Icon className="size-3 shrink-0" aria-hidden />
				{t(mark.label as Key)}
			</span>
		</Tag>
	);
}

export function FactMarks({
	facts,
	license,
	t,
	vary = [],
	full,
}: {
	facts: Facts;
	license?: string;
	t: T;
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
					<FactTag key={m.label} mark={m} t={t} />
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
	return (
		<div className="space-y-4">
			<section>
				<h4 className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
					{t("alt.ossHeading")}
				</h4>
				<ul className={`${GRID_1COL} gap-2 sm:grid-cols-2`}>
					{oss.map((a) => (
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
					<h4 className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
						{t("alt.cheaperHeading")}
					</h4>
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
			<h4 className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
				{t("row.whatYouLose")}
			</h4>
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
				className="flex items-center gap-3 rounded-[calc(var(--radius))] border border-dashed p-3.5 transition hover:border-solid"
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
			className="flex items-center justify-between gap-3 rounded-[calc(var(--radius))] border border-dashed border-border p-3.5 text-sm text-muted transition hover:text-text"
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
