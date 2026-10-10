/** @jsxRuntime automatic */
import { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { captionLines } from "../timeline";
import type { VideoInputProps } from "../types";

/** Word-level captions (FR-VID-3): the current line, with the spoken word highlighted. */
export function Captions({ props }: { props: VideoInputProps }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const lines = useMemo(() => captionLines(props.captions, height > width ? 4 : 7), [props.captions, width, height]);
  const ms = (frame / fps) * 1000;
  const line = lines.find((l) => ms >= l[0]!.startMs - 100 && ms <= l[l.length - 1]!.endMs + 250);
  if (!line) return null;
  const portrait = height > width;
  const u = Math.min(width, height) / 1080;
  return (
    <AbsoluteFill
      style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: portrait ? 330 * u : 90 * u }}
    >
      <div
        style={{
          maxWidth: portrait ? 940 * u : 1500 * u,
          background: "rgba(0,0,0,0.72)",
          borderRadius: 20 * u,
          padding: `${16 * u}px ${28 * u}px`,
          textAlign: "center",
          fontSize: (portrait ? 64 : 52) * u,
          fontWeight: 700,
          lineHeight: 1.25,
        }}
      >
        {line.map((w, i) => {
          // The spoken word stays lit until the next one starts (no gaps, never two at once).
          const next = line[i + 1]?.startMs ?? w.endMs + 250;
          return (
            <span key={i} style={{ color: ms >= w.startMs && ms < next ? props.theme.accent : "#fff" }}>
              {w.word}{" "}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}
