/**
 * The legal pages, in both locales.
 *
 * Every statement here is a claim about what the software actually does, so the
 * copy is written from the code rather than from a template: self-hosted Umami
 * with no cookie, Cloudflare Turnstile on the vote widget when configured,
 * Stripe for sponsorship, magic-link sessions, and a voter identity that is a
 * random signed cookie plus salted hashes of a network *block* and three request
 * headers — never a stored IP address. If any of that changes, this file is part
 * of the change.
 *
 * The prose lives here rather than in i18n.ts because it is documents, not
 * interface strings: nothing else needs these keys, and dropping ~200 entries
 * into the dictionary would bury the strings that are actually reused.
 */

import type { Lang } from "core/src/index";
import { LEGAL_DOCS, type LegalDoc, paths } from "core/src/routes";
import { CONTACT_EMAIL, REPO } from "./contribute";
import { MEASURE } from "./listShared";
import { Link } from "./nav";
import { PageShell } from "./shell";

/**
 * The identity a legal notice is legally required to publish.
 *
 * Deliberately `null` where nothing real exists yet, exactly as `CONTACT_EMAIL`
 * is in contribute.tsx. A legal notice naming an invented company is worse than
 * one that says out loud which fields are outstanding, and France's LCEN wants
 * the true publisher, not a plausible one. Fill these in before launch: the
 * notice page renders each missing field as an explicit gap.
 */
export const PUBLISHER: {
	name: string | null;
	status: string | null;
	/**
	 * A city is not what LCEN art. 6 III-1 asks a *professional* publisher for —
	 * it wants the address of the establishment, alongside the SIREN. Selling
	 * sponsorship makes this site professional, so this line is provisional: it
	 * becomes compliant when it holds a full address, and the cheap way to get one
	 * without publishing a home is a domiciliation service.
	 */
	address: string | null;
	/** Required next to the address for a registered business. */
	siren: string | null;
	director: string | null;
	host: string | null;
	email: string | null;
} = {
	name: "Angelo Al Yacoub",
	status: "Entreprise individuelle (micro-entreprise)",
	address: "Lyon, France",
	siren: "103 492 724",
	director: "Angelo Al Yacoub",
	// Contabo GmbH, Munich. Verify the street line against their own imprint
	// before launch — naming the host is the part of the notice a reader relies
	// on when the publisher will not answer.
	host: "Contabo GmbH, Aschauer Straße 32a, 81549 München, Germany",
	email: CONTACT_EMAIL,
};

/** Last substantive revision. Bumped by hand, because a build date would lie. */
export const UPDATED = "2026-08-06";

type Copy = Record<Lang, string>;
type Section = { h: Copy; p: Copy[] };
type Doc = { title: Copy; intro: Copy; sections: Section[] };

const MISSING: Copy = {
	en: "not published yet",
	fr: "non publié à ce jour",
};

const field = (value: string | null, lang: Lang) => value ?? MISSING[lang];

