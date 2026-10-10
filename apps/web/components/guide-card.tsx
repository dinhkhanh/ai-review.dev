import { localizedArticlePath } from "@repo/content";
import type { ArticleCard } from "@repo/core";
import Link from "next/link";
import type { Messages } from "../lib/messages";

/** Card for comparisons and lists (FR-CON-8). */
export function GuideGrid({ guides, t }: { guides: ArticleCard[]; t: Messages }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {guides.map((g) => (
        <li key={g.id} className="relative">
          <article className="flex h-full flex-col rounded-lg border border-border bg-bg p-5 transition-colors hover:border-brand/50">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              {t.types[g.type]}
              {g.categoryName ? ` · ${g.categoryName}` : ""}
            </p>
            <h3 className="mt-1 text-base font-semibold leading-snug">
              <Link
                href={localizedArticlePath(g.type, g.slug, g.locale)}
                className="after:absolute after:inset-0 hover:underline"
              >
                {g.title}
              </Link>
            </h3>
            {g.metaDescription ? <p className="mt-2 line-clamp-3 text-sm text-muted">{g.metaDescription}</p> : null}
            <p className="mt-auto pt-3 text-xs text-muted">{t.card.productsCompared(g.productCount)}</p>
          </article>
        </li>
      ))}
    </ul>
  );
}
