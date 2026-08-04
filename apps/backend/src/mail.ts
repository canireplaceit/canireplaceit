// send() never throws — it returns a boolean, since every caller here fires
// mail after a state change (row written, token minted) that must not be
// rolled back by a mail outage.

import { createTransport, type Transporter } from "nodemailer";
import { env } from "./env";
import { log } from "./log";

export type MailMessage = {
	to: string;
	subject: string;
	html: string;
	/** Required: an HTML-only link is invisible in a text-only client and scores as spam. */
	text: string;
};

export type Mailer = {
	readonly id: string;
	send(m: MailMessage): Promise<boolean>;
};

class ConsoleMailer implements Mailer {
	readonly id = "console";
	async send(m: MailMessage): Promise<boolean> {
		// Deliberately raw stdout, not the pino logger: this is the dev delivery mechanism for a sign-in link when no SMTP is configured, so the body — including the token — has to be readable here.
		console.log(
			`\n──── mail (not sent — no SMTP configured) ────\n` +
				`to:      ${m.to}\nsubject: ${m.subject}\n\n${m.text}\n` +
				`─────────────────────────────────────────────\n`,
		);
		return true;
	}
}

class SmtpMailer implements Mailer {
	readonly id = "smtp";
	private readonly tx: Transporter;
	private readonly from: string;

	constructor(cfg: NonNullable<typeof env.smtp>) {
		this.from = cfg.from;
		this.tx = createTransport({
			host: cfg.host,
			port: cfg.port,
			secure: cfg.secure,
			// Omit entirely when unset: an empty username makes nodemailer attempt an AUTH mailpit doesn't support.
			...(cfg.user ? { auth: { user: cfg.user, pass: cfg.pass } } : {}),
			// Without this, nodemailer upgrades to STARTTLS against plain-SMTP mailpit and fails the cert check.
			...(cfg.secure ? {} : { ignoreTLS: true }),
			pool: true,
			maxConnections: cfg.poolMax,
		});
	}

	async send(m: MailMessage): Promise<boolean> {
		try {
			await this.tx.sendMail({
				from: this.from,
				to: m.to,
				subject: m.subject,
				html: m.html,
				text: m.text,
			});
			return true;
		} catch (e) {
			// The address is logged, the body never is — it carries a sign-in token.
			log.error({ to: m.to, err: e }, "mail failed");
			return false;
		}
	}
}

export const mailer: Mailer = env.smtp
	? new SmtpMailer(env.smtp)
	: new ConsoleMailer();

const esc = (s: string): string =>
	s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const MONO =
	"font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;";

export function signInMail(link: string, ttlMinutes: number): MailMessage {
	const subject = "Your canireplaceit sign-in link";
	const text =
		`Somebody asked for a sign-in link for this address.\n\n${link}\n\n` +
		`It works once and expires in ${ttlMinutes} minutes.\n` +
		`If this wasn't you, ignore this email — nothing happens until the link is used.\n`;

	const html =
		`<div style="${MONO}font-size:14px;line-height:1.6;color:#171a17;max-width:520px">` +
		`<p style="font-weight:700;font-size:15px">Your canireplaceit sign-in link</p>` +
		`<p>Somebody asked for a sign-in link for this address.</p>` +
		`<p style="margin:24px 0"><a href="${esc(link)}" style="${MONO}display:inline-block;` +
		`background:#0e9c47;color:#fff;font-size:14px;font-weight:700;text-decoration:none;` +
		`padding:12px 20px;border-radius:8px">Sign in &rarr;</a></p>` +
		`<p style="color:#6b6f6a">It works once and expires in ${ttlMinutes} minutes.<br>` +
		`If this wasn't you, ignore this email — nothing happens until the link is used.</p>` +
		// Raw URL as a fallback for clients that strip the anchor.
		`<p style="color:#6b6f6a;font-size:11px;word-break:break-all">${esc(link)}</p>` +
		`</div>`;

	return { to: "", subject, html, text };
}

