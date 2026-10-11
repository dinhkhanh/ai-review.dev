import { articleCount, listArticles, listProducts, mediaUsage, searchMedia } from "@repo/core";
import { getDb, mediaAssets } from "@repo/db";
import { mediaUrl } from "@repo/media/urls";
import { Badge } from "@repo/ui/badge";
import { Input } from "@repo/ui/input";
import Link from "next/link";
import { ActionForm } from "../../../components/action-form";
import { SubmitButton } from "../../../components/submit-button";
import { Empty, PageHeader } from "../../../components/ui";
import { generateIllustrationAction, updateAltAction } from "./actions";

export const metadata = { title: "Media" };
// Image generation runs in a server action.
export const maxDuration = 120;

const PAGE_SIZE = 48;
const select = "h-10 max-w-full rounded-md border border-border bg-bg px-2 text-sm";

type Search = { q?: string; kind?: string; origin?: string; product?: string; missingAlt?: string; page?: string };

/** Media library (FR-CMS-9): search, filters, alt text and usage across articles. */
export default async function MediaPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const db = getDb();
  const page = Math.max(1, Number(sp.page) || 1);
  const kinds = mediaAssets.kind.enumValues;
  const origins = mediaAssets.origin.enumValues;
  const kind = kinds.find((k) => k === sp.kind) ?? null;
  const origin = origins.find((o) => o === sp.origin) ?? null;
  const [{ rows, total }, productList, articleList] = await Promise.all([
    searchMedia(db, {
      q: sp.q,
      kind,
      origin,
      productId: sp.product || null,
      missingAlt: sp.missingAlt === "1",
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    listProducts(db, { limit: 200 }),
    listArticles(db, { limit: 50 }),
  ]);
  const usage = await mediaUsage(
    db,
    rows.map((r) => r.id),
  );
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (p: number) => {
    const params = new URLSearchParams(Object.entries(sp).filter(([k, v]) => k !== "page" && v) as string[][]);
    params.set("page", String(p));
    return `/media?${params}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Media"
        subtitle={`${total} asset${total === 1 ? "" : "s"}: screenshots, graphics, logos and generated images.`}
      />

      <form className="flex flex-wrap items-end gap-2" role="search">
        <Input name="q" defaultValue={sp.q ?? ""} placeholder="Search alt text, role, product…" className="w-64" />
        <select name="kind" defaultValue={kind ?? ""} className={select} aria-label="Kind">
          <option value="">All kinds</option>
          {kinds.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <select name="origin" defaultValue={origin ?? ""} className={select} aria-label="Origin">
          <option value="">All origins</option>
          {origins.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
        <select name="product" defaultValue={sp.product ?? ""} className={select} aria-label="Product">
          <option value="">All products</option>
          {productList.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <label className="flex h-10 items-center gap-2 text-sm">
          <input type="checkbox" name="missingAlt" value="1" defaultChecked={sp.missingAlt === "1"} /> Missing alt
        </label>
        <SubmitButton size="md" variant="secondary">
          Filter
        </SubmitButton>
      </form>

      <details className="rounded-lg border border-border bg-bg p-4">
        <summary className="cursor-pointer text-sm font-medium">Generate an illustrative image</summary>
        <p className="mt-2 text-sm text-muted">
          Abstract editorial image from the article’s category and audience. No logos, product UI or text; never a
          substitute for real screenshots.
        </p>
        <ActionForm action={generateIllustrationAction} className="mt-3 flex flex-wrap items-center gap-2">
          <select name="articleId" required className={select} aria-label="Article">
            {articleList.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
          <SubmitButton size="md" pendingLabel="Generating…">
            Generate
          </SubmitButton>
        </ActionForm>
      </details>

      {rows.length === 0 ? (
        <Empty>No media matches.</Empty>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {rows.map((m) => {
            const uses = usage.get(m.id);
            const n = articleCount(uses);
            const isLogo = uses?.some((u) => u.via === "logo");
            return (
              <li key={m.id} className="overflow-hidden rounded-lg border border-border bg-bg">
                <Link href={`/media/${m.id}`} className="block bg-surface">
                  {m.kind === "video" || m.kind === "audio" ? (
                    <div className="flex aspect-video items-center justify-center text-sm text-muted">{m.kind}</div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={mediaUrl(m, "thumb")}
                      alt={m.alt ?? ""}
                      loading="lazy"
                      className="aspect-video w-full object-contain"
                    />
                  )}
                </Link>
                <div className="space-y-2 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge>{m.kind}</Badge>
                    <Badge tone={m.origin === "generated" ? "warning" : "neutral"}>{m.origin}</Badge>
                    {m.parentAssetId ? <Badge tone="brand">processed</Badge> : null}
                    <span className="text-xs text-muted">{m.width && m.height ? `${m.width}×${m.height}` : ""}</span>
                  </div>
                  <p className="truncate text-xs text-muted" title={m.role ?? ""}>
                    {m.productName ? `${m.productName} · ` : ""}
                    {m.role ?? "—"}
                  </p>
                  <ActionForm action={updateAltAction} className="flex gap-1.5">
                    <input type="hidden" name="assetId" value={m.id} />
                    <Input
                      name="alt"
                      defaultValue={m.alt ?? ""}
                      placeholder="Alt text missing"
                      aria-label="Alt text"
                      maxLength={300}
                      className={`h-8 ${m.alt ? "" : "border-warning"}`}
                    />
                    <SubmitButton size="sm" variant="secondary">
                      Save
                    </SubmitButton>
                  </ActionForm>
                  <Link href={`/media/${m.id}`} className="text-xs text-brand hover:underline">
                    {n ? `Used in ${n} article${n === 1 ? "" : "s"}` : "Not used in articles"}
                    {isLogo ? " · product logo" : ""}
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {pages > 1 ? (
        <nav className="flex items-center gap-3 text-sm" aria-label="Pagination">
          {page > 1 ? <Link href={pageHref(page - 1)}>← Previous</Link> : null}
          <span className="text-muted">
            Page {page} of {pages}
          </span>
          {page < pages ? <Link href={pageHref(page + 1)}>Next →</Link> : null}
        </nav>
      ) : null}
    </div>
  );
}
