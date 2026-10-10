import { helpfulVoteCounts } from "@repo/core";
import { getDb } from "@repo/db";

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 3600 * 1000);

/** Visitor "Was this helpful?" votes for the last 30 days (FR-WEB-10). */
export async function VoteCounts({ articleId }: { articleId: string }) {
  const { helpful, notHelpful } = await helpfulVoteCounts(getDb(), articleId, daysAgo(30));
  const total = helpful + notHelpful;
  return (
    <section>
      <h2 className="font-semibold">Reader feedback (30 days)</h2>
      {total === 0 ? (
        <p className="mt-1 text-sm text-muted">No votes yet.</p>
      ) : (
        <p className="mt-1 text-sm">
          <span className="text-success">{helpful} helpful</span> ·{" "}
          <span className="text-danger">{notHelpful} not helpful</span>{" "}
          <span className="text-muted">({Math.round((helpful / total) * 100)}% positive)</span>
        </p>
      )}
    </section>
  );
}
