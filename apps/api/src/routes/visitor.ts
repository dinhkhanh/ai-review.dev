import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  AcceptedResponseSchema,
  ErrorResponseSchema,
  NewsletterRequestSchema,
  ReportRequestSchema,
  VoteRequestSchema,
} from "@repo/contracts";
import {
  createErrorReport,
  getArticleIdBySlug,
  guardVisitorWrite,
  recordHelpfulVote,
  subscribeNewsletter,
  VISITOR_LIMITS,
  type GuardResult,
} from "@repo/core";
import type { Context } from "hono";
import type { AppEnv } from "../create-app";

/**
 * Visitor write endpoints (FR-API-3): helpful vote, error report, newsletter sign-up. No accounts or
 * cookies; each is rate-limited per daily-hashed IP and Turnstile-verified when configured.
 */

const errorBody = (description: string) => ({
  content: { "application/json": { schema: ErrorResponseSchema } },
  description,
});
const responses = () => ({
  202: { content: { "application/json": { schema: AcceptedResponseSchema } }, description: "Accepted" },
  400: errorBody("Invalid request"),
  403: errorBody("Turnstile check failed"),
  429: errorBody("Rate limited"),
});

const json = <T extends z.ZodType>(schema: T) => ({
  body: { content: { "application/json": { schema } }, required: true },
});

const voteRoute = createRoute({
  method: "post",
  path: "/reviews/{slug}/vote",
  tags: ["visitors"],
  summary: "Was this review helpful? One vote per visitor per day; voting again changes it",
  request: { params: z.object({ slug: z.string().max(120) }), ...json(VoteRequestSchema) },
  responses: { ...responses(), 404: errorBody("Review not found") },
});

const reportRoute = createRoute({
  method: "post",
  path: "/reports",
  tags: ["visitors"],
  summary: "Report a pricing change or an error in a review",
  request: json(ReportRequestSchema),
  responses: responses(),
});

const newsletterRoute = createRoute({
  method: "post",
  path: "/newsletter",
  tags: ["visitors"],
  summary: "Subscribe to the newsletter (double opt-in: a confirmation email is sent)",
  request: json(NewsletterRequestSchema),
  responses: responses(),
});

type Blocked = Extract<GuardResult, { ok: false }>;

function blocked(c: Context<AppEnv>, g: Blocked) {
  if (g.retryAfter) c.header("Retry-After", String(g.retryAfter));
  const body = { error: { code: g.code as string, message: g.message } };
  return g.status === 429 ? c.json(body, 429) : c.json(body, 403);
}

export const visitorRoutes = new OpenAPIHono<AppEnv>()
  .openapi(voteRoute, async (c) => {
    const { slug } = c.req.valid("param");
    const body = c.req.valid("json");
    const guard = await guardVisitorWrite(c.req.raw.headers, {
      bucket: "vote",
      ...VISITOR_LIMITS.vote,
      turnstileToken: body.turnstileToken,
    });
    if (!guard.ok) return blocked(c, guard);
    const db = c.get("db");
    const articleId = await getArticleIdBySlug(db, slug);
    if (!articleId) return c.json({ error: { code: "not_found", message: "Review not found" } }, 404);
    await recordHelpfulVote(db, { articleId, helpful: body.helpful, ipHash: guard.ipHash });
    return c.json({ status: "accepted" as const, message: "Thanks for the feedback" }, 202);
  })
  .openapi(reportRoute, async (c) => {
    const body = c.req.valid("json");
    const guard = await guardVisitorWrite(c.req.raw.headers, {
      bucket: "report",
      ...VISITOR_LIMITS.report,
      turnstileToken: body.turnstileToken,
    });
    if (!guard.ok) return blocked(c, guard);
    const db = c.get("db");
    await createErrorReport(db, {
      articleId: body.article ? await getArticleIdBySlug(db, body.article) : null,
      kind: body.kind,
      message: body.message,
      email: body.email ?? null,
    });
    return c.json({ status: "accepted" as const, message: "Thanks, we will re-check our sources" }, 202);
  })
  .openapi(newsletterRoute, async (c) => {
    const body = c.req.valid("json");
    const guard = await guardVisitorWrite(c.req.raw.headers, {
      bucket: "newsletter",
      ...VISITOR_LIMITS.newsletter,
      turnstileToken: body.turnstileToken,
    });
    if (!guard.ok) return blocked(c, guard);
    await subscribeNewsletter(c.get("db"), { email: body.email, source: body.source ?? "api" });
    // Same answer whether or not the address was known (no enumeration).
    return c.json({ status: "accepted" as const, message: "Check your inbox to confirm your subscription" }, 202);
  });
