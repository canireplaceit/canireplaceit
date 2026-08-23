import { useEffect, useRef, useState } from "react";
import { setAdPreview, tintStyle } from "./ads";
import { api } from "./api";
import { Logo } from "./components";
import type { Key } from "./i18n";

type T = (k: Key) => string;
type TC = (v: { en: string }) => string;

export type CreativeSlot = {
	id: string;
	placement: string;
	rail?: string | null;
	label: { en: string; fr?: string };
	category?: string | null;
};

export type { Draft };

type Draft = {
	name: string;
	tagline: string;
	nameFr: string;
	taglineFr: string;
	url: string;
	logoUrl: string;
	tint: string;
};

const EMPTY: Draft = {
	name: "",
	tagline: "",
	nameFr: "",
	taglineFr: "",
	url: "",
	logoUrl: "",
	tint: "",
};

const field =
	"w-full rounded-[calc(var(--radius))] border border-border bg-surface px-3 py-2.5 text-sm outline-none placeholder:text-muted focus:border-[color-mix(in_srgb,var(--accent)_60%,var(--color-border))]";

const label = "block font-medium text-xs text-muted mb-1.5";

/** Everything blank falls through to the shared creative — same rule as the API. */
const merge = (shared: Draft, over: Partial<Draft>): Draft => ({
	name: over.name || shared.name,
	tagline: over.tagline || shared.tagline,
	nameFr: over.nameFr || over.name || shared.nameFr || shared.name,
	taglineFr:
		over.taglineFr || over.tagline || shared.taglineFr || shared.tagline,
	url: over.url || shared.url,
	logoUrl: over.logoUrl || shared.logoUrl,
	tint: over.tint || shared.tint,
});

const accent = (d: Draft) => d.tint || "var(--accent)";

/** Same tint helper the live ad units use, so previews match exactly. */
const cardStyle = (d: Draft) => tintStyle(d.tint || null);

// ── The three previews ───────────────────────────────────────────────────────

/** Left/right panel. The only placement with room for a tagline. */
function RailPreview({ d, t }: { d: Draft; t: T }) {
	return (
		<div className="w-[232px]">
			<div
				className="flex flex-col rounded-[calc(var(--radius))] border p-3.5"
				style={cardStyle(d)}
			>
				<span className="flex items-center gap-2.5">
					<Logo src={d.logoUrl || null} name={d.name || "?"} size={40} />
					<span className="min-w-0 flex-1 truncate font-semibold text-[15px] tracking-tight">
						{d.name || t("creative.yourName")}
					</span>
				</span>
				<span className="mt-2.5 block text-[13px] text-muted leading-snug">
					{d.tagline || t("creative.yourTagline")}
				</span>
				<span className="mt-2.5 inline-flex items-center gap-1.5 font-mono text-[9px] text-muted uppercase tracking-[0.16em]">
					<span
						className="size-1 rounded-full"
						style={{ background: accent(d) }}
					/>
					{t("ads.sponsored")}
				</span>
			</div>
		</div>
	);
}

/** The landing wall cell. Logo and name only — no tagline is rendered here. */
function WallPreview({ d, t }: { d: Draft; t: T }) {
	return (
		<div className="w-[220px] overflow-hidden rounded-[calc(var(--radius))] border border-border">
			{/* No tint — the wall is a uniform logo grid (see HeroCard). */}
			<div className="relative flex min-h-[68px] items-center justify-center gap-2.5 bg-surface px-3 py-4">
				<Logo src={d.logoUrl || null} name={d.name || "?"} size={26} />
				<span className="min-w-0 truncate font-semibold text-sm tracking-tight">
					{d.name || t("creative.yourName")}
				</span>
				<span className="absolute right-2 bottom-1.5 inline-flex items-center gap-1 font-mono text-[9px] text-muted uppercase tracking-[0.16em] opacity-60">
					<span
						className="size-1 rounded-full"
						style={{ background: "var(--accent)" }}
					/>
					{t("ads.sponsored")}
				</span>
			</div>
		</div>
	);
}

