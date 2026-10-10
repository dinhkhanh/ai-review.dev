import type { QaScorecard } from "@repo/content";
import { articles, eq, newsletterDeliveries, newsletterSubscribers, notifications } from "@repo/db";
import { seed } from "@repo/db/seed";
import { setupTestDb } from "@repo/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addArticleVersion,
  buildDigestIssue,
  createArticle,
  createDeal,
  ensureGoSlug,
  findOrCreateProduct,
  getDigestIssue,
  previousDigestPeriod,
  publishArticle,
  renderDigestEmail,
  runDigestSchedule,
  sendDigestIssue,
  setSetting,
  subscribeNewsletter,
  transitionArticle,
  updateDigestIssue,
  type DigestItem,
  type NewsletterEnv,
} from "./index";

let ctx: Awaited<ReturnType<typeof setupTestDb>>;
beforeAll(async () => {
  ctx = await setupTestDb();
});
afterAll(async () => ctx.close());
beforeEach(async () => {
  await ctx.reset();
  await seed(ctx.db);
});

const env: NewsletterEnv = {
  resendApiKey: "re_test",
  emailFrom: "AI Review <hello@ai-review.dev>",
  siteUrl: "https://ai-review.dev",
};
const passing: QaScorecard = { hardGatesPassed: true, checks: [], computedAt: new Date().toISOString() };
const DAY = 24 * 3600 * 1000;
/** A week after now, so "last week" contains today's publishes. */
const nextWeek = () => new Date(Date.now() + 7 * DAY);

async function publishedReview(name: string, url: string, opts: { locale?: string; verdict?: string } = {}) {
  const { product } = await findOrCreateProduct(ctx.db, { name, websiteUrl: url });
  await ensureGoSlug(ctx.db, product);
  const a = await createArticle(ctx.db, {
    type: "review",
    productId: product.id,
    title: `${name} review`,
    slug: `${product.slug}-review`,
    locale: opts.locale,
  });
  await addArticleVersion(ctx.db, a.id, {
    blocks: [
      { id: "v", type: "verdict", score: 8, summary: opts.verdict ?? `${name} verdict`, bestFor: [], notFor: [] },
    ],
    overallScore: 8,
    qaScorecard: passing,
  });
  await transitionArticle(ctx.db, a.id, "in_review");
  await transitionArticle(ctx.db, a.id, "approved");
  await publishArticle(ctx.db, a.id, { ignoreCap: true });
  return { product, article: a };
}

async function confirmedSubscriber(email: string, locale = "en") {
  await subscribeNewsletter(ctx.db, { email, locale }, { env: { ...env, resendApiKey: null } });
  const [row] = await ctx.db
    .update(newsletterSubscribers)
    .set({ confirmedAt: new Date() })
    .where(eq(newsletterSubscribers.email, email))
    .returning();
  return row!;
}

const okFetch = () =>
  vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const emails = JSON.parse(String(init?.body)) as unknown[];
    return new Response(JSON.stringify({ data: emails.map((_, i) => ({ id: `msg_${i}` })) }), { status: 200 });
  });

describe("digest period", () => {
  it("covers the previous Monday–Sunday in UTC", () => {
    expect(previousDigestPeriod(new Date("2026-10-15T08:00:00Z"))).toEqual({
      periodStart: "2026-10-05",
      periodEnd: "2026-10-11",
    });
    // On a Monday the previous week is the one that just ended.
    expect(previousDigestPeriod(new Date("2026-10-12T00:30:00Z")).periodStart).toBe("2026-10-05");
  });
});

