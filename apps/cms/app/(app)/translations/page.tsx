import { ARTICLE_TYPE_LABEL, localizedArticlePath, type ArticleTypeKey } from "@repo/content";
import {
  catalogTranslations,
  getSetting,
  translationCoverage,
  TRANSLATION_LOCALES,
  type TranslationState,
} from "@repo/core";
import { getDb } from "@repo/db";
import { Input } from "@repo/ui/input";
import Link from "next/link";
import { ActionForm } from "../../../components/action-form";
import { SubmitButton } from "../../../components/submit-button";
import { Empty, fmtDate, Notice, PageHeader, StatusBadge, Table, Tabs } from "../../../components/ui";
import { saveCatalogTranslationAction, translateSelectedAction } from "./actions";

export const metadata = { title: "Translations" };

const LOCALE_LABEL: Record<string, string> = { de: "German" };
const FILTERS: Array<{ key: string; label: string; states: TranslationState[] | null }> = [
  { key: "todo", label: "Missing or stale", states: ["missing", "stale"] },
  { key: "review", label: "In review", states: ["in_review", "changes_requested", "approved", "scheduled", "draft"] },
  { key: "published", label: "Published", states: ["published"] },
  { key: "running", label: "Running", states: ["in_progress"] },
  { key: "all", label: "All", states: null },
];