/** Shared by `category` and `inline` placements — same as InListSponsor renders both. */
function InListPreview({ d, t }: { d: Draft; t: T }) {
	return (
		<div
			className="flex w-full max-w-[420px] items-start gap-3 rounded-[calc(var(--radius))] border border-dashed p-3.5"
			style={{ ...cardStyle(d), borderStyle: "solid" }}
		>
			<Logo src={d.logoUrl || null} name={d.name || "?"} size={34} />
			<span className="min-w-0 flex-1">
				<span className="block truncate font-display font-semibold">
					{d.name || t("creative.yourName")}
				</span>
				<span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted text-xs">
					<span
						className="shrink-0 rounded-[calc(var(--radius))] border px-1.5 py-px font-mono text-[9px] uppercase leading-relaxed tracking-[0.14em]"
						style={{ borderColor: accent(d), color: accent(d) }}
					>
						{t("ads.sponsored")}
					</span>
					<span className="min-w-0 truncate">
						{d.tagline || t("creative.yourTagline")}
					</span>
				</span>
			</span>
		</div>
	);
}

/** Renders every shape one slot appears in (e.g. a rail slot also rides the phone marquee). */
export function SlotPreviews({
	slot,
	d = EMPTY,
	t,
	tc,
}: {
	slot: CreativeSlot;
	d?: Draft;
	t: T;
	tc: TC;
}) {
	const where =
		slot.placement === "rail"
			? t("creative.whereRail")
			: slot.placement === "hero"
				? t("creative.whereHero")
				: t("creative.whereCategory");

	return (
		<div className="rounded-[calc(var(--radius))] border border-border bg-bg p-4">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<span className="font-mono text-[10px] text-muted uppercase tracking-[0.16em]">
					{slot.id}
				</span>
				<span className="text-muted text-xs">{tc(slot.label)}</span>
			</div>
			<p className="mt-1.5 text-muted text-xs">{where}</p>

			<div className="mt-3 flex flex-wrap items-start gap-4">
				{slot.placement === "rail" && <RailPreview d={d} t={t} />}
				{slot.placement === "hero" && <WallPreview d={d} t={t} />}
				{slot.placement === "category" && <InListPreview d={d} t={t} />}
			</div>

			{slot.placement === "rail" && (
				<p className="mt-2.5 text-muted text-xs">{t("creative.railNote")}</p>
			)}
			{slot.placement === "hero" && (
				<p className="mt-2.5 text-muted text-xs">{t("creative.heroNote")}</p>
			)}
		</div>
	);
}

// ── The form ─────────────────────────────────────────────────────────────────

