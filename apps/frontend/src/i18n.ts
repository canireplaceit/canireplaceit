import {
	isLang,
	type Lang,
	resolveTranslation,
	type Translations,
} from "core/src/index";
import { useCallback, useEffect, useState } from "react";

export type { Lang };

// ponytail: a dict and a hook. i18next earns its weight at ~5 locales, not 2.
/**
 * Exported so the prerenderer can read labels it needs OUTSIDE the React tree.
 * `meta` is computed before render, so it has no `t`. Without this the build
 * script kept its own copy of the theme names and they drifted on the first
 * edit.
 */
export const dict = {
	en: {
		"nav.list": "The list",
		"nav.menu": "Menu",
		"features.title": "What these projects actually do",
		"features.blurb":
			"A closed vocabulary of features, answered per project from its own docs and repo. A dash means nobody has checked, never that the answer is no.",
		"features.genre": "Genre",
		"features.all": "All",
		"features.require": "Require a feature",
		"features.searchPlaceholder":
			"Search features: SSO, markdown, offline, webhooks…",
		"features.acceptPaid": "Count features that are only in a paid tier",
		"features.narrow": "more. Narrow with the search box.",
		"features.compare": "Compare",
		"features.pickTwo":
			"Pick two or more projects above to see only the features where they actually differ.",
		"features.noMatch":
			"Nothing matches every requirement. That is a real answer, not an empty page. Loosen one, or allow paid tiers.",
		"features.noDiff":
			"These projects do not differ on anything we have checked. That is worth knowing. It usually means the choice turns on something outside the matrix.",
		"features.loading": "Loading the feature matrix…",
		"features.loadFailed": "The feature dataset could not be loaded.",
		"features.facts": "facts",
		"features.coverage": "projects with feature data",
		"features.legend":
			"Values: ● yes · € paid tier only · ◐ partial · ○ no · – not checked",
		"features.onProject": "What it does",
		"features.vsHeading": "Where they actually differ",
		"features.vsBlurb":
			"Only features both sides were checked on, and only where they disagree",
		"features.checked": "features checked",
		"features.compareLink": "compare with others →",
		"features.compareProduct":
			"compare {name} against {n} open source projects",
		"features.compareProject": "compare {name} with other open source projects",
		"features.paidOnly": "paid only",
		"features.bothChecked": "Only rows both projects were checked on",
		"features.realDiff": "real disagreements",
		"features.quick": "Quick filters",
		"features.quickMcpOfficial": "Official MCP server",
		"features.quickMcp": "Ships an MCP server",
		"features.quickAi": "Has AI features",
		"features.quickSso": "SSO in the free build",
		"features.quickSelfhost": "Runs on SQLite",
		"features.results": "Matching projects",
		"features.matchOne": "project matches",
		"features.matchMany": "projects match",
		"features.reqOne": "requirement",
		"features.reqMany": "requirements",
		"features.moreGenres": "All {n} genres",
		"features.lessGenres": "Show fewer",
		"features.required": "Your requirements",
		"features.featureCol": "Feature",
		"features.diffOne":
			"1 differing feature. Rows where every side agrees, or where nobody has checked, are dropped.",
		"features.diffMany":
			"{n} differing features. Rows where every side agrees, or where nobody has checked, are dropped.",
		"features.vocab": "features in the vocabulary",
		"features.val.yes": "Yes",
		"features.val.paid": "Paid tier only",
		"features.val.partial": "Partial",
		"features.val.no": "No",
		"features.val.unknown": "Not checked",
		"nav.features": "Features",
		"nav.sponsor": "Sponsor",
		"nav.submit": "Submit",

		"hero.title": "Can I replace",
		"hero.blurb":
			"Every SaaS bill, one honest verdict. Not “here are 40 alternatives”, but whether the open source one is good enough yet, and what switching costs.",
		"hero.searchPlaceholder": "Search {n} products: Jira, Figma, Datadog…",

		"stats.products": "products reviewed",
		"stats.alternatives": "open source alternatives",
		"stats.noAnswer": "we say don't bother",
		"stats.switches": "switches reported",
		// Count is only ever rendered above zero, so the singular form's plural rule must be correct.
		"stats.switchesOne": "switch reported",
		"stats.switchesNone": "be the first to report a switch",

		"filter.allCategories": "All categories",
		"filter.anyVerdict": "Any verdict",
		"filter.sortVotes": "Most switched",
		"filter.sortPrice": "Most expensive",
		"filter.sortName": "A to Z",

		"verdict.yes": "Replaceable",
		"verdict.almost": "Almost",
		"verdict.not-yet": "Not yet",

		"effort.managed": "hosted option",
		"effort.docker": "one docker compose",
		"effort.ops": "real ops work",

		"row.alternatives": "alternatives",
		"row.switched": "I switched",
		"row.switchedDone": "Counted, thanks",
		"row.perMonth": "/mo",
		"row.allArchived": "every alternative is archived",
		"row.free": "free tier",
		"row.whatYouLose": "What you give up",
		"row.quoteOnly": "quote only",
		"row.once": "one-time",

		"price.heading": "Price",
		"price.plan": "Plan",
		"price.basisLabel": "Basis",
		"price.checked": "Checked",
		"price.confidenceLabel": "Confidence",
		"price.source": "Source",
		"price.takenFrom": "price taken from",
		"price.on": "on",

		"ladder.title": "Your exit ladder",
		"ladder.here": "You are here",
		"ladder.cheaper": "Cheaper, still paid",
		"ladder.oss": "Open source, least work first",
		"ladder.save": "save",
		"ladder.perYear": "/yr",
		"price.basis.flat": "flat rate",
		"price.basis.per-seat": "per seat",
		"price.basis.usage": "usage-based",
		"price.basis.one-time": "one-time licence",
		"price.basis.custom": "custom quote",
		"price.confidence.high": "confirmed",
		"price.confidence.medium": "from docs, not the pricing page",
		"price.confidence.low": "unconfirmed",
		"price.confidence.lowNote":
			"We could not confirm this figure on the vendor's own page. Treat it as a hint, not a quote.",
		"price.noPublic": "No public price",
		"price.noPublicNote":
			"We looked: this vendor publishes nothing but “contact sales”.",
		"price.unverified": "Price not checked",
		"price.unverifiedNote":
			"Nobody has verified this one yet. We are not going to invent a number.",

		"repo.dormant": "no commits since",
		"repo.compose": "docker compose in the repo",
		// The card has room for one word beside the whale, not the sentence.
		"repo.composeShort": "compose",
		// Accessible name of a forge mark (e.g. "Bruno on GitHub"). Marks are 14px silhouettes readers may not recognise.
		"repo.at": "on",
		"repo.forgeOther": "another forge",
		"repo.archived": "Archived",
		"alt.showAll": "Show all {n}",
		"alt.filterAll": "All",
		"alt.filterNoServer": "No server",
		"alt.filterNoStrings": "No strings",
		"escape.live": "live alternatives",
		"escape.easiest": "least work",
		"escape.noServer": "need no server",
		"escape.noStrings": "hold nothing back",
		"alt.archivedHeading": "Archived, {n} kept for the record",
		"alt.archivedBlurb":
			"These are done. Listed because knowing a project died is worth as much as knowing it exists, not because we recommend them.",
		"repo.archivedNote":
			"The maintainers have stopped. The forge has it read-only. Treat it as a dead end, not an option.",
		// Prefixes the forge's own top-language string, a proper noun that is never translated (e.g. "written in Go").
		"repo.language": "written in",

		"alt.ossHeading": "Open source",
		"alt.cheaperHeading": "Cheaper, still paid",
		"alt.cheaper": "paid, cheaper",
		"alt.website": "website",

		"facts.selfHost": "self-hostable",
		"facts.noSelfHost": "not self-hostable",
		"facts.openCore": "open core",
		"facts.sso": "SSO included",
		"facts.ssoPaid": "SSO paywalled",
		"facts.ssoUnknown": "SSO not checked",
		"facts.residency.self": "your server",
		"facts.residency.eu-option": "EU region",
		"facts.residency.us-only": "US only",
		"facts.residency.unknown": "residency not checked",

		"facts.openCore.none": "fully open",
		"facts.openCore.minor": "mostly open",
		"facts.openCore.major": "open core",
		"facts.openCore.noneNote":
			"The build you can run yourself is the whole product. Nothing is held back for a paid tier.",
		"facts.openCore.minorNote":
			"The self-hosted build is the product, minus a few enterprise conveniences that are sold separately.",
		"facts.openCore.majorNote":
			"The free build is a demo. The half that makes it worth switching to is sold, not self-hosted.",
		"facts.paywalledLabel": "Paid only",
		"facts.paywalledVaries":
			"Something is held back, but the products citing this project do not describe the same thing. See the ones it replaces, below.",
		"facts.heading": "What you actually get",

		"facts.varies.selfHost": "self-hosting: varies by product",
		"facts.varies.openCore": "open core: varies by product",
		"facts.varies.sso": "SSO: varies by product",
		"facts.varies.residency": "residency: varies by product",
		"facts.variesNote":
			"These facts are written against each product this project is offered to replace, and those entries do not agree here. Check the product page you came from.",

		"nav.categories": "Categories",
		"nav.glossary": "Glossary",

		// The exit ladder: derived from the verdict plus the facts via `rungOf` in core, never picked directly by a contributor.
		"rung.locked-in": "locked in",
		"rung.partial": "partial exit",
		"rung.self-hostable": "self-hostable",
		"rung.drop-in": "drop-in",

		"cats.all": "All categories",
		"cats.browse": "Browse categories",
		"products.browse": "Browse products",
		"products.title": "Every product we track",
		"products.blurb":
			"All {n} paid products in the catalogue, grouped by category. Every one has a page saying what replaces it, what that costs, and what you give up.",
		"products.inCategory": "products in this category",
		"cats.title": "Every category",
		"cats.blurb":
			"Grouped by theme, and inside each theme ordered by how many paid products we have reviewed, not by an editor's idea of importance. The bar is the exit ladder: how far out of a category you can actually get.",
		"cats.ladder": "Exit ladder",
		"cats.projects": "open source projects",
		"cats.medianPrice": "median price",
		"cats.noMedian": "no published price",
		"cats.medianOver": "median across",
		"cats.cheapest": "lowest-effort escape",
		"cats.noEscape": "nothing fully open yet",
		"cats.nearby": "Nearby categories",
		"cats.inThis": "In this category",
		"product.related": "Other products in {category}",
		"product.inCollections": "This product also appears in",
		"project.inCategories": "Replaces products in",
		"project.inCollections": "This project also appears in",
		"project.repo": "The repo",
		"project.licence": "Licence",
		"project.writtenIn": "Written in",
		"project.lastCommit": "Last commit",
		"project.composeLabel": "Docker Compose",
		"project.composeYes": "a compose file sits in the repo root",
		"project.composeNo": "no compose file in the repo root",
		"cats.smallNote":
			"One of the smaller corners of the catalogue. The nearby categories below cover adjacent ground.",

		"catGroup.work": "Work & collaboration",
		"catGroup.dev": "Building software",
		"catGroup.infra": "Infrastructure & hosting",
		"catGroup.security": "Security & access",
		"catGroup.ai-data": "AI, data & research",
		"catGroup.growth": "Marketing & sales",
		"catGroup.commerce": "Commerce & logistics",
		"catGroup.operations": "Running a business",
		"catGroup.creative": "Creative & media",
		"catGroup.home": "Home & personal",
		"cats.themes": "Jump to a theme",
		"cats.inGroup": "categories",

		"edit.blurb":
			"This page is one JSON file in the repo. Something wrong or out of date? Edit it and open a pull request. CI validates it before anyone merges.",
		"edit.derivedBlurb":
			"This page is derived from the product files that cite this project, so there is no single file behind it. Fix it where it is written.",
		"edit.suggest": "Suggest a change",
		"edit.browseFiles": "Browse the product files",

		"page.home": "All products",
		"page.categories": "All categories",
		"page.products": "Product index",
		"page.replaces": "Replaces",
		"page.notFound": "Nothing here.",
		"page.loading": "Loading…",

		"ui.language": "Language",

		"nav.products": "Products",
		"nav.projects": "Alternatives",
		"nav.collections": "Collections",

		"hero.sponsorsIntro": "canireplaceit is supported by these sponsors.",
		"hero.sponsorsCta": "Sponsor this project →",

		"home.pagedTitle": "Every product we have reviewed, page {n}",
		/* Appended to a paginated heading so ten sibling pages are not ten
		   identically-headed documents. The home route already did this with its
		   own key; the project index and the collections did not. */
		"page.headingSuffix": ", page {n}",
		// Page 2+ of a collection, for the <title> only. The long title phrase plus
		// "— page 42" runs past 60 characters on the big collections, and cutting
		// the phrase to make room is what made 63 of these pages byte-identical.
		"collection.pagedTitle":
			"{name} — page {page} of the open source catalogue",

		"page.pagination": "Pagination",
		// The hub's full page index, and the accessible name that keeps it apart
		// from the compact strip above it.
		"page.allPages": "All {n} pages",
		"page.previous": "Prev",
		"page.next": "Next",
		"page.pageOf": "Page {n} of {of}",
		"page.projects": "All open source projects",
		"page.collections": "Collections",

		"filter.category": "Category",
		"filter.verdict": "Verdict",
		"filter.sort": "Order",
		// The default sort, matching the order the paginated pages are cut from.
		"filter.sortWeight": "Our order",
		"filter.effort": "How much work",
		"filter.anyEffort": "Any effort",
		"filter.openness": "How open",
		"filter.anyOpenness": "Any openness",
		"filter.price": "Price",
		"filter.anyPrice": "Any price",
		"filter.clear": "Clear filters",
		"filter.filteredNote": "filtered view, not a page of its own",
		"filter.hiddenPrefix": "Not shown, because there is no figure to compare:",
		"filter.hiddenNoPublic": "with no public price",
		"filter.hiddenUnchecked": "nobody has checked yet",

		"filter.open": "Filters",
		"filter.close": "Close",
		"filter.verdictAll": "All",
		"filter.categorySearch": "Search categories…",
		"filter.show": "Show {n} product",
		"filter.showPlural": "Show {n} products",

		// One ordered axis, worst to best, not independent checkboxes. Ranking order must be preserved.
		"openness.hosted-only": "hosted only",
		"openness.source-available": "source available",
		"openness.open-core": "open core",
		"openness.mostly-open": "mostly open",
		"openness.fully-open": "fully open",
		"openness.atLeast.fully-open": "Fully open only",
		"openness.atLeast.mostly-open": "Mostly open or better",
		"openness.atLeast.open-core": "Open core or better",
		"openness.atLeast.source-available": "Source available or better",
		"openness.atLeast.hosted-only": "Anything, including hosted only",

		"effort.atMost.managed": "A hosted option exists",
		"effort.atMost.docker": "One docker compose or easier",

		"price.band.free": "Free tier",
		"price.band.under-25": "Under $25/mo",
		"price.band.25-100": "$25 to $100/mo",
		"price.band.over-100": "Over $100/mo",
		"price.band.no-public": "No public price",
		"price.band.unchecked": "Price not checked",

		"projects.title": "Every open source project",
		"projects.blurb":
			"All 871 of them, with what each one replaces, its licence, how much work it is to run and whether the repo is still alive. Most of these projects replace exactly one product, which makes this the only page that lists them.",
		"projects.searchPlaceholder": "Search projects: Nextcloud, Plausible…",
		"projects.unit": "projects",

		"collections.title": "Collections",
		"collections.blurb":
			"Cross-sections of the catalogue, each one a query rather than a list somebody keeps. Nothing here is hand-picked, so nothing here can quietly go stale.",
		"collections.rejectedNote":
			"“Open source” and “FOSS” are the two big ones on purpose: {open} of {all} projects carry a recognised open source licence, and {foss} of those hold nothing back. The gap between them is the point. There is no separate “FOSS and self-hostable” collection, because nothing withheld already means you can run it. It would list the same {foss} projects twice. Every project, in every state, is on",
		"collections.all": "All collections",

		"collection.self-hostable.title": "Self-hostable",
		"collection.self-hostable.blurb":
			"Products with a credible open source replacement that you run yourself. A real exit, with a server attached.",
		"collection.self-hostable.derivation":
			"Derived from the exit ladder: the verdict is “replaceable”, at least one alternative is genuinely self-hostable, and none of them offers a hosted tier, so leaving means operating it.",

		"collection.open-source.title": "Open source",
		"collection.open-source.blurb":
			"Projects whose source is public under a recognised open source licence, and that you can build and run. The broad reading: selling an enterprise edition beside an open core does not disqualify anyone here.",
		"collection.open-source.derivation":
			"Derived from the licence string on every citation, matched against the OSI licence families: MIT, Apache-2.0, the GPLs, MPL, the BSDs and the rest. Licences that publish source without being open source are excluded, and have their own collection.",
		"collection.open-source.unresolvedNote":
			"These projects are cited against several products, and those entries do not agree about whether the licence is open source at all. Rather than settle it with whichever citation happened to be read first, they are named here. Each project page shows the split.",

		"collection.foss.title": "FOSS",
		"collection.foss.blurb":
			"The strict reading. An open source licence with no strings attached and nothing held back: no Commons Clause, no BSL, and no enterprise edition sold beside the free one. The build you run yourself is the whole product.",
		"collection.foss.derivation":
			"Two conditions, both derived: the licence is a recognised OSI licence, and facts.openCore is “none” on every product that cites the project. Self-hosting is not a third condition. In this catalogue “nothing withheld” already means you can run it, so adding it would change the list by nothing at all.",
		"collection.foss.unresolvedNote":
			"These projects are cited against several products, and those entries do not agree about the licence or about what is withheld. Free software with no strings is a strong claim and it needs consensus, so these are named here rather than counted on a guess. Each project page shows the split.",

		"collection.open-core.title": "Open core",
		"collection.open-core.blurb":
			"Open source projects where the build you can run is not the whole product. Useful, often the right choice, but not the same claim.",
		"collection.open-core.derivation":
			"Derived from facts.openCore on every product that cites the project. A project is in only when all of its citations agree it withholds something.",

		// Keep short: this string is the H1, breadcrumb, and a 240px nav dropdown row that truncates. Long form lives in <title> in seo.ts.
		"collection.source-available.title": "Source-available",
		"collection.source-available.blurb":
			"Published source that is not open source. You can read the code and usually run it, but the licence is not an OSI licence, so what you may do with it is limited in ways neither of the two collections above limits you.",
		"collection.source-available.derivation":
			"Derived from the licence string on every citation, against a closed list of named licences that publish source without being open source: BSL/BUSL, SSPL, Elastic, FSL, Commons Clause, Sustainable Use and vendor EULAs. An enterprise edition beside an OSI core is not on that list: that is open core, and it has its own collection.",

		"collection.cheaper.title": "Cheaper, still paid",
		"collection.cheaper.blurb":
			"Products with a commercial alternative that genuinely costs less. For when self-hosting is not the answer but the invoice still is.",
		"collection.cheaper.derivation":
			"Derived from the alternatives themselves: every product here lists at least one “cheaper” entry, which validation requires to undercut the product it replaces.",

		"catGroupBlurb.work":
			"Getting work done: docs, tasks, meetings and the tools a team lives in.",
		"catGroupBlurb.dev":
			"Building and shipping software: editors, CI, registries, the developer's own stack.",
		"catGroupBlurb.infra":
			"The machines underneath: servers, networks, storage, and what watches them.",
		"catGroupBlurb.security":
			"Passwords, secrets, identity and the things that keep other people out.",
		"catGroupBlurb.ai-data": "Models, pipelines and the places data ends up.",
		"catGroupBlurb.growth":
			"Finding an audience and measuring whether any of it worked.",
		"catGroupBlurb.commerce": "Selling things, and getting paid for them.",
		"catGroupBlurb.operations":
			"Running the business itself: people, money, scheduling, support.",
		"catGroupBlurb.creative": "Making pictures, video, music and 3D.",
		"catGroupBlurb.home":
			"Personal and household software, on your own hardware where possible.",
		"group.allProducts": "Everything in this theme",
		"projects.mostReplacing": "Replaces the most",
		"lede.yes":
			"You can replace {product}: {best} does the same job under {licence}.",
		"lede.almost":
			"You can almost replace {product}: {best} covers most of it under {licence}.",
		"lede.notYet":
			"You cannot replace {product} yet. Nothing open source covers the job.",
		"lede.butLose": "What you give up is {lose}.",
		"def.verdict.yes":
			"Feature-complete for the realistic use case. Switching costs you an install, not a migration.",
		"def.verdict.almost":
			"Covers part of the job. You give up something real. The page says what.",
		"def.verdict.not-yet":
			"Nothing credible replaces this yet. Listed so you know the answer is no, not so you keep looking.",
		"def.effort.managed":
			"Someone will run it for you if you would rather not, or it is a binary you just install.",
		"def.effort.docker":
			"The repo ships a compose file: one command and it runs.",
		"def.effort.ops":
			"You are operating a server. Backups, updates and uptime become yours.",
		"def.facts.openCore.none":
			"The build you can run yourself is the whole product. Nothing is held back.",
		"def.facts.openCore.minor":
			"An open source licence, with a few enterprise conveniences sold beside it.",
		"def.facts.openCore.major":
			"An open source licence, but the free build is a demo of the product.",
		"def.facts.selfHost": "You can run this on your own machine or server.",
		"def.facts.noSelfHost":
			"You cannot run this yourself, whatever the licence says.",
		"def.facts.ssoPaid": "Single sign-on is not in the free build.",
		"def.facts.sso": "Single sign-on works in the free build.",
		"def.repo.archived":
			"The repo is archived. Read-only, finished. Kept here because knowing something died is worth as much as knowing it exists.",
		"def.repo.dormant":
			"No commits for over a year. Not dead, but nobody is working on it.",
		"def.repo.compose": "Ships a compose file in the repo root.",
		"gaps.unsureHeading": "Claims we are least sure about",
		"gaps.unsureBlurb":
			"Prices we could not confirm on the vendor’s own page. Listed rather than hidden, because a figure you cannot check is worth less than one you are told to doubt.",
		"gaps.uncheckedNote":
			"A further {n} products have no price on file at all. Nobody has looked yet, which is not the same as “free”, and the catalogue never renders it that way.",
		"defaults.heading": "The defaults, and what replaces them",
		"defaults.blurb":
			"These ship with the system, so nothing here is about money. The question is whether a newer tool is worth installing, and what you give up the next time you are on a machine that only has the original.",
		"defaults.tool": "Default",
		"defaults.replacement": "Replacement",
		"defaults.costs": "Costs you",
		"cover.heading": "Replace the most with the fewest",
		"cover.blurb":
			"{n} projects between them replace {covered} of the {total} products in this catalogue. Each row is not the next-biggest project. It is the one that covers the most of what the rows above it do not.",
		"cover.more": "more",
		"archived.recent": "Most recently stopped",
		"archived.recentNote":
			"The date is the last commit on the repo, which is the closest thing a forge will tell us to when the work stopped.",
		"siblings.sameJob": "Others that do this job",
		"siblings.sameLanguage": "Also written in {lang}",
		"gaps.title": "What nothing replaces yet",
		"gaps.eyebrow": "The gaps",
		"gaps.link": "The products nothing open source replaces yet",
		"gaps.blurb":
			"The paid products in this catalogue with no credible open source replacement, and the specific thing each one withholds. Published because a directory that only lists wins is an advertisement.",
		// Both counts, above the fold, so the second list is not a surprise
		// halfway down. Derived from the two lists below, never written here.
		"gaps.counts": "{paid} paid products, and {free} free tools listed apart",
		"gaps.paidHeading": "The paid products nothing replaces",
		"gaps.freeHeading": "The free tools nothing replaces",
		"gaps.freeBlurb":
			"These cost nothing, and most are open source themselves. They are not a gap in open source — they are open source with no second implementation behind it, which makes each one a single point of dependence for an entire industry.",
		"gaps.footnote":
			"Every row here is a verdict of “not yet”, which is a judgement about today and not a prediction. When a replacement appears the product moves off this page. That is the point of keeping it derived rather than hand-written.",
		// The About page. Google's Quality Rater Guidelines name it as the starting
		// point for assessing Trust, and it is the one page the site did not have.
		// Everything on it is already true elsewhere on the site; this is the page
		// that says it in one place.
		"about.title": "About",
		"about.eyebrow": "About",
		"about.h1": "Who writes these verdicts, and how",
		"about.blurb":
			"One maintainer, one public repository, and a rule applied the same way to every entry. This page says who, how a verdict is decided, how a price is checked, and what money does not buy here.",
		"about.who.h": "Who runs this",
		"about.who.p1":
			"canireplaceit is written and maintained by one person, publishing as @hadesdevs. This is not a company with a research team behind it, and pretending otherwise would be the first thing on the site that was not true. The publisher's real identity, legal form and address are on the legal notice, because a site that sells sponsorship is required to publish them and because you should be able to find out who is telling you to cancel a subscription.",
		"about.who.p2":
			"The catalogue is not a database somebody keeps privately. Every product on this site is one JSON file in a public repository, and every page carries a link straight to the file it was built from. If a verdict is wrong you can read exactly what it was based on, change it, and open a pull request; CI validates the change before anyone merges it.",
		"about.verdict.h": "How a verdict is decided",
		"about.verdict.p1":
			"There are three verdicts and only three. Replaceable means an open source project covers the realistic use case, so leaving costs an install rather than a migration. Almost means it covers part of the job and you give up something real, and the page names what. Not yet means nothing credible replaces the product, and the entry stays on the site anyway so that the answer is on record.",
		"about.verdict.p2":
			"A verdict is about how replaceable a product is, not about how good it is. That is why nothing here carries a star rating. A three-point replaceability scale is not a quality score, and turning one into the other would mean publishing a number nobody measured.",
		"about.verdict.p3":
			"The facts a verdict rests on are structured fields rather than prose, so the same question gets the same answer on every entry: the licence, whether you can genuinely run the thing yourself, how much of the product is held back behind a paid tier, whether SSO costs extra, and where the data is allowed to sit. Each of those terms is defined once, and the definition is public.",
		"about.price.h": "How prices are checked, and re-checked",
		"about.price.p1":
			"A price with no date is a rumour. Every figure on this site carries a receipt: the plan it was read from, the vendor page it was read on, the day it was read, and how confident we are in the reading. A price we could not confirm on the vendor's own pricing page says so instead of passing itself off as confirmed, and a product nobody has priced yet says that too rather than showing a plausible number.",
		"about.price.p2":
			"Prices move, and a stale one is the fastest way for a catalogue like this to become useless. Figures are re-read in passes rather than continuously, the date on the page is always the date of the last real reading, and the entries we are least sure about are listed in public rather than quietly left to age.",
		"about.gaps.h": "Why there is a page about what nothing replaces",
		"about.gaps.p1":
			"A directory that only lists its wins is an advertisement. The gaps page is every product in this catalogue where our own thesis fails: paid tools with no credible open source replacement, and the specific thing each one withholds. A second list on the same page holds the free tools nothing replaces either, because those are not a gap in open source — they are open source with nothing behind them. Both are derived from the verdicts rather than written by hand, so a product leaves the page the day a replacement lands.",
		"about.money.h": "How this is paid for, and what that does not buy",
		"about.money.p1":
			"Sponsorship slots are paid placements and every one of them is labelled as such, wherever it appears. If a placement is not labelled, it is not paid.",
		"about.money.p2":
			"Verdicts, rankings, the order of any list, inclusion in the catalogue, and removal from it are never paid. No sponsor sees a verdict before it is published, and no sponsor has ever been given a right of review over one.",
		"about.money.p3":
			"A sponsor being reviewed badly on this site is a normal outcome, not an incident.",
		"about.money.p4":
			"There are no affiliate links on this site. If that ever changes, links that earn a commission will be marked at the link itself and not only on a page like this one, and the change will be recorded on the disclosure page.",
		"about.fix.h": "If something here is wrong",
		"about.fix.p1":
			"A wrong verdict or a stale price is worth reporting, and reporting one is not a favour to us. The file is public and so is the fix.",
		"glossary.title": "What the words mean",
		"glossary.eyebrow": "Glossary",
		"glossary.blurb":
			"Sixteen terms this catalogue runs on. Each one is a rule applied the same way to every entry, not a description someone wrote, which is why they are worth reading once.",
		"cats.h1": "Open source {name} alternatives",
		"group.h1": "{label}: open source alternatives",
		"project.h1": "{name}, an open source alternative to {replaces}",
		// The keyword phrase, not the brand slogan. All 592 English product pages
		// headed themselves "Can I replace X?" — nobody's search term — on the
		// strongest element of the pages that earn the traffic. The slogan is
		// still there, one line below.
		"product.h1": "Open source {name} alternatives",
		// The gaps page's own headline. Carries the count because the page is the
		// list, and the number is what makes the title worth clicking.
		"gaps.h1": "{n} paid tools with no open source alternative",
		"faq.heading": "Questions about {product}",
		"faq.q.oss": "Is there an open source alternative to {product}?",
		"faq.a.oss":
			"{n} open source projects are listed on this page, and {free} of them hold nothing back behind a paid tier.",
		"faq.q.selfHost": "Can you self-host a replacement for {product}?",
		"faq.a.selfHost": "{n} of the alternatives here run on your own server.",
		"faq.a.selfHostCompose":
			"{n} of those ship a compose file in the repository root, so starting one is a single command.",
		"faq.a.selfHostManaged":
			"{n} need no server at all: someone else will host them, or they install as a binary.",
		"faq.q.price": "How much does {product} cost?",
		"faq.a.price":
			"{price} a month on the {plan} plan, which is {year} a year. Checked on {date}.",
		"faq.a.priceNone":
			"{product} publishes no price. The vendor asks you to contact sales.",
		"faq.q.lose": "What do you lose by leaving {product}?",
		"glossary.verdicts": "The verdict",
		"glossary.effort": "How much work leaving is",
		"glossary.openness": "How open it really is",
		"glossary.repo": "The state of the repo",
		"glossary.ladderNote":
			"Every one of these is derived from the data rather than authored per entry, so the same question gets the same answer across every product in the catalogue. The collections are the same rules turned into pages:",
		"spec.heading": "Side by side",
		"spec.project": "Project",
		"spec.licence": "Licence",
		"spec.runIt": "Run it",
		"spec.language": "Written in",
		"spec.strings": "Strings attached",
		"spec.noStrings": "none",
		"features.removeColumn": "Remove column",
		"features.addColumn": "Add a column",
		"features.columnLimit": "{n} columns is the most a row stays readable at.",
		"group.alternatives": "alternatives",

		"collection.under-10.title": "Cheap enough that nobody audits it",
		"collection.under-10.blurb":
			"Subscriptions under $10 a month with a drop-in replacement. Individually too small to bother cancelling, which is exactly why they pile up, and leaving costs an install, not a migration.",
		"collection.under-10.derivation":
			"Products priced between $0 and $10 a month whose exit ladder rung is “drop-in”. Both halves are derived: the price from its receipt, the rung from the alternatives themselves.",

		"collection.expensive.title": "The expensive ones",
		"collection.expensive.blurb":
			"Over $100 a month. Where the money actually is, whatever the exit looks like, and where an afternoon spent reading is worth the most per hour.",
		"collection.expensive.derivation":
			"Products whose typical entry-tier price exceeds $100 a month. No judgement about the exit is applied here: some of these are genuinely hard to leave, and the page says so per product.",

		"collection.in-rust.title": "Written in Rust",
		"collection.in-rust.blurb":
			"Projects whose largest body of code is Rust. A shortcut for people who would rather run, patch or contribute to something in a language they already know.",
		"collection.in-rust.derivation":
			"The forge’s own “top language by bytes”, never a guess. Projects with no reading are absent rather than counted as something else.",

		"collection.in-go.title": "Written in Go",
		"collection.in-go.blurb":
			"Projects whose largest body of code is Go, which in practice often means one static binary and no runtime to install first.",
		"collection.in-go.derivation":
			"The forge’s own “top language by bytes”, never a guess. Projects with no reading are absent rather than counted as something else.",

		"collection.in-python.title": "Written in Python",
		"collection.in-python.blurb":
			"Projects whose largest body of code is Python. The easiest to read and change, and the most likely to want an environment managing before it runs.",
		"collection.in-python.derivation":
			"The forge’s own “top language by bytes”, never a guess. Projects with no reading are absent rather than counted as something else.",

		"collection.one-compose.title": "One docker compose away",
		"collection.one-compose.blurb":
			"Projects that ship a compose file in the repo root. Not “this could be self-hosted in principle”. Clone it, one command, it runs. The shortest path from reading this site to leaving a bill behind.",
		"collection.one-compose.derivation":
			"Derived from the repo itself: `bun run health` looks for a compose file in the root of each cited repository. Never authored, so it cannot flatter a project that dropped one.",

		"collection.archived.title": "The graveyard",
		"collection.archived.blurb":
			"Projects that are done. They stay in the catalogue because knowing something died is worth as much as knowing it exists, and because the alternative is a directory that only ever describes the present tense.",
		"collection.archived.derivation":
			"Derived from the archived flag on each entry, with the forge’s own reading taking precedence where it has one. Nothing here is a judgement about quality: plenty of these were good, and several were replaced by forks that are listed elsewhere on this site.",

		"collection.unresolved": "Citations disagree",
		"collection.open-core.unresolvedNote":
			"These projects are cited against several products, and those entries do not agree about this fact. They are left out of the list above rather than counted on a guess, and named here rather than dropped quietly. Each project page shows the split.",
		"collection.source-available.unresolvedNote":
			"These projects are cited against several products, and those entries do not agree about whether the licence is open source at all. Calling a project “not open source” on the strength of whichever citation was read first would be a claim this site cannot support, so they are named here instead. Each project page shows the split.",

		"ads.priceOnRequest": "price on request",
		"ads.notPricedYet": "not priced yet",
		"ads.unpricedNote":
			"hero positions exist but are not priced yet. Get in touch if one interests you.",

		"empty.none": "No match.",
		"empty.submit": "Add it →",
		"error.api": "Something broke on our side. Try again in a minute.",
		"error.noSuchPage": "That page doesn’t exist. Here is the list instead.",
		"list.disclaimer":
			"* Prices are typical entry-tier list prices and drift constantly. Verdicts are opinions, argued in the open. Disagree via Submit.",

		"ads.eyebrow": "Sponsorship",
		"ads.title": "Sponsor this project",
		"ads.blurb":
			"Sponsors keep this site free and independent. Flat price, 30 days, no auction, no tracking pixels. One sponsor per slot.",
		"ads.available": "available",
		"ads.availableCount": "available",
		"ads.taken": "taken",
		"ads.yourProductHere": "Sponsor this project",
		"ads.billingEmail": "Billing email",
		"ads.submit": "Reserve {n} slot",
		"ads.submitPlural": "Reserve {n} slots",
		"ads.done":
			"Reserved. We'll email a payment link, then ask for your logo and tagline.",
		"ads.popupTitle": "Payment received",
		"ads.popupBody":
			"Your ad is now with us for review. We read every one before it goes live. Check your email for updates; most are reviewed within a business day.",
		"ads.popupOk": "Got it",
		"ads.sponsored": "sponsored",
		// "Ad" on a phone, "Sponsored" from sm up. Same disclosure, less room.
		"ads.adShort": "Ad",
		"ads.yourLogoHere": "Sponsor this project",
		"ads.houseLabel": "From the maker",
		"ads.houseBody": "I build things like this one. Available for work.",

		"ads.waitlist": "Nothing open? We'll tell you when a slot frees up.",
		"ads.waitlistCta": "Notify me",
		"ads.openSlot": "Open slot",
		"ads.previewing": "Your preview",
		"ads.railLeft": "Sponsors, left",
		"ads.railRight": "Sponsors, right",
		"ads.tape": "Sponsors",

		// Three slots per order must match ORDER_MAX_SLOTS in packages/core/src/sponsorship.ts.
		"ads.pickRule":
			"Three slots per order: one side panel, one landing page spot, and one category.",
		// The allowance strip's counter, built from ORDER_MAX_SLOTS, see Forms.tsx.
		"ads.chosenCount": "{n} of {max} chosen",
		// Rail and category also have a plural tab form (choosing from many); hero has none since there's only one wall.
		"ads.chipRail": "Side panel",
		"ads.chipHero": "Landing wall",
		"ads.chipCategory": "Category",
		"ads.tabRail": "Side panels",
		"ads.tabCategory": "Categories",
		"ads.tabListLabel": "Slot type",
		"ads.categorySearch": "Search categories…",
		"ads.noCategoryMatches": "No categories match that search.",
		"ads.basket": "Your selection",
		"ads.remove": "Remove",
		"ads.totalFor": "Total for",
		"ads.saving": "You save {amount} against paying monthly.",
		"ads.capSwappedRail":
			"One side panel per order. {label} was removed to make room.",
		"ads.capSwappedLanding":
			"This landing page spot is limited to one per order. {label} was removed to make room.",
		"ads.capSwappedCategory":
			"One category per order. {label} was removed to make room.",

		// The three wizard steps: pick slots, pick a term, write the ad and pay.
		"ads.step1": "Where",
		"ads.step2": "How long",
		"ads.step3": "Your ad",
		"ads.steps": "Sponsorship steps",
		"ads.continue": "Continue",
		"ads.back": "Back",
		"ads.payNow": "Pay {amount}",

		"ads.termHeading": "How long do you want it for?",
		"ads.month": "month",
		"ads.months": "months",
		"ads.paid":
			"Paid {amount} for {slots} slot(s), {months} month(s). Now tell us what to show. It goes on every slot you bought.",
		"ads.submitCreative": "Submit creative",
		"ads.paidReturn":
			"Payment received. Now tell us what to show. It goes on every slot you bought.",
		"ads.paidPending":
			"Your payment went through, but we are still waiting on the confirmation. Nothing is lost. Email us and we will send your creative link.",
		"ads.payFailed": "The payment did not complete. Nothing was charged.",
		"ads.payRateLimited":
			"Too many attempts from this network. Wait a few minutes and try again.",
		"ads.payUnavailable":
			"Checkout is not available right now. No payment provider is configured. Use the waitlist below and we'll come to you.",

		// Wording must not let "not enough data yet" read as "a quiet month". This section is on the page that asks for money.
		"adstats.eyebrow": "Audience",
		"adstats.yoursTitle": "You will see exactly how your ad performs.",
		"adstats.yoursBody":
			"Impressions, clicks and click-through rate for every slot you buy, on your own dashboard, from the very first view. Sign in with the email you paid with. We send a link, there is no password. Site-wide figures are published here once there is enough traffic for them to mean anything.",
		"adstats.measuringSince": "Measuring since",
		"adstats.impressions": "impressions",
		"adstats.clicks": "clicks",
		"adstats.ctr": "click-through rate",
		"adstats.daysWithData": "days measured",
		"adstats.discarded": "{n} events were discarded as bot traffic.",
		"adstats.method":
			"An impression is counted when at least half the unit is on screen for a full second, once per slot per visitor per half hour. Crawlers, prerenders and datacenter networks are excluded.",
		"adstats.bySlot": "By slot",
		"adstats.byPage": "By page",
		"adstats.byCategory": "By category",
		"adstats.slot": "slot",
		"adstats.page": "page",
		"adstats.category": "category",
		"adstats.page.home": "Home",
		"adstats.page.product": "Product pages",
		"adstats.page.category": "Category pages",
		"adstats.page.project": "Project pages",
		"adstats.page.other": "Other",
		"adstats.pinned": "Pinned",

		"submit.eyebrow": "Contribute",
		"submit.title": "Something missing?",
		"submit.blurb":
			"Every product is one JSON file in the repo. There is no form and no account. Open a pull request and it ships on the next deploy.",
		"submit.addProduct": "Add a product",
		"submit.openIssue": "Challenge a verdict",
		"submit.contributing": "How to contribute",
		// TEMPORARY. Remove the "coming soon" half once CI actually runs these.
		"submit.prNote":
			"Every PR is validated by hand for now: the file's shape, that each repo is real, and translation coverage. Automated checks on your PR are coming soon.",

		"form.error": "Failed to send. Try again.",
		"footer.tagline": "A directory of open source alternatives, with verdicts.",
		"footer.policy":
			"No affiliate links. Sponsored slots are labelled and never change a verdict.",
		"footer.licence":
			"The catalogue data is CC-BY-4.0. Quote it, and link the page you took it from — the check dates are what make the answer defensible.",
		"footer.licenceMore": "Licences",
		"footer.browse": "Browse",
		"footer.contribute": "Contribute",
		"footer.about": "About",
		"footer.legal": "Legal",
		"footer.legalAll": "All documents",
		"footer.repo": "The repository",
		"footer.madeWith": "Made with",
		"footer.by": "by",
		"footer.policyMore": "How sponsorship works",
		"theme.toggle": "Toggle theme",
		"theme.light": "light",
		"theme.dark": "dark",
		"a11y.skip": "Skip to content",
		"a11y.results": "{n} results",

		"nav.contact": "Contact",
		"nav.stats": "Stats",

		"sitestats.eyebrow": "Traffic",
		"sitestats.title": "What this site actually gets",
		"sitestats.blurb":
			"Measured on our own server, with analytics we host ourselves. If we are going to tell you to self-host things, we can start with our own numbers.",
		"sitestats.catalogue": "What the catalogue holds",
		"sitestats.catalogueNote":
			"Counted from the catalogue this site is built out of, as it stood when this page was generated. Nothing here is an estimate and nothing is rounded.",
		"sitestats.traffic": "What the site receives",
		"sitestats.pageviews": "Pageviews",
		"sitestats.sessions": "Sessions",
		"sitestats.bestDay": "Best day",
		"sitestats.avgTime": "Avg. session",
		"sitestats.visitors": "Visitors",
		"sitestats.chartPending":
			"Measuring since {date}. A chart needs a few more days.",
		"sitestats.chartPendingNoDate": "Not enough days of data yet for a chart.",
		"sitestats.path": "Path",
		"sitestats.source": "Source",
		"sitestats.direct": "Direct",
		"sitestats.topPages": "Most read",
		"sitestats.sources": "Where readers come from",
		"sitestats.since": "Measuring since",
		"sitestats.method":
			"Counted first-party by a self-hosted Umami on the same box as this site. No third-party analytics, and no cross-site cookie.",
		"sitestats.sessionsNote":
			"“Sessions” are visits, not people: someone who clears their cookies counts twice.",
		"sitestats.noneYet":
			"Nothing counted in this window yet. The figures appear as soon as there is traffic to report.",
		"sitestats.unavailableTitle": "Figures unavailable right now",
		"sitestats.unavailable":
			"The analytics server did not answer. Nothing on this page is estimated or cached from elsewhere, so rather than show you a number we cannot stand behind, we show you none.",

		"nav.signin": "Sign in",
		"creative.yourName": "Your product",
		"creative.yourTagline": "One line about what it does",
		"creative.name": "Product name",
		"creative.namePh": "Umami",
		"creative.tagline": "One line about it",
		"creative.taglinePh": "Privacy-first analytics you host yourself",
		"creative.taglineNote":
			"Shown on the left and right panels, and on category cards. The landing wall is logo and name only.",
		"creative.url": "Where the click goes",
		"creative.icon": "Icon",
		"creative.upload": "Upload an icon",
		"creative.uploading": "Uploading…",
		"creative.removeIcon": "Remove",
		"creative.iconNote": "PNG, JPEG or WebP, up to 512 KB. Square works best.",
		"creative.iconUrlPh": "…or paste a URL you host yourself",
		"creative.logoUrl": "Icon URL",
		"creative.tint": "Card colour",
		"creative.tintReset": "Use the site's colour",
		"creative.tintNote":
			"Tints the border and the sponsored label on your cards. Left alone, they use the site's own accent.",
		"creative.frenchToggle": "Add French copy (optional)",
		"creative.frenchNote":
			"Leave blank and your English copy is shown to every reader. Fill it in and French readers see this instead.",
		"creative.nameFrPh": "Product name, in French",
		"creative.taglineFrPh": "One line, in French",
		"ads.previewTitle": "What these look like",
		"creative.previewTitle": "How it will look",
		"creative.previewNote":
			"Live, at the size each unit actually ships at. Every slot you bought is below.",
		"creative.whereRail":
			"Runs in the left and right panels on desktop, and in the scrolling strip on phones.",
		"creative.whereHero":
			"Runs in the sponsor wall under the headline, on every page of the site.",
		"creative.whereCategory":
			"Runs in the list on its category page, and in the mixed list on the home page.",
		"creative.railNote":
			"This is the only placement with room for your tagline.",
		"creative.heroNote": "No tagline here. The wall is logo and name only.",
		"creative.override": "Use a different ad for this slot",
		"creative.hideOverride": "Use the same ad here",
		"creative.overrideNote":
			"Anything left blank falls back to the creative on the left.",
		"creative.sending": "Sending…",
		"creative.liveNote":
			"Your ad goes live the moment the payment clears. Nothing else to send, and no waiting on us.",
		"creative.reviewNote":
			"Nothing goes live until we've approved it. You can reply to the payment email to change anything.",
		"creative.errTooLarge": "That file is over 512 KB. Try a smaller icon.",
		"creative.errType": "PNG, JPEG or WebP only. SVG isn't accepted.",
		"creative.errUpload": "That upload didn't work. Try again, or paste a URL.",
		"team.eyebrow": "Access",
		"team.title": "Who can see these numbers",
		"team.blurbManage":
			"Anyone you add can read the numbers for every placement on this account. They cannot buy, change or take anything down.",
		"team.blurbRead":
			"You can read the numbers for every placement on this account. Only an owner can add or remove people.",
		"team.payer": "Billed",
		"team.youAre": "You are",
		"team.orgOwner": "Owner",
		"team.orgUser": "Viewer",
		"team.siteAdmin": "Site admin",
		"team.remove": "Remove",
		"team.add": "Add",
		"team.addLabel": "Add someone by email",
		"team.role": "Access",
		"team.note":
			"They get one email with a link that signs them in. An owner can add and remove people; a viewer can only look.",
		"team.errFull": "This account is full. Remove someone first.",
		"team.errSelf": "That address already owns this account.",
		"team.seatsUsed": "{n} of {max} seats used",
		"dash.orgSwitch": "Account",
		"dash.eyebrow": "Advertiser",
		"dash.title": "Your placements",
		"dash.signOut": "Sign out",
		"dash.signedOutTitle": "You're not signed in",
		"dash.signedOutBody":
			"Advertisers sign in with the email they paid with. We'll send a link that works once.",
		"dash.emptyTitle": "No placements on this address yet",
		"dash.emptyBody":
			"Anything you buy with this email shows up here, with its numbers, as soon as it's paid for.",
		"dash.emptyCta": "See what's available",
		"dash.byPlacement": "By placement",
		"dash.slot": "Slot",
		"dash.state": "State",
		"dash.runs": "Term",
		"dash.until": "until",
		"dash.months": "months",
		"dash.method":
			"Counted on our own server, deduplicated per session, and filtered for automated traffic before it reaches this page, the same standard the public rate card is held to.",
		"dash.needCreativeTitle": "One of these is waiting on your creative",
		"dash.needCreativeBody":
			"It's paid for but nothing is running yet. Use the link in the email we sent when the payment landed.",
		"dash.status.paid": "needs creative",
		"dash.status.submitted": "in review",
		"dash.status.live": "live",
		"dash.status.rejected": "rejected",
		"dash.status.refunded": "refunded",
		"dash.noClicksYet":
			"No clicks yet. That's expected before a placement goes live.",
		"dash.noClicksSince": "No clicks yet. Views are counting since {date}.",
		"dash.termProgress": "{elapsed} of {total} days",
		"dash.endsOn": "ends",

		"admin.eyebrow": "Platform",
		"admin.title": "Console",
		"admin.signedOutTitle": "You're not signed in",
		"admin.signedOutBody":
			"This console is behind the same sign-in as the advertiser dashboard. Use the address that is listed as a site admin.",
		"admin.forbiddenTitle": "This address is not a site admin",
		"admin.forbiddenBody":
			"You are signed in, but this account is not on the site admin list, so none of this is available to it.",
		"admin.unconfiguredTitle": "No site admin is configured",
		"admin.unconfiguredBody":
			"SITE_ADMIN is empty on this server, so nobody can review anything. Set it and restart the API.",
		"admin.loadError": "The console could not be loaded.",
		"admin.retry": "Try again",

		"admin.queue.title": "Waiting for review",
		"admin.queue.empty":
			"Nothing is waiting. Every paid creative has been dealt with.",
		"admin.queue.waiting": "waiting {h} h",
		"admin.buyer": "Buyer",
		"admin.paid": "Paid",
		"admin.preview": "What ships if you approve it",
		"admin.previewEn": "English",
		"admin.previewFr": "French",
		"admin.fields": "Every field, as stored",
		"admin.field.name": "Name",
		"admin.field.nameFr": "Name, French",
		"admin.field.tagline": "Tagline",
		"admin.field.taglineFr": "Tagline, French",
		"admin.field.url": "Destination",
		"admin.field.logo": "Logo",
		"admin.field.tint": "Colour",
		"admin.inherited": "empty, French readers are shown the English text",
		"admin.notSet": "not set",
		"admin.defaultTint": "none, the site's own accent is used",
		"admin.timeline": "Timeline",
		"admin.at.created": "Ordered",
		"admin.at.paid": "Paid",
		"admin.at.submitted": "Creative filed",
		"admin.at.starts": "Starts",
		"admin.at.ends": "Ends",
		"admin.approve": "Approve and publish",
		"admin.reject": "Reject and refund",
		"admin.rejectReason": "Why it is being rejected",
		"admin.rejectPlaceholder": "Kept on the order. The buyer is not sent it.",
		"admin.working": "Working…",
		"admin.refundFailed":
			"The refund failed, so nothing was changed. The order is still waiting for review. Check Stripe before trying again.",
		"admin.actionFailed": "That didn't work. Nothing was changed.",
		"admin.approved": "Approved. It is live now.",
		"admin.rejectedDone": "Rejected, and the charge was refunded.",
		"admin.alreadyRefunded":
			"It had already been refunded, so no second refund was made.",

		"admin.campaigns.title": "Campaigns",
		"admin.campaigns.empty": "Nothing has been sold yet.",
		"admin.site": "Site-wide, every campaign",
		"admin.running": "Running",
		"admin.left": "Left",
		"admin.days": "d",
		"admin.compare":
			"The site-wide row is the same figure the public rate card publishes. A campaign is going well or badly relative to that, not to a score we made up.",

		"admin.slots.title": "The board",
		"admin.slots.occupancy": "{taken} of {total} taken",
		"admin.slots.free": "Free",
		"admin.slots.expiring": "ends within a week",
		"admin.slots.price": "Rate",
		"admin.slots.occupant": "Occupant",

		"signin.eyebrow": "Advertiser access",
		"signin.title": "See your placement's numbers",
		"signin.blurb":
			"Use the email you paid with. There is no password. We send a link that signs you in.",
		"signin.emailLabel": "Email address",
		"signin.placeholder": "you@company.com",
		"signin.submit": "Email me a link",
		"signin.sending": "Sending…",
		"signin.sentTitle": "Check your inbox",
		"signin.sentBody":
			"If that address has a placement with us, a sign-in link is on its way. It works once and expires in 15 minutes.",
		"signin.tryAnother": "Use a different address",
		"signin.note":
			"We only ever email you a link. No password to make up, and nothing to forget.",
		"signin.linkDead":
			"That link did not work. It has already been used, or it expired. Ask for a new one below.",
		"signin.doneTitle": "You're signed in",
		"signin.doneBody": "Signed in as {email}.",

		"contact.eyebrow": "Contact",
		"contact.title": "How to reach us",

		"contact.wrong.title": "Something here is wrong",
		"contact.wrong.body":
			"A verdict you disagree with, a price that moved, a project that changed licence or died. This is the most useful thing you can send us, and it is the reason every page carries an edit link: each entry is one JSON file, so a correction is a pull request that CI checks before anyone merges it. No account and no clone needed. The forge edits it in the browser. If you would rather not open a PR, open an issue and say what is wrong and where you read otherwise.",
		"contact.wrong.edit": "Suggest a change",
		"contact.wrong.issue": "Report it as an issue",
		"contact.wrong.contributing": "How to contribute",

		"contact.submit.title": "A product or an alternative is missing",
		"contact.submit.body":
			"Adding an entry has its own page, with the file format and what a good entry has to carry.",

		"contact.sponsor.title": "Sponsorship and advertising",
		"contact.sponsor.body":
			"Every slot, its price and whether it is free right now are on the rate card. Buying is self-service; the billing email you enter there is how we come back to you.",

		"contact.email.title": "Email",
		// Not a fabricated address: shown only until the owner sets CONTACT_EMAIL.
		"contact.email.none":
			"No email address is published yet. The issue tracker above is the channel that works today, and it is public, which is the point: a correction anyone can check beats one only we saw. For anything you cannot say in public, the billing email on a sponsorship order reaches the same person.",
		"contact.email.body":
			"For anything that does not belong in a public issue. Expect a few working days.",

		"contact.privacy.title": "What we do with it",
		"contact.privacy.body":
			"Issues and pull requests are public and hosted by the forge. Nothing on this site sets a third-party cookie or loads a third-party script, and there is no analytics vendor to hand a message to.",
	},
	fr: {
		"nav.list": "La liste",
		"nav.menu": "Menu",
		"features.title": "Ce que ces projets font vraiment",
		"features.blurb":
			"Un vocabulaire fermé de fonctionnalités, renseigné projet par projet depuis sa documentation et son dépôt. Un tiret veut dire que personne n'a vérifié, jamais que la réponse est non.",
		"features.genre": "Genre",
		"features.all": "Tous",
		"features.require": "Exiger une fonctionnalité",
		"features.searchPlaceholder":
			"Chercher : SSO, markdown, hors ligne, webhooks…",
		"features.acceptPaid":
			"Compter les fonctionnalités réservées à une offre payante",
		"features.narrow": "de plus. Affinez avec la recherche.",
		"features.compare": "Comparer",
		"features.pickTwo":
			"Sélectionnez au moins deux projets ci-dessus pour ne voir que ce qui les distingue vraiment.",
		"features.noMatch":
			"Rien ne satisfait toutes les exigences. C'est une vraie réponse, pas une page vide. Retirez-en une, ou acceptez les offres payantes.",
		"features.noDiff":
			"Ces projets ne diffèrent sur rien de ce que nous avons vérifié. C'est utile à savoir. Le choix se joue en général ailleurs que dans le tableau.",
		"features.loading": "Chargement du tableau des fonctionnalités…",
		"features.loadFailed": "Le jeu de données n'a pas pu être chargé.",
		"features.facts": "faits",
		"features.coverage": "projets renseignés",
		"features.legend":
			"Valeurs : ● oui · € offre payante seulement · ◐ partiel · ○ non · – non vérifié",
		"features.onProject": "Ce qu'il fait",
		"features.vsHeading": "Là où ils diffèrent vraiment",
		"features.vsBlurb":
			"Uniquement les fonctionnalités vérifiées des deux côtés, et seulement en cas de désaccord",
		"features.checked": "fonctionnalités vérifiées",
		"features.compareLink": "comparer avec d'autres →",
		"features.compareProduct": "comparer {name} à {n} projets open source",
		"features.compareProject": "comparer {name} aux autres projets open source",
		"features.paidOnly": "payant",
		"features.bothChecked": "Seulement les lignes vérifiées des deux côtés",
		"features.realDiff": "désaccords réels",
		"features.quick": "Filtres rapides",
		"features.quickMcpOfficial": "Serveur MCP officiel",
		"features.quickMcp": "Fournit un serveur MCP",
		"features.quickAi": "Fonctions IA intégrées",
		"features.quickSso": "SSO dans la version libre",
		"features.quickSelfhost": "Fonctionne sur SQLite",
		"features.results": "Projets correspondants",
		"features.matchOne": "projet correspond",
		"features.matchMany": "projets correspondent",
		"features.reqOne": "exigence",
		"features.reqMany": "exigences",
		"features.moreGenres": "Les {n} genres",
		"features.lessGenres": "En voir moins",
		"features.required": "Vos exigences",
		"features.featureCol": "Fonctionnalité",
		"features.diffOne":
			"1 fonctionnalité différente. Les lignes où tout le monde est d'accord, ou que personne n'a vérifiées, sont retirées.",
		"features.diffMany":
			"{n} fonctionnalités différentes. Les lignes où tout le monde est d'accord, ou que personne n'a vérifiées, sont retirées.",
		"features.vocab": "fonctionnalités au vocabulaire",
		"features.val.yes": "Oui",
		"features.val.paid": "Offre payante seulement",
		"features.val.partial": "Partiel",
		"features.val.no": "Non",
		"features.val.unknown": "Non vérifié",
		"nav.features": "Fonctionnalités",
		"nav.sponsor": "Sponsoriser",
		"nav.submit": "Proposer",

		"hero.title": "Puis-je remplacer",
		"hero.blurb":
			"Chaque abonnement SaaS, un verdict honnête. Pas « voici 40 alternatives », mais si l’option open source tient la route, et ce que coûte la migration.",
		"hero.searchPlaceholder":
			"Chercher parmi {n} produits : Jira, Figma, Datadog…",

		"stats.products": "produits évalués",
		"stats.alternatives": "alternatives open source",
		"stats.noAnswer": "on dit de laisser tomber",
		"stats.switches": "migrations déclarées",
		"stats.switchesOne": "migration déclarée",
		"stats.switchesNone": "soyez le premier à déclarer une migration",

		"filter.allCategories": "Toutes les catégories",
		"filter.anyVerdict": "Tous les verdicts",
		"filter.sortVotes": "Les plus remplacés",
		"filter.sortPrice": "Les plus chers",
		"filter.sortName": "A à Z",

		"verdict.yes": "Remplaçable",
		"verdict.almost": "Presque",
		"verdict.not-yet": "Pas encore",

		"effort.managed": "offre hébergée disponible",
		"effort.docker": "un docker compose",
		"effort.ops": "du vrai travail d’ops",

		"row.alternatives": "alternatives",
		"row.switched": "J’ai migré",
		"row.switchedDone": "Compté, merci",
		"row.perMonth": "/mois",
		"row.allArchived": "toutes les alternatives sont archivées",
		"row.free": "offre gratuite",
		"row.whatYouLose": "Ce que vous perdez",
		"row.quoteOnly": "sur devis",
		"row.once": "en une fois",

		"price.heading": "Prix",
		"price.plan": "Formule",
		"price.basisLabel": "Base",
		"price.checked": "Vérifié",
		"price.confidenceLabel": "Confiance",
		"price.source": "Source",
		"price.takenFrom": "prix relevé sur",
		"price.on": "le",

		"ladder.title": "Votre échelle de sortie",
		"ladder.here": "Vous êtes ici",
		"ladder.cheaper": "Moins cher, toujours payant",
		"ladder.oss": "Open source, le moins d’effort d’abord",
		"ladder.save": "économisez",
		"ladder.perYear": "/an",
		"price.basis.flat": "forfait",
		"price.basis.per-seat": "par utilisateur",
		"price.basis.usage": "à l’usage",
		"price.basis.one-time": "licence perpétuelle",
		"price.basis.custom": "sur devis",
		"price.confidence.high": "confirmé",
		"price.confidence.medium": "d’après la doc, pas la page tarifs",
		"price.confidence.low": "non confirmé",
		"price.confidence.lowNote":
			"Nous n’avons pas pu confirmer ce montant sur la page de l’éditeur. À prendre comme un ordre de grandeur, pas comme un devis.",
		"price.noPublic": "Aucun prix public",
		"price.noPublicNote":
			"Nous avons regardé : cet éditeur n’affiche rien d’autre que « contactez-nous ».",
		"price.unverified": "Prix non vérifié",
		"price.unverifiedNote":
			"Personne ne l’a encore vérifié. Nous n’allons pas inventer un chiffre.",

		"repo.dormant": "aucun commit depuis",
		"repo.compose": "docker compose dans le dépôt",
		"repo.composeShort": "compose",
		"repo.at": "sur",
		"repo.forgeOther": "une autre forge",
		"repo.archived": "Archivé",
		"alt.showAll": "Afficher les {n}",
		"alt.filterAll": "Toutes",
		"alt.filterNoServer": "Sans serveur",
		"alt.filterNoStrings": "Sans réserve",
		"escape.live": "alternatives vivantes",
		"escape.easiest": "le moins de travail",
		"escape.noServer": "sans serveur",
		"escape.noStrings": "ne réservent rien",
		"alt.archivedHeading": "Archivés, {n} conservés pour mémoire",
		"alt.archivedBlurb":
			"Ces projets sont terminés. Ils figurent ici parce que savoir qu’un projet est mort vaut autant que savoir qu’il existe, pas parce que nous les recommandons.",
		"repo.archivedNote":
			"Les mainteneurs ont arrêté. La forge le passe en lecture seule. C’est une impasse, pas une option.",
		"repo.language": "écrit en",

		"alt.ossHeading": "Open source",
		"alt.cheaperHeading": "Moins cher, toujours payant",
		"alt.cheaper": "payant, moins cher",
		"alt.website": "site web",

		"facts.selfHost": "auto-hébergeable",
		"facts.noSelfHost": "non auto-hébergeable",
		"facts.openCore": "open core",
		"facts.sso": "SSO inclus",
		"facts.ssoPaid": "SSO payant",
		"facts.ssoUnknown": "SSO non vérifié",
		"facts.residency.self": "votre serveur",
		"facts.residency.eu-option": "région UE",
		"facts.residency.us-only": "États-Unis",
		"facts.residency.unknown": "hébergement non vérifié",

		"facts.openCore.none": "entièrement ouvert",
		"facts.openCore.minor": "presque tout ouvert",
		"facts.openCore.major": "open core",
		"facts.openCore.noneNote":
			"La version que vous pouvez héberger vous-même, c’est le produit entier. Rien n’est réservé à une offre payante.",
		"facts.openCore.minorNote":
			"La version auto-hébergée, c’est le produit, moins quelques commodités « entreprise » vendues à part.",
		"facts.openCore.majorNote":
			"La version gratuite est une démo. La moitié qui justifie la migration est vendue, pas auto-hébergeable.",
		"facts.paywalledLabel": "Payant uniquement",
		"facts.paywalledVaries":
			"Une partie est réservée au payant, mais les produits qui citent ce projet n’en décrivent pas la même. Voir ce qu’il remplace, ci-dessous.",
		"facts.heading": "Ce que vous obtenez vraiment",

		"facts.varies.selfHost": "auto-hébergement : selon le produit",
		"facts.varies.openCore": "open core : selon le produit",
		"facts.varies.sso": "SSO : selon le produit",
		"facts.varies.residency": "hébergement : selon le produit",
		"facts.variesNote":
			"Ces informations sont rédigées produit par produit, et les fiches qui citent ce projet ne concordent pas ici. Reportez-vous à la page produit d’où vous venez.",

		"nav.categories": "Catégories",
		"nav.glossary": "Glossaire",

		"rung.locked-in": "verrouillé",
		"rung.partial": "sortie partielle",
		"rung.self-hostable": "auto-hébergeable",
		"rung.drop-in": "remplacement direct",

		"cats.all": "Toutes les catégories",
		"cats.browse": "Parcourir les catégories",
		"products.browse": "Parcourir les produits",
		"products.title": "Tous les produits suivis",
		"products.blurb":
			"Les {n} produits payants du catalogue, classés par catégorie. Chacun a une page qui dit ce qui le remplace, ce que ça coûte et ce qu’on y perd.",
		"products.inCategory": "produits dans cette catégorie",
		"cats.title": "Toutes les catégories",
		"cats.blurb":
			"Regroupées par thème, et à l’intérieur de chaque thème classées par nombre de produits payants évalués, pas selon l’idée qu’un éditeur se fait de leur importance. La barre montre l’échelle de sortie : jusqu’où on peut réellement s’échapper d’une catégorie.",
		"cats.ladder": "Échelle de sortie",
		"cats.projects": "projets open source",
		"cats.medianPrice": "prix médian",
		"cats.noMedian": "aucun prix publié",
		"cats.medianOver": "médiane sur",
		"cats.cheapest": "la sortie la plus simple",
		"cats.noEscape": "rien de totalement ouvert",
		"cats.nearby": "Catégories voisines",
		"cats.inThis": "Dans cette catégorie",
		"product.related": "Autres produits dans {category}",
		"product.inCollections": "Ce produit figure aussi dans",
		"project.inCategories": "Remplace des produits dans",
		"project.inCollections": "Ce projet figure aussi dans",
		"project.repo": "Le dépôt",
		"project.licence": "Licence",
		"project.writtenIn": "Écrit en",
		"project.lastCommit": "Dernier commit",
		"project.composeLabel": "Docker Compose",
		"project.composeYes": "un fichier compose est à la racine du dépôt",
		"project.composeNo": "pas de fichier compose à la racine du dépôt",
		"cats.smallNote":
			"L’un des plus petits recoins du catalogue. Les catégories voisines ci-dessous couvrent un terrain proche.",

		"catGroup.work": "Travail et collaboration",
		"catGroup.dev": "Développement logiciel",
		"catGroup.infra": "Infrastructure et hébergement",
		"catGroup.security": "Sécurité et accès",
		"catGroup.ai-data": "IA, données et recherche",
		"catGroup.growth": "Marketing et ventes",
		"catGroup.commerce": "Commerce et logistique",
		"catGroup.operations": "Gestion d’entreprise",
		"catGroup.creative": "Création et médias",
		"catGroup.home": "Maison et usage personnel",
		"cats.themes": "Aller à un thème",
		"cats.inGroup": "catégories",

		"edit.blurb":
			"Cette page est un fichier JSON du dépôt. Une erreur, une info périmée ? Modifiez-le et ouvrez une pull request. La CI le valide avant toute fusion.",
		"edit.derivedBlurb":
			"Cette page est dérivée des fichiers produit qui citent ce projet : aucun fichier unique ne la porte. Corrigez-la là où elle est écrite.",
		"edit.suggest": "Proposer une correction",
		"edit.browseFiles": "Parcourir les fichiers produit",

		"page.home": "Tous les produits",
		"page.categories": "Toutes les catégories",
		"page.products": "Index des produits",
		"page.replaces": "Remplace",
		"page.notFound": "Rien ici.",
		"page.loading": "Chargement…",

		"ui.language": "Langue",

		"nav.products": "Produits",
		"nav.projects": "Alternatives",
		"nav.collections": "Collections",

		"hero.sponsorsIntro": "canireplaceit est soutenu par ces sponsors.",
		"hero.sponsorsCta": "Soutenir ce projet →",

		"home.pagedTitle": "Tous les produits évalués, page {n}",
		"page.headingSuffix": ", page {n}",
		"collection.pagedTitle": "{name} — page {page} du catalogue open source",

		"page.pagination": "Pagination",
		"page.allPages": "Les {n} pages",
		"page.previous": "Précédent",
		"page.next": "Suivant",
		"page.pageOf": "Page {n} sur {of}",
		"page.projects": "Projets open source",
		"page.collections": "Collections",

		"filter.category": "Catégorie",
		"filter.verdict": "Verdict",
		"filter.sort": "Ordre",
		"filter.sortWeight": "Notre ordre",
		"filter.effort": "Charge de travail",
		"filter.anyEffort": "Peu importe l’effort",
		"filter.openness": "Degré d’ouverture",
		"filter.anyOpenness": "Peu importe l’ouverture",
		"filter.price": "Prix",
		"filter.anyPrice": "Peu importe le prix",
		"filter.clear": "Effacer les filtres",
		"filter.filteredNote": "vue filtrée, ce n’est pas une page à part",
		"filter.hiddenPrefix": "Non affichés, faute de chiffre comparable :",
		"filter.hiddenNoPublic": "sans prix public",
		"filter.hiddenUnchecked": "que personne n’a encore vérifiés",

		"filter.open": "Filtres",
		"filter.close": "Fermer",
		"filter.verdictAll": "Tous",
		"filter.categorySearch": "Rechercher une catégorie…",
		"filter.show": "Afficher {n} produit",
		"filter.showPlural": "Afficher {n} produits",

		"openness.hosted-only": "hébergé chez eux",
		"openness.source-available": "source disponible",
		"openness.open-core": "open core",
		"openness.mostly-open": "presque tout ouvert",
		"openness.fully-open": "entièrement ouvert",
		"openness.atLeast.fully-open": "Entièrement ouvert uniquement",
		"openness.atLeast.mostly-open": "Presque tout ouvert ou mieux",
		"openness.atLeast.open-core": "Open core ou mieux",
		"openness.atLeast.source-available": "Source disponible ou mieux",
		"openness.atLeast.hosted-only": "Tout, y compris hébergé chez eux",

		"effort.atMost.managed": "Une offre hébergée existe",
		"effort.atMost.docker": "Un docker compose ou plus simple",

		"price.band.free": "Offre gratuite",
		"price.band.under-25": "Moins de 25 $/mois",
		"price.band.25-100": "25 à 100 $/mois",
		"price.band.over-100": "Plus de 100 $/mois",
		"price.band.no-public": "Aucun prix public",
		"price.band.unchecked": "Prix non vérifié",

		"projects.title": "Tous les projets open source",
		"projects.blurb":
			"Les 871, avec ce que chacun remplace, sa licence, l’effort qu’il demande et l’activité de son dépôt. La plupart ne remplacent qu’un seul produit : cette page est la seule qui les liste.",
		"projects.searchPlaceholder":
			"Rechercher un projet : Nextcloud, Plausible…",
		"projects.unit": "projets",

		"collections.title": "Collections",
		"collections.blurb":
			"Des coupes transversales du catalogue, chacune étant une requête et non une liste tenue à la main. Rien n’est sélectionné manuellement, donc rien ne peut vieillir en silence.",
		"collections.rejectedNote":
			"« Open source » et « FOSS » sont volontairement les deux plus grandes : {open} projets sur {all} portent une licence open source reconnue, et {foss} d’entre eux ne réservent rien. C’est l’écart entre les deux qui compte. Il n’y a pas de collection « libre et auto-hébergeable » distincte : ne rien réserver implique déjà que vous pouvez l’exécuter, elle listerait donc deux fois les mêmes {foss} projets. Tous les projets, dans tous les états, sont sur",
		"collections.all": "Toutes les collections",

		"collection.self-hostable.title": "Auto-hébergeable",
		"collection.self-hostable.blurb":
			"Les produits pour lesquels un remplaçant open source crédible existe, à condition de l’héberger vous-même. Une vraie sortie, avec un serveur au bout.",
		"collection.self-hostable.derivation":
			"Dérivé de l’échelle de sortie : le verdict est « remplaçable », au moins une alternative est réellement auto-hébergeable, et aucune ne propose d’offre hébergée. Partir, c’est donc l’exploiter soi-même.",

		"collection.open-source.title": "Open source",
		"collection.open-source.blurb":
			"Les projets dont le code source est public sous une licence open source reconnue, et que vous pouvez compiler et exécuter. L’acception large : vendre une édition entreprise à côté d’un cœur ouvert n’exclut personne d’ici.",
		"collection.open-source.derivation":
			"Dérivé de la licence indiquée sur chaque citation, confrontée aux familles de licences approuvées par l’OSI : MIT, Apache-2.0, les GPL, MPL, les BSD et les autres. Les licences qui publient le code sans être open source en sont exclues, et ont leur propre collection.",
		"collection.open-source.unresolvedNote":
			"Ces projets sont cités face à plusieurs produits, et ces entrées ne s’accordent pas sur le fait même que la licence soit open source. Plutôt que de trancher avec la première citation lue, ils sont nommés ici. Chaque fiche projet détaille le désaccord.",

		"collection.foss.title": "FOSS",
		"collection.foss.blurb":
			"L’acception stricte. Une licence open source sans contrepartie et sans rien de réservé : pas de Commons Clause, pas de BSL, pas d’édition entreprise vendue à côté de la version gratuite. Ce que vous hébergez, c’est le produit entier.",
		"collection.foss.derivation":
			"Deux conditions, toutes deux dérivées : la licence est une licence OSI reconnue, et facts.openCore vaut « none » sur chaque produit qui cite le projet. L’auto-hébergement n’est pas une troisième condition. Dans ce catalogue, « rien de réservé » implique déjà que vous pouvez l’exécuter, l’ajouter ne changerait donc rien à la liste.",
		"collection.foss.unresolvedNote":
			"Ces projets sont cités face à plusieurs produits, et ces entrées ne s’accordent ni sur la licence ni sur ce qui est réservé. « Libre, sans contrepartie » est une affirmation forte : elle exige un consensus, donc ces projets sont nommés ici plutôt que comptés au jugé. Chaque fiche projet détaille le désaccord.",

		"collection.open-core.title": "Open core",
		"collection.open-core.blurb":
			"Les projets open source dont la version que vous pouvez exécuter n’est pas le produit complet. Souvent utiles, parfois le bon choix, mais ce n’est pas la même promesse.",
		"collection.open-core.derivation":
			"Dérivé de facts.openCore sur chaque produit qui cite le projet. Un projet n’y figure que si toutes ses citations s’accordent à dire qu’une partie est réservée au payant.",

		// Court volontairement : ce libellé sert de H1, de fil d'Ariane et de ligne de menu déroulant.
		"collection.source-available.title": "Source ouverte, pas libre",
		"collection.source-available.blurb":
			"Du code publié qui n’est pas open source. Vous pouvez le lire et le plus souvent l’exécuter, mais la licence n’est pas une licence OSI, ce que vous avez le droit d’en faire est restreint comme aucune des deux collections ci-dessus ne le restreint.",
		"collection.source-available.derivation":
			"Dérivé de la licence indiquée sur chaque citation, confrontée à une liste fermée de licences nommées qui publient le code sans être libres : BSL/BUSL, SSPL, Elastic, FSL, Commons Clause, Sustainable Use et les CLUF éditeurs. Une édition entreprise à côté d’un cœur sous licence OSI n’en fait pas partie : c’est de l’open core, qui a sa propre collection.",

		"collection.cheaper.title": "Moins cher, mais payant",
		"collection.cheaper.blurb":
			"Les produits qui ont une alternative commerciale réellement moins chère. Pour quand l’auto-hébergement n’est pas la réponse, mais la facture l’est.",
		"collection.cheaper.derivation":
			"Dérivé des alternatives elles-mêmes : chaque produit ici liste au moins une entrée « moins cher », que la validation oblige à coûter moins que le produit remplacé.",

		"catGroupBlurb.work":
			"Le travail au quotidien : documents, tâches, réunions et les outils où vit une équipe.",
		"catGroupBlurb.dev":
			"Construire et livrer du logiciel : éditeurs, CI, registres, la pile du développeur.",
		"catGroupBlurb.infra":
			"Les machines en dessous : serveurs, réseaux, stockage, et ce qui les surveille.",
		"catGroupBlurb.security":
			"Mots de passe, secrets, identité et tout ce qui tient les autres à l’écart.",
		"catGroupBlurb.ai-data":
			"Modèles, pipelines et les endroits où les données finissent.",
		"catGroupBlurb.growth":
			"Trouver une audience et mesurer si tout cela a servi.",
		"catGroupBlurb.commerce": "Vendre, et se faire payer.",
		"catGroupBlurb.operations":
			"Faire tourner l’entreprise : personnes, argent, planning, support.",
		"catGroupBlurb.creative":
			"Faire des images, de la vidéo, de la musique et de la 3D.",
		"catGroupBlurb.home":
			"Logiciels personnels et domestiques, sur votre propre matériel quand c’est possible.",
		"group.allProducts": "Tout dans ce thème",
		"projects.mostReplacing": "Remplacent le plus",
		"lede.yes":
			"Vous pouvez remplacer {product} : {best} fait le même travail sous {licence}.",
		"lede.almost":
			"Vous pouvez presque remplacer {product} : {best} en couvre l’essentiel sous {licence}.",
		"lede.notYet":
			"Vous ne pouvez pas encore remplacer {product}. Rien d’open source ne couvre le travail.",
		"lede.butLose": "Ce que vous perdez : {lose}.",
		"def.verdict.yes":
			"Couvre le cas d’usage réaliste. Partir coûte une installation, pas une migration.",
		"def.verdict.almost":
			"Couvre une partie du travail. Vous perdez quelque chose de réel. La fiche dit quoi.",
		"def.verdict.not-yet":
			"Rien de crédible ne remplace encore ceci. Listé pour que vous sachiez que la réponse est non.",
		"def.effort.managed":
			"Quelqu’un peut l’héberger pour vous, ou c’est un binaire qu’il suffit d’installer.",
		"def.effort.docker":
			"Le dépôt fournit un fichier compose : une commande et ça tourne.",
		"def.effort.ops":
			"Vous exploitez un serveur. Sauvegardes, mises à jour et disponibilité deviennent les vôtres.",
		"def.facts.openCore.none":
			"La version que vous pouvez exécuter est le produit entier. Rien n’est réservé.",
		"def.facts.openCore.minor":
			"Licence open source, avec quelques commodités entreprise vendues à côté.",
		"def.facts.openCore.major":
			"Licence open source, mais la version gratuite est une démo du produit.",
		"def.facts.selfHost":
			"Vous pouvez l’exécuter sur votre machine ou votre serveur.",
		"def.facts.noSelfHost":
			"Vous ne pouvez pas l’exécuter vous-même, quoi que dise la licence.",
		"def.facts.ssoPaid":
			"L’authentification unique n’est pas dans la version gratuite.",
		"def.facts.sso":
			"L’authentification unique fonctionne dans la version gratuite.",
		"def.repo.archived":
			"Dépôt archivé. En lecture seule, terminé. Conservé ici parce que savoir qu’une chose est morte vaut autant que savoir qu’elle existe.",
		"def.repo.dormant":
			"Aucun commit depuis plus d’un an. Pas mort, mais personne n’y travaille.",
		"def.repo.compose": "Fournit un fichier compose à la racine du dépôt.",
		"gaps.unsureHeading": "Les affirmations dont nous sommes le moins sûrs",
		"gaps.unsureBlurb":
			"Des prix que nous n’avons pas pu confirmer sur la page de l’éditeur. Listés plutôt que cachés : un chiffre invérifiable vaut moins qu’un chiffre qu’on vous dit de mettre en doute.",
		"gaps.uncheckedNote":
			"{n} produits supplémentaires n’ont aucun prix au dossier. Personne n’a encore vérifié, ce qui n’est pas « gratuit », et le catalogue ne l’affiche jamais ainsi.",
		"defaults.heading": "Les outils par défaut, et ce qui les remplace",
		"defaults.blurb":
			"Ceux-ci sont livrés avec le système : il n’est donc pas question d’argent. La question est de savoir si un outil plus récent vaut l’installation, et ce que vous perdez la prochaine fois que vous serez sur une machine qui n’a que l’original.",
		"defaults.tool": "Par défaut",
		"defaults.replacement": "Remplaçant",
		"defaults.costs": "Ce que ça coûte",
		"cover.heading": "Remplacer le plus avec le moins",
		"cover.blurb":
			"{n} projets remplacent à eux seuls {covered} des {total} produits de ce catalogue. Chaque ligne n’est pas le projet suivant par la taille : c’est celui qui couvre le plus de ce que les lignes du dessus ne couvrent pas.",
		"cover.more": "de plus",
		"archived.recent": "Arrêtés le plus récemment",
		"archived.recentNote":
			"La date est celle du dernier commit sur le dépôt, ce qui est ce qu’une forge donne de plus proche du moment où le travail s’est arrêté.",
		"siblings.sameJob": "D’autres qui font ce travail",
		"siblings.sameLanguage": "Également écrits en {lang}",
		"gaps.title": "Ce que rien ne remplace encore",
		"gaps.eyebrow": "Les manques",
		"gaps.link": "Les produits que rien d’open source ne remplace encore",
		"gaps.blurb":
			"Les produits payants de ce catalogue sans remplaçant open source crédible, et ce que chacun retient précisément. Publié parce qu’un annuaire qui ne liste que ses succès est une publicité.",
		"gaps.counts":
			"{paid} produits payants, et {free} outils gratuits listés à part",
		"gaps.paidHeading": "Les produits payants que rien ne remplace",
		"gaps.freeHeading": "Les outils gratuits que rien ne remplace",
		"gaps.freeBlurb":
			"Ceux-ci ne coûtent rien, et la plupart sont eux-mêmes open source. Ce ne sont pas des manques de l’open source : c’est de l’open source sans deuxième implémentation derrière, ce qui fait de chacun un point de dépendance unique pour toute une industrie.",
		"gaps.footnote":
			"Chaque ligne est un verdict « pas encore », c’est-à-dire un jugement sur aujourd’hui, pas une prédiction. Dès qu’un remplaçant apparaît, le produit quitte cette page, d’où l’intérêt de la dériver plutôt que de l’écrire à la main.",
		"about.title": "À propos",
		"about.eyebrow": "À propos",
		"about.h1": "Qui écrit ces verdicts, et comment",
		"about.blurb":
			"Une seule personne, un dépôt public, et une règle appliquée de la même façon à chaque entrée. Cette page dit qui, comment un verdict est décidé, comment un tarif est vérifié, et ce que l’argent n’achète pas ici.",
		"about.who.h": "Qui tient ce site",
		"about.who.p1":
			"canireplaceit est écrit et maintenu par une seule personne, qui publie sous le nom @hadesdevs. Ce n’est pas une société avec une équipe de recherche derrière, et prétendre le contraire serait la première chose fausse du site. L’identité réelle de l’éditeur, sa forme juridique et son adresse figurent sur les mentions légales, parce qu’un site qui vend du sponsoring est tenu de les publier et parce que vous devez pouvoir savoir qui vous conseille de résilier un abonnement.",
		"about.who.p2":
			"Le catalogue n’est pas une base de données gardée en privé. Chaque produit du site est un fichier JSON dans un dépôt public, et chaque page renvoie directement au fichier dont elle est issue. Si un verdict est faux, vous pouvez lire exactement ce sur quoi il repose, le corriger et ouvrir une pull request ; la CI valide la modification avant toute fusion.",
		"about.verdict.h": "Comment un verdict est décidé",
		"about.verdict.p1":
			"Il y a trois verdicts, et seulement trois. Remplaçable veut dire qu’un projet open source couvre le cas d’usage réaliste : partir coûte une installation, pas une migration. Presque veut dire qu’il couvre une partie du travail et que vous perdez quelque chose de réel, et la page dit quoi. Pas encore veut dire que rien de crédible ne remplace le produit, et l’entrée reste sur le site pour que la réponse soit consignée.",
		"about.verdict.p2":
			"Un verdict porte sur la remplaçabilité d’un produit, pas sur sa qualité. C’est pourquoi rien ici ne porte de note en étoiles. Une échelle de remplaçabilité à trois points n’est pas une note de qualité, et convertir l’une en l’autre reviendrait à publier un chiffre que personne n’a mesuré.",
		"about.verdict.p3":
			"Les faits sur lesquels repose un verdict sont des champs structurés plutôt que de la prose, pour que la même question reçoive la même réponse sur chaque entrée : la licence, la possibilité réelle d’héberger le logiciel soi-même, la part du produit réservée à une offre payante, le surcoût éventuel du SSO, et l’endroit où les données ont le droit de résider. Chacun de ces termes est défini une fois, et la définition est publique.",
		"about.price.h": "Comment les tarifs sont relevés, puis revérifiés",
		"about.price.p1":
			"Un tarif sans date est une rumeur. Chaque chiffre du site porte son reçu : la formule sur laquelle il a été lu, la page de l’éditeur où il a été lu, le jour où il a été lu, et le degré de confiance dans le relevé. Un tarif que nous n’avons pas pu confirmer sur la page tarifaire de l’éditeur le dit, au lieu de se faire passer pour confirmé, et un produit que personne n’a encore relevé le dit aussi plutôt que d’afficher un chiffre plausible.",
		"about.price.p2":
			"Les tarifs bougent, et un tarif périmé est le moyen le plus rapide de rendre un catalogue comme celui-ci inutile. Les chiffres sont repris par passes plutôt qu’en continu, la date affichée est toujours celle du dernier relevé réel, et les entrées dont nous sommes le moins sûrs sont listées en public plutôt que laissées vieillir en silence.",
		"about.gaps.h": "Pourquoi il existe une page sur ce que rien ne remplace",
		"about.gaps.p1":
			"Un annuaire qui ne liste que ses succès est une publicité. La page des manques rassemble tous les produits du catalogue où notre propre thèse échoue : des outils payants sans remplaçant open source crédible, et ce que chacun retient précisément. Une seconde liste, sur la même page, réunit les outils gratuits que rien ne remplace non plus : ceux-là ne sont pas un manque de l’open source, c’est de l’open source sans rien derrière. Les deux sont dérivées des verdicts plutôt qu’écrites à la main, donc un produit quitte la page le jour où un remplaçant apparaît.",
		"about.money.h": "Comment le site est financé, et ce que cela n’achète pas",
		"about.money.p1":
			"Les emplacements de sponsoring sont des placements payants et chacun est signalé comme tel, où qu’il apparaisse. Si un emplacement n’est pas signalé, c’est qu’il n’est pas payé.",
		"about.money.p2":
			"Les verdicts, les classements, l’ordre des listes, l’entrée au catalogue et la sortie du catalogue ne sont jamais payés. Aucun sponsor ne voit un verdict avant publication, et aucun n’a jamais obtenu de droit de regard sur un verdict.",
		"about.money.p3":
			"Qu’un sponsor reçoive un mauvais verdict sur ce site est une situation normale, pas un incident.",
		"about.money.p4":
			"Il n’y a aucun lien affilié sur ce site. Si cela change, les liens rémunérés seront signalés au niveau du lien et pas seulement sur une page comme celle-ci, et le changement sera consigné sur la page de transparence.",
		"about.fix.h": "Si quelque chose est faux ici",
		"about.fix.p1":
			"Un verdict erroné ou un tarif périmé mérite d’être signalé, et le signaler ne nous rend pas service. Le fichier est public, et le correctif aussi.",
		"glossary.title": "Ce que les mots veulent dire",
		"glossary.eyebrow": "Glossaire",
		"glossary.blurb":
			"Seize termes sur lesquels repose ce catalogue. Chacun est une règle appliquée de la même façon à chaque entrée, pas une description écrite au cas par cas, d’où l’intérêt de les lire une fois.",
		"cats.h1": "Alternatives open source {name}",
		"group.h1": "{label} : alternatives open source",
		"project.h1": "{name}, une alternative open source à {replaces}",
		"product.h1": "Alternatives open source à {name}",
		"gaps.h1": "{n} outils payants sans alternative open source",
		"faq.heading": "Questions sur {product}",
		"faq.q.oss": "Existe-t-il une alternative open source à {product} ?",
		"faq.a.oss":
			"{n} projets open source sont listés sur cette page, dont {free} ne réservent rien à une offre payante.",
		"faq.q.selfHost": "Peut-on auto-héberger un remplaçant de {product} ?",
		"faq.a.selfHost":
			"{n} des alternatives présentées ici tournent sur votre propre serveur.",
		"faq.a.selfHostCompose":
			"{n} d’entre elles livrent un fichier compose à la racine du dépôt : une seule commande suffit à les démarrer.",
		"faq.a.selfHostManaged":
			"{n} ne demandent aucun serveur : quelqu’un les héberge pour vous, ou elles s’installent comme un binaire.",
		"faq.q.price": "Combien coûte {product} ?",
		"faq.a.price":
			"{price} par mois sur la formule {plan}, soit {year} par an. Relevé le {date}.",
		"faq.a.priceNone":
			"{product} ne publie aucun tarif. L’éditeur renvoie vers son service commercial.",
		"faq.q.lose": "Que perdez-vous en quittant {product} ?",
		"glossary.verdicts": "Le verdict",
		"glossary.effort": "Ce que partir demande",
		"glossary.openness": "À quel point c’est vraiment ouvert",
		"glossary.repo": "L’état du dépôt",
		"glossary.ladderNote":
			"Chacun de ces termes est dérivé des données plutôt que saisi entrée par entrée : la même question reçoit donc la même réponse sur tous les produits du catalogue. Les collections sont ces mêmes règles transformées en pages :",
		"spec.heading": "Côte à côte",
		"spec.project": "Projet",
		"spec.licence": "Licence",
		"spec.runIt": "L’exécuter",
		"spec.language": "Écrit en",
		"spec.strings": "Réserves",
		"spec.noStrings": "aucune",
		"features.removeColumn": "Retirer la colonne",
		"features.addColumn": "Ajouter une colonne",
		"features.columnLimit":
			"{n} colonnes : au-delà, une ligne devient illisible.",
		"group.alternatives": "alternatives",

		"collection.under-10.title": "Trop peu cher pour qu’on y regarde",
		"collection.under-10.blurb":
			"Abonnements à moins de 10 $ par mois avec un remplaçant immédiat. Chacun trop petit pour qu’on pense à le résilier, et c’est précisément pour ça qu’ils s’accumulent. Partir coûte une installation, pas une migration.",
		"collection.under-10.derivation":
			"Produits facturés entre 0 et 10 $ par mois dont l’échelon de sortie est « immédiat ». Les deux moitiés sont dérivées : le prix de son justificatif, l’échelon des alternatives elles-mêmes.",

		"collection.expensive.title": "Les gros montants",
		"collection.expensive.blurb":
			"Plus de 100 $ par mois. Là où l’argent se trouve vraiment, quelle que soit la difficulté de sortie, et là où une après-midi de lecture rapporte le plus à l’heure.",
		"collection.expensive.derivation":
			"Produits dont le tarif d’entrée dépasse 100 $ par mois. Aucun jugement sur la sortie n’est appliqué ici : certains sont réellement difficiles à quitter, et chaque fiche le dit.",

		"collection.in-rust.title": "Écrits en Rust",
		"collection.in-rust.blurb":
			"Projets dont le plus gros du code est en Rust. Un raccourci pour qui préfère exécuter, corriger ou contribuer dans un langage qu’il connaît déjà.",
		"collection.in-rust.derivation":
			"Le « langage principal en octets » de la forge, jamais une supposition. Les projets sans relevé sont absents plutôt que comptés ailleurs.",

		"collection.in-go.title": "Écrits en Go",
		"collection.in-go.blurb":
			"Projets dont le plus gros du code est en Go, ce qui signifie souvent un binaire statique et aucun runtime à installer d’abord.",
		"collection.in-go.derivation":
			"Le « langage principal en octets » de la forge, jamais une supposition. Les projets sans relevé sont absents plutôt que comptés ailleurs.",

		"collection.in-python.title": "Écrits en Python",
		"collection.in-python.blurb":
			"Projets dont le plus gros du code est en Python. Les plus faciles à lire et à modifier, et les plus susceptibles de demander un environnement avant de démarrer.",
		"collection.in-python.derivation":
			"Le « langage principal en octets » de la forge, jamais une supposition. Les projets sans relevé sont absents plutôt que comptés ailleurs.",

		"collection.one-compose.title": "À un docker compose près",
		"collection.one-compose.blurb":
			"Projets qui livrent un fichier compose à la racine du dépôt. Pas « auto-hébergeable en théorie » : vous clonez, une commande, ça tourne. Le chemin le plus court entre lire ce site et abandonner une facture.",
		"collection.one-compose.derivation":
			"Dérivé du dépôt lui-même : `bun run health` cherche un fichier compose à la racine de chaque dépôt cité. Jamais saisi à la main, donc impossible de flatter un projet qui n’en a plus.",

		"collection.archived.title": "Le cimetière",
		"collection.archived.blurb":
			"Des projets terminés. Ils restent au catalogue parce que savoir qu’une chose est morte vaut autant que savoir qu’elle existe, et parce que l’alternative, c’est un annuaire qui ne décrit jamais que le présent.",
		"collection.archived.derivation":
			"Dérivé du champ « archivé » de chaque entrée, la lecture de la forge primant lorsqu’elle existe. Rien ici n’est un jugement de qualité : beaucoup étaient bons, et plusieurs ont été remplacés par des forks listés ailleurs sur ce site.",

		"collection.unresolved": "Les citations divergent",
		"collection.open-core.unresolvedNote":
			"Ces projets sont cités face à plusieurs produits, et ces entrées ne s’accordent pas sur ce point précis. Ils sont écartés de la liste ci-dessus plutôt que comptés au jugé, et nommés ici plutôt qu’effacés en silence. Chaque fiche projet détaille le désaccord.",
		"collection.source-available.unresolvedNote":
			"Ces projets sont cités face à plusieurs produits, et ces entrées ne s’accordent pas sur le fait même que la licence soit libre. Qualifier un projet de « non libre » sur la foi de la première citation lue serait une affirmation que ce site ne peut pas étayer : ils sont donc nommés ici. Chaque fiche projet détaille le désaccord.",

		"ads.priceOnRequest": "prix sur demande",
		"ads.notPricedYet": "pas encore tarifé",
		"ads.unpricedNote":
			"emplacements de la vitrine existent mais ne sont pas encore tarifés. Écrivez-nous si l'un d'eux vous intéresse.",

		"empty.none": "Aucun résultat.",
		"empty.submit": "Ajoutez-le →",
		"error.api":
			"Quelque chose a cassé de notre côté. Réessayez dans une minute.",
		"error.noSuchPage": "Cette page n’existe pas. Voici la liste à la place.",
		"list.disclaimer":
			"* Les prix correspondent à l’offre d’entrée et changent sans cesse. Les verdicts sont des avis, assumés et discutables. Contestez via Proposer.",

		"ads.eyebrow": "Sponsoring",
		"ads.title": "Soutenir ce projet",
		"ads.blurb":
			"Les sponsors permettent à ce site de rester gratuit et indépendant. Prix fixe, 30 jours, sans enchères ni pixels de tracking. Un seul sponsor par emplacement.",
		"ads.available": "disponible",
		"ads.availableCount": "disponibles",
		"ads.taken": "réservé",
		"ads.yourProductHere": "Soutenir ce projet",
		"ads.billingEmail": "E-mail de facturation",
		"ads.submit": "Réserver {n} emplacement",
		"ads.submitPlural": "Réserver {n} emplacements",
		"ads.done":
			"Réservé. On envoie un lien de paiement, puis on demande votre logo et votre accroche.",
		"ads.popupTitle": "Paiement reçu",
		"ads.popupBody":
			"Votre pub est maintenant entre nos mains pour relecture. On les lit toutes avant mise en ligne. Surveillez vos e-mails : la plupart sont traitées en moins d'un jour ouvré.",
		"ads.popupOk": "Compris",
		"ads.sponsored": "sponsorisé",
		// « Pub » sur mobile, « Sponsorisé » à partir de sm, même mention, moins de place.
		"ads.adShort": "Pub",
		"ads.yourLogoHere": "Soutenir ce projet",
		"ads.houseLabel": "Par le créateur",
		"ads.houseBody": "Je construis des sites comme celui-ci. Disponible.",

		"ads.waitlist":
			"Rien de libre ? On vous prévient dès qu’un emplacement se libère.",
		"ads.waitlistCta": "Me prévenir",
		"ads.openSlot": "Emplacement libre",
		"ads.previewing": "Aperçu",
		"ads.railLeft": "Sponsors, à gauche",
		"ads.railRight": "Sponsors, à droite",
		"ads.tape": "Sponsors",

		"ads.pickRule":
			"Trois emplacements par commande : un panneau latéral, un emplacement sur la page d'accueil, et une catégorie.",
		"ads.chosenCount": "{n} sur {max} choisis",
		"ads.chipRail": "Panneau latéral",
		"ads.chipHero": "Mur d'accueil",
		"ads.chipCategory": "Catégorie",
		"ads.tabRail": "Panneaux latéraux",
		"ads.tabCategory": "Catégories",
		"ads.tabListLabel": "Type d'emplacement",
		"ads.categorySearch": "Chercher une catégorie…",
		"ads.noCategoryMatches":
			"Aucune catégorie ne correspond à cette recherche.",
		"ads.basket": "Votre sélection",
		"ads.remove": "Retirer",
		"ads.totalFor": "Total pour",
		"ads.saving": "Vous économisez {amount} par rapport au paiement mensuel.",
		"ads.capSwappedRail":
			"Un seul panneau latéral par commande. {label} a été retiré pour lui faire de la place.",
		"ads.capSwappedLanding":
			"Cet emplacement de la page d'accueil est limité à un par commande. {label} a été retiré pour lui faire de la place.",
		"ads.capSwappedCategory":
			"Une seule catégorie par commande. {label} a été retiré pour lui faire de la place.",

		"ads.step1": "Où",
		"ads.step2": "Combien de temps",
		"ads.step3": "Votre annonce",
		"ads.steps": "Étapes du sponsoring",
		"ads.continue": "Continuer",
		"ads.back": "Retour",
		"ads.payNow": "Payer {amount}",

		"ads.termHeading": "Pour combien de temps ?",
		"ads.month": "mois",
		"ads.months": "mois",
		"ads.paid":
			"{amount} réglés pour {slots} emplacement(s), {months} mois. Dites-nous maintenant quoi afficher. Ce sera appliqué à tous vos emplacements.",
		"ads.submitCreative": "Envoyer le visuel",
		"ads.paidReturn":
			"Paiement reçu. Dites-nous maintenant quoi afficher. Ce sera appliqué à tous vos emplacements.",
		"ads.paidPending":
			"Votre paiement est passé, mais nous attendons encore la confirmation. Rien n'est perdu : écrivez-nous et nous vous enverrons votre lien.",
		"ads.payFailed": "Le paiement n'a pas abouti. Rien n'a été débité.",
		"ads.payRateLimited":
			"Trop de tentatives depuis ce réseau. Patientez quelques minutes.",
		"ads.payUnavailable":
			"Le paiement n'est pas disponible pour le moment. Aucun prestataire n'est configuré. Inscrivez-vous ci-dessous et nous reviendrons vers vous.",

		"adstats.eyebrow": "Audience",
		"adstats.yoursTitle":
			"Vous verrez exactement comment votre annonce performe.",
		"adstats.yoursBody":
			"Impressions, clics et taux de clic pour chaque emplacement acheté, sur votre tableau de bord, dès la première vue. Connectez-vous avec l'e-mail utilisé pour payer. Nous envoyons un lien, sans mot de passe. Les chiffres globaux du site sont publiés ici une fois qu'ils ont du sens.",
		"adstats.measuringSince": "Mesures depuis le",
		"adstats.impressions": "impressions",
		"adstats.clicks": "clics",
		"adstats.ctr": "taux de clic",
		"adstats.daysWithData": "jours mesurés",
		"adstats.discarded": "{n} événements écartés comme trafic robot.",
		"adstats.method":
			"Une impression est comptée lorsque la moitié au moins de l'encart est à l'écran pendant une seconde entière, une fois par emplacement, par visiteur et par demi-heure. Robots d'indexation, préchargements et réseaux de datacenter sont exclus.",
		"adstats.bySlot": "Par emplacement",
		"adstats.byPage": "Par page",
		"adstats.byCategory": "Par catégorie",
		"adstats.slot": "emplacement",
		"adstats.page": "page",
		"adstats.category": "catégorie",
		"adstats.page.home": "Accueil",
		"adstats.page.product": "Pages produit",
		"adstats.page.category": "Pages catégorie",
		"adstats.page.project": "Pages projet",
		"adstats.page.other": "Autres",
		"adstats.pinned": "Épinglé",

		"submit.eyebrow": "Contribuer",
		"submit.title": "Il manque quelque chose ?",
		"submit.blurb":
			"Chaque produit est un fichier JSON dans le dépôt. Ni formulaire ni compte. Ouvrez une pull request et c’est en ligne au prochain déploiement.",
		"submit.addProduct": "Ajouter un produit",
		"submit.openIssue": "Contester un verdict",
		"submit.contributing": "Comment contribuer",
		"submit.prNote":
			"Chaque PR est validée à la main pour l’instant : la forme du fichier, l’existence de chaque dépôt et la couverture de traduction. Les vérifications automatiques sur votre PR arrivent bientôt.",

		"form.error": "Échec de l’envoi. Réessayez.",
		"footer.tagline":
			"Un annuaire d’alternatives open source, avec des avis tranchés.",
		"footer.policy":
			"Aucun lien affilié. Les emplacements sponsorisés sont signalés et ne changent jamais un verdict.",
		"footer.licence":
			"Les données du catalogue sont sous CC-BY-4.0. Citez-les, et liez la page d’où elles viennent : ce sont les dates de relevé qui rendent la réponse défendable.",
		"footer.licenceMore": "Licences",
		"footer.browse": "Parcourir",
		"footer.contribute": "Contribuer",
		"footer.about": "À propos",
		"footer.legal": "Informations légales",
		"footer.legalAll": "Tous les documents",
		"footer.repo": "Le dépôt",
		"footer.madeWith": "Fait avec",
		"footer.by": "par",
		"footer.policyMore": "Comment marche le sponsoring",
		"theme.toggle": "Changer de thème",
		"theme.light": "clair",
		"theme.dark": "sombre",
		"a11y.skip": "Aller au contenu",
		"a11y.results": "{n} résultats",

		"nav.contact": "Contact",
		"nav.stats": "Trafic",

		"sitestats.eyebrow": "Trafic",
		"sitestats.title": "Ce que ce site reçoit vraiment",
		"sitestats.blurb":
			"Mesuré sur notre propre serveur, avec des analytics que nous hébergeons nous-mêmes. Si nous vous disons d'auto-héberger, autant commencer par nos propres chiffres.",
		"sitestats.catalogue": "Ce que contient le catalogue",
		"sitestats.catalogueNote":
			"Compté à partir du catalogue dont ce site est fait, tel qu'il était à la génération de cette page. Rien ici n'est estimé ni arrondi.",
		"sitestats.traffic": "Ce que le site reçoit",
		"sitestats.pageviews": "Pages vues",
		"sitestats.sessions": "Sessions",
		"sitestats.bestDay": "Meilleur jour",
		"sitestats.avgTime": "Session moyenne",
		"sitestats.visitors": "Visiteurs",
		"sitestats.chartPending":
			"Mesuré depuis le {date}. Un graphique demandera encore quelques jours.",
		"sitestats.chartPendingNoDate":
			"Pas encore assez de jours de données pour un graphique.",
		"sitestats.path": "Chemin",
		"sitestats.source": "Provenance",
		"sitestats.direct": "Direct",
		"sitestats.topPages": "Les plus lues",
		"sitestats.sources": "D'où viennent les lecteurs",
		"sitestats.since": "Mesuré depuis le",
		"sitestats.method":
			"Compté en première partie par un Umami auto-hébergé sur la même machine que ce site. Aucun analytics tiers, aucun cookie inter-sites.",
		"sitestats.sessionsNote":
			"Les « sessions » sont des visites, pas des personnes : effacer ses cookies compte deux fois.",
		"sitestats.noneYet":
			"Rien de compté sur cette période pour l'instant. Les chiffres apparaissent dès qu'il y a du trafic à signaler.",
		"sitestats.unavailableTitle": "Chiffres indisponibles pour le moment",
		"sitestats.unavailable":
			"Le serveur d'analytics n'a pas répondu. Rien sur cette page n'est estimé ni repris d'ailleurs : plutôt que d'afficher un chiffre que nous ne pouvons pas assumer, nous n'en affichons aucun.",

		"nav.signin": "Connexion",
		"creative.yourName": "Votre produit",
		"creative.yourTagline": "Une ligne sur ce qu'il fait",
		"creative.name": "Nom du produit",
		"creative.namePh": "Umami",
		"creative.tagline": "Une ligne de description",
		"creative.taglinePh": "Analytics respectueux, hébergés chez vous",
		"creative.taglineNote":
			"Affichée sur les panneaux gauche et droit, et sur les cartes de catégorie. Le mur d'accueil n'affiche que le logo et le nom.",
		"creative.url": "Vers où mène le clic",
		"creative.icon": "Icône",
		"creative.upload": "Envoyer une icône",
		"creative.uploading": "Envoi…",
		"creative.removeIcon": "Retirer",
		"creative.iconNote":
			"PNG, JPEG ou WebP, jusqu'à 512 Ko. Carrée de préférence.",
		"creative.iconUrlPh": "…ou collez une URL que vous hébergez",
		"creative.logoUrl": "URL de l'icône",
		"creative.tint": "Couleur de la carte",
		"creative.tintReset": "Utiliser la couleur du site",
		"creative.tintNote":
			"Teinte la bordure et la mention sponsorisé de vos cartes. Sans choix, elles utilisent l'accent du site.",
		"creative.frenchToggle": "Ajouter le texte en français (facultatif)",
		"creative.frenchNote":
			"Laissé vide, votre texte anglais est montré à tout le monde. Rempli, les lecteurs francophones voient celui-ci.",
		"creative.nameFrPh": "Nom du produit, en français",
		"creative.taglineFrPh": "Une ligne, en français",
		"ads.previewTitle": "À quoi ça ressemble",
		"creative.previewTitle": "Rendu final",
		"creative.previewNote":
			"En direct, à la taille réelle de chaque emplacement. Tous ceux que vous avez achetés sont ci-dessous.",
		"creative.whereRail":
			"S'affiche dans les panneaux gauche et droit sur ordinateur, et dans le bandeau défilant sur mobile.",
		"creative.whereHero":
			"S'affiche dans le mur de sponsors sous le titre, sur toutes les pages du site.",
		"creative.whereCategory":
			"S'affiche dans la liste de sa page de catégorie, et dans la liste de l'accueil.",
		"creative.railNote":
			"C'est le seul emplacement qui a la place d'afficher votre description.",
		"creative.heroNote":
			"Pas de description ici. Le mur n'affiche que le logo et le nom.",
		"creative.override": "Utiliser une autre annonce ici",
		"creative.hideOverride": "Utiliser la même annonce ici",
		"creative.overrideNote":
			"Tout champ laissé vide reprend l'annonce de gauche.",
		"creative.sending": "Envoi…",
		"creative.liveNote":
			"Votre annonce part en ligne dès que le paiement est validé. Rien d'autre à envoyer, aucune attente de notre côté.",
		"creative.reviewNote":
			"Rien ne part en ligne avant validation. Répondez à l'e-mail de paiement pour modifier quoi que ce soit.",
		"creative.errTooLarge":
			"Ce fichier dépasse 512 Ko. Essayez une icône plus petite.",
		"creative.errType":
			"PNG, JPEG ou WebP uniquement. Le SVG n'est pas accepté.",
		"creative.errUpload": "L'envoi a échoué. Réessayez, ou collez une URL.",
		"team.eyebrow": "Accès",
		"team.title": "Qui peut voir ces chiffres",
		"team.blurbManage":
			"Les personnes que vous ajoutez peuvent lire les chiffres de tous les emplacements de ce compte. Elles ne peuvent rien acheter, modifier ni retirer.",
		"team.blurbRead":
			"Vous pouvez lire les chiffres de tous les emplacements de ce compte. Seul un propriétaire peut ajouter ou retirer des personnes.",
		"team.payer": "Facturé",
		"team.youAre": "Vous êtes",
		"team.orgOwner": "Propriétaire",
		"team.orgUser": "Lecture seule",
		"team.siteAdmin": "Admin du site",
		"team.remove": "Retirer",
		"team.add": "Ajouter",
		"team.addLabel": "Ajouter par e-mail",
		"team.role": "Accès",
		"team.note":
			"Elles reçoivent un e-mail avec un lien qui les connecte. Un propriétaire peut ajouter et retirer ; un lecteur peut seulement consulter.",
		"team.errFull": "Ce compte est plein. Retirez quelqu'un d'abord.",
		"team.errSelf": "Cette adresse est déjà propriétaire du compte.",
		"team.seatsUsed": "{n} sur {max} places utilisées",
		"dash.orgSwitch": "Compte",
		"dash.eyebrow": "Annonceur",
		"dash.title": "Vos emplacements",
		"dash.signOut": "Se déconnecter",
		"dash.signedOutTitle": "Vous n'êtes pas connecté",
		"dash.signedOutBody":
			"Les annonceurs se connectent avec l'e-mail utilisé pour payer. Nous envoyons un lien à usage unique.",
		"dash.emptyTitle": "Aucun emplacement sur cette adresse",
		"dash.emptyBody":
			"Tout ce que vous achetez avec cet e-mail apparaît ici, avec ses chiffres, dès le paiement.",
		"dash.emptyCta": "Voir les emplacements libres",
		"dash.byPlacement": "Par emplacement",
		"dash.slot": "Emplacement",
		"dash.state": "État",
		"dash.runs": "Durée",
		"dash.until": "jusqu'au",
		"dash.months": "mois",
		"dash.method":
			"Compté sur notre propre serveur, dédupliqué par session, et filtré du trafic automatisé avant d'arriver sur cette page, la même exigence que pour les chiffres publics.",
		"dash.needCreativeTitle": "Un emplacement attend votre visuel",
		"dash.needCreativeBody":
			"Il est payé mais rien ne tourne encore. Utilisez le lien de l'e-mail envoyé à la réception du paiement.",
		"dash.status.paid": "visuel attendu",
		"dash.status.submitted": "en validation",
		"dash.status.live": "en ligne",
		"dash.status.rejected": "refusé",
		"dash.status.refunded": "remboursé",
		"dash.noClicksYet":
			"Aucun clic pour l'instant. Normal avant la mise en ligne d'un emplacement.",
		"dash.noClicksSince":
			"Aucun clic pour l'instant. Les vues sont comptées depuis le {date}.",
		"dash.termProgress": "{elapsed} jours sur {total}",
		"dash.endsOn": "jusqu'au",

		"admin.eyebrow": "Plateforme",
		"admin.title": "Console",
		"admin.signedOutTitle": "Vous n'êtes pas connecté",
		"admin.signedOutBody":
			"Cette console utilise la même connexion que l'espace annonceur. Utilisez l'adresse déclarée comme administrateur du site.",
		"admin.forbiddenTitle": "Cette adresse n'est pas administratrice du site",
		"admin.forbiddenBody":
			"Vous êtes connecté, mais ce compte ne figure pas dans la liste des administrateurs : rien de tout ceci ne lui est accessible.",
		"admin.unconfiguredTitle": "Aucun administrateur n'est configuré",
		"admin.unconfiguredBody":
			"SITE_ADMIN est vide sur ce serveur, donc personne ne peut rien valider. Renseignez-le et redémarrez l'API.",
		"admin.loadError": "La console n'a pas pu être chargée.",
		"admin.retry": "Réessayer",

		"admin.queue.title": "En attente de validation",
		"admin.queue.empty":
			"Rien en attente. Tous les visuels payés ont été traités.",
		"admin.queue.waiting": "en attente depuis {h} h",
		"admin.buyer": "Acheteur",
		"admin.paid": "Payé",
		"admin.preview": "Ce qui partira en ligne si vous validez",
		"admin.previewEn": "Anglais",
		"admin.previewFr": "Français",
		"admin.fields": "Tous les champs, tels qu'enregistrés",
		"admin.field.name": "Nom",
		"admin.field.nameFr": "Nom, français",
		"admin.field.tagline": "Accroche",
		"admin.field.taglineFr": "Accroche, français",
		"admin.field.url": "Destination",
		"admin.field.logo": "Logo",
		"admin.field.tint": "Couleur",
		"admin.inherited":
			"vide, le texte anglais est affiché aux lecteurs francophones",
		"admin.notSet": "non renseigné",
		"admin.defaultTint": "aucune, la couleur d'accent du site est utilisée",
		"admin.timeline": "Chronologie",
		"admin.at.created": "Commandé",
		"admin.at.paid": "Payé",
		"admin.at.submitted": "Visuel déposé",
		"admin.at.starts": "Début",
		"admin.at.ends": "Fin",
		"admin.approve": "Valider et publier",
		"admin.reject": "Refuser et rembourser",
		"admin.rejectReason": "Motif du refus",
		"admin.rejectPlaceholder":
			"Conservé sur la commande. L'acheteur ne le reçoit pas.",
		"admin.working": "En cours…",
		"admin.refundFailed":
			"Le remboursement a échoué : rien n'a été modifié, la commande attend toujours d'être validée. Vérifiez dans Stripe avant de réessayer.",
		"admin.actionFailed": "Cela n'a pas fonctionné. Rien n'a été modifié.",
		"admin.approved": "Validé. C'est en ligne.",
		"admin.rejectedDone": "Refusé, et le paiement a été remboursé.",
		"admin.alreadyRefunded":
			"Le remboursement avait déjà été fait : aucun second remboursement n'a été émis.",

		"admin.campaigns.title": "Campagnes",
		"admin.campaigns.empty": "Rien n'a encore été vendu.",
		"admin.site": "Tout le site, toutes campagnes",
		"admin.running": "En cours depuis",
		"admin.left": "Restant",
		"admin.days": "j",
		"admin.compare":
			"La ligne « tout le site » reprend le chiffre publié sur la page tarifs. Une campagne va bien ou mal par rapport à celui-ci, pas à une note inventée.",

		"admin.slots.title": "Les emplacements",
		"admin.slots.occupancy": "{taken} occupés sur {total}",
		"admin.slots.free": "Libre",
		"admin.slots.expiring": "se termine sous une semaine",
		"admin.slots.price": "Tarif",
		"admin.slots.occupant": "Occupant",

		"signin.eyebrow": "Accès annonceur",
		"signin.title": "Consultez les chiffres de votre emplacement",
		"signin.blurb":
			"Utilisez l'e-mail avec lequel vous avez payé. Pas de mot de passe. Nous envoyons un lien qui vous connecte.",
		"signin.emailLabel": "Adresse e-mail",
		"signin.placeholder": "vous@entreprise.com",
		"signin.submit": "Envoyez-moi un lien",
		"signin.sending": "Envoi…",
		"signin.sentTitle": "Regardez votre boîte mail",
		"signin.sentBody":
			"Si cette adresse a un emplacement chez nous, un lien de connexion est en route. Il fonctionne une fois et expire dans 15 minutes.",
		"signin.tryAnother": "Utiliser une autre adresse",
		"signin.note":
			"Nous vous envoyons uniquement un lien. Aucun mot de passe à inventer, ni à oublier.",
		"signin.linkDead":
			"Ce lien n'a pas fonctionné. Il a déjà servi, ou il a expiré. Demandez-en un nouveau ci-dessous.",
		"signin.doneTitle": "Vous êtes connecté",
		"signin.doneBody": "Connecté en tant que {email}.",

		"contact.eyebrow": "Contact",
		"contact.title": "Comment nous joindre",

		"contact.wrong.title": "Quelque chose est faux ici",
		"contact.wrong.body":
			"Un verdict que vous contestez, un prix qui a bougé, un projet qui a changé de licence ou qui est mort. C’est ce que vous pouvez nous envoyer de plus utile, et c’est la raison du lien d’édition sur chaque page : chaque entrée est un fichier JSON, donc une correction est une pull request que la CI valide avant toute fusion. Ni compte ni clone nécessaires. La forge l’édite dans le navigateur. Si vous préférez éviter la PR, ouvrez une issue en disant ce qui est faux et où vous avez lu le contraire.",
		"contact.wrong.edit": "Proposer une correction",
		"contact.wrong.issue": "Signaler par une issue",
		"contact.wrong.contributing": "Comment contribuer",

		"contact.submit.title": "Un produit ou une alternative manque",
		"contact.submit.body":
			"Ajouter une entrée a sa propre page, avec le format du fichier et ce qu’une bonne entrée doit contenir.",

		"contact.sponsor.title": "Sponsoring et publicité",
		"contact.sponsor.body":
			"Chaque emplacement, son prix et sa disponibilité du moment sont sur la page tarifs. L’achat se fait en autonomie ; l’e-mail de facturation que vous y saisissez nous sert à revenir vers vous.",

		"contact.email.title": "E-mail",
		"contact.email.none":
			"Aucune adresse e-mail n’est publiée pour l’instant. Le suivi d’issues ci-dessus est le canal qui fonctionne aujourd’hui, et il est public, c’est justement l’intérêt : une correction que tout le monde peut vérifier vaut mieux qu’une que nous seuls avons vue. Pour ce qui ne peut pas être dit en public, l’e-mail de facturation d’une commande de sponsoring atteint la même personne.",
		"contact.email.body":
			"Pour ce qui n’a pas sa place dans une issue publique. Comptez quelques jours ouvrés.",

		"contact.privacy.title": "Ce que nous en faisons",
		"contact.privacy.body":
			"Les issues et les pull requests sont publiques et hébergées par la forge. Rien sur ce site ne dépose de cookie tiers ni ne charge de script tiers, et il n’y a aucun prestataire d’analytics à qui transmettre un message.",
	},
} as const;

