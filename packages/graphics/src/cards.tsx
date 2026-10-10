/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { Resvg } from "@resvg/resvg-js";
import { scoreBand, tokens } from "@repo/ui/tokens";
import type { ReactNode } from "react";
import satori from "satori";
import { loadFonts } from "./fonts";

/** Templated, deterministic cards (FR-MED-1). Light theme, brand tokens, 1200×675 unless noted. */

const c = tokens.color.light;
export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 675;

async function render(node: ReactNode, width: number, height: number) {
  const svg = await satori(node as never, { width, height, fonts: await loadFonts() });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
  return { png: Buffer.from(png), svg };
}

function Frame({ title, kicker, children }: { title: string; kicker: string; children: ReactNode }) {
  return (
    <div
      style={{
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        padding: 56,
        background: c.bg,
        color: c.text,
        fontFamily: "Inter",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 24, color: c.muted }}>
        <div style={{ display: "flex", width: 12, height: 12, borderRadius: 6, background: c.brand }} />
        <span>{kicker}</span>
      </div>
      <div style={{ display: "flex", marginTop: 12, fontSize: 48, fontWeight: 700, lineHeight: 1.1 }}>{title}</div>
      <div style={{ display: "flex", flex: 1, marginTop: 32, minHeight: 0 }}>{children}</div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 20, color: c.muted }}>
        <span>ai-review.dev</span>
      </div>
    </div>
  );
}

export interface PricingCardInput {
  productName: string;
  verifiedAt: Date;
  tiers: Array<{ name: string; price: number | null; currency: string; period: string; highlights: string[] }>;
}

const PERIOD: Record<string, string> = { month: "/mo", year: "/yr", one_time: " once", usage: " usage", custom: "" };

export function formatPrice(price: number | null, currency: string, period: string): string {
  if (price === null) return "Custom";
  if (price === 0) return "Free";
  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: price % 1 === 0 ? 0 : 2,
  }).format(price);
  return `${amount}${PERIOD[period] ?? ""}`;
}

export async function renderPricingCard(input: PricingCardInput) {
  const tiers = input.tiers.slice(0, 4);
  return render(
    <Frame title={`${input.productName} pricing`} kicker={`Verified ${input.verifiedAt.toISOString().slice(0, 10)}`}>
      <div style={{ display: "flex", gap: 20, width: "100%" }}>
        {tiers.map((t) => (
          <div
            key={t.name}
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              padding: 24,
              borderRadius: 16,
              border: `2px solid ${c.border}`,
              background: c.surface,
            }}
          >
            <span style={{ fontSize: 26, fontWeight: 700 }}>{t.name}</span>
            <span style={{ fontSize: 40, fontWeight: 700, marginTop: 8, color: c.brand }}>
              {formatPrice(t.price, t.currency, t.period)}
            </span>
            <div
              style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16, fontSize: 19, color: c.muted }}
            >
              {t.highlights.slice(0, 4).map((h) => (
                <span key={h}>• {h.length > 48 ? `${h.slice(0, 47)}…` : h}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Frame>,
    CARD_WIDTH,
    CARD_HEIGHT,
  );
}

export async function renderProsConsCard(input: { productName: string; pros: string[]; cons: string[] }) {
  const column = (label: string, items: string[], color: string, mark: string) => (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 14 }}>
      <span style={{ fontSize: 28, fontWeight: 700, color }}>{label}</span>
      {items.slice(0, 5).map((item) => (
        <div key={item} style={{ display: "flex", gap: 12, fontSize: 22, lineHeight: 1.3 }}>
          <span style={{ color, fontWeight: 700 }}>{mark}</span>
          <span>{item.length > 70 ? `${item.slice(0, 69)}…` : item}</span>
        </div>
      ))}
    </div>
  );
  return render(
    <Frame title={`${input.productName}: pros and cons`} kicker="Our take">
      <div style={{ display: "flex", gap: 48, width: "100%" }}>
        {column("Pros", input.pros, c.success, "+")}
        {column("Cons", input.cons, c.danger, "−")}
      </div>
    </Frame>,
    CARD_WIDTH,
    CARD_HEIGHT,
  );
}

export const BADGE_SIZE = 400;

export async function renderScoreBadge(input: { score: number; productName: string }) {
  const band = scoreBand(input.score);
  return render(
    <div
      style={{
        width: BADGE_SIZE,
        height: BADGE_SIZE,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: c.bg,
        borderRadius: 32,
        border: `12px solid ${band.color}`,
        fontFamily: "Inter",
        color: c.text,
      }}
    >
      <span style={{ fontSize: 120, fontWeight: 700, lineHeight: 1 }}>{input.score.toFixed(1)}</span>
      <span style={{ fontSize: 30, color: band.color, fontWeight: 700, marginTop: 8 }}>{band.label}</span>
      <span style={{ fontSize: 20, color: c.muted, marginTop: 16 }}>ai-review.dev</span>
    </div>,
    BADGE_SIZE,
    BADGE_SIZE,
  );
}
