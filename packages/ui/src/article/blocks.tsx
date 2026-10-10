import type { Block } from "@repo/content";
import { scoreBand } from "../tokens";
import { InlineText, SPONSORED_REL, type InlineContext } from "./inline";
import { headingId, type RenderModel } from "./model";

const PERIOD: Record<string, string> = {
  month: "/month",
  year: "/year",
  one_time: " one-time",
  usage: " usage-based",
  custom: "",
};

export function formatTierPrice(price: number | null, currency: string, period: string): string {
  if (price === null) return "Custom";
  if (price === 0) return "Free";
  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: price % 1 === 0 ? 0 : 2,
  }).format(price);
  return `${amount}${PERIOD[period] ?? ""}`;
}

function formatDate(value: string | Date) {
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function ScoreBadge({ score, size = "md" }: { score: number; size?: "sm" | "md" | "lg" }) {
  const band = scoreBand(score);
  const dims = size === "lg" ? "h-20 w-20 text-3xl" : size === "sm" ? "h-9 w-9 text-sm" : "h-14 w-14 text-xl";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full border-4 font-bold tabular-nums ${dims}`}
      style={{ borderColor: band.color }}
      aria-label={`Score ${score.toFixed(1)} out of 10 (${band.label})`}
    >
      {score.toFixed(1)}
    </span>
  );
}

export function CtaButton({
  href,
  label,
  note,
  direct,
}: {
  href: string;
  label: string;
  note?: string;
  direct?: boolean;
}) {
  return (
    <div className="my-6 flex flex-col items-start gap-1.5">
      <a
        href={href}
        rel={SPONSORED_REL}
        target="_blank"
        className="inline-flex h-12 items-center justify-center rounded-md bg-brand px-6 text-base font-semibold text-brand-fg hover:opacity-90"
        data-direct={direct ? "true" : undefined}
      >
        {label} <span aria-hidden="true">&nbsp;→</span>
      </a>
      {note ? <span className="text-xs text-muted">{note}</span> : null}
    </div>
  );
}

export function BlockView({ block, model, ctx }: { block: Block; model: RenderModel; ctx: InlineContext }) {
  switch (block.type) {
    case "heading": {
      const Tag = block.level === 2 ? "h2" : "h3";
      return (
        <Tag
          id={headingId(block.text)}
          className={
            block.level === 2 ? "mt-12 scroll-mt-20 text-2xl font-bold tracking-tight" : "mt-8 text-xl font-semibold"
          }
        >
          {block.text}
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p className="mt-4 leading-7">
          <InlineText inlines={block.children} ctx={ctx} />
        </p>
      );
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag className={`mt-4 space-y-1.5 pl-6 leading-7 ${block.ordered ? "list-decimal" : "list-disc"}`}>
          {block.items.map((item, i) => (
            <li key={i}>
              <InlineText inlines={item} ctx={ctx} />
            </li>
          ))}
        </Tag>
      );
    }
    case "verdict":
      return (
        <section aria-label="Verdict" className="mt-6 rounded-lg border border-border bg-surface p-5">
          <div className="flex items-start gap-4">
            <ScoreBadge score={block.score} size="lg" />
            <div>
              <p className="text-sm font-medium uppercase tracking-wide text-muted">Our verdict</p>
              <p className="mt-1 text-lg leading-7">{block.summary}</p>
            </div>
          </div>
          {block.bestFor.length || block.notFor.length ? (
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-sm font-semibold text-success">Best for</p>
                <ul className="mt-1.5 space-y-1 text-sm">
                  {block.bestFor.map((x) => (
                    <li key={x}>✓ {x}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-sm font-semibold text-danger">Not for</p>
                <ul className="mt-1.5 space-y-1 text-sm">
                  {block.notFor.map((x) => (
                    <li key={x}>✗ {x}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </section>
      );
    case "rubric":
      return (
        <div className="mt-6 space-y-4">
          {block.dimensions.map((d) => (
            <div key={d.key}>
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-medium">{d.label}</span>
                <span className="tabular-nums text-sm text-muted">
                  <strong className="text-base text-text">{d.score.toFixed(1)}</strong>/10 · weight{" "}
                  {Math.round(d.weight * 100)}%
                </span>
              </div>
              <div className="mt-1.5 h-2 rounded-full bg-surface" aria-hidden="true">
                <div
                  className="h-2 rounded-full"
                  style={{ width: `${d.score * 10}%`, background: scoreBand(d.score).color }}
                />
              </div>
              <p className="mt-1.5 text-sm text-muted">
                {d.justification}
                {d.citations.map((c) => (
                  <sup key={c.sourceId} className="ml-0.5">
                    <a href={`#source-${ctx.citationNumber(c.sourceId)}`} className="text-brand">
                      [{ctx.citationNumber(c.sourceId)}]
                    </a>
                  </sup>
                ))}
              </p>
            </div>
          ))}
        </div>
      );
    case "pricing_table":
      return (
        <div className="mt-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {block.tiers.map((t) => (
              <div key={t.name} className="rounded-lg border border-border p-4">
                <p className="font-semibold">{t.name}</p>
                <p className="mt-1 text-2xl font-bold tabular-nums">
                  {formatTierPrice(t.price, t.currency, t.period)}
                  {t.citations.slice(0, 1).map((c) => (
                    <sup key={c.sourceId} className="ml-0.5 text-xs font-normal">
                      <a href={`#source-${ctx.citationNumber(c.sourceId)}`} className="text-brand">
                        [{ctx.citationNumber(c.sourceId)}]
                      </a>
                    </sup>
                  ))}
                </p>
                {t.highlights.length ? (
                  <ul className="mt-3 space-y-1 text-sm text-muted">
                    {t.highlights.map((h) => (
                      <li key={h}>• {h}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            Prices verified on {formatDate(block.verifiedAt)}.{" "}
            {model.reportHref ? (
              <a href={model.reportHref} className="underline">
                Report a change
              </a>
            ) : null}
          </p>
        </div>
      );
    case "pros_cons":
      return (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-border p-4">
            <p className="font-semibold text-success">Pros</p>
            <ul className="mt-2 space-y-1.5 text-sm">
              {block.pros.map((p) => (
                <li key={p} className="flex gap-2">
                  <span aria-hidden="true" className="font-bold text-success">
                    +
                  </span>
                  {p}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="font-semibold text-danger">Cons</p>
            <ul className="mt-2 space-y-1.5 text-sm">
              {block.cons.map((c) => (
                <li key={c} className="flex gap-2">
                  <span aria-hidden="true" className="font-bold text-danger">
                    −
                  </span>
                  {c}
                </li>
              ))}
            </ul>
          </div>
        </div>
      );
    case "comparison_table":
      return (
        <div className="mt-6 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[32rem] text-sm">
            <thead className="bg-surface text-left">
              <tr>
                <th scope="col" className="p-3 font-medium">
                  <span className="sr-only">Feature</span>
                </th>
                {block.productIds.map((id) => {
                  const p = model.products[id];
                  return (
                    <th key={id} scope="col" className="p-3 font-semibold">
                      {p?.href ? (
                        <a href={p.href} className="underline underline-offset-2">
                          {p.name}
                        </a>
                      ) : (
                        (p?.name ?? "—")
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => (
                <tr key={row.label} className="border-t border-border">
                  <th scope="row" className="p-3 text-left font-medium text-muted">
                    {row.label}
                  </th>
                  {row.values.map((v, i) => (
                    <td key={i} className="p-3">
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "image": {
      const m = model.media[block.assetId];
      if (!m) return null;
      return (
        <figure className="mt-6">
          <img
            src={m.url}
            srcSet={m.srcSet || undefined}
            sizes="(min-width: 768px) 720px, 100vw"
            width={m.width ?? undefined}
            height={m.height ?? undefined}
            alt={m.alt ?? block.caption ?? ""}
            loading="lazy"
            decoding="async"
            className="h-auto w-full rounded-lg border border-border"
          />
          {block.caption ? <figcaption className="mt-2 text-sm text-muted">{block.caption}</figcaption> : null}
        </figure>
      );
    }
    case "video": {
      // Static thumbnail link (no player JS in the article body; FR-WEB-3). Unknown or not yet
      // uploaded videos render nothing.
      const v = model.videos?.[block.videoId];
      if (!v) return null;
      return (
        <figure className="mt-6">
          <a
            href={v.watchUrl}
            target="_blank"
            rel="noopener"
            className={`relative block overflow-hidden rounded-lg bg-black ${v.vertical ? "aspect-[9/16] max-w-xs" : "aspect-video"}`}
          >
            <img src={v.thumbnailUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="rounded-xl bg-red-600 px-5 py-3 text-sm font-semibold text-white">▶ Watch</span>
            </span>
          </a>
          <figcaption className="mt-2 text-sm text-muted">{v.title}</figcaption>
        </figure>
      );
    }
    case "faq":
      return (
        <div className="mt-6 divide-y divide-border rounded-lg border border-border">
          {block.items.map((item) => (
            <details key={item.question} className="group p-4">
              <summary className="cursor-pointer list-none font-medium marker:hidden">
                <span className="mr-2 inline-block transition-transform group-open:rotate-90" aria-hidden="true">
                  ›
                </span>
                {item.question}
              </summary>
              <p className="mt-2 leading-7 text-muted">
                <InlineText inlines={item.answer} ctx={ctx} />
              </p>
            </details>
          ))}
        </div>
      );
    case "cta": {
      const direct = model.directLinks?.[block.goSlug];
      return (
        <CtaButton
          href={direct ?? ctx.goHref(block.goSlug, block.placement)}
          label={block.label}
          note={block.note}
          direct={!!direct}
        />
      );
    }
    case "callout":
      return (
        <aside
          className={`mt-6 rounded-lg border-l-4 p-4 text-sm leading-6 ${
            block.tone === "warning"
              ? "border-warning bg-warning/10"
              : block.tone === "tip"
                ? "border-success bg-success/10"
                : "border-brand bg-brand/10"
          }`}
        >
          <InlineText inlines={block.children} ctx={ctx} />
        </aside>
      );
    case "sources":
      return null; // Rendered once at the end by ArticleRenderer, numbered by first citation.
  }
}
