/** @jsxRuntime automatic */
import { AbsoluteFill, Audio, Sequence, useVideoConfig } from "remotion";
import type { VideoInputProps } from "../types";
import { Captions } from "./captions";
import { useBrandFont } from "./fonts";
import { Scene } from "./scenes";

/** One review video (short or long; the frame size comes from the composition). */
export function ReviewVideo(props: VideoInputProps) {
  const family = useBrandFont(props.fontUrls);
  const { width, height } = useVideoConfig();
  const u = Math.min(width, height) / 1080;
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 20% 0%, ${props.theme.surface} 0%, ${props.theme.bg} 60%)`,
        fontFamily: family ? `${family}, ${props.theme.font}` : props.theme.font,
        color: props.theme.text,
      }}
    >
      {props.scenes.map((scene) => (
        <Sequence key={scene.id} from={scene.startFrame} durationInFrames={scene.durationFrames} name={scene.id}>
          <Scene scene={scene} props={props} />
        </Sequence>
      ))}
      <Captions props={props} />
      <AbsoluteFill style={{ justifyContent: "flex-end", padding: 36 * u, pointerEvents: "none" }}>
        <div style={{ color: props.theme.muted, fontSize: 28 * u, fontWeight: 700, opacity: 0.8 }}>ai-review.dev</div>
      </AbsoluteFill>
      {props.audioUrl ? <Audio src={props.audioUrl} /> : null}
      {props.musicUrl ? <Audio src={props.musicUrl} volume={0.06} loop /> : null}
    </AbsoluteFill>
  );
}
