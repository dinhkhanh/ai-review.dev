import { localePath, localizedArticlePath } from "@repo/content";
import { listCategoriesWithCounts, SEARCH_TYPES, searchSite, type SearchType } from "@repo/core";
import { getDb } from "@repo/db";
import { ScoreBadge } from "@repo/ui/article";
import type { Metadata } from "next";
import Link from "next/link";
import { messagesFor, pageLocale } from "../../../lib/i18n";

// Result pages are not indexed (thin, query-driven content; NFR-10).
export async function generateMetadata(): Promise<Metadata> {
  const t = messagesFor(await pageLocale());
  return { title: t.search.title, robots: { index: false, follow: true } };
}

const isType = (t: string | undefined): t is SearchType => !!t && (SEARCH_TYPES as readonly string[]).includes(t);

/** Site search (FR-WEB-7) across reviews, comparisons, alternatives and best-of lists, per locale. */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; type?: string }>;
}) {
  const locale = await pageLocale();
  const t = messagesFor(locale);
  const params = await searchParams;
  const q = params.q?.trim().slice(0, 200) ?? "";
  const type = isType(params.type) ? params.type : null;
  const category = params.category?.slice(0, 80) || null;
  const db = getDb();
  const [cats, hits] = await Promise.all([
    listCategoriesWithCounts(db, { locale }),
    q ? searchSite(db, { q, categorySlug: category, type, limit: 50, locale }) : Promise.resolve([]),
  ]);
  const select = "h-10 rounded-md border border-border bg-bg px-3 text-sm";
  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight">{q ? t.search.results(q) : t.search.title}</h1>
      <form action={localePath(locale, "/search")} method="get" role="search" className="mt-6 flex flex-wrap gap-2">
        <label htmlFor="q" className="sr-only">
          {t.search.label}
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={q}
          maxLength={200}
          placeholder={t.search.placeholder}
          className="h-10 min-w-0 flex-1 rounded-md border border-border bg-bg px-3 text-sm"
        />
        <label htmlFor="category" className="sr-only">
          {t.search.category}
        </label>
        <select id="category" name="category" defaultValue={category ?? ""} className={select}>
          <option value="">{t.search.allCategories}</option>
          {cats.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
        <label htmlFor="type" className="sr-only">
          {t.search.type}
        </label>
        <select id="type" name="type" defaultValue={type ?? ""} className={select}>
          <option value="">{t.search.allTypes}</option>
          {SEARCH_TYPES.map((x) => (
            <option key={x} value={x}>
              {t.types[x]}
            </option>
          ))}
        </select>
        <button className="h-10 rounded-md bg-brand px-4 text-sm font-medium text-brand-fg">{t.search.submit}</button>
      </form>
      {q ? (
        <div className="mt-8">
          <p className="text-sm text-muted" role="status">
            {hits.length === 0 ? t.search.noMatches : t.search.count(hits.length)}
          </p>
          <ol className="mt-4 space-y-3">
            {hits.map((h) => (
              <li key={h.id} className="relative rounded-lg border border-border p-4 hover:border-brand/50">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted">
                      {t.types[h.type]}
                      {h.categoryName ? ` · ${h.categoryName}` : ""}
                    </p>
                    <h2 className="mt-1 font-semibold">
                      <Link
                        href={localizedArticlePath(h.type, h.slug, locale)}
                        className="after:absolute after:inset-0 hover:underline"
                      >
                        {h.title}
                      </Link>
                    </h2>
                    {h.metaDescription ? (
                      <p className="mt-1 line-clamp-2 text-sm text-muted">{h.metaDescription}</p>
                    ) : null}
                  </div>
                  {h.type === "review" && typeof h.overallScore === "number" ? (
                    <ScoreBadge score={h.overallScore} size="sm" label={t.render.score} />
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
