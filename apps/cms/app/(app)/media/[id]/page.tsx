import { articleCount, getMediaAsset, listMediaChildren, mediaUsage } from "@repo/core";
import { getDb } from "@repo/db";
import { mediaUrl } from "@repo/media/urls";
import { Badge } from "@repo/ui/badge";
import { Input, Label } from "@repo/ui/input";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "../../../../components/action-form";
import { SubmitButton } from "../../../../components/submit-button";
import { fmtDate, PageHeader, Table } from "../../../../components/ui";
import { updateAltAction } from "../actions";
import { ProcessForm } from "./process-form";

export const metadata = { title: "Media asset" };

/** One asset (FR-CMS-9): preview, variants, usage, processed versions and processing (FR-MED-3). */
export default async function MediaAssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const asset = await getMediaAsset(db, id);
  if (!asset) notFound();
  const [children, usage, parent] = await Promise.all([
    listMediaChildren(db, id),
    mediaUsage(db, [id]),
    asset.parentAssetId ? getMediaAsset(db, asset.parentAssetId) : Promise.resolve(null),
  ]);
  const uses = usage.get(id) ?? [];
  const n = articleCount(uses);
  const isImage = asset.kind !== "video" && asset.kind !== "audio";
  const host = (() => {
    try {
      return asset.productWebsiteUrl ? new URL(asset.productWebsiteUrl).hostname.replace(/^www\./, "") : null;
    } catch {
      return null;
    }
  })();

  return (
    <div className="space-y-8">
      <PageHeader
        title={asset.alt || asset.role || "Media asset"}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge>{asset.kind}</Badge>
            <Badge tone={asset.origin === "generated" ? "warning" : "neutral"}>{asset.origin}</Badge>
            {asset.productName ? (
              <Link href={`/products/${asset.productId}`} className="underline">
                {asset.productName}
              </Link>
            ) : null}
            <span>
              · used in {n} article{n === 1 ? "" : "s"}
            </span>
          </span>
        }
        actions={
          <Link href="/media" className="text-sm text-brand hover:underline">
            ← Media library
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="rounded-lg border border-border bg-surface p-2">
          {isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mediaUrl(asset, "full")} alt={asset.alt ?? ""} className="mx-auto max-h-[70vh] w-auto" />
          ) : (
            <a href={mediaUrl(asset)} className="underline">
              Open {asset.kind}
            </a>
          )}
        </div>
        <aside className="space-y-5 text-sm">
          <ActionForm action={updateAltAction} className="space-y-2">
            <input type="hidden" name="assetId" value={asset.id} />
            <Label htmlFor="alt">Alt text</Label>
            <Input id="alt" name="alt" defaultValue={asset.alt ?? ""} maxLength={300} />
            <SubmitButton size="sm">Save alt text</SubmitButton>
          </ActionForm>
          <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5">
            <dt className="text-muted">Role</dt>
            <dd className="break-all">{asset.role ?? "—"}</dd>
            <dt className="text-muted">Size</dt>
            <dd>
              {asset.width}×{asset.height} · {asset.bytes ? `${Math.round(asset.bytes / 1024)} KB` : "—"} ·{" "}
              {asset.mimeType}
            </dd>
            <dt className="text-muted">Storage</dt>
            <dd className="break-all">
              {asset.storage}: {asset.storageKey}
            </dd>
            <dt className="text-muted">Captured</dt>
            <dd>{fmtDate(asset.capturedAt)}</dd>
            <dt className="text-muted">Created</dt>
            <dd>{fmtDate(asset.createdAt)}</dd>
            <dt className="text-muted">Licence</dt>
            <dd>{asset.licenseNote ?? "—"}</dd>
            {parent ? (
              <>
                <dt className="text-muted">Original</dt>
                <dd>
                  <Link href={`/media/${parent.id}`} className="underline">
                    {parent.role ?? parent.id}
                  </Link>
                </dd>
              </>
            ) : null}
            <dt className="text-muted">Variants</dt>
            <dd className="space-x-2">
              {Object.entries(asset.variants).map(([name, v]) => (
                <a key={name} href={mediaUrl({ ...asset, storageKey: v.key })} className="underline">
                  {name} {v.width}w
                </a>
              ))}
              {Object.keys(asset.variants).length === 0 ? "—" : null}
            </dd>
          </dl>
        </aside>
      </div>

      <section className="space-y-3">
        <h2 className="font-semibold">Usage</h2>
        {uses.length === 0 ? (
          <p className="text-sm text-muted">Not used in any article version or as a product logo.</p>
        ) : (
          <Table head={["Where", "Used as", "Versions"]}>
            {uses.map((u, i) => (
              <tr key={i} className="border-t border-border">
                <td className="p-3">
                  {u.articleId ? (
                    <Link href={`/articles/${u.articleId}`} className="hover:underline">
                      {u.articleTitle} <span className="text-xs text-muted">({u.articleType})</span>
                    </Link>
                  ) : (
                    <Link href={`/products/${u.productId}`} className="hover:underline">
                      {u.productName} (all of its articles)
                    </Link>
                  )}
                </td>
                <td className="p-3">{u.via === "og" ? "social/OG image" : u.via}</td>
                <td className="p-3">
                  {[u.inCurrent ? "current" : null, u.inPublished ? "published" : null].filter(Boolean).join(" + ") ||
                    "—"}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </section>

      {children.length ? (
        <section className="space-y-3">
          <h2 className="font-semibold">Processed versions</h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {children.map((c) => (
              <li key={c.id} className="rounded-lg border border-border bg-bg p-2 text-xs">
                <Link href={`/media/${c.id}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mediaUrl(c, "thumb")} alt={c.alt ?? ""} className="aspect-video w-full object-contain" />
                  <span className="mt-1 block text-muted">{fmtDate(c.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {isImage ? (
        <section className="space-y-3">
          <h2 className="font-semibold">Crop, frame and annotate</h2>
          <p className="text-sm text-muted">
            Creates a new asset linked to this one; the original stays untouched as evidence.
          </p>
          <ProcessForm assetId={asset.id} host={host} width={asset.width} height={asset.height} />
        </section>
      ) : null}
    </div>
  );
}
