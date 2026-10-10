import { localePath } from "@repo/content";
import { listActiveDeals, type ActiveDeal } from "@repo/core";
import { getDb } from "@repo/db";
import type { Metadata } from "next";
import Link from "next/link";
import { DealCard } from "../../../components/deal-card";
import { messagesFor, pageAlternates, pageLocale } from "../../../lib/i18n";
import { goHref, reviewPath } from "../../../lib/render";

export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await pageLocale();
  const t = messagesFor(locale);
  return {
    title: t.deals.metaTitle,
    description: t.deals.metaDescription,
    alternates: await pageAlternates("/deals", locale),
  };
}

/** Deals and coupons (FR-WEB-8), grouped by category. CTAs use go-links with placement `deals`. */
export default async function DealsPage() {
  const locale = await pageLocale();
  const t = messagesFor(locale);
  const deals = await listActiveDeals(getDb(), { locale });
  const groups = new Map<string, { name: string; deals: ActiveDeal[] }>();
  for (const d of deals) {
    const key = d.categorySlug ?? "other";
    const g = groups.get(key) ?? { name: d.categoryName ?? t.deals.other, deals: [] };
    g.deals.push(d);
    groups.set(key, g);
  }
  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight">{t.deals.title}</h1>
      <p className="mt-2 max-w-2xl text-muted">{t.deals.intro}</p>
      <p className="mt-2 text-xs text-muted">
        {t.deals.affiliate}{" "}
        <Link href={localePath(locale, "/affiliate-disclosure")} className="underline">
          {t.deals.learnMore}
        </Link>
      </p>
      {groups.size === 0 ? (
        <p className="mt-10 text-muted">{t.deals.empty}</p>
      ) : (
        [...groups.entries()].map(([slug, g]) => (
          <section key={slug} aria-labelledby={`deals-${slug}`} className="mt-10">
            <h2 id={`deals-${slug}`} className="text-xl font-semibold">
              {g.name}
            </h2>
            <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {g.deals.map((d) => (
                <li key={d.id}>
                  <DealCard
                    t={t}
                    deal={{
                      ...d,
                      href: d.goSlug ? goHref("deals")(d.goSlug, "deals") : null,
                      reviewHref: d.reviewSlug ? reviewPath(d.reviewSlug, locale) : null,
                    }}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
