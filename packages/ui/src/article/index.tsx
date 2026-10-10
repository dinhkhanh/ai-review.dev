import type { ArticleBody } from "@repo/content";
import { BlockView, CtaButton, formatTierPrice, ScoreBadge } from "./blocks";
import { InlineText, SPONSORED_REL, type InlineContext } from "./inline";
import { citationOrder, defaultGoHref, hasMonetisedLinks, type RenderModel } from "./model";

export * from "./model";
export { CtaButton, formatTierPrice, InlineText, ScoreBadge, SPONSORED_REL };

/** Affiliate disclosure, shown above the fold on every page with a monetised link (FR-AFF-14). */
export function AffiliateDisclosure({ href = "/affiliate-disclosure" }: { href?: string }) {
  return (
    <p className="rounded-md border border-border bg-surface px-3 py-2 text-xs leading-5 text-muted" role="note">
      <strong className="font-semibold text-text">Disclosure:</strong> we may earn a commission if you buy through links
      on this page, at no extra cost to you. It never changes our verdict.{" "}
      <a href={href} className="underline">
        How we make money
      </a>
    </p>
  );
}

function SourcesList({ model, order }: { model: RenderModel; order: string[] }) {
  const byId = new Map(model.sources.map((s) => [s.id, s]));
  const cited = order.map((id) => byId.get(id)).filter((s): s is NonNullable<typeof s> => !!s);
  if (cited.length === 0) return null;
  return (
    <section aria-labelledby="sources-heading" className="mt-12 border-t border-border pt-6">
      <h2 id="sources-heading" className="text-lg font-semibold">
        Sources
      </h2>
      <ol className="mt-3 space-y-1.5 text-sm text-muted">
        {cited.map((s, i) => (
          <li key={s.id} id={`source-${i + 1}`} className="scroll-mt-20">
            [{i + 1}]{" "}
            <a href={s.url} rel="noopener nofollow" target="_blank" className="underline underline-offset-2">
              {s.title || new URL(s.url).hostname}
            </a>{" "}
            · {new URL(s.url).hostname.replace(/^www\./, "")} · retrieved{" "}
            {new Date(s.fetchedAt).toLocaleDateString("en-US", {
              year: "numeric",
              month: "short",
              day: "numeric",
              timeZone: "UTC",
            })}
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Renders portable article blocks (C-1). Disclosure and rel="sponsored" are enforced here, so no
 * author or model output can publish a monetised link without them (FR-AFF-14).
 */
export function ArticleRenderer({ model }: { model: RenderModel }) {
  const order = citationOrder(model.blocks);
  const ctx: InlineContext = {
    goHref: model.goHref ?? defaultGoHref,
    directLinks: model.directLinks,
    citationNumber: (id) => order.indexOf(id) + 1,
  };
  return (
    <div className="article">
      {hasMonetisedLinks(model.blocks) ? <AffiliateDisclosure href={model.disclosureHref} /> : null}
      {model.blocks.map((block) => (
        <BlockView key={block.id} block={block} model={model} ctx={ctx} />
      ))}
      <SourcesList model={model} order={order} />
    </div>
  );
}

/** Sticky bottom CTA on mobile (FR-WEB-5, placement "sticky_mobile"). */
export function StickyCta({ href, label, score }: { href: string; label: string; score?: number | null }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg/95 p-3 backdrop-blur md:hidden">
      <div className="flex items-center gap-3">
        {typeof score === "number" ? <ScoreBadge score={score} size="sm" /> : null}
        <a
          href={href}
          rel={SPONSORED_REL}
          target="_blank"
          className="flex h-11 flex-1 items-center justify-center rounded-md bg-brand text-sm font-semibold text-brand-fg"
        >
          {label}
        </a>
      </div>
    </div>
  );
}

export type { ArticleBody };