export function paidMail(o: {
	dashboardUrl: string;
	slots: string[];
	amountCents: number;
	months: number;
	currency: string;
}): MailMessage {
	const money = new Intl.NumberFormat("en", {
		style: "currency",
		currency: o.currency.toUpperCase(),
	}).format(o.amountCents / 100);
	const what = `${o.slots.length} slot${o.slots.length === 1 ? "" : "s"} (${o.slots.join(", ")}) for ${o.months} month${o.months === 1 ? "" : "s"}`;
	const subject = "Your canireplaceit ad — payment received, in review";

	const text =
		`Payment of ${money} received — thank you.\n\n` +
		`${what}.\n\n` +
		`Your ad is with us for a quick read before it goes up. Nothing else is\n` +
		`needed from you: the full ${o.months} month${o.months === 1 ? "" : "s"} start${o.months === 1 ? "s" : ""} when it goes live, not\n` +
		`today, so the review costs you nothing.\n\n` +
		`Your dashboard — it will show the ad going live, then its impressions,\n` +
		`clicks and CTR, counted on our own server and filtered for automated\n` +
		`traffic:\n\n${o.dashboardUrl}\n\n` +
		`Sign in there with this email address; we send a link, there is no password.\n\n` +
		`Need to change the ad, or take it down? Reply to this email.\n`;

	const html =
		`<div style="${MONO}font-size:14px;line-height:1.6;color:#171a17;max-width:520px">` +
		`<p style="font-weight:700;font-size:15px">Payment received — your ad is in review</p>` +
		`<p>${money} received — ${esc(what)}.</p>` +
		`<p><strong>Nothing else is needed from you.</strong> We read every ad before it goes up. ` +
		`The full term starts when it goes live, not today, so the review costs you nothing.</p>` +
		`<p style="margin:24px 0"><a href="${esc(o.dashboardUrl)}" style="${MONO}display:inline-block;` +
		`background:#0e9c47;color:#fff;font-size:14px;font-weight:700;text-decoration:none;` +
		`padding:12px 20px;border-radius:8px">Open your dashboard &rarr;</a></p>` +
		`<p style="color:#6b6f6a">It shows the ad going live, then impressions, clicks and CTR, ` +
		`counted on our own server and filtered for automated traffic. Sign in with this email ` +
		`address — we send a link, there is no password.</p>` +
		`<p style="color:#6b6f6a">Need to change the ad, or take it down? Reply to this email.</p>` +
		`<p style="color:#6b6f6a;font-size:11px;word-break:break-all">${esc(o.dashboardUrl)}</p>` +
		`</div>`;

	return { to: "", subject, html, text };
}

export function approvedMail(o: {
	dashboardUrl: string;
	slot: string;
	endsAt: Date;
}): MailMessage {
	const until = new Intl.DateTimeFormat("en", { dateStyle: "long" }).format(
		o.endsAt,
	);
	const subject = "Your canireplaceit ad is live";

	const text =
		`Good news — your ad on ${o.slot} passed review and is live now.\n\n` +
		`It runs until ${until}.\n\n` +
		`Your dashboard shows impressions, clicks and CTR, counted on our own\n` +
		`server and filtered for automated traffic:\n\n${o.dashboardUrl}\n\n` +
		`Sign in there with this email address; we send a link, there is no password.\n\n` +
		`Need to change the ad, or take it down? Reply to this email.\n`;

	const html =
		`<div style="${MONO}font-size:14px;line-height:1.6;color:#171a17;max-width:520px">` +
		`<p style="font-weight:700;font-size:15px">Your ad is live</p>` +
		`<p>Good news — your ad on ${esc(o.slot)} passed review and is live now. It runs until ${until}.</p>` +
		`<p style="margin:24px 0"><a href="${esc(o.dashboardUrl)}" style="${MONO}display:inline-block;` +
		`background:#0e9c47;color:#fff;font-size:14px;font-weight:700;text-decoration:none;` +
		`padding:12px 20px;border-radius:8px">Open your dashboard &rarr;</a></p>` +
		`<p style="color:#6b6f6a">It shows impressions, clicks and CTR, counted on our own server and ` +
		`filtered for automated traffic. Sign in with this email address — we send a link, there is no password.</p>` +
		`<p style="color:#6b6f6a">Need to change the ad, or take it down? Reply to this email.</p>` +
		`<p style="color:#6b6f6a;font-size:11px;word-break:break-all">${esc(o.dashboardUrl)}</p>` +
		`</div>`;

	return { to: "", subject, html, text };
}

