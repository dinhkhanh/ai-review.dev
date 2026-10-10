/** @jsxRuntime automatic */
import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { qrPath } from "../qr";
import type { TimedScene, VideoInputProps } from "../types";
import { formatPrice, scoreColor } from "./theme";

type SceneProps = { scene: TimedScene; props: VideoInputProps };

/** Layout helpers: `u` scales sizes from a 1080 px reference; shorts are portrait. */
function useLayout() {
  const { width, height, fps } = useVideoConfig();
  const portrait = height > width;
  return { width, height, fps, portrait, u: Math.min(width, height) / 1080 };
}

function useEnter(delay = 0) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping: 200 }, durationInFrames: 18 });
}

function Fade({ scene, children }: { scene: TimedScene; children: ReactNode }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 8, scene.durationFrames - 6, scene.durationFrames], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
}

function Headline({ text, props, style }: { text: string; props: VideoInputProps; style?: CSSProperties }) {
  const { u } = useLayout();
  const enter = useEnter(4);
  if (!text.trim()) return null;
  return (
    <div
      style={{
        color: props.theme.text,
        fontSize: 64 * u,
        fontWeight: 700,
        lineHeight: 1.15,
        letterSpacing: -1,
        opacity: enter,
        transform: `translateY(${(1 - enter) * 30 * u}px)`,
        ...style,
      }}
    >
      {text}
    </div>
  );
}

function Panel({ props, children, style }: { props: VideoInputProps; children: ReactNode; style?: CSSProperties }) {
  const { u } = useLayout();
  return (
    <div
      style={{
        background: props.theme.surface,
        border: `${2 * u}px solid ${props.theme.border}`,
        borderRadius: 28 * u,
        padding: 40 * u,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Content area clear of captions (bottom) and the brand bar. */
function Stage({ children }: { children: ReactNode }) {
  const { u, portrait } = useLayout();
  return (
    <AbsoluteFill
      style={{
        padding: portrait ? `${180 * u}px ${70 * u}px ${560 * u}px` : `${90 * u}px ${130 * u}px ${230 * u}px`,
        justifyContent: "center",
        gap: 40 * u,
      }}
    >
      {children}
    </AbsoluteFill>
  );
}

function TitleScene({ scene, props }: SceneProps) {
  const { u } = useLayout();
  const enter = useEnter();
  return (
    <Stage>
      <div style={{ display: "flex", alignItems: "center", gap: 36 * u, transform: `scale(${0.9 + enter * 0.1})` }}>
        {props.product.logoUrl ? (
          <Img
            src={props.product.logoUrl}
            style={{ width: 150 * u, height: 150 * u, objectFit: "contain", borderRadius: 28 * u, background: "#fff" }}
          />
        ) : null}
        <div style={{ color: props.theme.text, fontSize: 110 * u, fontWeight: 700, letterSpacing: -3, opacity: enter }}>
          {props.product.name}
        </div>
      </div>
      {props.product.category ? (
        <div
          style={{
            alignSelf: "flex-start",
            color: props.theme.brandFg,
            background: props.theme.brand,
            borderRadius: 999,
            padding: `${10 * u}px ${28 * u}px`,
            fontSize: 34 * u,
            fontWeight: 700,
          }}
        >
          {props.product.category}
        </div>
      ) : null}
      <Headline text={scene.onScreenText || props.title} props={props} style={{ color: props.theme.muted }} />
    </Stage>
  );
}

function ScreenshotScene({ scene, props }: SceneProps) {
  const frame = useCurrentFrame();
  const { u, portrait } = useLayout();
  if (!scene.imageUrl) return <TextScene scene={scene} props={props} />;
  // Subtle Ken Burns: slow zoom and drift across the scene.
  const zoom = interpolate(frame, [0, scene.durationFrames], [1, 1.08], { extrapolateRight: "clamp" });
  const drift = interpolate(frame, [0, scene.durationFrames], [0, -2], { extrapolateRight: "clamp" });
  return (
    <Stage>
      <Headline text={scene.onScreenText} props={props} />
      <div
        style={{
          overflow: "hidden",
          borderRadius: 24 * u,
          border: `${2 * u}px solid ${props.theme.border}`,
          boxShadow: "0 30px 80px rgba(0,0,0,0.5)",
          height: portrait ? 900 * u : 640 * u,
          background: "#fff",
        }}
      >
        <Img
          src={scene.imageUrl}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "top center",
            transform: `scale(${zoom}) translateY(${drift}%)`,
          }}
        />
      </div>
    </Stage>
  );
}

function ScoreScene({ scene, props }: SceneProps) {
  const frame = useCurrentFrame();
  const { u, fps } = useLayout();
  if (props.score === null) return <TextScene scene={scene} props={props} />;
  const progress = spring({ frame, fps, config: { damping: 200 }, durationInFrames: Math.round(fps * 1.4) });
  const value = props.score * progress;
  const color = scoreColor(props.score, props.theme);
  const r = 160;
  const circumference = 2 * Math.PI * r;
  return (
    <Stage>
      <div style={{ display: "flex", alignItems: "center", gap: 60 * u, flexWrap: "wrap" }}>
        <svg width={400 * u} height={400 * u} viewBox="0 0 400 400">
          <circle cx={200} cy={200} r={r} stroke={props.theme.border} strokeWidth={28} fill="none" />
          <circle
            cx={200}
            cy={200}
            r={r}
            stroke={color}
            strokeWidth={28}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - value / 10)}
            transform="rotate(-90 200 200)"
          />
          <text x={200} y={225} textAnchor="middle" fontSize={110} fontWeight={700} fill={props.theme.text}>
            {value.toFixed(1)}
          </text>
          <text x={200} y={285} textAnchor="middle" fontSize={34} fill={props.theme.muted}>
            out of 10
          </text>
        </svg>
        <div style={{ flex: 1, minWidth: 300 * u }}>
          <div style={{ color: props.theme.muted, fontSize: 40 * u }}>Our score</div>
          <Headline text={scene.onScreenText} props={props} />
        </div>
      </div>
    </Stage>
  );
}

