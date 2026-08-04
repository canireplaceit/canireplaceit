/**
 * "Edit this page", the docs-site way.
 *
 * The content model is the whole reason this is a link and not a form. Products,
 * categories and ad inventory are JSON files in git; votes, sponsors and leads
 * are the only things in the database. So the honest editor for a product page is
 * the forge's own web editor on that product's file — it opens a branch, a diff
 * and a pull request for someone with a GitHub account and no clone, and CI
 * validates the result before anyone merges it.
 *
 * An in-browser admin writing to the database would put the catalogue in two
 * places at once, lose the review trail, and break the promise that a fresh clone
 * with no database still builds the whole site.
 */

import { FilePen, GitPullRequest } from "lucide-react";
import { CARD } from "./components";
import type { Key } from "./i18n";

/** Where the content lives. */
export const REPO = "https://github.com/canireplaceit/canireplaceit";

/**
 * The maintainer's public email address — the one thing on the contact page that
 * cannot be derived.
 *
 * Deliberately `null`. No address, company, postal address or social handle is
 * recorded anywhere in this repo, and inventing one so the page looks complete
 * would be the same class of lie as an unpriced slot rendering as free. Set it to
 * a real address and the contact page grows a `mailto:` row; until then it says
 * out loud that there is no published address and sends people to the tracker.
 */
export const CONTACT_EMAIL: string | null = "canireplaceit@gmail.com";

/** The forge's web editor, on the default branch. */
export const editUrl = (file: string) => `${REPO}/edit/main/${file}`;

/** The file behind a product page. One product, one file, by construction. */
export const productFile = (slug: string) => `data/products/${slug}.json`;

/** Every category is one entry in one file. */
export const CATEGORY_FILE = "data/categories.json";

const link =
	"inline-flex items-center gap-1.5 rounded-[calc(var(--radius))] border border-border px-2.5 py-1.5 text-xs hover:border-[color-mix(in_srgb,var(--brand)_50%,var(--line))]";

/**
 * `file` is the path this page is authored in, or null when the page is derived
 * from several — a project page is assembled from every product that cites it,
 * so there is no one file to open and saying so is better than picking one.
 */
export function EditThisPage({
	file,
	t,
	className = "",
}: {
	file: string | null;
	t: (k: Key) => string;
	className?: string;
}) {
	return (
		<aside className={`${CARD} ${className}`}>
			<p className="text-xs text-muted">
				{t(file ? "edit.blurb" : "edit.derivedBlurb")}
			</p>
			<div className="mt-2.5 flex flex-wrap gap-2">
				{/* External, and a real target: this leaves the site for the forge. */}
				<a
					href={file ? editUrl(file) : `${REPO}/tree/main/data/products`}
					target="_blank"
					rel="noopener"
					className={`${link} text-brand`}
				>
					<FilePen className="size-3.5" aria-hidden />
					{t(file ? "edit.suggest" : "edit.browseFiles")}
					{file && <code className="text-muted">{file}</code>}
				</a>
				<a
					href={`${REPO}/blob/main/CONTRIBUTING.md`}
					target="_blank"
					rel="noopener"
					className={link}
				>
					<GitPullRequest className="size-3.5" aria-hidden />
					{t("submit.contributing")}
				</a>
			</div>
		</aside>
	);
}
