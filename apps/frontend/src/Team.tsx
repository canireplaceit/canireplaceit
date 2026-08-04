// canManage only hides controls; the API re-derives permissions and enforces 403 server-side.
import { useState } from "react";
import { api, type Org, type OrgRole } from "./api";
import type { Key } from "./i18n";

type T = (k: Key) => string;

const field =
	"w-full rounded-[calc(var(--radius))] border border-border bg-bg px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--brand)_35%,transparent)]";

function RolePill({ role, t }: { role: OrgRole; t: T }) {
	const isOwner = role === "org-owner";
	return (
		<span
			className="whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider"
			style={
				isOwner
					? { background: "var(--brand)", color: "#fff" }
					: {
							background: "color-mix(in srgb, var(--muted) 22%, transparent)",
							color: "var(--muted)",
						}
			}
		>
			{t(isOwner ? "team.orgOwner" : "team.orgUser")}
		</span>
	);
}

export function TeamPanel({
	org,
	t,
	onChanged,
}: {
	org: Org;
	t: T;
	onChanged: () => void;
}) {
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<OrgRole>("org-user");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");

	const add = async (e: React.FormEvent) => {
		e.preventDefault();
		const value = email.trim();
		if (!value) return;
		setBusy(true);
		setError("");
		try {
			await api.addMember({ email: value, role, owner: org.owner });
			setEmail("");
			onChanged();
		} catch (err) {
			// The API answers a reason for the two cases a person can fix.
			const msg = String(err);
			setError(
				/at most/.test(msg)
					? t("team.errFull")
					: /already owns/.test(msg)
						? t("team.errSelf")
						: t("form.error"),
			);
		} finally {
			setBusy(false);
		}
	};

	const remove = async (member: string) => {
		setBusy(true);
		try {
			await api.removeMember({ email: member, owner: org.owner });
			onChanged();
		} catch {
			setError(t("form.error"));
		} finally {
			setBusy(false);
		}
	};

	return (
		<section className="mt-10 rounded-[calc(var(--radius))] border border-border p-5">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<div>
					<p className="font-mono text-[10px] text-muted uppercase tracking-[0.2em]">
						{t("team.eyebrow")}
					</p>
					<h2 className="mt-1 font-bold font-display text-lg tracking-tight">
						{t("team.title")}
					</h2>
				</div>
				<span className="font-mono text-muted text-xs">
					{t("team.seatsUsed")
						.replace("{n}", String(org.members.length + 1))
						.replace("{max}", "11")}
				</span>
			</div>

			<p className="mt-2 max-w-2xl text-muted text-sm">
				{org.canManage ? t("team.blurbManage") : t("team.blurbRead")}
			</p>
			<p className="mt-1.5 font-mono text-[10px] text-muted uppercase tracking-widest">
				{t("team.youAre")}{" "}
				{t(
					org.role === "admin"
						? "team.siteAdmin"
						: org.role === "org-owner"
							? "team.orgOwner"
							: "team.orgUser",
				)}
				{org.isPayer ? ` · ${t("team.payer")}` : ""}
			</p>

			<ul className="mt-4 divide-y divide-border">
				<li className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
					<span className="min-w-0 flex-1 truncate">{org.owner}</span>
					<span className="font-mono text-[10px] text-muted uppercase tracking-wider">
						{t("team.payer")}
					</span>
				</li>
				{org.members.map((m) => (
					<li
						key={m.email}
						className="flex flex-wrap items-center gap-3 py-2.5 text-sm"
					>
						<span className="min-w-0 flex-1 truncate">{m.email}</span>
						<RolePill role={m.role} t={t} />
						{org.canManage && (
							<button
								type="button"
								disabled={busy}
								onClick={() => void remove(m.email)}
								className="rounded-[calc(var(--radius))] border border-border px-2.5 py-1 text-xs disabled:opacity-50"
							>
								{t("team.remove")}
							</button>
						)}
					</li>
				))}
			</ul>

			{org.canManage && (
				<form onSubmit={add} className="mt-4 flex flex-wrap items-end gap-2">
					<label className="min-w-[12rem] flex-1">
						<span className="mb-1.5 block font-medium text-muted text-xs">
							{t("team.addLabel")}
						</span>
						<input
							type="email"
							required
							value={email}
							onChange={(e) => setEmail(e.currentTarget.value)}
							placeholder="colleague@company.com"
							className={field}
						/>
					</label>
					<label>
						<span className="mb-1.5 block font-medium text-muted text-xs">
							{t("team.role")}
						</span>
						<select
							value={role}
							onChange={(e) => setRole(e.currentTarget.value as OrgRole)}
							className={`${field} w-auto`}
						>
							<option value="org-user">{t("team.orgUser")}</option>
							<option value="org-owner">{t("team.orgOwner")}</option>
						</select>
					</label>
					<button
						type="submit"
						disabled={busy}
						className="rounded-[calc(var(--radius))] px-4 py-2 font-medium text-sm disabled:opacity-50"
						style={{ background: "var(--brand)", color: "#fff" }}
					>
						{t("team.add")}
					</button>
				</form>
			)}

			{error && (
				<p className="mt-3 text-sm" style={{ color: "var(--danger)" }}>
					{error}
				</p>
			)}
			{org.canManage && (
				<p className="mt-3 text-muted text-xs">{t("team.note")}</p>
			)}
		</section>
	);
}
