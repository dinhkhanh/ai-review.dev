/** @jsxRuntime automatic */
import { Composition, type CalculateMetadataFunction } from "remotion";
import { COMPOSITION_IDS, DEFAULT_THEME, VIDEO_DIMENSIONS, VIDEO_FPS, type VideoInputProps } from "../types";
import { ReviewVideo } from "./Video";

/** Placeholder props for the Remotion studio; real renders always pass input props. */
export const SAMPLE_PROPS: VideoInputProps = {
  kind: "long",
  theme: DEFAULT_THEME,
  product: { name: "Example", logoUrl: null, category: "Productivity" },
  title: "Example review",
  score: 8.2,
  verdict: { summary: "A solid pick for small teams.", bestFor: ["Small teams"] },
  pricing: [
    { name: "Free", price: 0, currency: "USD", period: "month" },
    { name: "Pro", price: 12, currency: "USD", period: "month" },
  ],
  pros: ["Fast setup", "Fair pricing"],
  cons: ["Few integrations"],
  comparison: null,
  goUrl: "https://ai-review.dev/reviews/example",
  disclosure: "We may earn a commission if you buy through our links.",
  scenes: [
    { id: "s1", visual: "title", onScreenText: "Example review", imageUrl: null, startFrame: 0, durationFrames: 60 },
    { id: "s2", visual: "score", onScreenText: "Great value", imageUrl: null, startFrame: 60, durationFrames: 60 },
    { id: "s3", visual: "outro", onScreenText: "Full review", imageUrl: null, startFrame: 120, durationFrames: 60 },
  ],
  captions: [],
  audioUrl: null,
  musicUrl: null,
  fontUrls: null,
  durationInFrames: 180,
};

const metadata: CalculateMetadataFunction<VideoInputProps> = ({ props }) => ({
  durationInFrames: Math.max(1, props.durationInFrames),
  fps: VIDEO_FPS,
  ...VIDEO_DIMENSIONS[props.kind],
});

export function RemotionRoot() {
  return (
    <>
      <Composition
        id={COMPOSITION_IDS.short}
        component={ReviewVideo}
        defaultProps={{ ...SAMPLE_PROPS, kind: "short" }}
        calculateMetadata={metadata}
        fps={VIDEO_FPS}
        durationInFrames={SAMPLE_PROPS.durationInFrames}
        {...VIDEO_DIMENSIONS.short}
      />
      <Composition
        id={COMPOSITION_IDS.long}
        component={ReviewVideo}
        defaultProps={SAMPLE_PROPS}
        calculateMetadata={metadata}
        fps={VIDEO_FPS}
        durationInFrames={SAMPLE_PROPS.durationInFrames}
        {...VIDEO_DIMENSIONS.long}
      />
    </>
  );
}
