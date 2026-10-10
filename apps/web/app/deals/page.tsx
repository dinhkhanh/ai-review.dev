import { listActiveDeals, type ActiveDeal } from "@repo/core";
import { getDb } from "@repo/db";
import type { Metadata } from "next";
import Link from "next/link";
import { DealCard } from "../../components/deal-card";
import { goHref } from "../../lib/render";
import { absoluteUrl } from "../../lib/site";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Software deals and coupons",
  description: "Current promo codes, free trials and discounts for the software we review.",
  alternates: { canonical: absoluteUrl("/deals") },
};

/** Deals and coupons (FR-WEB-8), grouped by category. CTAs use go-links with placement `deals`. */
export default async function DealsPage() {
  const deals = await listActiveDeals(getDb());
  const groups = new Map<string, { name: string; deals: ActiveDeal[] }>();
  for (const d of deals) {
    const key = d.categorySlug ?? "other";
    const g = groups.get(key) ?? { name: d.categoryName ?? "Other", deals: [] };
    g.deals.push(d);
    groups.set(key, g);
  }
  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight">Deals and coupons</h1>
      <p className="mt-2 max-w-2xl text-muted">
        Promo codes, trials and guarantees for products we have reviewed. We check them when we refresh each review.
      </p>
      <p className="mt-2 text-xs text-muted">
        Deal links are affiliate links: we may earn a commission at no extra cost to you.{" "}
        <Link href="/affiliate-disclosure" className="underline">
          Learn more
        </Link>
      </p>
      {groups.size === 0 ? (
        <p className="mt-10 text-muted">No active deals right now. Check back soon.</p>
      ) : (
        [...groups.entries()].map(([slug, g]) => (
          <section key={slug} aria-labelledby={`deals-${slug}`} className="mt-10">
            <h2 id={`deals-${slug}`} className="text-xl font-semibold">
              {g.name}
            </h2>
            <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {g.deals.map((d) => (
                <li key={d.id}>
                  <DealCard deal={{ ...d, href: d.goSlug ? goHref("deals")(d.goSlug, "deals") : null }} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
