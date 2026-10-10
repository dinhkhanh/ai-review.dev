import type { ArticleBody, Block } from "@repo/content";
import type { RefMap } from "@repo/pipeline/editor";
import { Input } from "@repo/ui/input";
import { ActionForm } from "../../../../components/action-form";
import { SubmitButton } from "../../../../components/submit-button";
import { field, toMd } from "../../../../lib/editor-form";
import { saveBlocksAction } from "../actions";

const area = "w-full rounded-md border border-border bg-bg p-2 font-mono text-[13px] leading-5";

function rows(text: string) {
  return Math.min(14, Math.max(2, Math.ceil(text.length / 90) + text.split("\n").length - 1));
}

function BlockFields({ block, refs }: { block: Block; refs: RefMap }) {
  const f = (name: string) => field(block.id, name);
  switch (block.type) {
    case "heading":
      return <Input name={f("text")} defaultValue={block.text} className={block.level === 2 ? "font-semibold" : ""} />;
    case "paragraph":
    case "callout": {
      const md = toMd(block.children, refs);
      return <textarea name={f("md")} defaultValue={md} rows={rows(md)} className={area} />;
    }
    case "list": {
      const md = block.items.map((i) => toMd(i, refs)).join("\n");
      return <textarea name={f("md")} defaultValue={md} rows={rows(md)} className={area} />;
    }
    case "verdict":
      return (
        <div className="space-y-2">
          <p className="text-xs text-muted">Score {block.score.toFixed(1)} (computed from the rubric)</p>
          <textarea name={f("summary")} defaultValue={block.summary} rows={3} className={area} />
          <div className="grid gap-2 sm:grid-cols-2">
            <textarea
              name={f("bestFor")}
              defaultValue={block.bestFor.join("\n")}
              rows={4}
              className={area}
              aria-label="Best for"
            />
            <textarea
              name={f("notFor")}
              defaultValue={block.notFor.join("\n")}
              rows={4}
              className={area}
              aria-label="Not for"
            />
          </div>
        </div>
      );
    case "pros_cons":
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          <textarea name={f("pros")} defaultValue={block.pros.join("\n")} rows={6} className={area} aria-label="Pros" />
          <textarea name={f("cons")} defaultValue={block.cons.join("\n")} rows={6} className={area} aria-label="Cons" />
        </div>
      );
    case "rubric":
      return (
        <div className="space-y-2">
          {block.dimensions.map((d) => {
            const just = `${d.justification}${d.citations.map((c) => `[^${refs.ref(c.sourceId)}]`).join("")}`;
            return (
              <div key={d.key} className="grid grid-cols-[8rem_4.5rem_1fr] items-start gap-2">
                <span className="pt-2 text-sm">
                  {d.label} <span className="text-xs text-muted">({Math.round(d.weight * 100)}%)</span>
                </span>
                <Input name={f(`score:${d.key}`)} type="number" step="0.5" min="1" max="10" defaultValue={d.score} />
                <textarea name={f(`just:${d.key}`)} defaultValue={just} rows={2} className={area} />
              </div>
            );
          })}
        </div>
      );
    case "faq":
      return (
        <div className="space-y-3">
          {block.items.map((item, i) => {
            const a = toMd(item.answer, refs);
            return (
              <div key={i} className="space-y-1">
                <Input name={f(`q:${i}`)} defaultValue={item.question} className="font-medium" />
                <textarea name={f(`a:${i}`)} defaultValue={a} rows={rows(a)} className={area} />
              </div>
            );
          })}
        </div>
      );
    case "cta":
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          <Input name={f("label")} defaultValue={block.label} aria-label="CTA label" />
          <Input name={f("note")} defaultValue={block.note ?? ""} placeholder="Note under the button (optional)" />
          <p className="text-xs text-muted sm:col-span-2">
            → /go/{block.goSlug}?p={block.placement}
          </p>
        </div>
      );
    case "image":
      return <Input name={f("caption")} defaultValue={block.caption ?? ""} placeholder="Caption" />;
    case "comparison_table": {
      const md = block.rows.map((r) => [r.label, ...r.values].join(" | ")).join("\n");
      return (
        <div>
          <p className="text-xs text-muted">One row per line: label | value per product (in column order)</p>
          <textarea name={f("rows")} defaultValue={md} rows={rows(md)} className={area} />
        </div>
      );
    }
    case "pricing_table":
      return (
        <p className="text-sm text-muted">
          {block.tiers
            .map((t) => `${t.name}: ${t.price === null ? "custom" : `${t.price} ${t.currency}/${t.period}`}`)
            .join(" · ")}{" "}
          — generated from the fact sheet; edit the fact sheet and use “Rebuild pricing table”.
        </p>
      );
    default:
      return <p className="text-sm text-muted">Rendered automatically.</p>;
  }
}

/** Block-based editor over the structured content (FR-CMS-5). One save = one new version. */
export function BlockEditor({
  articleId,
  versionId,
  blocks,
  refs,
  commentCounts,
}: {
  articleId: string;
  versionId: string;
  blocks: ArticleBody;
  refs: RefMap;
  commentCounts: Record<string, number>;
}) {
  return (
    <ActionForm action={saveBlocksAction} className="space-y-3">
      <input type="hidden" name="articleId" value={articleId} />
      <input type="hidden" name="baseVersionId" value={versionId} />
      <div className="sticky top-0 z-10 -mx-1 flex items-center gap-3 bg-surface px-1 py-2">
        <SubmitButton size="sm" pendingLabel="Saving…">
          Save as new version
        </SubmitButton>
        <span className="text-xs text-muted">
          Syntax: **bold**, *italic*, [text](https://…), [text](go:slug#placement), citations [^S3]
        </span>
      </div>
      {blocks.map((b) => (
        <div key={b.id} className="rounded-md border border-border bg-bg p-3" id={`block-${b.id}`}>
          <p className="mb-1.5 flex gap-2 font-mono text-[11px] text-muted">
            <span>{b.type}</span>
            <span>#{b.id}</span>
            {commentCounts[b.id] ? <span className="text-warning">{commentCounts[b.id]} comment(s)</span> : null}
          </p>
          <BlockFields block={b} refs={refs} />
        </div>
      ))}
    </ActionForm>
  );
}