const DOCS: Record<LegalDoc, Doc> = {
	terms: {
		title: { en: "Terms of use", fr: "Conditions générales d’utilisation" },
		intro: {
			en: "What this site is, what you can expect from it, and what it expects from you. Using the site means accepting these terms.",
			fr: "Ce qu’est ce site, ce que vous pouvez en attendre et ce qu’il attend de vous. Utiliser le site vaut acceptation de ces conditions.",
		},
		sections: [
			{
				h: { en: "What the site publishes", fr: "Ce que le site publie" },
				p: [
					{
						en: "Editorial opinion, backed by dated facts. A verdict says whether we think an open source project can replace a paid product today, for a described kind of reader. It is not advice, not certification, and not a guarantee that the replacement will work for you.",
						fr: "Des avis éditoriaux, appuyés sur des faits datés. Un verdict indique si, selon nous, un projet open source peut remplacer aujourd’hui un produit payant, pour un type de lecteur décrit. Ce n’est ni un conseil, ni une certification, ni une garantie que le remplacement fonctionnera dans votre cas.",
					},
					{
						en: "Prices, licences and features change without warning. Every price carries the date it was checked. Check the vendor before you migrate anything that matters — a stale figure on this site has cost you nothing until you act on it without verifying.",
						fr: "Les prix, licences et fonctionnalités changent sans préavis. Chaque prix porte sa date de vérification. Vérifiez auprès de l’éditeur avant toute migration importante : un chiffre périmé ici ne vous coûte rien tant que vous ne l’utilisez pas sans le contrôler.",
					},
				],
			},
			{
				h: { en: "Corrections", fr: "Corrections" },
				p: [
					{
						en: "If a verdict or a price is wrong, tell us and it gets fixed. Every entry is one public file in a public repository, so a correction is visible, attributable and dated. That is the whole quality mechanism, and it only works if people use it.",
						fr: "Si un verdict ou un prix est faux, signalez-le et il sera corrigé. Chaque entrée est un fichier public dans un dépôt public : une correction est visible, attribuable et datée. C’est tout le mécanisme qualité, et il ne fonctionne que si on s’en sert.",
					},
				],
			},
			{
				h: {
					en: "What you send us",
					fr: "Ce que vous nous envoyez",
				},
				p: [
					{
						en: "Submitting a product, an alternative or a correction means you have the right to send it and that you allow us to publish it under the same licence as the rest of the catalogue. Do not send anything confidential or anything that is not yours.",
						fr: "Proposer un produit, une alternative ou une correction signifie que vous avez le droit de le faire et que vous nous autorisez à la publier sous la même licence que le reste du catalogue. N’envoyez rien de confidentiel ni rien qui ne vous appartienne pas.",
					},
				],
			},
			{
				h: { en: "Accounts and fair use", fr: "Comptes et usage loyal" },
				p: [
					{
						en: "An account exists only to manage sponsorship. Sign-in is by emailed link; keep access to that mailbox and you keep access to the account. One vote per person: automating votes, scraping the site at a rate that degrades it for others, or using it to harass a vendor will get the access withdrawn.",
						fr: "Un compte ne sert qu’à gérer un sponsoring. La connexion se fait par lien envoyé par e-mail : garder l’accès à cette boîte, c’est garder l’accès au compte. Un vote par personne : automatiser des votes, aspirer le site à un rythme qui le dégrade pour les autres, ou l’utiliser pour harceler un éditeur entraîne le retrait de l’accès.",
					},
				],
			},
			{
				h: { en: "Liability", fr: "Responsabilité" },
				p: [
					{
						en: "The site is provided as is, without warranty. We are not liable for a decision you make on the basis of what you read here, and in particular not for the cost or the consequences of a migration. Nothing in these terms limits liability that the law does not allow us to limit.",
						fr: "Le site est fourni en l’état, sans garantie. Nous ne sommes pas responsables d’une décision prise sur la base de ce que vous y lisez, et notamment pas du coût ni des conséquences d’une migration. Rien ici ne limite une responsabilité que la loi ne permet pas de limiter.",
					},
				],
			},
			{
				h: { en: "Applicable law", fr: "Droit applicable" },
				p: [
					{
						en: "French law applies. If you are a consumer, this does not deprive you of the protection of the mandatory rules of your own country of residence.",
						fr: "Le droit français s’applique. Si vous êtes consommateur, cela ne vous prive pas de la protection des règles impératives de votre pays de résidence.",
					},
				],
			},
		],
	},

	privacy: {
		title: { en: "Privacy", fr: "Confidentialité" },
		intro: {
			en: "What is collected, why, and how long it stays. The short version: an email address only if you sign in, no advertising cookie, no third-party tracker, and never a stored IP address.",
			fr: "Ce qui est collecté, pourquoi et pour combien de temps. En bref : une adresse e-mail seulement si vous vous connectez, aucun cookie publicitaire, aucun traceur tiers, et jamais d’adresse IP conservée.",
		},
		sections: [
			{
				h: { en: "Reading the site", fr: "Lire le site" },
				p: [
					{
						en: "Nothing is asked of you and nothing identifies you. Audience measurement runs on Umami, self-hosted on our own server: it sets no cookie, builds no cross-site profile, and produces aggregate counts — pages, referrers, countries. Those figures are published on the traffic page rather than kept private.",
						fr: "Rien ne vous est demandé et rien ne vous identifie. La mesure d’audience utilise Umami, auto-hébergé sur notre propre serveur : aucun cookie, aucun profil inter-sites, uniquement des compteurs agrégés — pages, référents, pays. Ces chiffres sont publiés sur la page trafic plutôt que gardés pour nous.",
					},
				],
			},
			{
				h: { en: "Voting", fr: "Voter" },
				p: [
					{
						en: "Voting needs to stop one person voting a hundred times without knowing who you are. So a vote stores: a random identifier in a signed cookie the browser cannot read or forge; a salted, one-way hash of your network block (an IPv4 /24 or an IPv6 /64, never the address itself); and a salted hash of three headers your browser sends anyway — user agent, language, encoding.",
						fr: "Le vote doit empêcher une personne de voter cent fois sans savoir qui vous êtes. Un vote enregistre donc : un identifiant aléatoire dans un cookie signé que le navigateur ne peut ni lire ni falsifier ; une empreinte salée et à sens unique de votre bloc réseau (un /24 en IPv4, un /64 en IPv6, jamais l’adresse elle-même) ; et une empreinte salée de trois en-têtes que votre navigateur envoie de toute façon — agent, langue, encodage.",
					},
					{
						en: "There is deliberately no canvas, font or JavaScript fingerprinting. Those techniques identify a person rather than a suspicious pattern, they require consent, and the anti-fraud job here does not need them.",
						fr: "Il n’y a délibérément aucune empreinte canvas, police ou JavaScript. Ces techniques identifient une personne plutôt qu’un comportement suspect, elles exigent un consentement, et la lutte anti-fraude ici n’en a pas besoin.",
					},
					{
						en: "When it is configured, the vote widget also calls Cloudflare Turnstile to tell a person from a script. Cloudflare then sees a request from your browser; a vote without that check still counts, only with less weight.",
						fr: "Lorsqu’il est configuré, le widget de vote appelle aussi Cloudflare Turnstile pour distinguer une personne d’un script. Cloudflare voit alors une requête de votre navigateur ; un vote sans cette vérification compte quand même, avec un poids moindre.",
					},
				],
			},
			{
				h: { en: "Writing to us", fr: "Nous écrire" },
				p: [
					{
						en: "What you type into a form is what we get: your message, and an email address if you give one, kept only to answer you.",
						fr: "Ce que vous saisissez dans un formulaire est ce que nous recevons : votre message, et une adresse e-mail si vous en donnez une, conservée uniquement pour vous répondre.",
					},
				],
			},
			{
				h: {
					en: "Signing in and sponsoring",
					fr: "Se connecter et sponsoriser",
				},
				p: [
					{
						en: "Sign-in stores your email address and nothing else — no password exists to leak. The link is valid for a few minutes and the session for an hour. Sponsorship is billed through Stripe, which handles the payment and the card details; we never see a card number, and we keep what an invoice requires.",
						fr: "La connexion enregistre votre adresse e-mail et rien d’autre — aucun mot de passe n’existe, donc aucun ne peut fuiter. Le lien est valable quelques minutes, la session une heure. Le sponsoring est facturé via Stripe, qui traite le paiement et les données de carte ; nous ne voyons jamais un numéro de carte et ne conservons que ce qu’exige une facture.",
					},
				],
			},
			{
				h: {
					en: "Retention and your rights",
					fr: "Conservation et vos droits",
				},
				p: [
					{
						en: "Messages are kept while the exchange is useful. Account data is kept while the account exists. Invoices are kept for the ten years French accounting law requires. Aggregate audience figures are kept indefinitely because they identify nobody.",
						fr: "Les messages sont conservés tant que l’échange est utile. Les données de compte le sont tant que le compte existe. Les factures sont conservées les dix ans qu’impose la loi comptable française. Les chiffres d’audience agrégés sont conservés sans limite, puisqu’ils n’identifient personne.",
					},
					{
						en: "You can ask for access, correction, deletion or a copy of your data, and you can complain to the CNIL. Write to the contact address below; there is a person on the other end, not a ticket queue.",
						fr: "Vous pouvez demander l’accès, la rectification, l’effacement ou une copie de vos données, et saisir la CNIL. Écrivez à l’adresse de contact ci-dessous : il y a une personne au bout, pas une file de tickets.",
					},
				],
			},
		],
	},

	cookies: {
		title: { en: "Cookies", fr: "Cookies" },
		intro: {
			en: "Short, because the site is boring: three cookies, all strictly necessary, none of them advertising. That is also why there is no consent banner to click through.",
			fr: "Court, parce que le site est sobre : trois cookies, tous strictement nécessaires, aucun publicitaire. C’est aussi pourquoi il n’y a pas de bandeau de consentement à cliquer.",
		},
		sections: [
			{
				h: { en: "What is set", fr: "Ce qui est déposé" },
				p: [
					{
						en: "A session cookie once you sign in, which disappears when the session ends. A signed voter cookie, which holds a random identifier and no personal data. A preference for language and theme, so the site does not forget them on every visit.",
						fr: "Un cookie de session une fois connecté, qui disparaît à la fin de la session. Un cookie de vote signé, qui contient un identifiant aléatoire et aucune donnée personnelle. Une préférence de langue et de thème, pour que le site ne les oublie pas à chaque visite.",
					},
				],
			},
			{
				h: { en: "What is not set", fr: "Ce qui n’est pas déposé" },
				p: [
					{
						en: "No advertising cookie, no analytics cookie, no third-party tracker, no cross-site identifier. Audience measurement is cookieless by design. Under the ePrivacy rules, strictly necessary cookies do not require consent — which is why you were not asked. If that ever changes, the banner appears; the intention is that it never has to.",
						fr: "Aucun cookie publicitaire, aucun cookie de mesure, aucun traceur tiers, aucun identifiant inter-sites. La mesure d’audience est sans cookie par conception. Selon les règles ePrivacy, les cookies strictement nécessaires ne requièrent pas de consentement — d’où l’absence de demande. Si cela change, le bandeau apparaîtra ; l’intention est que ce ne soit jamais nécessaire.",
					},
				],
			},
		],
	},

	notice: {
		title: { en: "Legal notice", fr: "Mentions légales" },
		intro: {
			en: "Who publishes this site and who hosts it, as French law requires.",
			fr: "Qui publie ce site et qui l’héberge, comme l’exige la loi française.",
		},
		sections: [
			{
				h: { en: "Publisher", fr: "Éditeur" },
				p: [
					{
						en: "Editorial responsibility for everything published here sits with the publisher named on this page. Contact for any legal question is the address below.",
						fr: "La responsabilité éditoriale de tout ce qui est publié ici incombe à l’éditeur nommé sur cette page. Le contact pour toute question juridique est l’adresse ci-dessous.",
					},
				],
			},
			{
				h: { en: "Hosting", fr: "Hébergement" },
				p: [
					{
						en: "The site runs on a server rented from the host named on this page, who can be contacted directly for anything that requires the host rather than the publisher.",
						fr: "Le site fonctionne sur un serveur loué auprès de l’hébergeur nommé sur cette page, qui peut être contacté directement pour ce qui relève de l’hébergeur plutôt que de l’éditeur.",
					},
				],
			},
			{
				h: { en: "Reporting content", fr: "Signaler un contenu" },
				p: [
					{
						en: "To report a factual error, a verdict you believe is wrong, or a use of your trademark you object to, write to the contact address. Corrections are made in public, in the repository, with the change visible in its history.",
						fr: "Pour signaler une erreur factuelle, un verdict que vous estimez erroné ou un usage de votre marque auquel vous vous opposez, écrivez à l’adresse de contact. Les corrections sont faites en public, dans le dépôt, avec la modification visible dans l’historique.",
					},
				],
			},
		],
	},

	sponsorship: {
		title: {
			en: "Sponsorship terms",
			fr: "Conditions générales de vente",
		},
		intro: {
			en: "The terms that apply when you buy a sponsorship slot. They exist because money changes hands; everything else on the site is free to read.",
			fr: "Les conditions applicables à l’achat d’un emplacement de sponsoring. Elles existent parce qu’il y a une transaction ; tout le reste du site est en lecture libre.",
		},
		sections: [
			{
				h: { en: "What you are buying", fr: "Ce que vous achetez" },
				p: [
					{
						en: "A named placement, for a fixed run, at the price shown on the sponsorship page. One rate for everyone: there is no negotiated pricing, and the rate card is public.",
						fr: "Un emplacement identifié, pour une durée fixe, au prix affiché sur la page de sponsoring. Un seul tarif pour tous : aucun prix négocié, et la grille est publique.",
					},
					{
						en: "What you are not buying, at any price: a verdict, a ranking, a position in a list, the removal of a competitor, or a link that is not marked as sponsored. This is not a negotiating position — it is the reason the placements are worth anything.",
						fr: "Ce que vous n’achetez à aucun prix : un verdict, un classement, une position dans une liste, le retrait d’un concurrent, ou un lien non signalé comme sponsorisé. Ce n’est pas une posture de négociation : c’est ce qui donne leur valeur aux emplacements.",
					},
				],
			},
			{
				h: { en: "Payment", fr: "Paiement" },
				p: [
					{
						en: "Payment is taken by Stripe. The publisher is under the French small-business VAT exemption — VAT is not applicable, art. 293 B of the CGI — so the price shown is the price charged. A campaign starts once payment is confirmed.",
						fr: "Le paiement est encaissé par Stripe. L’éditeur relève de la franchise en base : TVA non applicable, art. 293 B du CGI — le prix affiché est donc le prix facturé. Une campagne démarre une fois le paiement confirmé.",
					},
				],
			},
			{
				h: { en: "Creative", fr: "Le visuel" },
				p: [
					{
						en: "You supply the name, the logo and the line, and you warrant you have the right to use them. We can refuse or pull anything misleading, illegal, or presented so as to look like editorial content. Every placement is labelled.",
						fr: "Vous fournissez le nom, le logo et l’accroche, et vous garantissez avoir le droit de les utiliser. Nous pouvons refuser ou retirer tout élément trompeur, illégal, ou présenté de façon à ressembler à du contenu éditorial. Chaque emplacement est signalé comme tel.",
					},
				],
			},
			{
				h: {
					en: "Cancellation and refunds",
					fr: "Annulation et remboursement",
				},
				p: [
					{
						en: "If a campaign cannot run for a reason on our side, the unused part is refunded. If you are a consumer buying in the EU, you have fourteen days to withdraw — except where you have asked for the campaign to start inside that period and it has, in which case the right lapses for the part already delivered.",
						fr: "Si une campagne ne peut pas être diffusée pour une raison qui nous incombe, la part non diffusée est remboursée. Si vous êtes un consommateur achetant dans l’UE, vous disposez de quatorze jours pour vous rétracter — sauf si vous avez demandé le démarrage de la campagne dans ce délai et qu’elle a commencé, auquel cas le droit s’éteint pour la part déjà exécutée.",
					},
				],
			},
			{
				h: { en: "Applicable law", fr: "Droit applicable" },
				p: [
					{
						en: "French law applies. For business buyers, the courts of the publisher's jurisdiction have exclusive competence. Consumers keep the protection of their own country's mandatory rules.",
						fr: "Le droit français s’applique. Pour les acheteurs professionnels, les tribunaux du ressort de l’éditeur sont seuls compétents. Les consommateurs conservent la protection des règles impératives de leur pays.",
					},
				],
			},
		],
	},

	disclosure: {
		title: {
			en: "Advertising & disclosure",
			fr: "Publicité et transparence",
		},
		intro: {
			en: "How the site makes money, and what that money does and does not buy. This page is a legal duty under consumer law — and it is also the page that makes the rest of the site worth reading.",
			fr: "Comment le site gagne de l’argent, et ce que cet argent achète ou non. Cette page est une obligation légale au titre du droit de la consommation — et c’est aussi celle qui rend le reste du site crédible.",
		},
		sections: [
			{
				h: { en: "What is paid", fr: "Ce qui est payé" },
				p: [
					{
						en: "Sponsorship slots are paid placements and every one of them is labelled as such, wherever it appears. If a placement is not labelled, it is not paid.",
						fr: "Les emplacements de sponsoring sont des placements payants et chacun est signalé comme tel, où qu’il apparaisse. Si un emplacement n’est pas signalé, c’est qu’il n’est pas payé.",
					},
				],
			},
			{
				h: { en: "What is never paid", fr: "Ce qui n’est jamais payé" },
				p: [
					{
						en: "Verdicts, rankings, the order of any list, inclusion in the catalogue, and removal from it. No sponsor sees a verdict before it is published, and no sponsor has ever been given a right of review over one.",
						fr: "Les verdicts, les classements, l’ordre des listes, l’entrée au catalogue et la sortie du catalogue. Aucun sponsor ne voit un verdict avant publication, et aucun n’a jamais obtenu de droit de regard sur un verdict.",
					},
					{
						en: "A sponsor being reviewed badly on this site is a normal outcome, not an incident.",
						fr: "Qu’un sponsor reçoive un mauvais verdict sur ce site est une situation normale, pas un incident.",
					},
				],
			},
			{
				h: { en: "Affiliate links", fr: "Liens affiliés" },
				p: [
					{
						en: "There are none today. If that changes, links that earn a commission will be marked at the link, not only in a page like this one, and the change will be recorded here.",
						fr: "Il n’y en a aucun à ce jour. Si cela change, les liens rémunérés seront signalés au niveau du lien, pas seulement sur une page comme celle-ci, et le changement sera consigné ici.",
					},
				],
			},
		],
	},

	licences: {
		title: { en: "Licences & trademarks", fr: "Licences et marques" },
		intro: {
			en: "Who owns what on this site, and what you may do with it.",
			fr: "À qui appartient quoi sur ce site, et ce que vous pouvez en faire.",
		},
		sections: [
			{
				h: { en: "Product names and logos", fr: "Noms et logos de produits" },
				p: [
					{
						en: "Every product name and logo belongs to its owner and is used here for identification only, to say which product a page is about. No affiliation, sponsorship or endorsement is implied — including for products that are, separately, sponsors.",
						fr: "Chaque nom et logo de produit appartient à son détenteur et n’est utilisé ici que pour identifier le produit dont traite une page. Aucune affiliation, aucun partenariat ni aucune approbation n’est sous-entendu — y compris pour les produits qui sont, par ailleurs, sponsors.",
					},
					{
						en: "Logos are stored as small copies of each vendor's own site icon, so a page can show them without calling a third-party server and exposing the reader to it. If you own a mark and want it removed, write to the contact address and it will be.",
						fr: "Les logos sont stockés sous forme de petites copies de l’icône du site de chaque éditeur, afin qu’une page puisse les afficher sans appeler un serveur tiers et y exposer le lecteur. Si vous détenez une marque et souhaitez son retrait, écrivez à l’adresse de contact et ce sera fait.",
					},
				],
			},
			{
				h: { en: "Our own content", fr: "Nos contenus" },
				p: [
					{
						en: "The catalogue — the verdicts, the notes, the structured facts — lives as public files in the repository and can be reused under the licence declared there, with attribution. The source code carries its own licence, in the same repository.",
						fr: "Le catalogue — verdicts, notes, faits structurés — existe sous forme de fichiers publics dans le dépôt et peut être réutilisé sous la licence qui y est déclarée, avec attribution. Le code source porte sa propre licence, dans le même dépôt.",
					},
					{
						en: "Open source projects listed here are covered by their own licences, which the site records per project. Ours does not extend to them, and reading a verdict grants you nothing about the software it describes.",
						fr: "Les projets open source recensés ici sont couverts par leurs propres licences, que le site consigne projet par projet. La nôtre ne s’y substitue pas, et lire un verdict ne vous accorde aucun droit sur le logiciel décrit.",
					},
				],
			},
		],
	},
};