/** Translations (phase 3 second locale): coverage of English articles and catalogue strings per locale. */
export default async function TranslationsPage({
  searchParams,
}: {
  searchParams: Promise<{ locale?: string; view?: string; tab?: string }>;
}) {
  const { locale = TRANSLATION_LOCALES[0]!, view = "todo", tab = "articles" } = await searchParams;
  const db = getDb();
  const policy = await getSetting(db, "i18n.policy");
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const isPublic = policy?.enabledLocales.includes(locale as never) ?? false;
  const auto = policy?.autoTranslate.includes(locale as never) ?? false;
  const base = `/translations?locale=${locale}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Translations"
        subtitle={`${LOCALE_LABEL[locale] ?? locale} versions of published English articles. A translation is stale when the English article publishes a newer version; re-translating rewrites only the changed sections.`}
      />
      <Notice>
        {LOCALE_LABEL[locale] ?? locale} pages are {isPublic ? "public" : "not public yet"} and auto-translate on
        publish is {auto ? "on" : "off"} (Settings → <code>i18n.policy</code>). Translations are reviewed like any
        article before they go live.
      </Notice>
      <Tabs
        active={tab}
        tabs={[
          { key: "articles", label: "Articles", href: `${base}&tab=articles` },
          { key: "catalog", label: "Categories & products", href: `${base}&tab=catalog` },
        ]}
      />
      {tab === "catalog" ? (
        <CatalogTab locale={locale} />
      ) : (
        <ArticlesTab locale={locale} view={view} base={base} site={site} />
      )}
    </div>
  );
}

async function ArticlesTab({ locale, view, base, site }: { locale: string; view: string; base: string; site: string }) {
  const rows = await translationCoverage(getDb(), locale);
  const filter = FILTERS.find((f) => f.key === view) ?? FILTERS[0]!;
  const shown = filter.states ? rows.filter((r) => filter.states!.includes(r.state)) : rows;
  return (
    <div className="space-y-4">
      <Tabs
        active={filter.key}
        tabs={FILTERS.map((f) => ({
          key: f.key,
          label: f.label,
          href: `${base}&tab=articles&view=${f.key}`,
          count: f.states ? rows.filter((r) => f.states!.includes(r.state)).length : rows.length,
        }))}
      />
      {shown.length === 0 ? (
        <Empty>Nothing here.</Empty>
      ) : (
        <ActionForm action={translateSelectedAction} className="space-y-3">
          <input type="hidden" name="locale" value={locale} />
          <Table head={["", "English article", "Type", "Product", "Translation", "State", "English published", ""]}>
            {shown.map((r) => (
              <tr key={r.sourceId} className="border-t border-border">
                <td className="p-3">
                  <input
                    type="checkbox"
                    name="sourceArticleId"
                    value={r.sourceId}
                    aria-label={`Select ${r.title}`}
                    disabled={r.state === "in_progress"}
                    defaultChecked={r.state === "missing" || r.state === "stale"}
                  />
                </td>
                <td className="p-3 font-medium">
                  <Link href={`/articles/${r.sourceId}`} className="hover:underline">
                    {r.title}
                  </Link>
                </td>
                <td className="p-3 text-muted">{ARTICLE_TYPE_LABEL[r.type as ArticleTypeKey]}</td>
                <td className="p-3">{r.productName ?? "—"}</td>
                <td className="p-3">
                  {r.target ? (
                    <Link href={`/articles/${r.target.id}`} className="hover:underline">
                      {r.target.title}
                    </Link>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="p-3">
                  <StatusBadge status={r.state} />
                </td>
                <td className="p-3 tabular-nums">{fmtDate(r.sourcePublishedAt)}</td>
                <td className="p-3 text-right">
                  {r.jobId ? (
                    <Link href={`/jobs/${r.jobId}`} className="text-brand hover:underline">
                      Job
                    </Link>
                  ) : r.target && r.state === "published" ? (
                    <a
                      href={`${site}${localizedArticlePath(r.type as ArticleTypeKey, r.target.slug, locale)}`}
                      target="_blank"
                      rel="noopener"
                      className="text-brand hover:underline"
                    >
                      View
                    </a>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
          <SubmitButton size="sm" pendingLabel="Queuing…">
            Translate selected
          </SubmitButton>
          <p className="text-xs text-muted">
            Each translation costs roughly $0.10–0.40 (Opus, about one call per 9,000 characters) and lands in the
            review queue.
          </p>
        </ActionForm>
      )}
    </div>
  );
}

type Localized = Record<string, Record<string, string> | undefined>;

async function CatalogTab({ locale }: { locale: string }) {
  const { categories, products } = await catalogTranslations(getDb());
  const tr = (t: unknown, field: string) => (t as Localized | null)?.[locale]?.[field] ?? "";
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="font-semibold">Categories</h2>
        <p className="text-sm text-muted">
          Translated automatically with the first translated article in a category; edit them here.
        </p>
        <Table head={["English", `${LOCALE_LABEL[locale] ?? locale}`]}>
          {categories.map((c) => (
            <tr key={c.id} className="border-t border-border align-top">
              <td className="p-3">
                <p className="font-medium">{c.name}</p>
                <p className="text-xs text-muted">{c.description}</p>
              </td>
              <td className="p-3">
                <ActionForm action={saveCatalogTranslationAction} className="space-y-2">
                  <input type="hidden" name="kind" value="category" />
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="locale" value={locale} />
                  <Input name="name" defaultValue={tr(c.translations, "name")} placeholder="Name" aria-label="Name" />
                  <textarea
                    name="description"
                    defaultValue={tr(c.translations, "description")}
                    rows={2}
                    placeholder="Description"
                    aria-label="Description"
                    className="w-full rounded-md border border-border bg-bg p-2 text-sm"
                  />
                  <SubmitButton size="sm" variant="secondary">
                    Save
                  </SubmitButton>
                </ActionForm>
              </td>
            </tr>
          ))}
        </Table>
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold">Product taglines</h2>
        {products.length === 0 ? (
          <Empty>No products yet.</Empty>
        ) : (
          <Table head={["Product", "English tagline", `${LOCALE_LABEL[locale] ?? locale} tagline`]}>
            {products.map((p) => (
              <tr key={p.id} className="border-t border-border align-top">
                <td className="p-3 font-medium">{p.name}</td>
                <td className="p-3 text-muted">{p.tagline ?? "—"}</td>
                <td className="p-3">
                  <ActionForm action={saveCatalogTranslationAction} className="flex gap-2">
                    <input type="hidden" name="kind" value="product" />
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="locale" value={locale} />
                    <Input name="tagline" defaultValue={tr(p.translations, "tagline")} aria-label="Tagline" />
                    <SubmitButton size="sm" variant="secondary">
                      Save
                    </SubmitButton>
                  </ActionForm>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </section>
    </div>
  );
}
