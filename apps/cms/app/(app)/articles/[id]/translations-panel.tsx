import { localizedArticlePath, type ArticleTypeKey } from "@repo/content";
import { translationGroup } from "@repo/core";
import { getDb } from "@repo/db";
import Link from "next/link";
import { ActionForm } from "../../../../components/action-form";
import { SubmitButton } from "../../../../components/submit-button";
import { StatusBadge } from "../../../../components/ui";
import { translateArticleAction } from "../../translations/actions";

const LOCALE_LABEL: Record<string, string> = { en: "English", de: "German" };

function TranslateButton(props: {
  articleId: string;
  sourceId: string;
  locale: string;
  label: string;
  full?: boolean;
}) {
  return (
    <ActionForm action={translateArticleAction}>
      <input type="hidden" name="articleId" value={props.articleId} />
      <input type="hidden" name="sourceArticleId" value={props.sourceId} />
      <input type="hidden" name="locale" value={props.locale} />
      {props.full ? <input type="hidden" name="full" value="1" /> : null}
      <SubmitButton size="sm" variant={props.full ? "ghost" : "secondary"} pendingLabel="Queuing…">
        {props.label}
      </SubmitButton>
    </ActionForm>
  );
}

/**
 * Translations of an article (phase 3 second locale): on an English article, each locale's state
 * with translate / re-translate; on a translation, its source and whether it is stale.
 */
export async function TranslationsPanel({ articleId }: { articleId: string }) {
  const group = await translationGroup(getDb(), articleId);
  if (!group?.source) return null;
  const { source } = group;
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const self = group.translations.find((t) => t.id === articleId);

  return (
    <section className="space-y-2">
      <h2 className="font-semibold">Translations</h2>
      {group.isSource ? (
        <>
          {!source.publishedVersionId ? (
            <p className="text-sm text-muted">
              Publish the English article first; translations follow the live version.
            </p>
          ) : null}
          <ul className="space-y-3 text-sm">
            {group.translations.map((t) => (
              <li key={t.id} className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{LOCALE_LABEL[t.locale] ?? t.locale}</span>
                  <StatusBadge status={t.state} />
                  <Link href={`/articles/${t.id}`} className="text-brand hover:underline">
                    Open
                  </Link>
                </div>
                {source.publishedVersionId && t.state !== "in_progress" ? (
                  <div className="flex flex-wrap gap-1">
                    {t.state === "stale" ? (
                      <TranslateButton
                        articleId={articleId}
                        sourceId={source.id}
                        locale={t.locale}
                        label="Update changed sections"
                      />
                    ) : null}
                    <TranslateButton
                      articleId={articleId}
                      sourceId={source.id}
                      locale={t.locale}
                      label="Re-translate everything"
                      full
                    />
                  </div>
                ) : null}
              </li>
            ))}
            {group.missing.map((m) => (
              <li key={m.locale} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{LOCALE_LABEL[m.locale] ?? m.locale}</span>
                <StatusBadge status={m.state} />
                {source.publishedVersionId && m.state === "missing" ? (
                  <TranslateButton articleId={articleId} sourceId={source.id} locale={m.locale} label="Translate" />
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="space-y-2 text-sm">
          <p>
            {LOCALE_LABEL[self?.locale ?? ""] ?? self?.locale} translation of{" "}
            <Link href={`/articles/${source.id}`} className="text-brand hover:underline">
              {source.title}
            </Link>{" "}
            (
            <a
              href={`${site}${localizedArticlePath(source.type as ArticleTypeKey, source.slug, source.locale)}`}
              target="_blank"
              rel="noopener"
              className="underline"
            >
              English page
            </a>
            ).
          </p>
          {self ? <StatusBadge status={self.state === "stale" ? "stale" : "current"} /> : null}
          {self?.state === "stale" ? (
            <p className="text-warning">
              The English article has a newer published version. Updating re-translates only the changed sections and
              keeps your edits elsewhere.
            </p>
          ) : null}
          <p className="text-xs text-muted">
            Edit the German text directly in the blocks. Section regeneration writes English, so it is off for
            translations.
          </p>
          {self && self.state !== "in_progress" ? (
            <div className="flex flex-wrap gap-1">
              {self.state === "stale" ? (
                <TranslateButton
                  articleId={articleId}
                  sourceId={source.id}
                  locale={self.locale}
                  label="Update changed sections"
                />
              ) : null}
              <TranslateButton
                articleId={articleId}
                sourceId={source.id}
                locale={self.locale}
                label="Re-translate everything"
                full
              />
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