const H = "text-lg font-semibold tracking-tight";
const P = "text-sm leading-relaxed text-pretty text-muted";

/** The section a legal notice needs and no other page does. */
function PublisherFacts({ lang }: { lang: Lang }) {
	const rows: [string, string][] = [
		[lang === "fr" ? "Éditeur" : "Publisher", field(PUBLISHER.name, lang)],
		[lang === "fr" ? "Statut" : "Legal form", field(PUBLISHER.status, lang)],
		[lang === "fr" ? "Adresse" : "Address", field(PUBLISHER.address, lang)],
		["SIREN", field(PUBLISHER.siren, lang)],
		[
			lang === "fr" ? "Directeur de publication" : "Publication director",
			field(PUBLISHER.director, lang),
		],
		[lang === "fr" ? "Hébergeur" : "Host", field(PUBLISHER.host, lang)],
		[lang === "fr" ? "Contact" : "Contact", field(PUBLISHER.email, lang)],
	];
	return (
		<dl className="panel mb-8 grid gap-x-6 gap-y-2 p-4 sm:grid-cols-[auto_1fr]">
			{rows.map(([k, v]) => (
				<div key={k} className="contents">
					<dt className="text-xs font-medium text-muted">{k}</dt>
					<dd className="text-sm">{v}</dd>
				</div>
			))}
		</dl>
	);
}