describe("building issues (FR-WEB-9)", () => {
  it("collects new and refreshed articles of one locale, once, with go-link CTAs and deals", async () => {
    const { product } = await publishedReview("Plausible", "https://plausible.io");
    await createDeal(ctx.db, { productId: product.id, title: "30-day trial", discountText: "30 days free" });
    const { article: old } = await publishedReview("Notion", "https://notion.so");
    await ctx.db
      .update(articles)
      .set({ publishedAt: new Date(Date.now() - 40 * DAY) })
      .where(eq(articles.id, old.id));
    const v2 = await addArticleVersion(ctx.db, old.id, {
      blocks: [{ id: "v", type: "verdict", score: 8.5, summary: "Refreshed verdict", bestFor: [], notFor: [] }],
      overallScore: 8.5,
      qaScorecard: passing,
    });
    await ctx.db.update(articles).set({ publishedVersionId: v2.id }).where(eq(articles.id, old.id));
    await publishedReview("Fathom", "https://usefathom.com", { locale: "de" });

    const built = await buildDigestIssue(ctx.db, { locale: "en", now: nextWeek(), env });
    expect(built?.created).toBe(true);
    const items = built!.issue.items as DigestItem[];
    expect(items.map((i) => i.kind)).toEqual(["new", "updated", "deal"]);
    const [first, second] = items as Array<Extract<DigestItem, { kind: "new" | "updated" }>>;
    expect(first).toMatchObject({ title: "Plausible review", summary: "Plausible verdict", score: 8 });
    expect(first!.url).toContain("https://ai-review.dev/reviews/plausible-review?utm_source=newsletter");
    expect(first!.ctaUrl).toBe("https://ai-review.dev/go/plausible?p=newsletter&a=plausible-review");
    expect(second).toMatchObject({ summary: "Refreshed verdict", versionId: v2.id });
    expect(built!.issue.subject).toContain("Plausible");

    // Same period again: the existing issue is returned untouched.
    expect((await buildDigestIssue(ctx.db, { locale: "en", now: nextWeek(), env }))?.created).toBe(false);

    const de = await buildDigestIssue(ctx.db, { locale: "de", now: nextWeek(), env });
    const deItems = de!.issue.items as DigestItem[];
    expect(deItems).toHaveLength(1);
    expect(deItems[0]).toMatchObject({ title: "Fathom review" });
    expect((deItems[0] as { url: string }).url).toContain("/de/reviews/");
    expect(de!.issue.subject).toMatch(/^Neu diese Woche/);

    // A later period does not repeat versions featured before.
    const later = new Date(nextWeek().getTime() + 7 * DAY);
    expect(await buildDigestIssue(ctx.db, { locale: "en", now: later, env })).toBeNull();
  });

  it("creates nothing when no article is new", async () => {
    expect(await buildDigestIssue(ctx.db, { locale: "en", now: nextWeek(), env })).toBeNull();
  });

  it("edits subject, intro and item order but keeps at least one article", async () => {
    await publishedReview("Plausible", "https://plausible.io");
    await publishedReview("Fathom", "https://usefathom.com");
    const { issue } = (await buildDigestIssue(ctx.db, { locale: "en", now: nextWeek(), env }))!;
    const keys = (issue.items as Array<{ articleId: string }>).map((i) => i.articleId);
    const edited = await updateDigestIssue(ctx.db, issue.id, {
      subject: "  Two   analytics tools ",
      intro: "Hello",
      itemKeys: [keys[1]!],
    });
    expect(edited.subject).toBe("Two analytics tools");
    expect(edited.items).toHaveLength(1);
    await expect(updateDigestIssue(ctx.db, issue.id, { itemKeys: [] })).rejects.toThrow(/at least one article/);
  });
});

describe("rendering", () => {
  const items: DigestItem[] = [
    {
      kind: "new",
      articleId: "a",
      versionId: "v",
      type: "review",
      title: "Tom & Jerry <script>",
      summary: "Great",
      score: 8,
      url: "https://ai-review.dev/reviews/x",
      productName: "Tom",
      ctaUrl: "https://ai-review.dev/go/tom?p=newsletter",
    },
    {
      kind: "deal",
      dealId: "d",
      title: "Trial",
      productName: "Tom",
      discountText: "30% off",
      code: "SAVE30",
      ctaUrl: "https://ai-review.dev/go/tom?p=newsletter",
      endsAt: null,
    },
  ];

  it("escapes content and carries disclosure and unsubscribe link", () => {
    const out = renderDigestEmail(
      { locale: "en", subject: "S", intro: "Line one\n\nLine two", items },
      { siteUrl: "https://ai-review.dev", unsubscribeUrl: "https://ai-review.dev/newsletter/unsubscribe?token=t" },
    );
    expect(out.html).toContain("Tom &amp; Jerry &lt;script&gt;");
    expect(out.html).not.toContain("<script>");
    expect(out.html).toContain('lang="en"');
    expect(out.html).toContain("affiliate links");
    expect(out.html).toContain("newsletter/unsubscribe?token=t");
    expect(out.html).toContain("SAVE30");
    expect(out.text).toContain("Line two");
    expect(out.text).toContain("Visit Tom: https://ai-review.dev/go/tom?p=newsletter");
  });

  it("uses German copy and marks affiliate links for de", () => {
    const out = renderDigestEmail(
      { locale: "de", subject: "S", intro: null, items },
      { siteUrl: "https://ai-review.dev", unsubscribeUrl: "u" },
    );
    expect(out.html).toContain("Werbehinweis");
    expect(out.html).toContain("Zu Tom*");
    expect(out.text).toContain("Abmelden: u");
  });
});

