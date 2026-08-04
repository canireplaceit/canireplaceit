/**
 * The site mark: two arrows trading places.
 *
 * Grey points left — the thing you are leaving. Blue points right — what
 * replaces it. Direction carries the whole meaning, which is why the two are
 * never the same colour: a symmetrical two-tone pair reads as *sync*, not
 * *replace*, and that misreading is the one this mark has to avoid.
 *
 * Inline rather than `<img src="/favicon.svg">` because it has to do two things
 * a referenced image cannot: inherit the theme (the grey is `currentColor`, the
 * blue is `--brand`, so dark mode needs no second file) and animate on hover.
 * `public/favicon.svg` is the same geometry with the colours baked in — if you
 * change one, change both.
 *
 * The motion is a 2.5px nudge along each arrow's own axis: the smallest thing
 * that still says "these two are going opposite ways". `motion-reduce` drops it
 * entirely rather than shortening it, and it rides on `group-hover`/
 * `group-focus-visible` from the header link, so keyboard users get it too.
 * Transform only — nothing here can reflow the header.
 */
export function Mark({ className = "size-6" }: { className?: string }) {
	const shared =
		"transition-transform duration-200 ease-out motion-reduce:transition-none motion-reduce:translate-x-0";
	return (
		// The link this sits in already reads "canireplaceit", so a <title> here
		// would make a screen reader announce the brand twice. aria-hidden is the
		// right answer for a mark beside its own wordmark. public/favicon.svg DOES
		// carry a title, because there it stands alone as the tab icon.
		// biome-ignore lint/a11y/noSvgWithoutTitle: decorative, see above
		<svg
			viewBox="0 0 32 32"
			className={className}
			fill="none"
			strokeWidth={3.4}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden
		>
			{/* Out: what you are leaving. */}
			<path
				d="M24 10H8M13 5L7 10l6 5"
				stroke="currentColor"
				opacity={0.55}
				className={`${shared} group-hover:-translate-x-[2.5px] group-focus-visible:-translate-x-[2.5px]`}
			/>
			{/* In: the replacement. */}
			<path
				d="M8 22h16M19 17l6 5-6 5"
				stroke="var(--brand)"
				className={`${shared} group-hover:translate-x-[2.5px] group-focus-visible:translate-x-[2.5px]`}
			/>
		</svg>
	);
}
