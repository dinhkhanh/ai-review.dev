import type { ArticleBody } from "@repo/content";
import { listMedia } from "@repo/core";
import { getDb } from "@repo/db";
import { mediaUrl } from "@repo/media/urls";
import { Input } from "@repo/ui/input";
import Link from "next/link";
import { ActionForm } from "../../../../components/action-form";
import { SubmitButton } from "../../../../components/submit-button";
import { generateIllustrationAction, insertIntoArticleAction } from "../../media/actions";

/**
 * Article sidebar: generate an illustrative image (FR-MED-2) and insert generated images or framed
 * screenshots (FR-MED-3) after the intro as a new version. Existing screenshots are never replaced.
 */
export async function MediaPanel({
  articleId,
  productId,
  blocks,
}: {
  articleId: string;
  productId: string | null;
  blocks: ArticleBody;
}) {
  const db = getDb();
  const [own, product] = await Promise.all([
    listMedia(db, { articleId, limit: 50 }),
    productId ? listMedia(db, { productId, limit: 100 }) : Promise.resolve([]),
  ]);
  const used = new Set(blocks.flatMap((b) => (b.type === "image" ? [b.assetId] : [])));
  const candidates = [
    ...new Map(
      [...own, ...product]
        .filter((m) => m.origin === "generated" || (m.parentAssetId && m.kind === "graphic"))
        .map((m) => [m.id, m]),
    ).values(),
  ].slice(0, 12);

  return (
    <section className="space-y-3">
      <h2 className="font-semibold">Images</h2>
      <ActionForm action={generateIllustrationAction} className="space-y-1">
        <input type="hidden" name="articleId" value={articleId} />
        <SubmitButton size="sm" variant="secondary" pendingLabel="Generating…">
          Generate illustrative image
        </SubmitButton>
        <p className="text-xs text-muted">Abstract, no logos or product UI. Screenshots stay the evidence.</p>
      </ActionForm>
      {candidates.length ? (
        <ul className="space-y-3">
          {candidates.map((m) => (
            <li key={m.id} className="rounded-md border border-border p-2 text-xs">
              <Link href={`/media/${m.id}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={mediaUrl(m, "thumb")}
                  alt={m.alt ?? ""}
                  className="aspect-video w-full rounded object-cover"
                />
              </Link>
              <p className="mt-1 text-muted">{m.origin === "generated" ? "Generated illustration" : m.role}</p>
              {used.has(m.id) ? (
                <p className="mt-1 text-success">In this version</p>
              ) : (
                <ActionForm action={insertIntoArticleAction} className="mt-1 flex gap-1">
                  <input type="hidden" name="articleId" value={articleId} />
                  <input type="hidden" name="assetId" value={m.id} />
                  <Input name="caption" placeholder="Caption (optional)" className="h-8 text-xs" maxLength={200} />
                  <SubmitButton size="sm" variant="secondary" pendingLabel="…">
                    Insert
                  </SubmitButton>
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