describe("sending", () => {
  it("emails each confirmed subscriber of the locale once, with one-click unsubscribe headers", async () => {
    await publishedReview("Plausible", "https://plausible.io");
    const a = await confirmedSubscriber("a@example.com");
    await confirmedSubscriber("b@example.com");
    await confirmedSubscriber("c@example.com", "de");
    await subscribeNewsletter(ctx.db, { email: "pending@example.com" }, { env: { ...env, resendApiKey: null } });
    const { issue } = (await buildDigestIssue(ctx.db, { locale: "en", now: nextWeek(), env }))!;

    const fetchMock = okFetch();
    const result = await sendDigestIssue(ctx.db, issue.id, { env, fetch: fetchMock, pauseMs: 0 });
    expect(result).toMatchObject({ status: "sent", delivered: 2, failed: 0, pending: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails/batch");
    expect((init!.headers as Record<string, string>)["Idempotency-Key"]).toMatch(new RegExp(`^digest/${issue.id}/`));
    const emails = JSON.parse(String(init!.body)) as Array<{ to: string[]; headers: Record<string, string> }>;
    expect(emails.map((e) => e.to[0]).sort()).toEqual(["a@example.com", "b@example.com"]);
    expect(emails[0]!.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(emails[0]!.headers["List-Unsubscribe"]).toMatch(
      /^<https:\/\/ai-review\.dev\/api\/newsletter\/unsubscribe\?token=/,
    );

    const after = await getDigestIssue(ctx.db, issue.id);
    expect(after).toMatchObject({ status: "sent", delivered: 2, recipients: 2 });
    const [sub] = await ctx.db.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.id, a.id));
    expect(sub!.lastIssueId).toBe(issue.id);

    // Sending again is a no-op.
    expect((await sendDigestIssue(ctx.db, issue.id, { env, fetch: fetchMock, pauseMs: 0 })).message).toBe(
      "Already sent",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resumes an interrupted batch with the same idempotency key and never re-sends delivered ones", async () => {
    await publishedReview("Plausible", "https://plausible.io");
    for (const e of ["a", "b", "c"]) await confirmedSubscriber(`${e}@example.com`);
    const { issue } = (await buildDigestIssue(ctx.db, { locale: "en", now: nextWeek(), env }))!;

    const ok = okFetch();
    let calls = 0;
    const flaky = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls += 1;
      if (calls === 2) throw new Error("socket hang up");
      return ok(url, init);
    });
    const first = await sendDigestIssue(ctx.db, issue.id, { env, fetch: flaky, pauseMs: 0, batchSize: 2 });
    expect(first).toMatchObject({ status: "failed", delivered: 2, pending: 1 });
    expect((await getDigestIssue(ctx.db, issue.id))?.error).toMatch(/Interrupted/);

    const resume = okFetch();
    const second = await sendDigestIssue(ctx.db, issue.id, { env, fetch: resume, pauseMs: 0, batchSize: 2 });
    expect(second).toMatchObject({ status: "sent", delivered: 3, pending: 0 });
    expect(resume).toHaveBeenCalledTimes(1);
    const keyOf = (call: unknown[]) => ((call[1] as RequestInit).headers as Record<string, string>)["Idempotency-Key"];
    expect(keyOf(resume.mock.calls[0]!)).toBe(keyOf(flaky.mock.calls[1]!));
    expect(JSON.parse(String(resume.mock.calls[0]![1]!.body))).toHaveLength(1);
    const rows = await ctx.db.select().from(newsletterDeliveries).where(eq(newsletterDeliveries.issueId, issue.id));
    expect(rows.map((r) => r.status)).toEqual(["sent", "sent", "sent"]);
  });

  it("marks a rejected batch failed and refuses to send without Resend credentials", async () => {
    await publishedReview("Plausible", "https://plausible.io");
    await confirmedSubscriber("a@example.com");
    const { issue } = (await buildDigestIssue(ctx.db, { locale: "en", now: nextWeek(), env }))!;
    await expect(sendDigestIssue(ctx.db, issue.id, { env: { ...env, resendApiKey: null } })).rejects.toThrow(
      /RESEND_API_KEY/,
    );
    const rejecting = vi.fn(async () => new Response("bad from", { status: 422 }));
    const result = await sendDigestIssue(ctx.db, issue.id, { env, fetch: rejecting, pauseMs: 0 });
    expect(result).toMatchObject({ status: "failed", failed: 1, delivered: 0 });
    expect(rejecting).toHaveBeenCalledTimes(1);
  });
});