function PricingScene({ scene, props }: SceneProps) {
  const { u, portrait, fps } = useLayout();
  const frame = useCurrentFrame();
  const tiers = props.pricing.slice(0, 4);
  if (tiers.length === 0) return <TextScene scene={scene} props={props} />;
  return (
    <Stage>
      <Headline text={scene.onScreenText || "Pricing"} props={props} />
      <div style={{ display: "flex", flexDirection: portrait ? "column" : "row", gap: 28 * u }}>
        {tiers.map((tier, i) => {
          const enter = spring({ frame: frame - 6 - i * 5, fps, config: { damping: 200 }, durationInFrames: 16 });
          return (
            <Panel
              key={tier.name}
              props={props}
              style={{ flex: 1, opacity: enter, transform: `translateY(${(1 - enter) * 40 * u}px)`, padding: 32 * u }}
            >
              <div style={{ color: props.theme.muted, fontSize: 36 * u }}>{tier.name}</div>
              <div style={{ color: props.theme.text, fontSize: 64 * u, fontWeight: 700 }}>{formatPrice(tier)}</div>
            </Panel>
          );
        })}
      </div>
    </Stage>
  );
}

function ListColumn({
  title,
  items,
  color,
  props,
  delay,
}: {
  title: string;
  items: string[];
  color: string;
  props: VideoInputProps;
  delay: number;
}) {
  const { u, fps } = useLayout();
  const frame = useCurrentFrame();
  return (
    <Panel props={props} style={{ flex: 1 }}>
      <div style={{ color, fontSize: 44 * u, fontWeight: 700, marginBottom: 20 * u }}>{title}</div>
      {items.slice(0, 4).map((item, i) => {
        const enter = spring({ frame: frame - delay - i * 6, fps, config: { damping: 200 }, durationInFrames: 14 });
        return (
          <div
            key={item}
            style={{ color: props.theme.text, fontSize: 38 * u, lineHeight: 1.3, marginTop: 14 * u, opacity: enter }}
          >
            {title === "Pros" ? "+ " : "– "}
            {item}
          </div>
        );
      })}
    </Panel>
  );
}

function ProsConsScene({ scene, props }: SceneProps) {
  const { u, portrait } = useLayout();
  if (props.pros.length === 0 && props.cons.length === 0) return <TextScene scene={scene} props={props} />;
  return (
    <Stage>
      <Headline text={scene.onScreenText} props={props} />
      <div style={{ display: "flex", flexDirection: portrait ? "column" : "row", gap: 28 * u }}>
        <ListColumn title="Pros" items={props.pros} color={props.theme.success} props={props} delay={6} />
        <ListColumn title="Cons" items={props.cons} color={props.theme.danger} props={props} delay={18} />
      </div>
    </Stage>
  );
}

