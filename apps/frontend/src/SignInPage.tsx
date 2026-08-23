/**
 * Sign in, by emailed link.
 *
 * An advertiser has exactly one credential we already know is theirs: the email
 * on the purchase. So there is no password field, no account creation, and
 * nothing to forget.
 *
 * ## The submitted state says the same thing whatever happened
 *
 * The API answers `{ ok: true }` whether or not the address belongs to a
 * customer — otherwise the endpoint is an oracle for "is this person an
 * advertiser here", and the customer list of an ad network is worth money to
 * the people who would ask. The UI has to hold that line: the confirmation
 * cannot say "check your inbox" in one case and "no such account" in the other,
 * so it says the honest thing that is true in both — *if that address has a
 * placement, a link is on its way*.
 *
 * That reads slightly awkward on purpose. Smoothing it into "we've sent you an
 * email" would be a small lie half the time.
 *
 * ## The callback lands here too
 *
 * `?ok=1` after a successful sign-in, `?error=link` when the token was expired,
 * already used, or never real — one message for all three, because telling them
 * apart tells a token sprayer which guesses were close.
 */

import { useEffect, useState } from "react";
import { api } from "./api";
import type { Key } from "./i18n";

type T = (k: Key) => string;

const field =
	"w-full rounded-[calc(var(--radius))] border border-border bg-bg px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--brand)_35%,transparent)]";

export function SignInPage({ t }: { t: T }) {
	const [email, setEmail] = useState("");
	const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(
		"idle",
	);
	const [signedInAs, setSignedInAs] = useState<string | null>(null);
	const [linkError, setLinkError] = useState(false);

	// The query is read after hydration rather than during render: the document is
	// prerendered and shared by every reader, so anything derived from `location`
	// must not differ between the server pass and the first client pass.
	useEffect(() => {
		const q = new URLSearchParams(location.search);
		setLinkError(q.get("error") === "link");
		if (q.get("ok") === "1") {
			// Ask the server who we are rather than trusting the query parameter —
			// `?ok=1` is something anyone can type.
			api
				.me()
				.then((r) => setSignedInAs(r.email))
				.catch(() => setLinkError(true));
		}
	}, []);

	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		// Trimmed here as well as on the server: the API validates `format: email`
		// before its own normalisation runs, so a pasted address with a trailing
		// space would be rejected outright.
		const value = email.trim();
		if (!value) return;
		setState("sending");
		try {
			await api.requestSignIn(value);
			setState("sent");
		} catch {
			setState("error");
		}
	};

	return (
		<main id="main" className="mx-auto max-w-md px-4 py-14">
			<p className="font-mono text-[10px] text-muted uppercase tracking-[0.2em]">
				{t("signin.eyebrow")}
			</p>
			<h1 className="mt-2 font-bold font-display text-2xl tracking-tight">
				{t("signin.title")}
			</h1>

			{signedInAs ? (
				<div
					className="mt-6 rounded-[calc(var(--radius))] border p-5 text-sm"
					style={{
						borderColor: "color-mix(in srgb, var(--brand) 45%, transparent)",
						background: "color-mix(in srgb, var(--brand) 7%, transparent)",
					}}
				>
					<p className="font-medium">{t("signin.doneTitle")}</p>
					<p className="mt-2 text-muted">
						{t("signin.doneBody").replace("{email}", signedInAs)}
					</p>
				</div>
			) : (
				<>
					<p className="mt-2 text-muted text-sm">{t("signin.blurb")}</p>

					{linkError && (
						<div
							className="mt-4 rounded-[calc(var(--radius))] border p-4 text-sm"
							style={{
								borderColor:
									"color-mix(in srgb, var(--accent) 50%, transparent)",
								background: "color-mix(in srgb, var(--accent) 8%, transparent)",
							}}
						>
							{t("signin.linkDead")}
						</div>
					)}

					{state === "sent" ? (
						<div
							className="mt-6 rounded-[calc(var(--radius))] border border-border p-5 text-sm"
							style={{
								background: "color-mix(in srgb, var(--brand) 6%, transparent)",
							}}
						>
							<p className="font-medium">{t("signin.sentTitle")}</p>
							<p className="mt-2 text-muted">{t("signin.sentBody")}</p>
							<button
								type="button"
								onClick={() => setState("idle")}
								className="mt-3 text-brand text-xs hover:underline"
							>
								{t("signin.tryAnother")}
							</button>
						</div>
					) : (
						<form onSubmit={submit} className="mt-6 grid gap-3">
							<label htmlFor="signin-email" className="sr-only">
								{t("signin.emailLabel")}
							</label>
							<input
								id="signin-email"
								name="email"
								type="email"
								required
								autoComplete="email"
								value={email}
								onChange={(e) => setEmail(e.currentTarget.value)}
								placeholder={t("signin.placeholder")}
								className={field}
							/>
							<button
								type="submit"
								disabled={state === "sending"}
								className="justify-self-start rounded-[calc(var(--radius))] px-4 py-2 font-medium text-sm disabled:opacity-60"
								style={{ background: "var(--brand)", color: "#fff" }}
							>
								{state === "sending" ? t("signin.sending") : t("signin.submit")}
							</button>
							{state === "error" && (
								<p className="text-sm" style={{ color: "var(--danger)" }}>
									{t("form.error")}
								</p>
							)}
						</form>
					)}

					<p className="mt-4 text-muted text-xs">{t("signin.note")}</p>
				</>
			)}
		</main>
	);
}
