import { articleText, blockText } from "@repo/content";
import {
  ARTICLE_TRANSITIONS,
  getArticle,
  getVersion,
  listComments,
  listSources,
  listVersions,
  loadArticleRenderData,
  sourceRefs,
} from "@repo/core";
import { getDb } from "@repo/db";
import { SECTION_KEYS, sectionKeyOf } from "@repo/pipeline/editor";
import { Button } from "@repo/ui/button";
import { Input, Label } from "@repo/ui/input";
import { ArticleRenderer } from "@repo/ui/article";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "../../../../components/action-form";
import { SubmitButton } from "../../../../components/submit-button";
import { fmtDate, Notice, PageHeader, StatusBadge, Table, Tabs } from "../../../../components/ui";
import { toPreviewModel, wordDiff } from "../../../../lib/render";
import {
  addCommentAction,
  rebuildPricingAction,
  regenerateSectionAction,
  rerunQaAction,
  resolveCommentAction,
  rollbackAction,
  saveSeoAction,
  transitionAction,
} from "../actions";
import { BlockEditor } from "./block-editor";

export const metadata = { title: "Article" };
// Section regeneration calls the model; allow long server actions on Vercel.
export const maxDuration = 300;

const LABELS: Record<string, string> = {
  in_review: "Submit for review",
  changes_requested: "Request changes",
  approved: "Approve",
  scheduled: "Schedule",
  draft: "Back to draft",
  archived: "Archive",
  published: "Publish",
};