describe("schedule (worker)", () => {
  const thursday8 = () => {
    const d = nextWeek();
    // Move to the Thursday 08:00 UTC of the week after today's week.
    const shift = (4 - d.getUTCDay() + 7) % 7;
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + shift - 7, 8, 5));
  };

  it("leaves a draft and notifies when auto-send is off; sends when it is on", async () => {
    await publishedReview("Plausible", "https://plausible.io");
    await confirmedSubscriber("a@example.com");
    const now = thursday8();
    // The publish must fall inside the previous week of `now`.
    const { periodStart } = previousDigestPeriod(now);
    await ctx.db.update(articles).set({ publishedAt: new Date(`${periodStart}T12:00:00Z`) });

    await setSetting(ctx.db, "newsletter.digest", {
      enabled: true,
      weekday: 4,
      hourUtc: 8,
      maxItems: 8,
      autoSend: false,
    });
    const fetchMock = okFetch();
    const draft = await runDigestSchedule(ctx.db, { now, env, fetch: fetchMock, pauseMs: 0 });
    expect(draft.built).toEqual([expect.objectContaining({ locale: "en", created: true })]);
    expect(draft.sent).toEqual([]);
    const notes = await ctx.db.select().from(notifications).where(eq(notifications.event, "newsletter.ready"));
    expect(notes).toHaveLength(1);

    // Other hours do nothing.
    expect((await runDigestSchedule(ctx.db, { now: new Date(now.getTime() + 3600_000), env })).built).toEqual([]);

    await ctx.reset();
    await seed(ctx.db);
    await publishedReview("Plausible", "https://plausible.io");
    await confirmedSubscriber("a@example.com");
    await ctx.db.update(articles).set({ publishedAt: new Date(`${periodStart}T12:00:00Z`) });
    await setSetting(ctx.db, "newsletter.digest", {
      enabled: true,
      weekday: 4,
      hourUtc: 8,
      maxItems: 8,
      autoSend: true,
    });
    const auto = await runDigestSchedule(ctx.db, { now, env, fetch: fetchMock, pauseMs: 0 });
    expect(auto.sent).toEqual([
      expect.objectContaining({ result: expect.objectContaining({ status: "sent", delivered: 1 }) }),
    ]);
  });
});

describe("subscription locale", () => {
  it("stores the locale and sends a German confirmation linking to the German page", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    await subscribeNewsletter(ctx.db, { email: "leser@example.de", locale: "de" }, { env, fetch: fetchMock });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.subject).toMatch(/bestätige/);
    expect(body.text).toContain("https://ai-review.dev/de/newsletter/confirm?token=");
    const [row] = await ctx.db.select().from(newsletterSubscribers);
    expect(row!.locale).toBe("de");

    await subscribeNewsletter(ctx.db, { email: "x@example.com", locale: "fr" }, { env, fetch: fetchMock });
    const [x] = await ctx.db
      .select()
      .from(newsletterSubscribers)
      .where(eq(newsletterSubscribers.email, "x@example.com"));
    expect(x!.locale).toBe("en");
  });
});