export type Key = keyof (typeof dict)["en"];

/** Only consulted for a URL with no locale in it, the path always wins. */
export const detectLang = (): Lang => {
	const saved = localStorage.getItem("lang");
	if (isLang(saved)) return saved;
	return navigator.language.toLowerCase().startsWith("fr") ? "fr" : "en";
};

/** Language is a URL property, not component state: switching it navigates; localStorage is write-only so a later locale-less visit still lands in the right language. */
export function useI18n(lang: Lang) {
	useEffect(() => {
		localStorage.setItem("lang", lang);
		document.documentElement.lang = lang;
	}, [lang]);

	const t = useCallback((key: Key) => dict[lang][key] ?? dict.en[key], [lang]);

	/** Content ships from git with every locale in one map; English is the fallback. */
	const tc = useCallback(
		(value: Translations) => resolveTranslation(value, lang),
		[lang],
	);

	return { t, tc };
}

/** Null on server and first client render, so hydration matches and no cached build ships a stale relative time. */
export function useNow(): number | null {
	const [now, setNow] = useState<number | null>(null);
	useEffect(() => setNow(Date.now()), []);
	return now;
}

export type Theme = "light" | "dark";

/** Starts from the prerenderer's default (not localStorage/media query) to avoid a hydration mismatch (React #418); stored theme is adopted in an effect instead. */
export function useTheme() {
	const [theme, setTheme] = useState<Theme>("light");
	const [ready, setReady] = useState(false);

	useEffect(() => {
		const saved = localStorage.getItem("theme");
		setTheme(
			saved === "light" || saved === "dark"
				? saved
				: matchMedia("(prefers-color-scheme: dark)").matches
					? "dark"
					: "light",
		);
		setReady(true);
	}, []);

	useEffect(() => {
		// Guarded, or the default would overwrite the head script's choice on mount.
		if (!ready) return;
		localStorage.setItem("theme", theme);
		document.documentElement.dataset.theme = theme;
		document.documentElement.style.colorScheme = theme;
	}, [theme, ready]);

	return {
		theme,
		setTheme,
		toggle: () => setTheme((p) => (p === "dark" ? "light" : "dark")),
	};
}
