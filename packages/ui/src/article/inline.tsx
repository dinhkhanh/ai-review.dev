import type { Inline } from "@repo/content";
import type { ReactNode } from "react";

/** rel for every monetised anchor (FR-AFF-14), applied by the renderer, never by authors. */
export const SPONSORED_REL = "sponsored nofollow noopener";

export interface InlineContext {
  goHref: (slug: string, placement: string) => string;
  directLinks?: Record<string, string>;
  citationNumber: (sourceId: string) => number;
  /** Accessible name for citation links; defaults to "Source n". */
  sourceLabel?: (n: number) => string;
  /** Appended to monetised link text (e.g. "*" on German pages). */
  affiliateMarker?: string;
}

export function InlineText({ inlines, ctx }: { inlines: Inline[]; ctx: InlineContext }) {
  return (
    <>
      {inlines.map((seg, i) => {
        const cite = seg.marks.find((m) => m.type === "citation");
        if (cite) {
          const n = ctx.citationNumber(cite.citation.sourceId);
          return (
            <sup key={i} className="ml-0.5 text-[0.7em]">
              <a
                href={`#source-${n}`}
                className="text-brand no-underline hover:underline"
                aria-label={ctx.sourceLabel?.(n) ?? `Source ${n}`}
              >
                [{n}]
              </a>
            </sup>
          );
        }
        let node: ReactNode = seg.text;
        if (seg.marks.some((m) => m.type === "code"))
          node = <code className="rounded bg-surface px-1 py-0.5 text-[0.9em]">{node}</code>;
        if (seg.marks.some((m) => m.type === "italic")) node = <em>{node}</em>;
        if (seg.marks.some((m) => m.type === "bold")) node = <strong className="font-semibold">{node}</strong>;
        const link = seg.marks.find((m) => m.type === "link" || m.type === "golink");
        if (link?.type === "link") {
          node = (
            <a href={link.href} className="text-brand underline underline-offset-2" rel="noopener" target="_blank">
              {node}
            </a>
          );
        } else if (link?.type === "golink") {
          node = (
            <a
              href={ctx.directLinks?.[link.slug] ?? ctx.goHref(link.slug, link.placement)}
              className="text-brand underline underline-offset-2"
              rel={SPONSORED_REL}
              target="_blank"
            >
              {node}
              {ctx.affiliateMarker || null}
            </a>
          );
        }
        return <span key={i}>{node}</span>;
      })}
    </>
  );
}
