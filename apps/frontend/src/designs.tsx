/**
 * The list.
 *
 * There used to be eight of these, switchable at runtime so they could be judged
 * on the real data. The Switchboard won and the other seven are gone, along with
 * the `design` prop that every list component, every page and both sponsor
 * renderers had to thread through to reach them.
 *
 * What the experiment leaves behind is the rule it was built to prove: a row is a
 * link to the product's own page, which is where the argument is made and what a
 * crawler needs to be able to follow. Everything visual comes from tokens.
 */

import { paths } from "core/src/routes";
import { ProductLogo, VerdictMark } from "./components";
import {
	type ListProps,
	MEASURE,
	priceLabel,
	withSponsors,
} from "./listShared";
import { Link } from "./nav";
import { InListSponsor } from "./SponsorRails";

export type { ListProps };

/**
 * An operational status board: one card per product, three across on a laptop.
 *
 * `grid-cols-1` is not redundant. Without an explicit track the grid sizes its
 * auto columns to max-content, so one long product name widens the whole
 * document and scrolls the page sideways at 375px.
 */
export function ProductList(props: ListProps) {
	const { products, slots, t, tc, lang } = props;

	return (
		<ul
			className={`mx-auto grid ${MEASURE} auto-rows-min grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3`}
		>
			{withSponsors(products, slots).map((item, i) =>
				item.kind === "sponsor" ? (
					<li key={item.slot.id}>
						<InListSponsor slot={item.slot} t={t} tc={tc} lang={lang} />
					</li>
				) : (
					<li
						key={item.p.slug}
						className="rounded-[calc(var(--radius))] border border-border bg-surface transition hover:border-[color-mix(in_srgb,var(--accent)_50%,var(--color-border))]"
					>
						<Link
							href={paths.product(lang, item.p.slug)}
							className="flex w-full items-start gap-3 p-3.5 text-left"
						>
							<ProductLogo product={item.p} size={34} eager={i < 12} />
							<span className="min-w-0 flex-1">
								<span className="flex items-baseline justify-between gap-2">
									<span className="truncate font-display font-semibold">
										{item.p.name}
									</span>
									<span className="nums shrink-0 text-sm text-muted">
										{priceLabel(item.p, lang, t)}
									</span>
								</span>
								<span className="mt-1.5 flex items-center justify-between gap-2">
									<VerdictMark verdict={item.p.verdict} t={t} />
									{/* A 0 here reads as "broken", not "new" — omit it rather
									    than publish a zero as a fact. */}
									{item.p.switchedCount > 0 && (
										<span className="nums shrink-0 text-xs text-muted">
											{item.p.switchedCount} ↺
										</span>
									)}
								</span>
							</span>
						</Link>
					</li>
				),
			)}
		</ul>
	);
}
