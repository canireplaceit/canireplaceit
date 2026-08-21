/**
 * Live vote tallies, shared by the site API and the public v1 API.
 *
 * These moved out of index.ts when the v1 API needed the same two queries.
 * Both apply `counted()`, so a nullified campaign stops inflating every number
 * on the site at once rather than one endpoint at a time.
 */

import { and, count, gte, isNull } from "drizzle-orm";
import { db, schema } from "./db";
import { TRUST_THRESHOLD } from "./vote-identity";

/** Votes that count: trusted enough, and not nullified by a review. */
export const counted = () =>
	and(
		gte(schema.votes.trust, TRUST_THRESHOLD),
		isNull(schema.votes.nullifiedAt),
	);

/** Live tallies per product slug, one query. */
export async function voteCounts(): Promise<Map<string, number>> {
	const rows = await db
		.select({ slug: schema.votes.productSlug, n: count() })
		.from(schema.votes)
		.where(counted())
		.groupBy(schema.votes.productSlug);
	return new Map(rows.map((r) => [r.slug, r.n]));
}

/** Live tallies per project slug, for "how many people switched TO this". */
export async function projectCounts(): Promise<Map<string, number>> {
	const rows = await db
		.select({ slug: schema.votes.projectSlug, n: count() })
		.from(schema.votes)
		.where(counted())
		.groupBy(schema.votes.projectSlug);
	return new Map(
		rows.filter((r) => r.slug !== null).map((r) => [r.slug as string, r.n]),
	);
}