function ComparisonScene({ scene, props }: SceneProps) {
  const { u, portrait } = useLayout();
  const cmp = props.comparison;
  if (!cmp || cmp.rows.length === 0) return <TextScene scene={scene} props={props} />;
  const cols = cmp.products.slice(0, portrait ? 3 : 4);
  const cell: CSSProperties = { padding: `${14 * u}px ${18 * u}px`, fontSize: (portrait ? 30 : 34) * u };
  return (
    <Stage>
      <Headline text={scene.onScreenText} props={props} />
      <Panel props={props} style={{ padding: 16 * u }}>
        <table style={{ width: "100%", borderCollapse: "collapse", color: props.theme.text }}>
          <thead>
            <tr>
              <th style={cell} />
              {cols.map((p, i) => (
                <th
                  key={p}
                  style={{ ...cell, textAlign: "left", color: i === 0 ? props.theme.brand : props.theme.muted }}
                >
                  {p}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cmp.rows.slice(0, portrait ? 6 : 5).map((row) => (
              <tr key={row.label} style={{ borderTop: `${2 * u}px solid ${props.theme.border}` }}>
                <td style={{ ...cell, color: props.theme.muted }}>{row.label}</td>
                {cols.map((_, i) => (
                  <td key={i} style={cell}>
                    {(row.values[i] ?? "—").slice(0, 40)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </Stage>
  );
}

function VerdictScene({ scene, props }: SceneProps) {
  const { u } = useLayout();
  return (
    <Stage>
      <div style={{ color: props.theme.brand, fontSize: 44 * u, fontWeight: 700 }}>
        Verdict{props.score !== null ? ` · ${props.score.toFixed(1)}/10` : ""}
      </div>
      <Headline text={scene.onScreenText || props.verdict.summary} props={props} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16 * u }}>
        {props.verdict.bestFor.slice(0, 4).map((b) => (
          <div
            key={b}
            style={{
              color: props.theme.text,
              border: `${2 * u}px solid ${props.theme.border}`,
              borderRadius: 999,
              padding: `${10 * u}px ${24 * u}px`,
              fontSize: 32 * u,
            }}
          >
            Best for: {b}
          </div>
        ))}
      </div>
    </Stage>
  );
}

function OutroScene({ scene, props }: SceneProps) {
  const { u } = useLayout();
  const qr = qrPath(props.goUrl);
  const enter = useEnter(4);
  return (
    <Stage>
      <Headline text={scene.onScreenText || "Read the full review"} props={props} />
      <div style={{ display: "flex", alignItems: "center", gap: 48 * u, flexWrap: "wrap", opacity: enter }}>
        <div style={{ background: "#fff", padding: 24 * u, borderRadius: 24 * u }}>
          <svg
            width={300 * u}
            height={300 * u}
            viewBox={`-2 -2 ${qr.size + 4} ${qr.size + 4}`}
            shapeRendering="crispEdges"
          >
            <path d={qr.d} fill="#000" />
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 320 * u }}>
          <div style={{ color: props.theme.brand, fontSize: 50 * u, fontWeight: 700, wordBreak: "break-all" }}>
            {props.goUrl.replace(/^https?:\/\//, "")}
          </div>
          <div style={{ color: props.theme.muted, fontSize: 30 * u, marginTop: 20 * u }}>{props.disclosure}</div>
        </div>
      </div>
    </Stage>
  );
}

/** Fallback when a scene's data is missing: its on-screen text on the brand background. */
function TextScene({ scene, props }: SceneProps) {
  return (
    <Stage>
      <Headline text={scene.onScreenText || props.title} props={props} />
    </Stage>
  );
}

const SCENES = {
  title: TitleScene,
  screenshot: ScreenshotScene,
  score: ScoreScene,
  pricing: PricingScene,
  pros_cons: ProsConsScene,
  comparison: ComparisonScene,
  verdict: VerdictScene,
  outro: OutroScene,
} as const;

export function Scene(p: SceneProps) {
  const Component = SCENES[p.scene.visual] ?? TextScene;
  return (
    <Fade scene={p.scene}>
      <Component {...p} />
    </Fade>
  );
}
