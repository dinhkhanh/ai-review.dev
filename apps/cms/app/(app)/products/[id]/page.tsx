import { resolveGoLink } from "@repo/affiliate";
import {
  findArticleForProduct,
  getProduct,
  goSlugsForProduct,
  latestFactSheet,
  listCategories,
  listCompetitors,
  listFactSheetVersions,
  listLinks,
  listMedia,
  listPrograms,
  listSources,
  loadGoLinkTable,
  sourceRefs,
} from "@repo/core";
import { getDb } from "@repo/db";
import { mediaUrl } from "@repo/media/urls";
import { Button } from "@repo/ui/button";
import { Input, Label } from "@repo/ui/input";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "../../../../components/action-form";
import { SubmitButton } from "../../../../components/submit-button";
import { Empty, fmtDate, JsonView, PageHeader, StatusBadge, Table, Tabs } from "../../../../components/ui";
import {
  deleteLinkAction,
  refreshProductAction,
  saveAltAction,
  saveFactSheetAction,
  saveFallbackAction,
  setProgramStatusAction,
  updateProductAction,
} from "../actions";
import { LinkForm, ProgramForm } from "./affiliate-forms";

export const metadata = { title: "Product" };

const NEXT_STATUS: Record<string, string[]> = {
  not_found: ["found"],
  found: ["applied", "rejected"],
  applied: ["approved", "rejected"],
  approved: ["active"],
  active: ["paused", "terminated"],
  paused: ["active", "terminated"],
  rejected: ["applied"],
  terminated: [],
};

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; v?: string }>;
}) {
  const { id } = await params;
  const { tab = "overview" } = await searchParams;
  const db = getDb();
  const product = await getProduct(db, id);
  if (!product) notFound();
  const [categories, sheet, versions, sources, media, programs, links, goSlugs, competitors, article] =
    await Promise.all([
      listCategories(db),
      latestFactSheet(db, id),
      listFactSheetVersions(db, id),
      listSources(db, id),
      listMedia(db, { productId: id }),
      listPrograms(db, { productId: id }),
      listLinks(db, id),
      goSlugsForProduct(db, id),
      listCompetitors(db, id),
      findArticleForProduct(db, id),
    ]);
  const refs = sourceRefs(sources);
  const go = goSlugs[0];
  const table = go ? await loadGoLinkTable(db, go.slug) : null;
  const preview = table ? resolveGoLink(table, { placement: "preview", articleSlug: article?.slug }) : null;
  const programRows = programs.map((p) => p.program);
  const base = `/products/${id}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {product.name} <StatusBadge status={product.status} />
          </span>
        }
        subtitle={
          <span>
            <a href={product.websiteUrl} target="_blank" rel="noopener" className="underline">
              {product.domain}
            </a>{" "}
            · researched {fmtDate(product.lastResearchedAt)} · fact sheet v{sheet?.version ?? "—"}
          </span>
        }
        actions={
          <>
            {article ? (
              <Link href={`/articles/${article.id}`} className="text-sm text-brand hover:underline">
                Review article ({article.status.replace(/_/g, " ")})
              </Link>
            ) : null}
            <form action={refreshProductAction}>
              <input type="hidden" name="productId" value={id} />
              <SubmitButton size="sm" variant="secondary" pendingLabel="Starting…">
                Refresh research
              </SubmitButton>
            </form>
          </>
        }
      />
      <Tabs
        active={tab}
        tabs={[
          { key: "overview", label: "Overview", href: `${base}?tab=overview` },
          { key: "facts", label: "Fact sheet", href: `${base}?tab=facts`, count: versions.length },
          { key: "sources", label: "Sources", href: `${base}?tab=sources`, count: sources.length },
          { key: "affiliate", label: "Affiliate", href: `${base}?tab=affiliate`, count: programs.length },
          { key: "media", label: "Media", href: `${base}?tab=media`, count: media.length },
        ]}
      />

      {tab === "overview" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <ActionForm action={updateProductAction} className="space-y-3 rounded-lg border border-border bg-bg p-4">
            <input type="hidden" name="productId" value={id} />
            <h2 className="font-semibold">Identity</h2>
            <div>
              <Label>Name</Label>
              <Input name="name" defaultValue={product.name} />
            </div>
            <div>
              <Label>Tagline</Label>
              <Input name="tagline" defaultValue={product.tagline ?? ""} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Category</Label>
                <select
                  name="categoryId"
                  defaultValue={product.categoryId ?? ""}
                  className="h-10 w-full rounded-md border border-border bg-bg px-2 text-sm"
                >
                  <option value="">—</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Status</Label>
                <select
                  name="status"
                  defaultValue={product.status}
                  className="h-10 w-full rounded-md border border-border bg-bg px-2 text-sm"
                >
                  {["draft", "active", "discontinued", "archived"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Refresh every (days)</Label>
                <Input name="refreshIntervalDays" type="number" defaultValue={product.refreshIntervalDays} />
              </div>
            </div>
            <SubmitButton size="sm">Save</SubmitButton>
          </ActionForm>
          <div className="space-y-4 rounded-lg border border-border bg-bg p-4 text-sm">
            <h2 className="font-semibold">Resolved profile</h2>
            <dl className="grid grid-cols-3 gap-2">
              {Object.entries(product.profile ?? {}).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted">{k}</dt>
                  <dd className="col-span-2 break-all">{typeof v === "string" ? v : JSON.stringify(v)}</dd>
                </div>
              ))}
            </dl>
            <h2 className="pt-2 font-semibold">Competitors</h2>
            {competitors.length ? (
              <ul className="space-y-1">
                {competitors.map((c) => (
                  <li key={c.productId}>
                    <Link href={`/products/${c.productId}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>{" "}
                    <span className="text-muted">
                      ({c.relation}) {c.note}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">None yet.</p>
            )}
          </div>
        </div>
      ) : null}

      {tab === "facts" ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
          <ActionForm action={saveFactSheetAction} className="space-y-2">
            <input type="hidden" name="productId" value={id} />
            <p className="text-sm text-muted">
              Edit the JSON and save to create a new version. Citations reference source ids (see the Sources tab for
              S-numbers).
            </p>
            <textarea
              name="json"
              defaultValue={sheet ? JSON.stringify(sheet.data, null, 2) : ""}
              rows={32}
              spellCheck={false}
              className="w-full rounded-md border border-border bg-bg p-3 font-mono text-xs"
            />
            <SubmitButton size="sm">Save new version</SubmitButton>
          </ActionForm>
          <div className="space-y-3">
            <h2 className="font-semibold">Versions</h2>
            <ul className="space-y-2 text-sm">
              {versions.map((v) => (
                <li key={v.id} className="rounded-md border border-border p-2">
                  v{v.version} · {fmtDate(v.createdAt)} · {v.changes} changes {v.editedByUserId ? "· manual" : ""}
                </li>
              ))}
            </ul>
            {sheet?.diffFromPrevious?.length ? (
              <div>
                <h3 className="text-sm font-semibold">Changes in v{sheet.version}</h3>
                <ul className="mt-1 space-y-1 text-xs">
                  {sheet.diffFromPrevious.slice(0, 40).map((c) => (
                    <li key={c.path}>
                      <code>{c.path}</code>: <span className="text-danger">{JSON.stringify(c.before)}</span> →{" "}
                      <span className="text-success">{JSON.stringify(c.after)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {tab === "sources" ? (
        sources.length ? (
          <Table head={["Ref", "Kind", "Source", "Fetched", "HTTP", "Shot"]}>
            {sources.map((s) => {
              const shot = media.find((m) => m.id === s.screenshotAssetId);
              return (
                <tr key={s.id} className="border-t border-border align-top">
                  <td className="p-3 font-mono">{refs.ref(s.id)}</td>
                  <td className="p-3">{s.kind}</td>
                  <td className="p-3">
                    <a href={s.url} target="_blank" rel="noopener" className="font-medium hover:underline">
                      {s.title ?? s.url}
                    </a>
                    <div className="break-all text-xs text-muted">{s.url}</div>
                  </td>
                  <td className="p-3 tabular-nums">{fmtDate(s.fetchedAt)}</td>
                  <td className="p-3">{s.httpStatus ?? "—"}</td>
                  <td className="p-3">
                    {shot ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={mediaUrl(shot, "thumb")}
                        alt=""
                        className="h-12 w-20 rounded border border-border object-cover"
                      />
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </Table>
        ) : (
          <Empty>No sources yet.</Empty>
        )
      ) : null}

      {tab === "affiliate" ? (
        <div className="space-y-8">
          <section className="space-y-3">
            <h2 className="font-semibold">Go-link</h2>
            {go ? (
              <div className="space-y-2 rounded-lg border border-border bg-bg p-4 text-sm">
                <p>
                  Public link: <code>/go/{go.slug}</code> → currently resolves to{" "}
                  <span className="break-all font-mono text-xs">{preview?.url}</span>{" "}
                  {preview?.fallback ? <StatusBadge status="pending" /> : <StatusBadge status="active" />}
                  {preview?.fallback ? <span className="text-muted"> (vendor fallback with UTM)</span> : null}
                </p>
                <ActionForm action={saveFallbackAction} className="flex items-end gap-2">
                  <input type="hidden" name="productId" value={id} />
                  <input type="hidden" name="slug" value={go.slug} />
                  <div className="flex-1">
                    <Label>Fallback URL</Label>
                    <Input name="fallbackUrl" type="url" defaultValue={go.fallbackUrl} />
                  </div>
                  <SubmitButton size="sm" variant="secondary">
                    Save
                  </SubmitButton>
                </ActionForm>
              </div>
            ) : (
              <p className="text-sm text-muted">No go-link yet (created by the pipeline).</p>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="font-semibold">Programs</h2>
            {programRows.map((p) => (
              <details key={p.id} className="rounded-lg border border-border bg-bg p-4">
                <summary className="flex cursor-pointer flex-wrap items-center gap-3">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-sm text-muted">{p.network}</span>
                  <StatusBadge status={p.status} />
                  <span className="text-sm text-muted">
                    {p.commissionValue ? `${p.commissionValue}${p.commissionModel.includes("percent") ? "%" : ""}` : ""}{" "}
                    {p.commissionModel.replace(/_/g, " ")}
                    {p.cookieDays ? ` · ${p.cookieDays}-day cookie` : ""}
                  </span>
                  <span className="ml-auto flex gap-1">
                    {NEXT_STATUS[p.status]?.map((s) => (
                      <form key={s} action={setProgramStatusAction}>
                        <input type="hidden" name="programId" value={p.id} />
                        <input type="hidden" name="productId" value={id} />
                        <input type="hidden" name="status" value={s} />
                        <Button type="submit" size="sm" variant="secondary">
                          → {s}
                        </Button>
                      </form>
                    ))}
                  </span>
                </summary>
                <div className="mt-4 space-y-4">
                  {p.draftApplication ? (
                    <div>
                      <Label>Draft application</Label>
                      <textarea
                        readOnly
                        defaultValue={p.draftApplication}
                        rows={4}
                        className="w-full rounded-md border border-border bg-surface p-2 text-sm"
                      />
                    </div>
                  ) : null}
                  {p.evidence.length ? (
                    <ul className="text-xs text-muted">
                      {p.evidence.map((e) => (
                        <li key={e.url}>
                          <a href={e.url} target="_blank" rel="noopener" className="underline">
                            {e.url}
                          </a>{" "}
                          {e.note}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <ProgramForm productId={id} program={p} />
                </div>
              </details>
            ))}
            <details className="rounded-lg border border-dashed border-border p-4">
              <summary className="cursor-pointer text-sm font-medium">Add a program manually</summary>
              <div className="mt-4">
                <ProgramForm productId={id} />
              </div>
            </details>
          </section>

          <section className="space-y-3">
            <h2 className="font-semibold">Links</h2>
            <p className="text-sm text-muted">
              The go-link picks the active link with the lowest priority number for the visitor&apos;s country (then
              global); links only count when their program is active (or they have no program).
            </p>
            {links.map((l) => (
              <div key={l.id} className="rounded-lg border border-border bg-bg p-4">
                <div className="mb-3 flex items-center gap-3 text-sm">
                  <StatusBadge status={l.status} />
                  <span className="break-all font-mono text-xs">{l.destinationUrl}</span>
                  <form action={deleteLinkAction} className="ml-auto">
                    <input type="hidden" name="productId" value={id} />
                    <input type="hidden" name="linkId" value={l.id} />
                    <Button type="submit" size="sm" variant="ghost">
                      Delete
                    </Button>
                  </form>
                </div>
                <LinkForm productId={id} programs={programRows} link={l} />
              </div>
            ))}
            <div className="rounded-lg border border-dashed border-border p-4">
              <p className="mb-3 text-sm font-medium">Add a link</p>
              <LinkForm productId={id} programs={programRows} />
            </div>
          </section>
        </div>
      ) : null}

      {tab === "media" ? (
        media.length ? (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {media.map((m) => (
              <li key={m.id} className="rounded-lg border border-border bg-bg p-3 text-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={mediaUrl(m, "card")}
                  alt={m.alt ?? ""}
                  className="aspect-video w-full rounded object-cover object-top"
                />
                <p className="mt-2 text-xs text-muted">
                  {m.role ?? m.kind} · {m.width}×{m.height} · {m.storage}
                </p>
                <ActionForm action={saveAltAction} className="mt-2 flex gap-2">
                  <input type="hidden" name="assetId" value={m.id} />
                  <input type="hidden" name="productId" value={id} />
                  <Input name="alt" defaultValue={m.alt ?? ""} placeholder="Alt text" className="h-8" />
                  <SubmitButton size="sm" variant="secondary">
                    Save
                  </SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No media yet.</Empty>
        )
      ) : null}
      {tab === "overview" ? <JsonView value={sheet?.data} label="Current fact sheet" /> : null}
    </div>
  );
}