/** The section's own name, in both locales. Was written out four times. */
const LEGAL_LABEL: Record<Lang, string> = {
	en: "Legal",
	fr: "Informations légales",
};

export function LegalPage({ lang, doc }: { lang: Lang; doc: LegalDoc }) {
	const d = DOCS[doc];
	return (
		<PageShell
			measure={MEASURE}
			trail={[
				{ label: lang === "fr" ? "Accueil" : "Home", href: paths.home(lang) },
				{ label: LEGAL_LABEL[lang], href: paths.legal(lang) },
				{ label: d.title[lang] },
			]}
			title={d.title[lang]}
			lede={d.intro[lang]}
			meta={
				<p className="text-muted text-xs">
					{lang === "fr" ? "Dernière mise à jour" : "Last updated"} : {UPDATED}
				</p>
			}
		>
			{doc === "notice" && <PublisherFacts lang={lang} />}

			<div className="max-w-3xl space-y-7">
				{d.sections.map((s) => (
					<section key={s.h.en}>
						<h2 className={H}>{s.h[lang]}</h2>
						{s.p.map((p) => (
							<p key={p.en.slice(0, 40)} className={`${P} mt-2`}>
								{p[lang]}
							</p>
						))}
					</section>
				))}
			</div>

			<p className={`${P} mt-10`}>
				{lang === "fr" ? "Une question ? " : "A question? "}
				<address className="inline not-italic">
					{PUBLISHER.email ? (
						<a
							href={`mailto:${PUBLISHER.email}`}
							className="text-brand hover:underline"
						>
							{PUBLISHER.email}
						</a>
					) : (
						<a href={REPO} className="text-brand hover:underline">
							{REPO}
						</a>
					)}
				</address>
			</p>
		</PageShell>
	);
}

