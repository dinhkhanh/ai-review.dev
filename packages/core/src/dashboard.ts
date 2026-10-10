import {
  and,
  articles,
  auditLog,
  clicks,
  costLedger,
  count,
  desc,
  eq,
  gte,
  products,
  reviewJobs,
  sql,
  type DbOrTx,
} from "@repo/db";

export interface DashboardStats {
  products: number;
  jobsRunning: number;
  jobsFailedLast24h: number;
  articlesAwaitingReview: number;
  articlesPublished: number;
  clicksToday: number;
  spendThisMonthUsd: number;
}

/** CMS dashboard counters (FR-CMS-2). Times are UTC. */
export async function getDashboardStats(db: DbOrTx, now = new Date()): Promise<DashboardStats> {
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000);

  const [[p], [running], [failed], [review], [published], [clicksToday], [spend]] = await Promise.all([
    db.select({ n: count() }).from(products),
    db.select({ n: count() }).from(reviewJobs).where(eq(reviewJobs.status, "running")),
    db
      .select({ n: count() })
      .from(reviewJobs)
      .where(and(eq(reviewJobs.status, "failed"), gte(reviewJobs.updatedAt, dayAgo))),
    db.select({ n: count() }).from(articles).where(eq(articles.status, "in_review")),
    db.select({ n: count() }).from(articles).where(eq(articles.status, "published")),
    db
      .select({ n: count() })
      .from(clicks)
      .where(and(gte(clicks.ts, startOfDay), eq(clicks.isBot, false))),
    db
      .select({ total: sql<string>`coalesce(sum(${costLedger.costUsd}), 0)` })
      .from(costLedger)
      .where(gte(costLedger.createdAt, startOfMonth)),
  ]);

  return {
    products: p?.n ?? 0,
    jobsRunning: running?.n ?? 0,
    jobsFailedLast24h: failed?.n ?? 0,
    articlesAwaitingReview: review?.n ?? 0,
    articlesPublished: published?.n ?? 0,
    clicksToday: clicksToday?.n ?? 0,
    spendThisMonthUsd: Number(spend?.total ?? 0),
  };
}

export async function listAuditLog(db: DbOrTx, limit = 100) {
  return db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(Math.min(limit, 500));
}
