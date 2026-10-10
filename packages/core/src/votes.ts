import { and, eq, gte, helpfulVotes, sql, type DbOrTx } from "@repo/db";

/**
 * "Was this helpful?" (FR-WEB-10). One vote per visitor per article per UTC day; the visitor is a
 * daily-salted IP hash (NFR-8), so votes cannot be linked across days. Re-voting changes the vote.
 */
export async function recordHelpfulVote(
  db: DbOrTx,
  input: { articleId: string; helpful: boolean; ipHash: string; now?: Date },
) {
  const day = (input.now ?? new Date()).toISOString().slice(0, 10);
  await db
    .insert(helpfulVotes)
    .values({ articleId: input.articleId, helpful: input.helpful, ipHash: input.ipHash, day })
    .onConflictDoUpdate({
      target: [helpfulVotes.articleId, helpfulVotes.ipHash, helpfulVotes.day],
      set: { helpful: input.helpful },
    });
}

/** Helpful / not helpful counts for an article since a date (CMS article page). */
export async function helpfulVoteCounts(db: DbOrTx, articleId: string, since?: Date) {
  const [row] = await db
    .select({
      helpful: sql<number>`count(*) filter (where ${helpfulVotes.helpful})::int`,
      notHelpful: sql<number>`count(*) filter (where not ${helpfulVotes.helpful})::int`,
    })
    .from(helpfulVotes)
    .where(
      and(
        eq(helpfulVotes.articleId, articleId),
        since ? gte(helpfulVotes.day, since.toISOString().slice(0, 10)) : undefined,
      ),
    );
  return { helpful: row?.helpful ?? 0, notHelpful: row?.notHelpful ?? 0 };
}
