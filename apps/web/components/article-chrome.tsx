import { localePath } from "@repo/content";
import type { ArticleRenderData } from "@repo/core";
import { ScoreBadge } from "@repo/ui/article";
import Link from "next/link";
import { formatDate, getMessages, messagesFor, publicTranslations } from "../lib/i18n";

/**
 * Shared article chrome for reviews and guides: breadcrumb, title, byline, AI disclosure and a
 * link to the article in other public locales.
 */
export async function ArticleHeader({
  data,
  current,
  verified,
  aiDisclosure,
}: {
  data: ArticleRenderData;
  /** Last breadcrumb item. */
  current: string;
  verified: Date | null;
  aiDisclosure: string | null;
}) {
  const locale = data.article.locale;
  const t = messagesFor(locale);
  const href = (path: string) => localePath(locale, path);
  const others = (await publicTranslations(data.article.id)).filter((x) => x.locale !== locale);
  return (
    <>
      <nav aria-label={t.nav.breadcrumb} className="text-sm text-muted">
        <ol className="flex flex-wrap gap-1.5">
          <li>
            <Link href={href("/")} className="hover:underline">
              {t.nav.home}
            </Link>{" "}
            /
          </li>
          {data.category ? (
            <li>
              <Link href={href(`/categories/${data.category.slug}`)} className="hover:underline">
                {data.category.name}
              </Link>{" "}
              /
            </li>
          ) : null}
          <li aria-current="page">{current}</li>
        </ol>
      </nav>
      <h1 className="mt-4 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{data.article.title}</h1>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        {data.author ? (
          <span>
            {t.article.by}{" "}
            <Link href={href(`/authors/${data.author.slug}`)} className="font-medium text-text hover:underline">
              {data.author.name}
            </Link>
          </span>
        ) : null}
        <span>{t.article.updated(formatDate(t, data.article.updatedAt))}</span>
        {verified ? <span>{t.article.verified(formatDate(t, verified))}</span> : null}
        {others.map((o) => (
          <Link key={o.locale} href={o.path} hrefLang={o.locale} lang={o.locale} className="underline">
            {messagesFor(o.locale).article.alsoIn(messagesFor(o.locale).localeNames[o.locale] ?? o.locale)}
          </Link>
        ))}
      </div>
      {aiDisclosure ? (
        <p className="mt-2 text-xs text-muted">
          {aiDisclosure}{" "}
          <Link href={href("/editorial-policy")} className="underline">
            {t.article.ourProcess}
          </Link>
        </p>
      ) : null}
    </>
  );
}

export async function ArticleToc({ toc }: { toc: Array<{ id: string; text: string }> }) {
  if (toc.length <= 2) return null;
  const t = await getMessages();
  return (
    <nav aria-label={t.article.onThisPage} className="text-sm">
      <p className="font-semibold">{t.article.onThisPage}</p>
      <ol className="mt-2 space-y-1.5 text-muted">
        {toc.map((x) => (
          <li key={x.id}>
            <a href={`#${x.id}`} className="hover:text-text hover:underline">
              {x.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Desktop sidebar score + CTA (placement "hero"). */
export async function SidebarCta({
  score,
  productName,
  href,
  label,
}: {
  score: number;
  productName: string | null;
  href: string;
  label: string;
}) {
  const t = await getMessages();
  return (
    <div className="rounded-lg border border-border p-5">
      <div className="flex items-center gap-3">
        <ScoreBadge score={score} label={t.render.score} />
        <div>
          <p className="font-semibold">{productName}</p>
          <p className="text-xs text-muted">{t.article.scoreOutOf10}</p>
        </div>
      </div>
      {t.ads.label ? <p className="mt-4 text-[0.7rem] uppercase tracking-wide text-muted">{t.ads.label}</p> : null}
      <a
        href={href}
        rel="sponsored nofollow noopener"
        target="_blank"
        className={`${t.ads.label ? "mt-1" : "mt-4"} flex h-11 items-center justify-center rounded-md bg-brand text-sm font-semibold text-brand-fg hover:opacity-90`}
      >
        {label}
        {t.ads.marker || null}
      </a>
    </div>
  );
}
