import { ARTICLE_ROUTE_PREFIX, localePath } from "@repo/content";
import { listPublishedArticles } from "@repo/core";
import { getDb } from "@repo/db";
import type { Metadata } from "next";
import Link from "next/link";
import { messagesFor, pageAlternates, pageLocale } from "../lib/i18n";
import { GuideGrid } from "./guide-card";
import type { GuideType } from "./guide-page";

export async function guideIndexMetadata(type: GuideType): Promise<Metadata> {
  const locale = await pageLocale();
  const copy = messagesFor(locale).guideIndex[type];
  return {
    title: copy.title,
    description: copy.description,
    alternates: await pageAlternates(ARTICLE_ROUTE_PREFIX[type], locale),
  };
}

export async function GuideIndex({ type }: { type: GuideType }) {
  const locale = await pageLocale();
  const t = messagesFor(locale);
  const copy = t.guideIndex[type];
  const guides = await listPublishedArticles(getDb(), { types: [type], limit: 100, locale });
  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <nav aria-label={t.nav.breadcrumb} className="text-sm text-muted">
        <Link href={localePath(locale, "/")} className="hover:underline">
          {t.nav.home}
        </Link>{" "}
        / {copy.title}
      </nav>
      <h1 className="mt-4 text-3xl font-bold tracking-tight">{copy.title}</h1>
      <p className="mt-2 max-w-2xl text-muted">{copy.description}</p>
      <div className="mt-8">
        {guides.length ? <GuideGrid guides={guides} t={t} /> : <p className="text-muted">{t.guideIndex.empty}</p>}
      </div>
    </div>
  );
}