export function CreativeForm({
	token,
	slots,
	t,
	tc,
	onDone,
	onCollect,
	submitLabel,
	children,
}: {
	/** Absent in purchase mode — there is no token until money has moved. */
	token?: string;
	slots: CreativeSlot[];
	t: T;
	tc: TC;
	onDone?: () => void;
	/** Purchase mode: hands the draft to the caller instead of POSTing it (no order exists to POST to yet). Absent means submit straight to `/api/sponsor/details`. */
	onCollect?: (
		draft: Draft & { perSlot: (Partial<Draft> & { slotId: string })[] },
	) => void;
	submitLabel?: string;
	children?: React.ReactNode;
}) {
	const [shared, setShared] = useState<Draft>(EMPTY);
	const [overrides, setOverrides] = useState<Record<string, Partial<Draft>>>(
		{},
	);
	const [openSlot, setOpenSlot] = useState<string | null>(null);
	const [state, setState] = useState<"idle" | "sending" | "error">("idle");
	const [error, setError] = useState("");
	const [uploading, setUploading] = useState(false);
	const fileRef = useRef<HTMLInputElement>(null);

	const set = (k: keyof Draft) => (v: string) =>
		setShared((p) => ({ ...p, [k]: v }));

	/** Live-updates the real ad units on the page while typing, purchase mode only. */
	// biome-ignore lint/correctness/useExhaustiveDependencies: slots is stable per order
	useEffect(() => {
		if (!onCollect) return;
		setAdPreview(
			new Set(slots.map((s) => s.id)),
			shared.name || shared.tagline || shared.logoUrl || shared.tint
				? {
						name: shared.name,
						tagline: shared.tagline,
						logoUrl: shared.logoUrl,
						tint: shared.tint,
					}
				: null,
		);
	}, [shared, onCollect]);

	useEffect(() => () => setAdPreview(new Set(), null), []);

	const upload = async (file: File) => {
		setUploading(true);
		setError("");
		try {
			const body = new FormData();
			// Omitted in purchase mode: the order doesn't exist yet, so the endpoint accepts an anonymous upload instead.
			if (token) body.append("token", token);
			body.append("file", file);
			const out = await api.uploadLogo(body);
			setShared((p) => ({ ...p, logoUrl: out.url }));
		} catch (e) {
			// The API answers a code, not prose, so the message is translated here.
			const code = /too-large|unsupported-type|empty/.exec(String(e))?.[0];
			setError(
				t(
					code === "too-large"
						? "creative.errTooLarge"
						: code === "unsupported-type"
							? "creative.errType"
							: "creative.errUpload",
				),
			);
		} finally {
			setUploading(false);
		}
	};

	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		const perSlot = Object.entries(overrides)
			.filter(([, o]) => Object.values(o).some(Boolean))
			.map(([slotId, o]) => ({ slotId, ...o }));

		if (onCollect) {
			onCollect({ ...shared, perSlot });
			return;
		}

		setState("sending");
		setError("");
		try {
			await api.details({
				token,
				name: shared.name,
				tagline: shared.tagline,
				url: shared.url,
				...(shared.nameFr ? { nameFr: shared.nameFr } : {}),
				...(shared.taglineFr ? { taglineFr: shared.taglineFr } : {}),
				...(shared.logoUrl ? { logoUrl: shared.logoUrl } : {}),
				...(shared.tint ? { tint: shared.tint } : {}),
				perSlot,
			});
			onDone?.();
		} catch {
			setState("error");
			setError(t("form.error"));
		}
	};

	return (
		<form onSubmit={submit} className="mt-6 grid gap-8 lg:grid-cols-2">
			{/* ── Fields ──────────────────────────────────────────────── */}
			<div className="grid content-start gap-4">
				{/* A real <label> wrapping the control, not a <span> beside it: nine
				    inputs on this form had no label at all, so a screen reader read
				    nine unnamed edit fields. Wrapping keeps the markup identical to
				    look at. */}
				<label className="block">
					<span className={label}>{t("creative.name")}</span>
					<input
						required
						aria-required="true"
						autoComplete="organization"
						maxLength={60}
						value={shared.name}
						onChange={(e) => set("name")(e.currentTarget.value)}
						placeholder={t("creative.namePh")}
						className={field}
					/>
				</label>

				<div>
					<label className="block">
						<span className={label}>{t("creative.tagline")}</span>
						<input
							required
							aria-required="true"
							maxLength={120}
							value={shared.tagline}
							onChange={(e) => set("tagline")(e.currentTarget.value)}
							placeholder={t("creative.taglinePh")}
							className={field}
						/>
					</label>
					<p className="mt-1 text-muted text-xs">{t("creative.taglineNote")}</p>
				</div>

				{/* Blank falls back to the English copy above, same as the API does with a missing field. */}
				<details className="rounded-[calc(var(--radius))] border border-border p-3">
					<summary className="cursor-pointer font-medium text-sm">
						{t("creative.frenchToggle")}
					</summary>
					<p className="mt-2 text-muted text-xs">{t("creative.frenchNote")}</p>
					<div className="mt-3 grid gap-3">
						<label className="block">
							<span className="sr-only">{t("creative.nameFrPh")}</span>
							<input
								maxLength={60}
								value={shared.nameFr}
								onChange={(e) => set("nameFr")(e.currentTarget.value)}
								placeholder={t("creative.nameFrPh")}
								className={field}
							/>
						</label>
						<label className="block">
							<span className="sr-only">{t("creative.taglineFrPh")}</span>
							<input
								maxLength={120}
								value={shared.taglineFr}
								onChange={(e) => set("taglineFr")(e.currentTarget.value)}
								placeholder={t("creative.taglineFrPh")}
								className={field}
							/>
						</label>
					</div>
				</details>

				<label className="block">
					<span className={label}>{t("creative.url")}</span>
					<input
						required
						aria-required="true"
						autoComplete="url"
						type="url"
						maxLength={500}
						value={shared.url}
						onChange={(e) => set("url")(e.currentTarget.value)}
						placeholder="https://example.com"
						className={field}
					/>
				</label>

				<div>
					<p className={label}>{t("creative.icon")}</p>
					<div className="flex flex-wrap items-center gap-2">
						<button
							type="button"
							onClick={() => fileRef.current?.click()}
							disabled={uploading}
							className="rounded-[calc(var(--radius))] border border-border px-3 py-2 text-sm disabled:opacity-60"
						>
							{uploading ? t("creative.uploading") : t("creative.upload")}
						</button>
						{shared.logoUrl && (
							<>
								<Logo
									src={shared.logoUrl}
									name={shared.name || "?"}
									size={32}
								/>
								<button
									type="button"
									onClick={() => setShared((p) => ({ ...p, logoUrl: "" }))}
									className="text-muted text-xs hover:underline"
								>
									{t("creative.removeIcon")}
								</button>
							</>
						)}
					</div>
					{/* display:none, so it is out of the accessibility tree and the
					    visible button above is the control — named anyway, because an
					    unnamed file input is one CSS change away from being a real
					    failure. */}
					<input
						ref={fileRef}
						type="file"
						aria-label={t("creative.upload")}
						accept="image/png,image/jpeg,image/webp"
						className="hidden"
						onChange={(e) => {
							const f = e.currentTarget.files?.[0];
							if (f) void upload(f);
							e.currentTarget.value = "";
						}}
					/>
					<p className="mt-1 text-muted text-xs">{t("creative.iconNote")}</p>
					<label className="block">
						<span className="sr-only">{t("creative.iconUrlPh")}</span>
						<input
							maxLength={500}
							value={shared.logoUrl}
							onChange={(e) => set("logoUrl")(e.currentTarget.value)}
							placeholder={t("creative.iconUrlPh")}
							className={`${field} mt-2`}
						/>
					</label>
				</div>

				<div>
					<p className={label}>{t("creative.tint")}</p>
					<div className="flex items-center gap-2">
						<input
							type="color"
							value={shared.tint || "#3ecf72"}
							onChange={(e) => set("tint")(e.currentTarget.value)}
							className="h-9 w-14 cursor-pointer rounded-[calc(var(--radius))] border border-border bg-surface"
							aria-label={t("creative.tint")}
						/>
						{shared.tint && (
							<button
								type="button"
								onClick={() => set("tint")("")}
								className="text-muted text-xs hover:underline"
							>
								{t("creative.tintReset")}
							</button>
						)}
					</div>
					<p className="mt-1 text-muted text-xs">{t("creative.tintNote")}</p>
				</div>

				{/* An upload or submit failure was announced to nobody. */}
				{error && (
					<p role="alert" className="text-sm" style={{ color: "var(--v-no)" }}>
						{error}
					</p>
				)}

				{children}

				<button
					type="submit"
					disabled={state === "sending"}
					className="justify-self-start rounded-[calc(var(--radius))] px-5 py-2.5 font-semibold text-sm disabled:opacity-40"
					style={{ background: "var(--accent)", color: "var(--bg)" }}
				>
					{state === "sending"
						? t("creative.sending")
						: (submitLabel ?? t("ads.submitCreative"))}
				</button>
				<p className="text-muted text-xs">
					{onCollect ? t("creative.liveNote") : t("creative.reviewNote")}
				</p>
			</div>

			{/* ── Previews ────────────────────────────────────────────── */}
			<div className="grid content-start gap-3">
				<p className="font-mono text-[10px] text-muted uppercase tracking-[0.2em]">
					{t("creative.previewTitle")}
				</p>
				<p className="text-muted text-xs">{t("creative.previewNote")}</p>

				{slots.map((s) => {
					const d = merge(shared, overrides[s.id] ?? {});
					const open = openSlot === s.id;
					return (
						<div key={s.id} className="grid gap-2">
							<SlotPreviews slot={s} d={d} t={t} tc={tc} />
							<button
								type="button"
								onClick={() => setOpenSlot(open ? null : s.id)}
								className="justify-self-start text-brand text-xs hover:underline"
							>
								{open ? t("creative.hideOverride") : t("creative.override")}
							</button>
							{open && (
								<div className="grid gap-2 rounded-[calc(var(--radius))] border border-border border-dashed p-3">
									<p className="text-muted text-xs">
										{t("creative.overrideNote")}
									</p>
									{(["name", "tagline", "url", "logoUrl"] as const).map((k) => (
										<label key={k} className="block">
											<span className="sr-only">
												{t(`creative.${k}` as Key)}
											</span>
											<input
												value={overrides[s.id]?.[k] ?? ""}
												onChange={(e) =>
													setOverrides((p) => ({
														...p,
														[s.id]: { ...p[s.id], [k]: e.target.value },
													}))
												}
												placeholder={t(`creative.${k}` as Key)}
												className={field}
											/>
										</label>
									))}
								</div>
							)}
						</div>
					);
				})}
			</div>
		</form>
	);
}