export function LegalIndexPage({ lang }: { lang: Lang }) {
	return (
		<PageShell
			measure={MEASURE}
			trail={[
				{ label: lang === "fr" ? "Accueil" : "Home", href: paths.home(lang) },
				{ label: LEGAL_LABEL[lang] },
			]}
			title={LEGAL_LABEL[lang]}
			lede={
				lang === "fr"
					? "Quelques pages, aussi courtes que possible, et exactes : elles décrivent ce que le site fait réellement."
					: "A handful of pages, as short as they can honestly be — each one describes what the site actually does."
			}
		>
			<ul className="grid gap-3 sm:grid-cols-2">
				{LEGAL_DOCS.map((doc) => (
					<li key={doc} className="card card-link">
						<Link href={paths.legal(lang, doc)} className="block h-full p-4">
							<span className="font-display font-semibold">
								{DOCS[doc].title[lang]}
							</span>
							<span className={`${P} mt-1.5 block`}>
								{DOCS[doc].intro[lang]}
							</span>
						</Link>
					</li>
				))}
			</ul>
		</PageShell>
	);
}

/** Title and one-line summary, for <title>/<meta> — see seo.ts. */
/**
 * A document as plain prose, for the Markdown twin.
 *
 * The twins exist so an agent can read a page without pulling 200 kB of HTML,
 * and the licence document is the one that says what the catalogue may be used
 * for. Reading the same `DOCS` the page renders, so the two cannot drift.
 */
export const legalSections = (
	doc: LegalDoc,
	lang: Lang,
): { h: string; p: string[] }[] =>
	DOCS[doc].sections.map((s) => ({
		h: s.h[lang],
		p: s.p.map((para) => para[lang]),
	}));

export const legalCopy = (doc: LegalDoc | undefined, lang: Lang) =>
	doc
		? { title: DOCS[doc].title[lang], description: DOCS[doc].intro[lang] }
		: {
				title: lang === "fr" ? "Informations légales" : "Legal",
				description:
					lang === "fr"
						? "Conditions d’utilisation, confidentialité, cookies, mentions légales, conditions de vente et transparence publicitaire."
						: "Terms of use, privacy, cookies, legal notice, sponsorship terms and advertising disclosure.",
			};
