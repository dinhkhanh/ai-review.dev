import {
  clientIpFrom,
  deviceClass,
  hashWithDailySalt,
  isBotUserAgent,
  resolveGoLink,
  sanitizeToken,
} from "@repo/affiliate";
import { articleIdForClick, localeFromPath, recordClick } from "@repo/core";
import { getDb } from "@repo/db";
import { after, type NextRequest } from "next/server";
import { getGoLinkTable, isClickBurst } from "../../../lib/golinks";
import { SITE } from "../../../lib/site";

export const dynamic = "force-dynamic";

function notFoundPage(slug: string) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link not found — ${SITE.name}</title></head><body style="font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;line-height:1.5"><h1>That link does not exist</h1><p>We could not find an offer for “${slug.replace(/[<>&"]/g, "")}”.</p><form action="/reviews" method="get"><label for="q">Search our reviews</label><br><input id="q" name="q" style="padding:.5rem;width:70%"> <button>Search</button></form><p><a href="/">Back to home</a></p></body></html>`;
  return new Response(html, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/**
 * Go-link redirect (FR-AFF-6, FR-AFF-7, NFR-2): resolve the best affiliate link for the visitor's
 * country with a SubID, 302 immediately, and log the click after the response (cookieless). A/B
 * variant clicks record their experiment (FR-AFF-13); the referring page's prefix gives the locale.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug: raw } = await params;
  const slug = sanitizeToken(raw, 80);
  const placement = sanitizeToken(request.nextUrl.searchParams.get("p"), 20) || null;
  const articleSlug = sanitizeToken(request.nextUrl.searchParams.get("a"), 80) || null;
  const country = request.headers.get("x-vercel-ip-country");

  let table;
  try {
    table = await getGoLinkTable(slug);
  } catch (error) {
    console.error("go-link lookup failed", error);
    return Response.redirect(new URL("/", request.url), 302);
  }
  if (!table) return notFoundPage(slug);

  const resolution = resolveGoLink(table, { country, articleSlug, placement });
  const ua = request.headers.get("user-agent");
  const referer = request.headers.get("referer");

  after(async () => {
    try {
      const secret = process.env.REVALIDATE_SECRET ?? "local-dev";
      const ipHash = await hashWithDailySalt(clientIpFrom(request.headers.get("x-forwarded-for")), secret);
      const db = getDb();
      let path: string | null = null;
      try {
        path = referer ? new URL(referer).pathname : null;
      } catch {
        path = null;
      }
      const locale = localeFromPath(path);
      await recordClick(db, {
        goSlug: table.slug,
        linkId: resolution.linkId,
        experimentId: resolution.experimentId,
        locale,
        articleId: articleSlug ? await articleIdForClick(db, articleSlug, locale) : null,
        placement,
        path,
        country,
        device: deviceClass(ua),
        ipHash,
        uaHash: await hashWithDailySalt(ua, secret),
        isBot: isBotUserAgent(ua) || (await isClickBurst(ipHash)),
        fallback: resolution.fallback,
      });
    } catch (error) {
      console.error("click logging failed", error);
    }
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: resolution.url,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer-when-downgrade",
    },
  });
}
