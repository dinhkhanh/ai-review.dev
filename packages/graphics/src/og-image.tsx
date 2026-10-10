/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { Resvg } from "@resvg/resvg-js";
import { scoreBand, tokens } from "@repo/ui/tokens";
import satori from "satori";
import { loadFonts } from "./fonts";

export interface OgImageInput {
  title: string;
  /** e.g. "Review", "Comparison". */
  kicker?: string;
  category?: string;
  /** Overall score 0-10; omitted for non-review pages. */
  score?: number;
  siteName?: string;
  /** Draw Satori layout boxes (development only). */
  debug?: boolean;
}

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
/** Layout stays at 1200×630; the PNG is rasterized at this multiple so text stays sharp on hi-DPI cards. */
export const OG_SCALE = 2;

/**
 * Deterministic, brand-consistent Open Graph image (FR-MED-1). No generative model involved.
 * Returns PNG bytes at OG_SCALE × the layout size; the caller uploads to R2 and records a media asset.
 */
export async function renderOgImage(input: OgImageInput): Promise<{ png: Buffer; svg: string }> {
  const c = tokens.color.dark;
  const band = input.score !== undefined ? scoreBand(input.score) : null;
  const svg = await satori(
    <div
      style={{
        width: OG_WIDTH,
        height: OG_HEIGHT,
        // Satori sizes the root as content-box; without this the padding pushes content off-canvas.
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        background: `linear-gradient(135deg, ${c.bg} 0%, ${c.surface} 100%)`,
        color: c.text,
        fontFamily: "Inter",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 28, color: c.muted }}>
        <div style={{ display: "flex", width: 14, height: 14, borderRadius: 7, background: c.brand }} />
        <span>{input.kicker ?? "Review"}</span>
        {input.category ? <span>· {input.category}</span> : null}
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 48 }}>
        <div
          style={{
            display: "flex",
            flex: 1,
            minWidth: 0,
            fontSize: input.title.length > 48 ? 60 : 76,
            fontWeight: 700,
            lineHeight: 1.08,
          }}
        >
          {input.title}
        </div>
        {band && input.score !== undefined ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              width: 200,
              height: 200,
              borderRadius: "50%",
              border: `10px solid ${band.color}`,
            }}
          >
            <span style={{ fontSize: 72, fontWeight: 700 }}>{input.score.toFixed(1)}</span>
            <span style={{ fontSize: 22, color: c.muted }}>{band.label}</span>
          </div>
        ) : null}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 26, color: c.muted }}>
        <span>{input.siteName ?? "ai-review.dev"}</span>
      </div>
    </div>,
    { width: OG_WIDTH, height: OG_HEIGHT, fonts: await loadFonts(), debug: input.debug ?? false },
  );
  const png = new Resvg(svg, { fitTo: { mode: "width", value: OG_WIDTH * OG_SCALE } }).render().asPng();
  return { png: Buffer.from(png), svg };
}