export function rejectedMail(o: {
	slot: string;
	reason: string | null;
	amountCents: number;
	currency: string;
	wasRefunded: boolean;
}): MailMessage {
	const money = new Intl.NumberFormat("en", {
		style: "currency",
		currency: o.currency.toUpperCase(),
	}).format(o.amountCents / 100);
	const subject = "Your canireplaceit ad wasn't approved";

	const why = o.reason ? `Reason given: ${o.reason}\n\n` : "";
	const whyHtml = o.reason
		? `<p><strong>Reason given:</strong> ${esc(o.reason)}</p>`
		: "";
	const refund = o.wasRefunded
		? `${money} has been refunded to your original payment method — no action\n` +
			`needed from you; it should show up in a few business days.\n\n`
		: "";
	const refundHtml = o.wasRefunded
		? `<p>${money} has been refunded to your original payment method — no action needed ` +
			`from you; it should show up in a few business days.</p>`
		: "";

	const text =
		`Your ad on ${o.slot} was not approved.\n\n${why}${refund}` +
		`Questions, or want to try again with a different creative? Reply to this email.\n`;

	const html =
		`<div style="${MONO}font-size:14px;line-height:1.6;color:#171a17;max-width:520px">` +
		`<p style="font-weight:700;font-size:15px">Your ad wasn't approved</p>` +
		`<p>Your ad on ${esc(o.slot)} was not approved.</p>` +
		`${whyHtml}${refundHtml}` +
		`<p style="color:#6b6f6a">Questions, or want to try again with a different creative? Reply to this email.</p>` +
		`</div>`;

	return { to: "", subject, html, text };
}

// Body is fixed, no free-text from the inviter — that field is the payload in invite-spam abuse.
export function invitedMail(o: {
	link: string;
	owner: string;
	role: "org-owner" | "org-user";
}): MailMessage {
	const can =
		o.role === "org-owner"
			? "You can see their ads and manage who else has access."
			: "You can see their ads and how they are performing.";
	const subject = `${o.owner} added you on canireplaceit`;

	const text =
		`${o.owner} gave you access to their advertising account on canireplaceit.\n\n` +
		`${can}\nYou cannot buy, change or take down anything.\n\n${o.link}\n\n` +
		`The link signs you in. It works once and expires shortly.\n` +
		`Didn't expect this? Ignore it — nothing is shared until the link is used.\n`;

	const html =
		`<div style="${MONO}font-size:14px;line-height:1.6;color:#171a17;max-width:520px">` +
		`<p style="font-weight:700;font-size:15px">${esc(o.owner)} added you on canireplaceit</p>` +
		`<p>${esc(can)} You cannot buy, change or take down anything.</p>` +
		`<p style="margin:24px 0"><a href="${esc(o.link)}" style="${MONO}display:inline-block;` +
		`background:#0e9c47;color:#fff;font-size:14px;font-weight:700;text-decoration:none;` +
		`padding:12px 20px;border-radius:8px">See the numbers &rarr;</a></p>` +
		`<p style="color:#6b6f6a">The link signs you in. It works once and expires shortly.<br>` +
		`Didn't expect this? Ignore it — nothing is shared until the link is used.</p>` +
		`<p style="color:#6b6f6a;font-size:11px;word-break:break-all">${esc(o.link)}</p>` +
		`</div>`;

	return { to: "", subject, html, text };
}