export default async function ArticlePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; w?: string; compare?: string }>;
}) {
  const { id } = await params;
  const { tab = "edit", w, compare } = await searchParams;
  const db = getDb();
  const article = await getArticle(db, id);
  if (!article) notFound();
  const data = await loadArticleRenderData(db, id);
  const [versions, comments, sources] = await Promise.all([
    listVersions(db, id),
    listComments(db, id),
    article.productId ? listSources(db, article.productId) : Promise.resolve([]),
  ]);
  const refs = sourceRefs(sources);
  const version = data?.version;
  const qa = version?.qaScorecard;
  const fc = version?.factCheck;
  const transitions = [...ARTICLE_TRANSITIONS[article.status].filter((s) => s !== "published")];
  const canPublish = article.status === "approved" || article.status === "scheduled";
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const base = `/articles/${id}`;
  const openComments = comments.filter((c) => !c.resolved);
  const commentCounts: Record<string, number> = {};
  for (const c of openComments) if (c.blockId) commentCounts[c.blockId] = (commentCounts[c.blockId] ?? 0) + 1;
  const sections = SECTION_KEYS.filter((k) => version?.blocks.some((b) => sectionKeyOf(b.id) === k));
  const compareVersion = compare ? await getVersion(db, compare) : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title={article.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={article.status} />
            <span>v{versions[0]?.version ?? 0}</span>
            {version?.overallScore ? <span>· score {version.overallScore.toFixed(1)}</span> : null}
            {qa ? <span>· gates {qa.hardGatesPassed ? "✓ pass" : "✗ fail"}</span> : null}
            {article.publishedVersionId ? (
              <>
                · live{" "}
                <a href={`${site}/reviews/${article.slug}`} target="_blank" rel="noopener" className="underline">
                  /reviews/{article.slug}
                </a>
                {article.publishedVersionId !== article.currentVersionId ? (
                  <span className="text-warning">(unpublished edits)</span>
                ) : null}
              </>
            ) : null}
            {article.productId ? (
              <Link href={`/products/${article.productId}`} className="underline">
                product
              </Link>
            ) : null}
          </span>
        }
        actions={
          <div className="flex flex-wrap items-start gap-2">
            {transitions.map((to) => (
              <ActionForm key={to} action={transitionAction} className="flex items-center gap-1">
                <input type="hidden" name="articleId" value={id} />
                <input type="hidden" name="to" value={to} />
                {to === "scheduled" ? (
                  <Input type="datetime-local" name="scheduledFor" required className="h-8 w-48" />
                ) : null}
                <SubmitButton size="sm" variant={to === "approved" ? "primary" : "secondary"}>
                  {LABELS[to] ?? to}
                </SubmitButton>
              </ActionForm>
            ))}
            {canPublish ? (
              <ActionForm action={transitionAction}>
                <input type="hidden" name="articleId" value={id} />
                <input type="hidden" name="to" value="published" />
                <SubmitButton size="sm" disabled={!qa?.hardGatesPassed} pendingLabel="Publishing…">
                  Publish now
                </SubmitButton>
              </ActionForm>
            ) : null}
          </div>
        }
      />
      {article.scheduledFor ? <Notice>Scheduled for {fmtDate(article.scheduledFor)} UTC.</Notice> : null}
      {qa && !qa.hardGatesPassed ? (
        <Notice tone="error">
          Hard gates failing:{" "}
          {qa.checks
            .filter((c) => c.hard && !c.passed)
            .map((c) => c.label)
            .join(", ")}
          . Publishing is blocked.
        </Notice>
      ) : null}

      <Tabs
        active={tab}
        tabs={[
          { key: "edit", label: "Edit", href: `${base}?tab=edit` },
          { key: "preview", label: "Preview", href: `${base}?tab=preview` },
          { key: "qa", label: "QA", href: `${base}?tab=qa` },
          { key: "facts", label: "Fact-check", href: `${base}?tab=facts`, count: fc?.claims.length },
          { key: "seo", label: "SEO", href: `${base}?tab=seo` },
          { key: "versions", label: "Versions", href: `${base}?tab=versions`, count: versions.length },
          { key: "comments", label: "Comments", href: `${base}?tab=comments`, count: openComments.length },
        ]}
      />

      {!version ? <Notice>No content yet; the pipeline has not written this article.</Notice> : null}

      {tab === "edit" && version ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <BlockEditor
            articleId={id}
            versionId={version.id}
            blocks={version.blocks}
            refs={refs}
            commentCounts={commentCounts}
          />
          <aside className="space-y-6">
            <section className="space-y-2">
              <h2 className="font-semibold">Regenerate a section</h2>
              <ActionForm action={regenerateSectionAction} className="space-y-2">
                <input type="hidden" name="articleId" value={id} />
                <select name="section" className="h-9 w-full rounded-md border border-border bg-bg px-2 text-sm">
                  {sections.map((s) => (
                    <option key={s} value={s}>
                      {s.replace("_", " ")}
                    </option>
                  ))}
                </select>
                <textarea
                  name="instruction"
                  rows={3}
                  placeholder="e.g. Shorter, and compare the Plus plan with Coda's"
                  className="w-full rounded-md border border-border bg-bg p-2 text-sm"
                />
                <SubmitButton size="sm" variant="secondary" pendingLabel="Writing… (up to a minute)">
                  Regenerate
                </SubmitButton>
              </ActionForm>
              <form action={rebuildPricingAction}>
                <input type="hidden" name="articleId" value={id} />
                <Button type="submit" size="sm" variant="ghost">
                  Rebuild pricing table from fact sheet
                </Button>
              </form>
            </section>
            <section>
              <h2 className="font-semibold">Sources</h2>
              <ol className="mt-2 max-h-[60vh] space-y-1.5 overflow-auto text-xs">
                {sources.map((s) => (
                  <li key={s.id}>
                    <span className="font-mono font-semibold">{refs.ref(s.id)}</span>{" "}
                    <a href={s.url} target="_blank" rel="noopener" className="underline">
                      {s.title ?? s.url}
                    </a>{" "}
                    <span className="text-muted">
                      ({s.kind}, {fmtDate(s.fetchedAt).slice(0, 10)})
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          </aside>
        </div>
      ) : null}

      {tab === "preview" && data ? (
        <div className="space-y-3">
          <div className="flex gap-2 text-sm">
            <Link href={`${base}?tab=preview`} className={!w ? "font-semibold" : "text-brand underline"}>
              Desktop
            </Link>
            <Link
              href={`${base}?tab=preview&w=mobile`}
              className={w === "mobile" ? "font-semibold" : "text-brand underline"}
            >
              Mobile
            </Link>
          </div>
          <div
            className={`mx-auto rounded-lg border border-border bg-bg p-6 ${w === "mobile" ? "max-w-[390px]" : "max-w-[760px]"}`}
          >
            <h1 className="text-3xl font-bold leading-tight">{article.title}</h1>
            <div className="mt-6">
              <ArticleRenderer model={toPreviewModel(data)} />
            </div>
          </div>
        </div>
      ) : null}

      {tab === "qa" && version ? (
        <div className="space-y-3">
          <form action={rerunQaAction}>
            <input type="hidden" name="articleId" value={id} />
            <SubmitButton size="sm" variant="secondary">
              Recompute scorecard
            </SubmitButton>
          </form>
          {qa ? (
            <Table head={["Check", "Gate", "Result", "Value", "Detail"]}>
              {qa.checks.map((c) => (
                <tr key={c.key} className="border-t border-border">
                  <td className="p-3">{c.label}</td>
                  <td className="p-3 text-xs">{c.hard ? "hard" : "soft"}</td>
                  <td className="p-3">
                    {c.passed ? (
                      <span className="text-success">✓</span>
                    ) : (
                      <span className={c.hard ? "text-danger" : "text-warning"}>✗</span>
                    )}
                  </td>
                  <td className="p-3 tabular-nums">{c.value === undefined ? "" : String(c.value)}</td>
                  <td className="max-w-md p-3 text-xs text-muted">{c.detail}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <Notice>No scorecard yet for this version.</Notice>
          )}
        </div>
      ) : null}

      {tab === "facts" && version ? (
        fc ? (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              {fc.supported} supported · {fc.unsupported} unsupported · {fc.outdated} outdated · {fc.uncited} uncited ·{" "}
              {fc.fixedCount} repaired automatically · checked {fmtDate(fc.checkedAt)}
            </p>
            <Table head={["Verdict", "Claim", "Sources", "Note"]}>
              {[...fc.claims]
                .sort((a, b) => (a.verdict === "supported" ? 1 : 0) - (b.verdict === "supported" ? 1 : 0))
                .map((c) => (
                  <tr key={c.id} className="border-t border-border align-top">
                    <td className="p-3">
                      <StatusBadge status={c.verdict} />
                      {c.fixed ? <span className="ml-1 text-xs text-muted">repaired</span> : null}
                    </td>
                    <td className="p-3">
                      <a href={`${base}?tab=edit#block-${c.blockId}`} className="hover:underline">
                        {c.text}
                      </a>
                    </td>
                    <td className="p-3 font-mono text-xs">{c.sourceIds.map((s) => refs.ref(s)).join(", ")}</td>
                    <td className="p-3 text-xs text-muted">{c.note}</td>
                  </tr>
                ))}
            </Table>
          </div>
        ) : (
          <Notice>This version has not been fact-checked.</Notice>
        )
      ) : null}

      {tab === "seo" && version ? (
        <ActionForm action={saveSeoAction} className="max-w-2xl space-y-3">
          <input type="hidden" name="articleId" value={id} />
          <div>
            <Label>Article title (H1)</Label>
            <Input name="title" defaultValue={article.title} />
          </div>
          <div>
            <Label>SEO title ({version.seo?.title.length ?? 0}/60)</Label>
            <Input name="seoTitle" defaultValue={version.seo?.title ?? ""} maxLength={70} />
          </div>
          <div>
            <Label>Meta description ({version.seo?.metaDescription.length ?? 0}/160)</Label>
            <textarea
              name="metaDescription"
              defaultValue={version.seo?.metaDescription ?? ""}
              maxLength={170}
              rows={3}
              className="w-full rounded-md border border-border bg-bg p-2 text-sm"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Primary keyword</Label>
              <Input name="primaryKeyword" defaultValue={version.seo?.primaryKeyword ?? ""} />
            </div>
            <div>
              <Label>Slug {article.publishedVersionId ? "(locked: published)" : ""}</Label>
              <Input name="slug" defaultValue={article.slug} disabled={!!article.publishedVersionId} />
            </div>
          </div>
          <p className="text-xs text-muted">Secondary keywords: {version.seo?.secondaryKeywords.join(", ") || "—"}</p>
          <SubmitButton size="sm">Save SEO</SubmitButton>
        </ActionForm>
      ) : null}

      {tab === "versions" ? (
        <div className="space-y-4">
          <Table head={["Version", "Change", "By", "Created", ""]}>
            {versions.map((v) => (
              <tr key={v.id} className="border-t border-border">
                <td className="p-3 tabular-nums">
                  v{v.version}
                  {v.id === article.publishedVersionId ? <span className="ml-2 text-xs text-success">live</span> : null}
                </td>
                <td className="p-3">{v.changeNote}</td>
                <td className="p-3 text-xs text-muted">
                  {v.createdByJobId ? "pipeline" : v.createdByUserId ? "editor" : "—"}
                </td>
                <td className="p-3 tabular-nums">{fmtDate(v.createdAt)}</td>
                <td className="flex justify-end gap-2 p-3">
                  <Link href={`${base}?tab=versions&compare=${v.id}`} className="text-sm text-brand hover:underline">
                    Diff vs current
                  </Link>
                  {v.id !== article.currentVersionId ? (
                    <form action={rollbackAction}>
                      <input type="hidden" name="articleId" value={id} />
                      <input type="hidden" name="versionId" value={v.id} />
                      <Button type="submit" size="sm" variant="ghost">
                        Roll back
                      </Button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
          {compareVersion && version ? (
            <section className="space-y-2">
              <h2 className="font-semibold">
                v{compareVersion.version} → current (v{versions[0]?.version})
              </h2>
              {version.blocks.map((b) => {
                const old = compareVersion.blocks.find((x) => x.id === b.id);
                const before = old ? blockText(old) : "";
                const after = blockText(b);
                if (before === after) return null;
                return (
                  <div key={b.id} className="rounded-md border border-border bg-bg p-3 text-sm leading-6">
                    <p className="mb-1 font-mono text-[11px] text-muted">
                      #{b.id}
                      {old ? "" : " (new)"}
                    </p>
                    {wordDiff(before, after).map((p, i) => (
                      <span
                        key={i}
                        className={p.op === "add" ? "bg-success/20" : p.op === "del" ? "bg-danger/20 line-through" : ""}
                      >
                        {p.text}
                      </span>
                    ))}
                  </div>
                );
              })}
              {compareVersion.blocks
                .filter((b) => !version.blocks.some((x) => x.id === b.id))
                .map((b) => (
                  <div key={b.id} className="rounded-md border border-border bg-bg p-3 text-sm">
                    <p className="mb-1 font-mono text-[11px] text-muted">#{b.id} (removed)</p>
                    <span className="bg-danger/20 line-through">{blockText(b)}</span>
                  </div>
                ))}
              <p className="text-xs text-muted">
                Words: {articleText(compareVersion.blocks).split(/\s+/).length} →{" "}
                {articleText(version.blocks).split(/\s+/).length}
              </p>
            </section>
          ) : null}
        </div>
      ) : null}

      {tab === "comments" ? (
        <div className="max-w-3xl space-y-4">
          <ActionForm action={addCommentAction} className="space-y-2 rounded-lg border border-border bg-bg p-4">
            <input type="hidden" name="articleId" value={id} />
            <input type="hidden" name="versionId" value={version?.id ?? ""} />
            <select name="blockId" className="h-9 w-full rounded-md border border-border bg-bg px-2 text-sm">
              <option value="">Whole article</option>
              {version?.blocks.map((b) => (
                <option key={b.id} value={b.id}>
                  #{b.id} — {blockText(b).slice(0, 60)}
                </option>
              ))}
            </select>
            <textarea
              name="body"
              rows={3}
              required
              className="w-full rounded-md border border-border bg-bg p-2 text-sm"
            />
            <SubmitButton size="sm">Add comment</SubmitButton>
          </ActionForm>
          <ul className="space-y-2">
            {comments.map((c) => (
              <li
                key={c.id}
                className={`rounded-lg border border-border p-3 text-sm ${c.resolved ? "opacity-60" : "bg-bg"}`}
              >
                <p className="text-xs text-muted">
                  {fmtDate(c.createdAt)} {c.blockId ? `· #${c.blockId}` : ""} {c.resolved ? "· resolved" : ""}
                </p>
                <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
                <form action={resolveCommentAction} className="mt-2">
                  <input type="hidden" name="articleId" value={id} />
                  <input type="hidden" name="commentId" value={c.id} />
                  <input type="hidden" name="resolved" value={c.resolved ? "0" : "1"} />
                  <Button type="submit" size="sm" variant="ghost">
                    {c.resolved ? "Reopen" : "Resolve"}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
